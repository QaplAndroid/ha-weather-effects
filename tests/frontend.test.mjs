import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// HA serves an ES module, without requiring a package.json in the integration.
const source = await readFile(new URL('../custom_components/weather_effects/frontend/weather-effects.js', import.meta.url), 'utf8');
const { normalizeDashboard, normalizeConfig, effectLayers, matchesDashboard, activeConfigs, WeatherEffectsOverlay, MAX_PARTICLES, EFFECTS, scenePrimitiveCount, allocateBudget, cloudSilhouette, LightningScheduler } =
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
  const context = new Proxy({
    clearCount: 0, drawCount: 0, fillRects: [], fillAlphas: [],
    clearRect() { this.clearCount++; },
    drawImage(image, ...coords) { assert.ok(image, 'sprite must already exist'); assert.ok(coords.every(Number.isFinite)); this.drawCount++; },
    fillRect(...coords) { this.fillRects.push(coords); this.fillAlphas.push(this.globalAlpha); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  }, {
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
  let clock = 0;
  const win = { ...events(), performance: { now: () => clock }, innerWidth: 1200, innerHeight: 800, devicePixelRatio: 3,
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
    clock = time;
    const callbacks = [...raf.values()]; raf.clear();
    callbacks.forEach(callback => callback(time));
  };
  return { win, doc, context, canvases, raf, intervals, motion, connection, tick };
}

test('intensity and lightning normalization is finite, clamped and strictly opt-in', () => {
  assert.deepEqual(config().intensity, {heat: 0, cloud: null, rain: null, wind: null});
  assert.equal(config().lightning_enabled, false);
  assert.equal(config().lightning_interval, 12); assert.equal(config().lightning_brightness, 0.1);
  for (const enabled of [1, 'true', false, null, undefined]) assert.equal(config({lightning_enabled: enabled}).lightning_enabled, false);
  const c = config({intensity: {heat: Infinity, cloud: -1, rain: 2, wind: '1'}, lightning_interval: 1, lightning_brightness: 99});
  assert.deepEqual(c.intensity, {heat: 0, cloud: 0, rain: 1, wind: null});
  assert.equal(c.lightning_interval, 5); assert.equal(c.lightning_brightness, 0.25);
  assert.equal(config({lightning_interval: Infinity}).lightning_interval, 12);
  assert.equal(config({lightning_interval: 100}).lightning_interval, 60);
  assert.equal(config({lightning_brightness: -1}).lightning_brightness, 0.05);
});

test('one pure lightning scheduler preserves global cooldown across metadata, rebuilds and profiles', () => {
  const scheduler = new LightningScheduler();
  const storm = config({effect: 'storm', lightning_enabled: true, lightning_interval: 5});
  scheduler.update([storm, {...storm, id: 'second'}], true, 0);
  assert.equal(scheduler.step(4999), null);
  assert.equal(scheduler.step(5000).serial, 1);
  assert.equal(scheduler.step(5100).serial, 1);
  assert.equal(scheduler.step(5220), null);
  scheduler.update([{...storm, id: 'renamed'}, storm], true, 6000);
  assert.equal(scheduler.nextAt, 10000);
  assert.equal(scheduler.step(9999), null);
  assert.equal(scheduler.step(10000).serial, 2);
  scheduler.update([storm], false, 10001);
  assert.equal(scheduler.flash, null);
  scheduler.update([storm], true, 20000);
  assert.equal(scheduler.nextAt, 25000, 'resume waits a fresh interval');
  assert.equal(scheduler.step(24999), null);
  assert.equal(scheduler.step(25000).serial, 3);
  scheduler.update([{...storm, lightning_interval: 12}], true, 25001);
  assert.equal(scheduler.flash, null); assert.equal(scheduler.nextAt, 37001);
});

test('heat is sun-only, cloud intensity increases darker coverage, rain and wind are not scaled twice', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = {hass: {connection: conn}};
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  for (const effect of Object.keys(EFFECTS).filter(e => e !== 'off')) {
    conn.callback([config({effect, intensity: {heat: 0}})]);
    assert.equal(overlay.scenes[0].heat.length, 0); assert.equal(overlay.scenes[0].heatGlow.length, 0);
    const oldScenes = overlay.scenes;
    conn.callback([config({effect, intensity: {heat: 1}})]);
    assert.notEqual(overlay.scenes, oldScenes);
    assert.equal(overlay.scenes[0].heat.length > 0, ['sun', 'partlycloudy'].includes(effect), effect);
    const allocations = env.canvases.length;
    env.tick(100); env.tick(200); assert.equal(env.canvases.length, allocations);
  }
  conn.callback([config({effect: 'clouds', intensity: {cloud: 0}})]);
  const light = overlay.scenes[0]; overlay.drawClouds(light, 0); const alpha = env.context.globalAlpha;
  conn.callback([config({effect: 'clouds', intensity: {cloud: 1}})]);
  const heavy = overlay.scenes[0]; overlay.drawClouds(heavy, 0);
  assert.ok(heavy.clouds.length > light.clouds.length);
  assert.equal(light.cloudSprite, 'cloud'); assert.equal(heavy.cloudSprite, 'darkCloud');
  assert.ok(env.context.globalAlpha > alpha);
  conn.callback([config({effect: 'storm', speed: 2, wind: 1, intensity: {rain: 0, wind: 0}})]);
  const counts = ['rain', 'wind'].map(key => overlay.scenes[0][key].length);
  const advance = () => {
    const scene = overlay.scenes[0];
    for (const key of ['rain', 'wind']) Object.assign(scene[key][0], {x: 300, y: 100, depth: 0.5});
    overlay.drawRain(scene, 0.1); overlay.drawWind(scene, 0.1);
    return ['rain', 'wind'].map(key => [scene[key][0].x, scene[key][0].y]);
  };
  const movement = advance();
  conn.callback([config({effect: 'storm', speed: 2, wind: 1, intensity: {rain: 1, wind: 1}})]);
  assert.deepEqual(['rain', 'wind'].map(key => overlay.scenes[0][key].length), counts);
  assert.deepEqual(advance(), movement);
  overlay.stop();
});

test('lightning obeys opt-in, global intervals, motion override, navigation, visibility and stop', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = {hass: {connection: conn}};
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  let time = 0;
  for (const effect of Object.keys(EFFECTS)) {
    conn.callback([config({effect, lightning_enabled: true})]);
    env.tick(time += 13000);
    assert.equal(Boolean(overlay.lightning.flash), ['storm', 'storm_clouds'].includes(effect), effect);
  }
  const storms = Array.from({length: 32}, (_, id) => config({id, effect: 'storm', density: 200,
    lightning_enabled: true, lightning_interval: 5, lightning_brightness: 0.25, respect_reduced_motion: false}));
  conn.callback(storms); env.tick(time += 5000);
  assert.ok(overlay.lightning.flash);
  assert.ok(overlay.scenes.reduce((sum, s) => sum + scenePrimitiveCount(s), 1) <= MAX_PARTICLES);
  const serial = overlay.lightning.serial, allocations = env.canvases.length, bolt = overlay.bolt;
  const due = overlay.lightning.nextAt;
  conn.callback(storms.map(c => ({...c, id: 'metadata-' + c.id})));
  assert.equal(overlay.lightning.nextAt, due);
  conn.callback(storms.map(c => ({...c, size: 2})));
  assert.equal(overlay.lightning.nextAt, due, 'visual rebuild cannot reset cooldown');
  env.tick(time += 250); assert.equal(overlay.lightning.flash, null);
  env.tick(due - 1); assert.equal(overlay.lightning.serial, serial);
  env.context.fillRects.length = 0;
  env.tick(time = due + 50);
  assert.equal(overlay.lightning.serial, serial + 1);
  assert.equal(env.context.fillRects.length, 1, 'only one wash across 32 profiles');
  assert.equal(env.canvases.length, allocations); assert.equal(overlay.bolt, bolt);
  const clear = env.context.clearCount;
  env.motion.matches = true; env.motion.dispatch('change');
  assert.equal(overlay.lightning.flash, null); assert.ok(env.context.clearCount > clear);
  assert.equal(env.raf.size, 1, 'motion override still permits ordinary weather, never lightning');
  env.tick(time += 20000); assert.equal(overlay.lightning.flash, null);
  env.motion.matches = false; env.motion.dispatch('change');
  assert.equal(overlay.lightning.nextAt, time + 5000);
  env.tick(time += 5000); assert.ok(overlay.lightning.flash);
  conn.callback(storms.map(c => ({...c, lightning_enabled: false})));
  assert.equal(overlay.lightning.flash, null, 'toggle off is synchronous');
  conn.callback(storms);
  for (const state of ['hidden', 'route']) {
    env.tick(time += 5000); assert.ok(overlay.lightning.flash);
    if (state === 'hidden') { env.doc.hidden = true; env.doc.dispatch('visibilitychange'); }
    else { env.win.location.pathname = '/config'; env.win.dispatch('location-changed'); }
    assert.equal(overlay.lightning.flash, null); assert.equal(env.raf.size, 0);
    env.tick(time += 10000);
    if (state === 'hidden') { env.doc.hidden = false; env.doc.dispatch('visibilitychange'); }
    else { env.win.location.pathname = '/lovelace'; env.win.dispatch('location-changed'); }
    assert.equal(overlay.lightning.nextAt, time + 5000);
    env.tick(time += 100); assert.equal(overlay.lightning.flash, null);
    env.tick(time += 4900); assert.ok(overlay.lightning.flash);
    // End each round without an active pulse, while retaining the cooldown.
    env.tick(time += 250);
  }
  overlay.stop(); assert.equal(overlay.lightning.flash, null);
  assert.equal(overlay.stepLightning(time + 100000), null);
});

test('heat, lightning bolt and wash share the global cap and bounded reusable raster cache', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = {hass: {connection: conn}};
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  conn.callback(Array.from({length: 32}, (_, id) => config({id, effect: id % 2 ? 'partlycloudy' : 'storm',
    density: 200, intensity: {heat: 1, cloud: 1}, lightning_enabled: true, lightning_interval: 5,
    lightning_brightness: 0.25})));
  assert.ok(overlay.scenes.some(scene => scene.heat.length));
  assert.ok(overlay.scenes.reduce((sum, scene) => sum + scenePrimitiveCount(scene), 2) <= MAX_PARTICLES);
  const allocations = env.canvases.length, bolt = overlay.bolt;
  env.context.fillAlphas.length = 0;
  overlay.drawLightning(5000); assert.equal(env.context.fillAlphas.at(-1), 0.25);
  overlay.drawLightning(5110); assert.equal(env.context.fillAlphas.at(-1), 0.0625);
  const paints = env.context.fillAlphas.length;
  overlay.drawLightning(5220); assert.equal(env.context.fillAlphas.length, paints);
  for (let time = 5300; time < 10000; time += 100) env.tick(time);
  assert.equal(env.canvases.length, allocations); assert.equal(overlay.bolt, bolt);
  assert.ok(overlay.sprites.size <= 13);
  overlay.stop();
});

test('cloud sprites use closed lobed silhouettes, distinct variants and stronger adjustable contrast', () => {
  const paths = [0, 1].map(variant => {
    const calls = [];
    const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
    cloudSilhouette(ctx, variant);
    assert.equal(calls[0][0], 'beginPath');
    assert.equal(calls.at(-1)[0], 'closePath');
    assert.equal(calls.filter(call => call[0] === 'bezierCurveTo').length, 8);
    assert.ok(calls.flatMap(call => call.slice(1)).every(Number.isFinite));
    return calls;
  });
  assert.notDeepEqual(paths[0], paths[1]);
  const env = mockEnvironment(), overlay = new WeatherEffectsOverlay(env.win, env.doc);
  overlay.dpr = 1;
  const cloud = overlay.sprite('cloud0');
  assert.equal(overlay.sprite('cloud0'), cloud, 'silhouette remains cached');
  overlay.ctx = env.context; overlay.width = 1200; overlay.height = 800;
  const scene = {config: config({opacity: 0.65}), cloudSprite: 'cloud', time: 0,
    clouds: [{x: 200, y: 100, depth: 0.6, scale: 1, phase: 0, variant: 0}]};
  overlay.drawClouds(scene, 0);
  assert.ok(env.context.globalAlpha > 0.45 && env.context.globalAlpha < 0.65);
  scene.config.opacity = 0.1; overlay.drawClouds(scene, 0);
  assert.ok(env.context.globalAlpha < 0.1, 'user opacity still controls clouds');
});

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
  const expected = {
    off: [], snow: ['snow'], rain: ['rain'], sun: ['sun'], clouds: ['clouds'],
    partlycloudy: ['sun', 'clouds'], rain_clouds: ['clouds', 'rain'], snow_clouds: ['clouds', 'snow'],
    fog: ['fog'], wind: ['wind'], wind_clouds: ['clouds', 'wind'], night: ['night'],
    night_clouds: ['night', 'clouds'], hail: ['clouds', 'hail'], sleet: ['clouds', 'rain', 'snow'],
    downpour: ['clouds', 'downpour'], storm: ['storm_clouds', 'wind', 'rain'], storm_clouds: ['storm_clouds', 'wind'],
  };
  assert.equal(Object.keys(expected).length, 18);
  assert.deepEqual(Object.keys(EFFECTS).sort(), Object.keys(expected).sort());
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
  for (const effect of Object.keys(EFFECTS)) {
    conn.callback([config({ effect })]);
    const allocations = env.canvases.length;
    env.tick(time += 100); env.tick(time += 40);
    assert.equal(env.raf.size, effect === 'off' ? 0 : 1, effect);
    assert.equal(env.canvases.length, allocations, `${effect}: no per-frame canvases`);
  }
  conn.callback(Array.from({ length: 32 }, (_, i) => config({ id: String(i), effect: 'snow_clouds', density: 200, max_fps: 15 })));
  assert.ok(overlay.scenes.reduce((n, scene) => n + scenePrimitiveCount(scene), 0) <= MAX_PARTICLES);
  env.tick(time += 100); const count = env.context.clearCount;
  env.tick(time + 10); assert.equal(env.context.clearCount, count);
  env.tick(time + 70); assert.equal(env.context.clearCount, count + 1);
  env.win.innerWidth = 400; env.win.dispatch('resize'); assert.equal(overlay.canvas.width, 800);
  assert.equal(env.doc.body.children.length, 1);
  overlay.stop();
});

test('one shared budget includes every visual layer across mixed and worst-case scenes', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = { hass: { connection: conn } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  const effects = Object.keys(EFFECTS).filter(effect => effect !== 'off');
  let time = 0;
  for (const variant of [...effects, 'mixed']) {
    conn.callback(Array.from({ length: 32 }, (_, i) => config({
      id: String(i), effect: variant === 'mixed' ? effects[i % effects.length] : variant,
      density: 200, size: 3, speed: 3, wind: i % 2 ? -2 : 2,
    })));
    const count = overlay.scenes.reduce((sum, scene) => sum + scenePrimitiveCount(scene), 0);
    const independentlyCounted = overlay.scenes.reduce((sum, scene) => sum + Object.values(scene).reduce((n, value) =>
      n + (Array.isArray(value) && value !== scene.layers ? value.length : 0), 0), 0);
    assert.equal(count, independentlyCounted, variant);
    assert.ok(count > 0 && count <= MAX_PARTICLES, `${variant}: ${count}`);
    const allocations = env.canvases.length;
    for (let i = 0; i < 4; i++) env.tick(time += 100);
    assert.equal(env.canvases.length, allocations, variant);
    for (const scene of overlay.scenes) {
      for (const key of ['clouds', 'fog', 'wind', 'rain', 'snow', 'hail', 'ripples', 'stars', 'sun', 'moon']) {
        for (const p of scene[key]) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${variant}/${key}`);
      }
    }
  }
  assert.ok(overlay.sprites.size <= 12);
  overlay.stop();
});

test('integer budget allocator is safe at zero and tiny budgets without starving the global bound', () => {
  assert.deepEqual(allocateBudget([], 0), []);
  assert.deepEqual(allocateBudget([0, 0], 0), [0, 0]);
  assert.deepEqual(allocateBudget([3, 2, 1], 0), [0, 0, 0]);
  assert.deepEqual(allocateBudget([3, 2, 1], -1), [0, 0, 0]);
  assert.deepEqual(allocateBudget([1, 2], 10), [1, 2]);
  assert.equal(scenePrimitiveCount({}), 0);
  for (let budget = 0; budget < 20; budget++) {
    const counts = allocateBudget([200, 7, 14, 1, 40, 0], budget);
    assert.equal(counts.reduce((a, b) => a + b, 0), budget);
    assert.ok(counts.every(n => Number.isInteger(n) && n >= 0));
    assert.equal(counts.at(-1), 0);
  }
});

test('sprites are reused across scene changes and size-only resizes, and released on stop', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = { hass: { connection: conn } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  let time = 0;
  for (const effect of Object.keys(EFFECTS)) { conn.callback([config({ effect })]); env.tick(time += 100); }
  assert.equal(overlay.sprites.size, 12);
  const sprites = new Map(overlay.sprites), allocations = env.canvases.length;
  for (const effect of Object.keys(EFFECTS)) {
    conn.callback([config({ effect, size: 2, opacity: 0.4, density: 200 })]);
    for (let i = 0; i < 3; i++) env.tick(time += 100);
  }
  assert.equal(env.canvases.length, allocations);
  for (const [name, canvas] of sprites) {
    assert.equal(overlay.sprites.get(name), canvas, name);
    assert.ok(canvas.width <= 640 && canvas.height <= 512, name);
  }
  assert.equal(overlay.sprite('unsupported-key'), null);
  assert.equal(env.canvases.length, allocations);
  env.win.innerWidth = 900; env.win.dispatch('resize');
  assert.equal(env.canvases.length, allocations, 'viewport resize reuses DPR-independent size sprites');
  conn.callback([config({ effect: 'snow_clouds' })]);
  env.win.devicePixelRatio = 1; env.win.dispatch('resize');
  assert.equal(overlay.canvas.width, 900);
  assert.notEqual(overlay.sprites.get('snow0'), sprites.get('snow0'), 'DPR change invalidates raster resolution');
  const afterResize = env.canvases.length;
  env.tick(time += 100); env.tick(time += 100);
  assert.equal(env.canvases.length, afterResize);
  overlay.stop();
  assert.equal(overlay.sprites.size, 0);
});

test('identical websocket visual configs preserve scene identity, time and particle positions', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = { hass: { connection: conn } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  conn.callback([config({ effect: 'sleet' })]); env.tick(0); env.tick(100);
  const scenes = overlay.scenes, scene = scenes[0], time = scene.time, rain = scene.rain[0], x = rain.x, y = rain.y;
  conn.callback([config({ effect: 'sleet' })]);
  assert.equal(overlay.scenes, scenes); assert.equal(scene.time, time);
  assert.equal(scene.rain[0], rain); assert.equal(rain.x, x); assert.equal(rain.y, y);
  conn.callback([config({ effect: 'sleet', id: 'renamed', dashboards: ['lovelace'], respect_reduced_motion: false })]);
  assert.equal(overlay.scenes, scenes, 'metadata and allow-list changes do not reset unchanged visuals');
  for (const [key, value] of Object.entries({ effect: 'hail', size: 2, density: 100, opacity: 0.4, wind: -1, speed: 2, max_fps: 15 })) {
    const before = overlay.scenes;
    conn.callback([config({ effect: 'sleet', [key]: value })]);
    assert.notEqual(overlay.scenes, before, key);
    conn.callback([config({ effect: 'sleet' })]);
  }
  overlay.stop();
});

test('sleet owns separate rain and snow arrays, each advanced exactly once at its own speed', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = { hass: { connection: conn } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  conn.callback([config({ effect: 'sleet', speed: 2 })]);
  const scene = overlay.scenes[0];
  assert.ok(scene.clouds.length && scene.rain.length && scene.snow.length);
  assert.notEqual(scene.rain, scene.snow);
  const rain = scene.rain[0], snow = scene.snow[0];
  Object.assign(rain, { x: 500, y: 100, depth: 0.5 });
  Object.assign(snow, { x: 500, y: 100, depth: 0.5 });
  env.tick(0); env.tick(100);
  assert.ok(Math.abs(rain.y - (100 + (330 + 470 * 0.5) * 2 * 0.1)) < 1e-9);
  assert.ok(Math.abs(snow.y - (100 + (18 + 43 * 0.5) * 2 * 0.1)) < 1e-9);
  overlay.stop();
});

test('new effects compose distinct particles and storm never paints a fullscreen mask or flash', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = { hass: { connection: conn } };
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  for (const [effect, required] of Object.entries({
    fog: ['fog'], wind: ['wind'], wind_clouds: ['wind', 'clouds'], night: ['stars', 'moon'],
    night_clouds: ['stars', 'moon', 'clouds'], hail: ['clouds', 'hail'],
    sleet: ['clouds', 'rain', 'snow'], downpour: ['clouds', 'rain', 'ripples'],
    storm: ['clouds', 'wind', 'rain'], storm_clouds: ['clouds', 'wind'],
  })) {
    conn.callback([config({ effect })]);
    for (const key of required) assert.ok(overlay.scenes[0][key].length > 0, `${effect}/${key}`);
    if (effect === 'fog') assert.ok(overlay.scenes[0].fog.every(p => p.y >= env.win.innerHeight * 0.72));
  }
  conn.callback([config({ effect: 'rain' })]); const normalRain = overlay.scenes[0].rain.length;
  conn.callback([config({ effect: 'downpour' })]); assert.ok(overlay.scenes[0].rain.length > normalRain * 1.5);
  for (const effect of ['storm', 'storm_clouds']) {
    conn.callback([config({ effect })]);
    assert.equal(overlay.scenes[0].cloudSprite, 'darkCloud');
    env.context.fillRects.length = 0;
    for (let i = 0; i < 30; i++) env.tick(i * 100);
    assert.deepEqual(env.context.fillRects, [], 'all storm painting is local geometry or cached cloud sprites');
  }
  overlay.stop();
});

test('all variants safely render a one-pixel viewport and pause without RAF while hidden', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = { hass: { connection: conn } };
  env.win.innerWidth = 0; env.win.innerHeight = 0;
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  let time = 0;
  for (const effect of Object.keys(EFFECTS)) {
    conn.callback([config({ effect, density: 10, size: 0.3, speed: 3, wind: -2 })]);
    env.tick(time += 100); env.tick(time += 100);
    env.doc.hidden = true; env.doc.dispatch('visibilitychange');
    const clears = env.context.clearCount;
    env.tick(time += 100);
    assert.equal(env.raf.size, 0, effect); assert.equal(env.context.clearCount, clears, effect);
    env.doc.hidden = false; env.doc.dispatch('visibilitychange');
    assert.equal(env.raf.size, effect === 'off' ? 0 : 1, effect);
  }
  assert.equal(overlay.width, 1); assert.equal(overlay.height, 1);
  overlay.stop();
});
