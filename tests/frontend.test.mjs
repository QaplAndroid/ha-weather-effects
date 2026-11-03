import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// HA serves an ES module, without requiring a package.json in the integration.
const source = await readFile(new URL('../custom_components/weather_effects/frontend/weather-effects.js', import.meta.url), 'utf8');
const { normalizeDashboard, normalizeConfig, effectLayers, matchesDashboard, activeConfigs, WeatherEffectsOverlay, MAX_PARTICLES } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const config = (extra = {}) => normalizeConfig({ id: 'test', enabled: true, dashboards: ['lovelace', 'dashboard-home'], effect: 'snow', ...extra });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function mockEnvironment() {
  const events = () => {
    const listeners = new Map();
    return {
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
      dispatch(name) { for (const cb of listeners.get(name) ?? []) cb(); },
      listenerCount() { return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
    };
  };
  const context = new Proxy({ clearCount: 0, clearRect() { this.clearCount++; }, createRadialGradient() { return { addColorStop() {} }; }, createLinearGradient() { return { addColorStop() {} }; } }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
  });
  const canvases = [];
  const doc = { ...events(), hidden: false, root: null,
    querySelector() { return this.root; },
    body: { children: [], appendChild(canvas) { this.children.push(canvas); } },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { style: {}, attributes: {}, hidden: false, getContext: () => context,
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { doc.body.children = doc.body.children.filter(child => child !== this); },
      };
      canvases.push(canvas); return canvas;
    },
  };
  const raf = new Map(), intervals = new Map();
  let id = 0;
  const motion = { ...events(), matches: false };
  const win = { ...events(), innerWidth: 1200, innerHeight: 800, devicePixelRatio: 3,
    location: { pathname: '/lovelace/main', search: '' }, matchMedia: () => motion,
    setInterval(callback, ms) { assert.equal(ms, 1000); intervals.set(++id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame(callback) { raf.set(++id, callback); return id; },
    cancelAnimationFrame(id) { raf.delete(id); },
  };
  const connection = (deferred = false) => {
    const conn = { connected: true, calls: 0, cleanups: 0, callback: null,
      subscribeMessage(callback, message) {
        assert.deepEqual(message, { type: 'weather_effects/subscribe' });
        this.calls++; this.callback = callback;
        const cleanup = () => { this.cleanups++; };
        return deferred ? new Promise(resolve => { this.resolve = () => resolve(cleanup); }) : Promise.resolve(cleanup);
      },
    };
    return conn;
  };
  const tick = time => {
    const callbacks = [...raf.values()]; raf.clear();
    callbacks.forEach(callback => callback(time));
  };
  return { win, doc, context, canvases, raf, intervals, motion, connection, tick };
}

test('dashboard normalization and route matching are exact, not substrings', () => {
  assert.equal(normalizeDashboard(' /Dashboard-Home/ '), 'dashboard-home');
  assert.equal(normalizeDashboard('dashboard/home'), '');
  assert.equal(normalizeDashboard('%ZZ'), '');
  assert.equal(normalizeDashboard('dashboard.home'), '');
  assert.equal(normalizeDashboard('dashboard%2Fhome'), '');
  assert.equal(normalizeDashboard(null), '');
  for (const path of ['/lovelace', '/lovelace/', '/lovelace/kitchen', '/dashboard-home/0', '/DASHBOARD-HOME/0']) {
    assert.equal(matchesDashboard(config(), path), true, path);
  }
  for (const path of ['/', '/lovelace-other/0', '/other/lovelace', '/config', '/dashboard-home-copy/0']) {
    assert.equal(matchesDashboard(config(), path), false, path);
  }
});

test('settings and editors are never decorated, including explicit allow-list entries', () => {
  const reserved = ['config', 'settings', 'editor', 'lovelace-editor', 'developer-tools', 'history', 'logbook', 'energy', 'map', 'calendar', 'todo', 'media-browser'];
  const allowed = config({ dashboards: [...reserved, 'lovelace'] });
  for (const path of [...reserved.map(route => `/${route}`), '/config/lovelace', '/lovelace/editor', '/lovelace/edit']) {
    assert.equal(matchesDashboard(allowed, path), false, path);
  }
  for (const search of ['?edit', '?edit=1', '?edit=0', '?foo=x&edit=true']) {
    assert.equal(matchesDashboard(allowed, '/lovelace/0', search), false);
  }
  assert.equal(matchesDashboard(allowed, '/lovelace/0', '?credit=1'), true);
  assert.equal(matchesDashboard(config({ enabled: false }), '/lovelace'), false);
  assert.equal(matchesDashboard(config({ dashboards: [] }), '/lovelace'), false);
});

test('all effects map to compositable layers; unknown values safely disable', () => {
  const expected = { off: [], snow: ['snow'], rain: ['rain'], sun: ['sun'], clouds: ['clouds'], partlycloudy: ['sun', 'clouds'], rain_clouds: ['clouds', 'rain'], snow_clouds: ['clouds', 'snow'] };
  for (const [effect, layers] of Object.entries(expected)) assert.deepEqual(effectLayers(effect), layers);
  assert.deepEqual(effectLayers('toString'), []);
  assert.deepEqual(effectLayers('unknown'), []);
  const copy = effectLayers('snow'); copy.push('rain');
  assert.deepEqual(effectLayers('snow'), ['snow']);
});

test('runtime values are sanitized and reduced-motion defaults to pausing', () => {
  const c = config({ speed: Infinity, size: 99, density: 999, opacity: -4, wind: -99, max_fps: 100 });
  assert.equal(c.speed, 1); assert.equal(c.size, 3); assert.equal(c.density, 200);
  assert.equal(c.opacity, 0.05); assert.equal(c.wind, -2); assert.equal(c.max_fps, 60);
  assert.equal(c.respect_reduced_motion, true);
  assert.equal(normalizeConfig(null), null);
  assert.equal(normalizeConfig({ enabled: 'true' }).enabled, false);
  const explicit = config({ respect_reduced_motion: false });
  assert.deepEqual(activeConfigs([c, explicit], { pathname: '/lovelace', search: '' }, true), [explicit]);
  assert.deepEqual(activeConfigs([c], { pathname: '/lovelace', search: '' }), [c]);
});

test('lifecycle subscribes once, shares one DPR-capped canvas, and idles on navigation/visibility', async () => {
  const env = mockEnvironment(), conn = env.connection();
  env.doc.root = { hass: { connection: conn } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start();
  await flush();
  assert.equal(conn.calls, 1); assert.equal(env.raf.size, 0);
  conn.callback([config()]);
  assert.equal(env.doc.body.children.length, 1);
  assert.equal(overlay.canvas.width, 2400);
  assert.equal(overlay.canvas.attributes['aria-hidden'], 'true');
  assert.match(overlay.canvas.style.cssText, /pointer-events:none/);
  assert.equal(env.raf.size, 1);
  overlay.poll(); overlay.poll(); await flush(); assert.equal(conn.calls, 1);
  env.tick(0); env.tick(40);
  assert.equal(env.raf.size, 1);
  env.win.location.pathname = '/config'; env.win.dispatch('location-changed');
  assert.equal(env.raf.size, 0); assert.equal(overlay.canvas.hidden, true);
  env.win.location.pathname = '/lovelace'; overlay.poll(); assert.equal(env.raf.size, 1);
  env.doc.hidden = true; env.doc.dispatch('visibilitychange'); assert.equal(env.raf.size, 0);
  env.doc.hidden = false; env.doc.dispatch('visibilitychange'); assert.equal(env.raf.size, 1);
  env.motion.matches = true; env.motion.dispatch('change'); assert.equal(env.raf.size, 0);
  conn.callback([config({ respect_reduced_motion: false })]); assert.equal(env.raf.size, 1);
  conn.callback([]); assert.equal(env.raf.size, 0);
  overlay.stop(); await flush();
  assert.equal(conn.cleanups, 1); assert.equal(env.doc.body.children.length, 0);
  assert.equal(env.intervals.size, 0); assert.equal(env.win.listenerCount(), 0);
  assert.equal(env.doc.listenerCount(), 0); assert.equal(env.motion.listenerCount(), 0);
});

test('connection changes discard stale events and clean up late subscription promises', async () => {
  const env = mockEnvironment(), first = env.connection(true), second = env.connection();
  env.doc.root = { hass: { connection: first } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  first.callback([config()]); assert.equal(env.raf.size, 1);
  env.doc.root.hass = { connection: second }; overlay.poll(); await flush();
  assert.equal(env.raf.size, 0); assert.equal(second.calls, 1);
  first.callback([config()]); assert.equal(overlay.configs.length, 0);
  first.resolve(); await flush(); assert.equal(first.cleanups, 1);
  second.callback([config({ effect: 'rain_clouds' })]); assert.equal(env.raf.size, 1);
  second.connected = false; overlay.poll(); assert.equal(env.raf.size, 0);
  second.connected = true; overlay.poll(); await flush(); assert.equal(second.calls, 2);
  overlay.stop(); await flush(); assert.equal(second.cleanups, 2);
});

test('failed subscriptions back off and can retry without an unhandled rejection', async () => {
  const env = mockEnvironment(), conn = env.connection();
  conn.subscribeMessage = () => { conn.calls++; throw new Error('temporarily unavailable'); };
  env.doc.root = { hass: { connection: conn } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  assert.equal(overlay.pending, false); assert.equal(conn.calls, 1);
  overlay.poll(); await flush(); assert.equal(conn.calls, 1);
  overlay.retryAt = 0; overlay.poll(); await flush(); assert.equal(conn.calls, 2);
  assert.equal(env.raf.size, 0); overlay.stop();
});

test('pending subscription cleanup after stop and missing HA root are safe', async () => {
  const env = mockEnvironment();
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start();
  assert.equal(env.raf.size, 0); overlay.poll();
  const conn = env.connection(true); env.doc.root = { hass: { connection: conn } };
  overlay.poll(); await flush(); overlay.stop(); conn.resolve(); await flush();
  assert.equal(conn.cleanups, 1); assert.equal(env.raf.size, 0);
  conn.callback([config()]); assert.equal(env.doc.body.children.length, 0);
});

test('all rendering combinations run, particle budgets and FPS limits remain bounded', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = { hass: { connection: conn } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  let time = 0;
  for (const effect of ['snow', 'rain', 'sun', 'clouds', 'partlycloudy', 'rain_clouds', 'snow_clouds']) {
    conn.callback([config({ effect })]); env.tick(time += 100); env.tick(time += 40);
    assert.equal(env.raf.size, 1, effect);
  }
  conn.callback(Array.from({ length: 32 }, (_, i) => config({ id: String(i), effect: 'snow_clouds', density: 200, max_fps: 15 })));
  assert.ok(overlay.scenes.reduce((n, scene) => n + scene.particles.length + scene.clouds.length, 0) <= MAX_PARTICLES);
  env.tick(time += 100); const count = env.context.clearCount;
  env.tick(time + 10); assert.equal(env.context.clearCount, count);
  env.tick(time + 70); assert.equal(env.context.clearCount, count + 1);
  env.win.innerWidth = 400; env.win.dispatch('resize'); assert.equal(overlay.canvas.width, 800);
  assert.equal(env.doc.body.children.length, 1);
  overlay.stop();
});
