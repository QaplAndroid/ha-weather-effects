import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// HA serves an ES module, without requiring a package.json in the integration.
const source = await readFile(new URL('../custom_components/weather_effects/frontend/weather-effects.js', import.meta.url), 'utf8');
const { normalizeDashboard, normalizeConfig, effectLayers, matchesDashboard, activeConfigs, WeatherEffectsOverlay, MAX_PARTICLES, EFFECTS, scenePrimitiveCount, allocateBudget, cloudSilhouette, layoutClouds, cloudOverlap, LightningScheduler, LightningGeometry, lightningStage, lightningEligible } =
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
    clearCount: 0, drawCount: 0, fillRects: [], fillAlphas: [], linePoints: [], strokeCount: 0,
    moveTo(x, y) { this.linePoints.push(['move', x, y]); },
    lineTo(x, y) { this.linePoints.push(['line', x, y]); },
    stroke() { this.strokeCount++; },
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

const seededCloudRandom = (initial = 42) => {
  let seed = initial;
  return () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
};
const overlapScore = (clouds, width) => {
  const period = width + Math.max(0, ...clouds.map(p => 320 * p.scale));
  let total = 0;
  for (let i = 0; i < clouds.length; i++) for (let j = 0; j < i; j++) total += cloudOverlap(clouds[i], clouds[j], period);
  return total / Math.max(1, clouds.length * (clouds.length - 1) / 2);
};

test('cloud bounds and spread normalize finite flat effective values independently of intensity/presets', () => {
  assert.deepEqual([config().cloud_top, config().cloud_bottom, config().cloud_spread], [10, 30, 80]);
  for (const [key, fallback] of [['cloud_top', 10], ['cloud_bottom', 30], ['cloud_spread', 80]]) {
    for (const value of [NaN, Infinity, -Infinity, '50', null]) assert.equal(config({[key]: value})[key], fallback);
  }
  const low = config({effect: 'clouds', cloud_top: -10, cloud_bottom: 110, cloud_spread: -10});
  assert.deepEqual([low.cloud_top, low.cloud_bottom, low.cloud_spread], [0, 100, 0]);
  const reversed = config({cloud_top: 90, cloud_bottom: 20, cloud_spread: 110});
  assert.deepEqual([reversed.cloud_top, reversed.cloud_bottom, reversed.cloud_spread], [20, 90, 100]);
  const storm = config({effect: 'storm', cloud_top: 60, cloud_bottom: 80, cloud_spread: 25, intensity: {cloud: 1, cloud_top: 0}});
  assert.deepEqual([storm.cloud_top, storm.cloud_bottom, storm.cloud_spread], [60, 80, 25]);
  assert.deepEqual([low.cloud_top, low.cloud_bottom, low.cloud_spread], [0, 100, 0]);
});

test('cloud layout keeps centers in low/high/extreme bands, deterministic and bounded at tiny/high density', () => {
  const input = Array.from({length: 80}, (_, i) => ({scale: 0.65 + i % 4 * 0.2, depth: 0.5}));
  for (const width of [1, 1200]) for (const height of [1, 800]) {
    for (const [top, bottom] of [[0, 0], [0, 10], [85, 100], [100, 100], [30, 30], [0, 100]]) {
      for (const spread of [0, 100]) {
        const c = config({cloud_top: top, cloud_bottom: bottom, cloud_spread: spread});
        const points = layoutClouds(input, width, height, c, seededCloudRandom());
        assert.deepEqual(points, layoutClouds(input, width, height, c, seededCloudRandom()));
        assert.equal(points.length, input.length);
        for (const p of points) {
          assert.ok(Number.isFinite(p.x + p.y)); assert.ok(p.x >= 0 && p.x <= width);
          assert.ok(p.y >= height * top / 100 - 1e-9 && p.y <= height * bottom / 100 + 1e-9);
        }
      }
    }
  }
  assert.equal(input[0].x, undefined, 'pure helper does not mutate source particles');
  assert.deepEqual(layoutClouds([], 1, 1, config(), seededCloudRandom()), []);
});

test('full spread measurably reduces normalized render-box overlap across fixed RNG seeds', () => {
  const input = Array.from({length: 12}, (_, i) => ({scale: 0.7 + i % 3 * 0.2}));
  let clustered = 0, distributed = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const natural = layoutClouds(input, 1600, 900, config({cloud_top: 10, cloud_bottom: 70, cloud_spread: 0}), seededCloudRandom(seed));
    const spread = layoutClouds(input, 1600, 900, config({cloud_top: 10, cloud_bottom: 70, cloud_spread: 100}), seededCloudRandom(seed));
    clustered += overlapScore(natural, 1600); distributed += overlapScore(spread, 1600);
    assert.ok(overlapScore(spread, 1600) <= overlapScore(natural, 1600) + 1e-9);
  }
  assert.ok(distributed < clustered * 0.35, `${distributed} vs ${clustered}`);
});

test('cloud controls rebuild scenes, metadata retains continuity, full spread preserves drift spacing and band centers', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = {hass: {connection: conn}};
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  let c = config({effect: 'clouds', density: 200, cloud_top: 60, cloud_bottom: 90, cloud_spread: 100});
  conn.callback([c]);
  for (const key of ['cloud_top', 'cloud_bottom', 'cloud_spread']) {
    const scenes = overlay.scenes;
    c = {...c, [key]: c[key] - 5}; conn.callback([c]);
    assert.notEqual(overlay.scenes, scenes, key);
  }
  const scenes = overlay.scenes, particles = scenes[0].clouds;
  conn.callback([{...c, id: 'renamed', title: 'metadata only'}]);
  assert.equal(overlay.scenes, scenes); assert.equal(overlay.scenes[0].clouds, particles);
  c = {...c, cloud_top: 100, cloud_bottom: 100, cloud_spread: 100}; conn.callback([c]);
  const scene = overlay.scenes[0], before = overlapScore(scene.clouds, overlay.width);
  const allocations = env.canvases.length;
  const centers = []; overlay.image = (name, x, y) => centers.push([x, y]);
  for (let frame = 0; frame < 500; frame++) overlay.drawClouds(scene, 0.1);
  assert.ok(centers.every(([x, y]) => Number.isFinite(x) && y === overlay.height));
  assert.ok(Math.abs(overlapScore(scene.clouds, overlay.width) - before) < 1e-10);
  assert.equal(env.canvases.length, allocations);
  assert.doesNotMatch(WeatherEffectsOverlay.prototype.drawClouds.toString(), /layoutClouds|cloudOverlap|createElement|\.map\(/);
  overlay.stop();
});

test('cloud placement controls leave fog banks, fog rendering and cloud intensity counts independent', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = {hass: {connection: conn}};
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  const originalRandom = Math.random;
  try {
    const fog = extra => {
      Math.random = seededCloudRandom(73);
      conn.callback([config({effect: 'fog', ...extra})]);
      return overlay.scenes[0];
    };
    const a = fog({cloud_top: 0, cloud_bottom: 0, cloud_spread: 0});
    const b = fog({cloud_top: 100, cloud_bottom: 100, cloud_spread: 100});
    assert.deepEqual(a.fog, b.fog); assert.equal(a.clouds.length, 0);
    const draws = []; overlay.image = (...args) => draws.push(args);
    overlay.drawFog(a, 0.1); const before = [...draws]; draws.length = 0;
    overlay.drawFog(b, 0.1); assert.deepEqual(draws, before);
    for (const intensity of [0, 1]) {
      conn.callback([config({effect: 'clouds', density: 200, intensity: {cloud: intensity}, cloud_spread: 0})]);
      const count = overlay.scenes[0].clouds.length;
      conn.callback([config({effect: 'clouds', density: 200, intensity: {cloud: intensity}, cloud_top: 100, cloud_bottom: 100, cloud_spread: 100})]);
      assert.equal(overlay.scenes[0].clouds.length, count);
      assert.equal(count, Math.ceil(200 / 22 * (0.35 + 1.65 * intensity)));
    }
  } finally { Math.random = originalRandom; overlay.stop(); }
});

test('new lightning controls retain strict master opt-in, old-profile migration and hard bounds', () => {
  const defaults = {lightning_bolt_enabled: true, lightning_flash_enabled: true,
    lightning_formation_time: 0.8, lightning_duration: 0.7, lightning_branches: 4,
    lightning_thickness: 1.5, lightning_glow: 0.6, lightning_length: 0.6};
  for (const [key, value] of Object.entries(defaults)) assert.equal(config()[key], value, key);
  for (const key of ['lightning_bolt_enabled', 'lightning_flash_enabled']) {
    for (const value of [1, 'true', null, false]) assert.equal(config({[key]: value})[key], false);
  }
  const limits = {lightning_formation_time: [0.1, 3], lightning_duration: [0.3, 2],
    lightning_branches: [0, 8], lightning_thickness: [0.5, 4], lightning_glow: [0, 1], lightning_length: [0.2, 0.9]};
  for (const [key, [low, high]] of Object.entries(limits)) {
    assert.equal(config({[key]: -100})[key], low); assert.equal(config({[key]: 100})[key], high);
    for (const value of [NaN, Infinity, '1', null]) assert.equal(config({[key]: value})[key], defaults[key]);
  }
  assert.equal(config({lightning_branches: 3.6}).lightning_branches, 4);
  assert.equal(lightningEligible(config({effect: 'storm'})), false);
  assert.equal(lightningEligible(config({effect: 'storm', lightning_enabled: true})), true, 'old explicit opt-in keeps both sub-switches');
  assert.equal(lightningEligible(config({effect: 'storm', lightning_enabled: true, lightning_bolt_enabled: false, lightning_flash_enabled: false})), false);
});

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
  assert.equal(scheduler.step(5800).formationTime, 800);
  assert.equal(scheduler.step(6500), null);
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
  assert.equal(scheduler.flash.serial, 3, 'settings do not interrupt an existing strike');
  assert.equal(scheduler.nextAt, 37000, 'cooldown is measured from the previous strike, not metadata arrival');
});

test('composite lightning chooses deterministic conservative controls and never overlaps at maximum duration', () => {
  const a = config({effect: 'storm', lightning_enabled: true, lightning_bolt_enabled: false,
    lightning_formation_time: 3, lightning_duration: 2, lightning_interval: 5, lightning_brightness: 0.2,
    lightning_branches: 8, lightning_thickness: 4, lightning_glow: 1, lightning_length: 0.9});
  const b = config({effect: 'storm_clouds', lightning_enabled: true, lightning_flash_enabled: false,
    lightning_branches: 2, lightning_thickness: 1, lightning_glow: 0.2, lightning_length: 0.3});
  const scheduler = new LightningScheduler(), reversed = new LightningScheduler();
  scheduler.update([a, b], true, 0); reversed.update([b, a], true, 0);
  assert.equal(scheduler.interval, 5500); assert.equal(scheduler.step(5499), null);
  const strike = scheduler.step(5500);
  assert.deepEqual(strike, reversed.step(5500));
  assert.equal(strike.formationTime, 3000); assert.equal(strike.duration, 2000);
  assert.equal(strike.boltEnabled, true); assert.equal(strike.flashEnabled, true);
  assert.equal(strike.brightness, 0.1); assert.equal(strike.branches, 2);
  assert.equal(strike.thickness, 1); assert.equal(strike.glow, 0.2); assert.equal(strike.length, 0.3);
  scheduler.update([b, {...a, id: 'renamed'}], true, 5501);
  assert.equal(scheduler.flash, strike); assert.equal(scheduler.nextAt, 11000);
  assert.equal(scheduler.step(10499), strike); assert.equal(scheduler.step(10500), null);
  assert.equal(scheduler.step(10999), null); assert.equal(scheduler.step(11000).serial, 2);
});

test('leader and delayed branches clip continuously with fixed bounded typed storage', () => {
  let seed = 42;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const geometry = new LightningGeometry(), arrays = [geometry.points, geometry.counts, geometry.attachments, geometry.ends];
  geometry.generate(1200, 800, 0.6, 8, rng);
  assert.equal(geometry.pathCount, 9); assert.ok(geometry.counts[0] >= 33 && geometry.counts[0] <= 49);
  assert.ok(Math.abs(geometry.points[(geometry.counts[0] - 1) * 2 + 1] - geometry.points[1] - 480) < 0.01);
  assert.deepEqual(geometry.visibleStats(0), {paths: 0, segments: 0});
  let previous = 0;
  const stats = {}, snapshot = geometry.points.slice(), serial = geometry.serial;
  const lines = [], ctx = {beginPath() {}, moveTo(x, y) { assert.ok(Number.isFinite(x + y)); }, lineTo(x, y) { lines.push([x, y]); }};
  for (let path = 1; path < geometry.pathCount; path++) {
    assert.ok(geometry.counts[path] <= 13);
    assert.equal(geometry.pathProgress(path, geometry.attachments[path]), 0);
    assert.equal(geometry.pathProgress(path, geometry.attachments[path] + 0.024), 0);
    assert.ok(geometry.pathProgress(path, geometry.attachments[path] + 0.04) > 0);
    assert.equal(geometry.pathProgress(path, 1), 1);
  }
  for (let i = 0; i <= 100; i++) {
    assert.equal(geometry.visibleStats(i / 100, stats), stats);
    assert.ok(stats.segments >= previous && stats.segments <= 144); previous = stats.segments;
    for (let path = 0; path < geometry.pathCount; path++) geometry.trace(ctx, path, i / 100);
  }
  assert.equal(geometry.serial, serial); assert.deepEqual(geometry.points, snapshot);
  assert.equal(geometry.visibleStats(1).paths, 9);
  lines.length = 0; geometry.trace(ctx, 0, 0.5 / (geometry.counts[0] - 1));
  assert.equal(lines.length, 1);
  assert.ok(Math.abs(lines[0][0] - (geometry.points[0] + geometry.points[2]) / 2) < 1e-6);
  assert.ok(Math.abs(lines[0][1] - (geometry.points[1] + geometry.points[3]) / 2) < 1e-6);
  for (let i = 0; i < 50; i++) geometry.generate(1, 1, 0.9, 8, rng);
  [geometry.points, geometry.counts, geometry.attachments, geometry.ends].forEach((array, i) => assert.equal(array, arrays[i]));
  assert.ok(geometry.points.every(Number.isFinite));
  // Guard the actual frame methods, not just their output, against accidental allocation.
  for (const method of [LightningGeometry.prototype.trace, LightningGeometry.prototype.pathProgress,
    WeatherEffectsOverlay.prototype.drawLightning]) assert.doesNotMatch(method.toString(), /new\s+(?:Array|Float\w*Array|Path2D)|createElement|\.slice\(|\.map\(/);
});

test('formation, one return stroke and brief wash have separate monotonic stages', () => {
  const flash = {started: 1000, formationTime: 800, duration: 700, brightness: 0.1}, out = {};
  for (const [time, leader] of [[1000, 0], [1200, 0.25], [1600, 0.75]]) {
    assert.equal(lightningStage(flash, time, out), out);
    assert.equal(out.leader, leader); assert.equal(out.returning, false); assert.equal(out.wash, 0);
  }
  assert.equal(lightningStage(flash, 1800).fade, 1);
  assert.equal(lightningStage(flash, 1890).wash, 0.1);
  let lastFade = 1, peaks = 0, lastWash = 0, rising = true;
  for (let time = 1800; time <= 2500; time++) {
    lightningStage(flash, time, out);
    assert.ok(out.fade <= lastFade && out.wash >= 0 && out.wash <= flash.brightness);
    if (out.wash < lastWash && rising) { peaks++; rising = false; }
    if (!rising) assert.ok(out.wash <= lastWash + 1e-12);
    if (time >= 1980) assert.equal(out.wash, 0);
    lastWash = out.wash; lastFade = out.fade;
  }
  assert.equal(peaks, 1); assert.equal(out.fade, 0); assert.equal(out.returning, false);
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
  conn.callback(storms); env.tick(time = Math.max(time + 5000, overlay.lightning.nextAt));
  assert.ok(overlay.lightning.flash);
  assert.ok(overlay.scenes.reduce((sum, s) => sum + scenePrimitiveCount(s), 1) <= MAX_PARTICLES);
  const serial = overlay.lightning.serial, allocations = env.canvases.length, bolt = overlay.bolt;
  const due = overlay.lightning.nextAt;
  conn.callback(storms.map(c => ({...c, id: 'metadata-' + c.id})));
  assert.equal(overlay.lightning.nextAt, due);
  conn.callback(storms.map(c => ({...c, size: 2})));
  assert.equal(overlay.lightning.nextAt, due, 'visual rebuild cannot reset cooldown');
  env.tick(time += 1500); assert.equal(overlay.lightning.flash, null);
  env.tick(due - 1); assert.equal(overlay.lightning.serial, serial);
  env.context.fillRects.length = 0;
  env.tick(time = due + 50);
  assert.equal(overlay.lightning.serial, serial + 1);
  assert.equal(env.context.fillRects.length, 0, 'formation has no screen wash');
  env.tick(time += 820);
  assert.equal(env.context.fillRects.length, 1, 'only one return-stroke wash across 32 profiles');
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
    env.tick(time += 1500);
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
  assert.ok(overlay.scenes.reduce((sum, scene) => sum + scenePrimitiveCount(scene), 10) <= MAX_PARTICLES);
  const allocations = env.canvases.length, bolt = overlay.bolt;
  env.context.fillAlphas.length = 0;
  overlay.drawLightning(5000); assert.equal(env.context.fillAlphas.length, 0);
  overlay.drawLightning(5400); assert.equal(env.context.fillAlphas.length, 0);
  overlay.drawLightning(5890); assert.equal(env.context.fillAlphas.at(-1), 0.25);
  overlay.drawLightning(5935); assert.ok(Math.abs(env.context.fillAlphas.at(-1) - 0.125) < 1e-9);
  const paints = env.context.fillAlphas.length;
  overlay.drawLightning(5980); assert.equal(env.context.fillAlphas.length, paints);
  overlay.drawLightning(6500); assert.equal(overlay.lightning.flash, null);
  for (let time = 6600; time < 10000; time += 100) env.tick(time);
  assert.equal(env.canvases.length, allocations); assert.equal(overlay.bolt, bolt);
  assert.ok(overlay.sprites.size <= 13);
  overlay.stop();
});

test('bolt and wash switches render independently under 32-profile master and safety gates', async () => {
  for (const [bolt, wash] of [[true, false], [false, true], [false, false], [true, true]]) {
    const env = mockEnvironment(), conn = env.connection(); env.doc.root = {hass: {connection: conn}};
    const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
    const profiles = Array.from({length: 32}, (_, id) => config({id, effect: 'storm', density: 200,
      lightning_enabled: true, lightning_interval: 5, lightning_bolt_enabled: bolt,
      lightning_flash_enabled: wash, lightning_branches: 8, respect_reduced_motion: false}));
    conn.callback(profiles);
    const allocations = env.canvases.length, storage = overlay.bolt;
    const draw = time => {
      env.context.fillRects.length = 0; env.context.linePoints.length = 0;
      overlay.drawLightning(time);
      return [env.context.linePoints.length, env.context.fillRects.length];
    };
    assert.deepEqual(draw(5000), [0, 0]);
    let counts = draw(5200); assert.equal(counts[0] > 0, bolt); assert.equal(counts[1], 0);
    const serial = overlay.lightningGeometry.serial;
    counts = draw(5600); assert.equal(counts[0] > 0, bolt); assert.equal(counts[1], 0);
    counts = draw(5820); assert.equal(counts[0] > 0, bolt); assert.equal(counts[1], wash ? 1 : 0);
    assert.ok(overlay.scenes.reduce((n, scene) => n + scenePrimitiveCount(scene), (bolt ? 9 : 0) + (wash ? 1 : 0)) <= MAX_PARTICLES);
    assert.equal(overlay.lightningGeometry.serial, serial); assert.equal(overlay.bolt, storage);
    assert.equal(env.canvases.length, allocations);
    if (!bolt) assert.equal(overlay.lightningGeometry.pathCount, 0);
    assert.deepEqual(draw(6500), [0, 0]);
    conn.callback(profiles.map(c => ({...c, lightning_enabled: false})));
    assert.deepEqual(draw(100000), [0, 0]); assert.equal(overlay.lightning.flash, null);
    conn.callback(profiles);
    for (const gate of ['motion', 'hidden', 'route', 'off']) {
      if (gate === 'motion') env.motion.matches = true;
      if (gate === 'hidden') env.doc.hidden = true;
      if (gate === 'route') env.win.location.pathname = '/config';
      if (gate === 'off') conn.callback(profiles.map(c => ({...c, effect: 'off'})));
      assert.deepEqual(draw(200000), [0, 0], gate); assert.equal(overlay.lightning.flash, null);
      env.motion.matches = false; env.doc.hidden = false; env.win.location.pathname = '/lovelace';
    }
    overlay.stop(); assert.deepEqual(draw(300000), [0, 0]);
  }
});

test('numeric bolt controls affect geometry and fade independently from wash brightness', async () => {
  const env = mockEnvironment(), conn = env.connection(); env.doc.root = {hass: {connection: conn}};
  const overlay = new WeatherEffectsOverlay(env.win, env.doc).start(); await flush();
  let time = 0;
  const sample = (brightness, thickness, glow, length, formation) => {
    conn.callback([config({effect: 'storm', lightning_enabled: false})]);
    env.tick(time += 10000);
    conn.callback([config({effect: 'storm', lightning_enabled: true, lightning_interval: 5,
      lightning_brightness: brightness, lightning_thickness: thickness, lightning_glow: glow,
      lightning_length: length, lightning_branches: 0, lightning_formation_time: formation,
      lightning_duration: 2})]);
    overlay.drawLightning(overlay.lightning.nextAt);
    const flash = overlay.lightning.flash;
    const strokes = env.context.strokeCount;
    overlay.drawLightning(flash.started + flash.formationTime + 90);
    const result = {width: env.context.lineWidth, alpha: env.context.globalAlpha,
      strokes: env.context.strokeCount - strokes, wash: env.context.fillAlphas.at(-1),
      reach: overlay.bolt[(overlay.lightningGeometry.counts[0] - 1) * 2 + 1] - overlay.bolt[1], flash};
    overlay.drawLightning(flash.started + flash.formationTime + flash.duration - 1);
    assert.equal(overlay.lightning.flash, flash);
    overlay.drawLightning(flash.started + flash.formationTime + flash.duration);
    assert.equal(overlay.lightning.flash, null);
    return result;
  };
  const a = sample(0.05, 0.5, 0, 0.2, 0.1), b = sample(0.25, 4, 1, 0.9, 3);
  assert.equal(a.width, 0.5); assert.equal(b.width, 4);
  assert.equal(a.alpha, b.alpha, 'screen brightness never dims or amplifies the bolt');
  assert.equal(a.strokes, 1); assert.equal(b.strokes, 2, 'outer glow is a single subtle extra stroke');
  assert.equal(a.wash, 0.05); assert.equal(b.wash, 0.25);
  assert.ok(Math.abs(a.reach - 160) < 0.01); assert.ok(Math.abs(b.reach - 720) < 0.01);
  assert.equal(a.flash.formationTime, 100); assert.equal(b.flash.formationTime, 3000);
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
