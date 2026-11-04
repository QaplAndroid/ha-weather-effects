/* Weather Effects: dependency-free, globally loaded Home Assistant ES module. */
export const MAX_PARTICLES = 800;
export const EFFECTS = Object.freeze({
  off: [], snow: ["snow"], rain: ["rain"], sun: ["sun"], clouds: ["clouds"],
  partlycloudy: ["sun", "clouds"], rain_clouds: ["clouds", "rain"],
  snow_clouds: ["clouds", "snow"], fog: ["fog"], wind: ["wind"],
  wind_clouds: ["clouds", "wind"], night: ["night"], night_clouds: ["night", "clouds"],
  hail: ["clouds", "hail"], sleet: ["clouds", "rain", "snow"],
  downpour: ["clouds", "downpour"], storm: ["storm_clouds", "wind", "rain"],
  storm_clouds: ["storm_clouds", "wind"],
});
// Physical render layers map only to these canonical appearance sources.
export const COMPONENT_SOURCES = Object.freeze({
  sun: "sun", clouds: "clouds", rain: "rain", snow: "snow", fog: "fog",
  wind: "wind", night: "night", hail: "hail", storm_clouds: "clouds", downpour: "rain",
});
const APPEARANCE_BOUNDS = Object.freeze({speed: [0.2, 3], size: [0.3, 3], density: [10, 200],
  opacity: [0.05, 1], wind: [-2, 2], cloud_top: [0, 100], cloud_bottom: [0, 100], cloud_spread: [0, 100]});
const ARRAY_SOURCES = {clouds: "clouds", fog: "fog", wind: "wind", rain: "rain", snow: "snow",
  hail: "hail", ripples: "rain", stars: "night", sun: "sun", moon: "night", heat: "sun", heatGlow: "sun"};
const componentConfig = (config, source) => config.layer_settings?.[source] || config;
// One closed cumulus silhouette: rounded lobes, a broad base and no ellipse seams.
export function cloudSilhouette(ctx, variant = 0) {
  ctx.beginPath(); ctx.moveTo(65, 130);
  if (variant % 2 === 0) {
    ctx.bezierCurveTo(38, 130, 22, 115, 24, 95);
    ctx.bezierCurveTo(26, 75, 43, 62, 65, 66);
    ctx.bezierCurveTo(68, 42, 87, 29, 110, 35);
    ctx.bezierCurveTo(125, 9, 168, 10, 185, 42);
    ctx.bezierCurveTo(210, 32, 237, 45, 242, 68);
    ctx.bezierCurveTo(270, 63, 293, 81, 296, 102);
  } else {
    ctx.bezierCurveTo(39, 130, 22, 114, 27, 94);
    ctx.bezierCurveTo(31, 75, 45, 68, 63, 70);
    ctx.bezierCurveTo(65, 39, 95, 23, 124, 43);
    ctx.bezierCurveTo(140, 17, 179, 24, 188, 49);
    ctx.bezierCurveTo(212, 36, 242, 48, 245, 72);
    ctx.bezierCurveTo(273, 67, 295, 82, 296, 102);
  }
  ctx.bezierCurveTo(299, 122, 280, 136, 255, 136);
  ctx.bezierCurveTo(204, 140, 112, 140, 65, 130);
  ctx.closePath();
}
// Each array item is one animated visual primitive; celestial bodies are cached sprites.
const SCENE_ARRAYS = ["clouds", "fog", "wind", "rain", "snow", "hail", "ripples", "stars", "sun", "moon", "heat", "heatGlow"];
const SPRITE_KEYS = new Set(["cloud0", "cloud1", "darkCloud0", "darkCloud1", "fog", "snow0", "snow1", "snow2", "hail", "star", "sun", "moon", "heatGlow"]);
export function scenePrimitiveCount(scene) {
  return SCENE_ARRAYS.reduce((sum, key) => sum + (scene[key]?.length || 0), 0);
}
// Proportional integer allocation also works for a zero or sub-layer-sized budget.
export function allocateBudget(counts, budget = MAX_PARTICLES) {
  const total = counts.reduce((a, b) => a + b, 0);
  const limit = Math.max(0, Math.floor(budget));
  if (total <= limit) return [...counts];
  const exact = counts.map(n => n * limit / total);
  const result = exact.map(Math.floor);
  let remaining = limit - result.reduce((a, b) => a + b, 0);
  const order = exact.map((n, i) => ({ i, fraction: n - result[i] })).sort((a, b) => b.fraction - a.fraction);
  for (const { i } of order) { if (!remaining) break; result[i]++; remaining--; }
  return result;
}
const visualSignature = configs => JSON.stringify(configs.map(c =>
  [c.effect, c.layer_settings ? c.layer_settings : [c.speed, c.size, c.density, c.opacity, c.wind, c.cloud_top, c.cloud_bottom, c.cloud_spread], c.max_fps, c.intensity,
    c.lightning_enabled, c.lightning_interval, c.lightning_brightness, c.lightning_bolt_enabled,
    c.lightning_flash_enabled, c.lightning_formation_time, c.lightning_duration, c.lightning_branches,
    c.lightning_thickness, c.lightning_glow, c.lightning_length]));
const BLOCKED_ROUTES = new Set(["config", "settings", "developer-tools", "profile", "auth", "onboarding", "lovelace-editor", "editor", "history", "logbook", "energy", "map", "calendar", "todo", "media-browser"]);
const clamp = (value, low, high, fallback) => {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
};
export function normalizeDashboard(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed || /[/?#]/.test(trimmed)) return "";
  try {
    const decoded = decodeURIComponent(trimmed).toLowerCase();
    return /^[a-z0-9_-]+$/.test(decoded) ? decoded : "";
  } catch { return ""; }
}
export function effectLayers(effect) {
  return Object.prototype.hasOwnProperty.call(EFFECTS, effect) ? [...EFFECTS[effect]] : [];
}
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  // Controls describe centers, not sprite edges. Sort malformed incoming bounds;
  // valid writes are checked by the backend before reaching this defensive path.
  const top = clamp(raw.cloud_top, 0, 100, 10), bottom = clamp(raw.cloud_bottom, 0, 100, 30);
  const config = {
    cloud_top: Math.min(top, bottom), cloud_bottom: Math.max(top, bottom),
    cloud_spread: clamp(raw.cloud_spread, 0, 100, 80),
    id: String(raw.id ?? ""), enabled: raw.enabled === true,
    dashboards: [...new Set((Array.isArray(raw.dashboards) ? raw.dashboards : []).map(normalizeDashboard).filter(Boolean))],
    effect: Object.prototype.hasOwnProperty.call(EFFECTS, raw.effect) ? raw.effect : "off",
    speed: clamp(raw.speed, 0.2, 3, 1), size: clamp(raw.size, 0.3, 3, 1),
    density: Math.round(clamp(raw.density, 10, 200, 70)), opacity: clamp(raw.opacity, 0.05, 1, 0.65),
    wind: clamp(raw.wind, -2, 2, 0), respect_reduced_motion: raw.respect_reduced_motion !== false,
    max_fps: clamp(raw.max_fps, 15, 60, 30),
    intensity: {
      heat: clamp(raw.intensity?.heat, 0, 1, 0),
      cloud: clamp(raw.intensity?.cloud, 0, 1, null),
      rain: clamp(raw.intensity?.rain, 0, 1, null),
      wind: clamp(raw.intensity?.wind, 0, 1, null),
    },
    lightning_enabled: raw.lightning_enabled === true,
    lightning_bolt_enabled: raw.lightning_bolt_enabled === undefined ? true : raw.lightning_bolt_enabled === true,
    lightning_flash_enabled: raw.lightning_flash_enabled === undefined ? true : raw.lightning_flash_enabled === true,
    lightning_formation_time: clamp(raw.lightning_formation_time, 0.1, 3, 0.8),
    lightning_duration: clamp(raw.lightning_duration, 0.3, 2, 0.7),
    lightning_branches: Math.round(clamp(raw.lightning_branches, 0, 8, 4)),
    lightning_thickness: clamp(raw.lightning_thickness, 0.5, 4, 1.5),
    lightning_glow: clamp(raw.lightning_glow, 0, 1, 0.6),
    lightning_length: clamp(raw.lightning_length, 0.2, 0.9, 0.6),
    lightning_interval: clamp(raw.lightning_interval, 5, 60, 12),
    lightning_brightness: clamp(raw.lightning_brightness, 0.05, 0.25, 0.10),
  };
  if (raw.appearance_model === "components_v1" || Object.prototype.hasOwnProperty.call(raw, "layer_settings")) {
    config.appearance_model = "components_v1";
    config.layer_settings = {};
    for (const physical of effectLayers(config.effect)) {
      const source = COMPONENT_SOURCES[physical];
      if (config.layer_settings[source]) continue;
      const input = raw.layer_settings?.[source];
      const layer = {};
      for (const [key, [low, high]] of Object.entries(APPEARANCE_BOUNDS)) {
        layer[key] = clamp(input?.[key], low, high, config[key]);
      }
      layer.density = Math.round(layer.density);
      const top = layer.cloud_top;
      layer.cloud_top = Math.min(top, layer.cloud_bottom);
      layer.cloud_bottom = Math.max(top, layer.cloud_bottom);
      config.layer_settings[source] = layer;
    }
  }
  return config;
}
// Conservative sprite-box overlap, normalized by the smaller rendered area.
// A common wrap period keeps spacing coherent as the whole cloud field drifts.
export function cloudOverlap(a, b, period = 0) {
  let dx = Math.abs(a.x - b.x);
  if (period > 0) { dx %= period; dx = Math.min(dx, period - dx); }
  const aw = 320 * a.scale, bw = 320 * b.scale, ah = 160 * a.scale, bh = 160 * b.scale;
  const x = Math.max(0, Math.min(aw, bw, (aw + bw) / 2 - dx));
  const y = Math.max(0, Math.min(ah, bh, (ah + bh) / 2 - Math.abs(a.y - b.y)));
  return x * y / Math.max(1e-9, Math.min(aw * ah, bw * bh));
}
// Pure, deterministic for a supplied RNG. Work is bounded and happens only at
// scene construction: stratified best-candidate placement plus three relaxation
// sweeps. Crowded/narrow bands can still overlap; never shrink or drop clouds.
export function layoutClouds(clouds, width, height, config, random = Math.random) {
  width = Math.max(1, width); height = Math.max(1, height);
  const top = height * config.cloud_top / 100, bottom = height * config.cloud_bottom / 100;
  const spread = config.cloud_spread / 100, band = bottom - top;
  const result = clouds.map(p => ({ ...p, x: random() * width, y: top + random() * band }));
  if (!result.length || !spread) return result;
  const period = width + Math.max(...result.map(p => 320 * p.scale));
  const natural = result.map(p => ({ x: p.x, y: p.y }));
  const score = (p, index, end) => {
    let sum = 0;
    for (let j = 0; j < end; j++) if (j !== index) {
      const overlap = cloudOverlap(p, result[j], period);
      sum += overlap * overlap;
    }
    return sum;
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < result.length; i++) {
      const p = result[i], end = pass ? result.length : i;
      let bestX = p.x, bestY = p.y, best = score(p, i, end);
      const offset = random(), vertical = random();
      for (let k = 0; k < 32 && best > 0; k++) {
        // Cover both dimensions even with an adversarial constant RNG. Boundary
        // candidates help equal/narrow bands and clouds wider than the viewport.
        p.x = ((k + offset) / 32) * width;
        p.y = top + (k % 4 === 0 ? 0 : k % 4 === 1 ? 1 : (vertical + k * 0.61803398875) % 1) * band;
        const candidate = score(p, i, end);
        if (candidate < best) { best = candidate; bestX = p.x; bestY = p.y; }
      }
      p.x = bestX; p.y = bestY;
    }
  }
  for (let i = 0; i < result.length; i++) {
    result[i].x = natural[i].x + (result[i].x - natural[i].x) * spread;
    result[i].y = natural[i].y + (result[i].y - natural[i].y) * spread;
  }
  return result;
}
export function matchesDashboard(config, pathname, search = "") {
  if (!config?.enabled || !effectLayers(config.effect).length) return false;
  if (new URLSearchParams(search).has("edit")) return false;
  const parts = String(pathname || "").split("/").filter(Boolean);
  const first = normalizeDashboard(parts[0]);
  if (!first || BLOCKED_ROUTES.has(first)) return false;
  if (parts.some(part => ["editor", "edit"].includes(normalizeDashboard(part)))) return false;
  return config.dashboards.some(dashboard => normalizeDashboard(dashboard) === first);
}
export function activeConfigs(configs, location, reducedMotion = false) {
  return configs.filter(config => matchesDashboard(config, location.pathname, location.search)
    && !(reducedMotion && config.respect_reduced_motion));
}

export const lightningEligible = c => c.lightning_enabled === true
  && (c.lightning_bolt_enabled === true || c.lightning_flash_enabled === true)
  && (c.effect === "storm" || c.effect === "storm_clouds");
// All stage times use the performance/RAF clock, in milliseconds. Optional output
// objects let the renderer reuse storage; callers can inspect the same pure stages.
export function lightningStage(flash, time, out = {}) {
  const age = Math.max(0, time - flash.started);
  out.leader = Math.min(1, age / flash.formationTime);
  out.returning = age >= flash.formationTime && age < flash.formationTime + flash.duration;
  const tail = Math.max(0, age - flash.formationTime);
  out.fade = out.returning ? (1 - tail / flash.duration) ** 2 : 0;
  // One short smooth wash at the return stroke, never throughout formation.
  const pulse = tail / Math.min(180, flash.duration);
  out.wash = out.returning && pulse < 1 ? flash.brightness * Math.sin(Math.PI * pulse) ** 2 : 0;
  return out;
}

// Fixed storage for 49 main vertices and eight paths of 13 vertices. No recursive
// branches, Path2D objects, per-frame arrays, canvases, or geometry generation.
export class LightningGeometry {
  constructor() {
    this.points = new Float32Array(9 * 49 * 2);
    this.counts = new Uint8Array(9);
    this.attachments = new Float32Array(9);
    this.ends = new Float32Array(9);
    this.pathCount = 0; this.serial = 0;
  }
  generate(width, height, length, branches, random = Math.random) {
    const segments = 32 + Math.floor(random() * 17);
    const startX = width * (0.3 + random() * 0.4), startY = height * 0.035;
    const reach = height * clamp(length, 0.2, 0.9, 0.6);
    this.pathCount = 1 + Math.round(clamp(branches, 0, 8, 4));
    this.counts.fill(0); this.counts[0] = segments + 1;
    this.attachments[0] = 0; this.ends[0] = 1;
    let x = startX;
    const drift = (random() - 0.5) * reach * 0.23;
    for (let i = 0; i <= segments; i++) {
      if (i) x += drift / segments + (random() - 0.5) * reach * 0.065;
      this.points[i * 2] = Math.min(width * 0.92, Math.max(width * 0.08, x));
      this.points[i * 2 + 1] = startY + reach * i / segments;
    }
    for (let path = 1; path < this.pathCount; path++) {
      const parent = Math.floor(segments * (0.15 + 0.64 * (path - 0.5) / (this.pathCount - 1)));
      const attach = parent / segments, count = 7 + Math.floor(random() * 6);
      const offset = path * 98, side = random() < 0.5 ? -1 : 1;
      const span = reach * (0.10 + random() * 0.16);
      this.counts[path] = count + 1; this.attachments[path] = attach;
      // A small delay after attachment, with enough time to reach the branch tip.
      this.ends[path] = Math.min(0.99, attach + 0.18 + random() * 0.12);
      let bx = this.points[parent * 2], by = this.points[parent * 2 + 1];
      for (let i = 0; i <= count; i++) {
        if (i) { bx += side * span / count + (random() - 0.5) * span * 0.13; by += span * (0.35 + random() * 0.5) / count; }
        this.points[offset + i * 2] = Math.max(0, Math.min(width, bx));
        this.points[offset + i * 2 + 1] = Math.min(height, by);
      }
    }
    this.serial++;
    return this;
  }
  pathProgress(path, leader) {
    const start = path ? this.attachments[path] + 0.025 : 0;
    return Math.min(1, Math.max(0, (leader - start) / (this.ends[path] - start)));
  }
  trace(ctx, path, leader) {
    const progress = this.pathProgress(path, leader);
    if (progress <= 0) return false;
    const offset = path * 98, extent = progress * (this.counts[path] - 1), whole = Math.floor(extent);
    ctx.beginPath(); ctx.moveTo(this.points[offset], this.points[offset + 1]);
    for (let i = 1; i <= whole; i++) ctx.lineTo(this.points[offset + i * 2], this.points[offset + i * 2 + 1]);
    if (whole < this.counts[path] - 1) {
      const at = offset + whole * 2, fraction = extent - whole;
      ctx.lineTo(this.points[at] + (this.points[at + 2] - this.points[at]) * fraction,
        this.points[at + 1] + (this.points[at + 3] - this.points[at + 1]) * fraction);
    }
    return true;
  }
  visibleStats(leader, out = {}) {
    out.paths = 0; out.segments = 0;
    for (let path = 0; path < this.pathCount; path++) {
      const progress = this.pathProgress(path, leader);
      if (progress > 0) { out.paths++; out.segments += Math.ceil(progress * (this.counts[path] - 1)); }
    }
    return out;
  }
}

// One global monotonic scheduler. Profile order/IDs, rebuilds and settings updates
// cannot restart an active strike or shorten its already-established cooldown.
export class LightningScheduler {
  constructor() {
    this.key = ""; this.nextAt = Infinity; this.lastAt = -Infinity; this.armedAt = -Infinity;
    this.flash = null; this.duration = 1500; this.serial = 0;
  }
  update(configs, allowed, now) {
    let interval = 60000, brightness = 0.25, branches = 8, thickness = 4, glow = 1, length = 0.9;
    let formationTime = 100, duration = 300, bolt = false, wash = false, count = 0;
    if (allowed) for (const c of configs) {
      if (!lightningEligible(c)) continue;
      count++; bolt ||= c.lightning_bolt_enabled; wash ||= c.lightning_flash_enabled;
      interval = Math.min(interval, clamp(c.lightning_interval, 5, 60, 12) * 1000);
      brightness = Math.min(brightness, clamp(c.lightning_brightness, 0.05, 0.25, 0.1));
      branches = Math.min(branches, Math.round(clamp(c.lightning_branches, 0, 8, 4)));
      thickness = Math.min(thickness, clamp(c.lightning_thickness, 0.5, 4, 1.5));
      glow = Math.min(glow, clamp(c.lightning_glow, 0, 1, 0.6));
      length = Math.min(length, clamp(c.lightning_length, 0.2, 0.9, 0.6));
      formationTime = Math.max(formationTime, clamp(c.lightning_formation_time, 0.1, 3, 0.8) * 1000);
      duration = Math.max(duration, clamp(c.lightning_duration, 0.3, 2, 0.7) * 1000);
    }
    const wasAllowed = Boolean(this.key);
    this.key = count ? "enabled" : "";
    this.interval = count ? Math.max(interval, formationTime + duration + 500) : 0;
    this.brightness = brightness; this.formationTime = formationTime; this.fadeDuration = duration;
    this.boltEnabled = bolt; this.flashEnabled = wash; this.branches = branches;
    this.thickness = thickness; this.glow = glow; this.length = length;
    if (!count) { this.flash = null; this.nextAt = Infinity; }
    else if (!wasAllowed) {
      this.armedAt = now;
      this.nextAt = Math.max(now + this.interval, this.lastAt + this.interval);
    } else this.nextAt = Math.max(this.nextAt, Math.max(this.armedAt, this.lastAt) + this.interval);
    if (this.flash) {
      // Disabling a visual sub-switch is immediate, never a route around safety.
      this.flash.boltEnabled &&= bolt; this.flash.flashEnabled &&= wash;
    }
    return wasAllowed !== Boolean(this.key);
  }
  step(now) {
    if (!this.key) return null;
    if (this.flash && now - this.flash.started >= this.flash.formationTime + this.flash.duration) this.flash = null;
    if (!this.flash && now >= this.nextAt) {
      this.lastAt = now; this.nextAt = now + this.interval;
      this.duration = this.formationTime + this.fadeDuration;
      this.flash = { started: now, brightness: this.brightness, serial: ++this.serial,
        formationTime: this.formationTime, duration: this.fadeDuration,
        boltEnabled: this.boltEnabled, flashEnabled: this.flashEnabled, branches: this.branches,
        thickness: this.thickness, glow: this.glow, length: this.length };
    }
    return this.flash;
  }
}

export class WeatherEffectsOverlay {
  constructor(win = globalThis.window, doc = globalThis.document) {
    this.win = win; this.doc = doc;
    this.configs = []; this.active = []; this.scenes = []; this.sprites = new Map();
    this.signature = "";
    this.lightning = new LightningScheduler();
    this.lightningGeometry = new LightningGeometry();
    this.bolt = this.lightningGeometry.points; this.boltSerial = 0;
    this.lightningStage = {};
    this.connection = null; this.unsubscribe = null; this.epoch = 0;
    this.pending = false; this.retryAt = 0; this.failures = 0;
    this.running = false; this.frame = null; this.lastFrame = null;
    this.width = 0; this.height = 0; this.dpr = 1;
    this.onPoll = () => this.poll();
    this.onState = () => this.refresh();
    this.onResize = () => { this.resize(); this.refresh(true); };
    this.onFrame = time => this.animate(time);
  }
  start() {
    if (this.running || !this.doc || !this.win) return this;
    this.running = true;
    this.motion = this.win.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.motion?.addEventListener?.("change", this.onState);
    this.doc.addEventListener("visibilitychange", this.onState);
    this.win.addEventListener("resize", this.onResize);
    this.win.addEventListener("popstate", this.onState);
    this.win.addEventListener("hashchange", this.onState);
    this.win.addEventListener("location-changed", this.onState);
    this.timer = this.win.setInterval(this.onPoll, 1000);
    this.poll();
    return this;
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    this.win.clearInterval(this.timer);
    this.motion?.removeEventListener?.("change", this.onState);
    this.doc.removeEventListener("visibilitychange", this.onState);
    this.win.removeEventListener("resize", this.onResize);
    this.win.removeEventListener("popstate", this.onState);
    this.win.removeEventListener("hashchange", this.onState);
    this.win.removeEventListener("location-changed", this.onState);
    this.disconnect(); this.pause();
    this.canvas?.remove(); this.canvas = null; this.ctx = null;
    this.sprites.clear(); this.scenes = []; this.signature = "";
  }
  release(unsubscribe) {
    if (typeof unsubscribe !== "function") return;
    try { Promise.resolve(unsubscribe()).catch(() => {}); } catch { /* disconnected socket */ }
  }
  disconnect() {
    this.epoch++; this.release(this.unsubscribe); this.unsubscribe = null;
    this.connection = null; this.pending = false; this.retryAt = 0; this.failures = 0;
    this.configs = []; this.refresh();
  }
  poll() {
    if (!this.running) return;
    const connection = this.doc.querySelector("home-assistant")?.hass?.connection;
    const live = connection && connection.connected !== false ? connection : null;
    if (live !== this.connection) { this.disconnect(); this.connection = live; }
    if (live && !this.unsubscribe && !this.pending && Date.now() >= this.retryAt) this.subscribe(live);
    this.refresh();
  }
  subscribe(connection) {
    const epoch = this.epoch;
    this.pending = true;
    // HA subscribeMessage unwraps the websocket event, so the callback receives the array itself.
    Promise.resolve().then(() => {
      if (!this.running || epoch !== this.epoch) return null;
      return connection.subscribeMessage(configs => {
        if (!this.running || epoch !== this.epoch || !Array.isArray(configs)) return;
        this.configs = configs.slice(0, 32).map(normalizeConfig).filter(Boolean);
        this.refresh();
      }, { type: "weather_effects/subscribe" });
    }).then(unsubscribe => {
      if (!this.running || epoch !== this.epoch) { this.release(unsubscribe); return; }
      this.pending = false;
      if (typeof unsubscribe !== "function") throw new Error("Missing subscription cleanup");
      this.unsubscribe = unsubscribe; this.failures = 0;
    }).catch(() => {
      if (!this.running || epoch !== this.epoch) return;
      this.pending = false;
      this.configs = []; this.refresh(true);
      this.retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5));
    });
  }
  refresh(force = false) {
    const active = this.running && !this.doc.hidden
      ? activeConfigs(this.configs, this.win.location, Boolean(this.motion?.matches)) : [];
    const signature = visualSignature(active);
    const changed = force || signature !== this.signature;
    this.signature = signature;
    this.active = active;
    this.syncLightning();
    if (!active.length) { this.pause(); return; }
    if (!this.ensureCanvas()) return;
    if (changed || !this.scenes.length) this.buildScenes();
    this.canvas.hidden = false;
    this.canvas.style.visibility = "visible";
    if (this.frame === null) { this.lastFrame = null; this.frame = this.win.requestAnimationFrame(this.onFrame); }
  }
  ensureCanvas() {
    if (this.canvas) return true;
    if (!this.doc.body) return false;
    const canvas = this.doc.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;display:block;";
    this.doc.body.appendChild(canvas); this.canvas = canvas; this.ctx = ctx;
    this.resize();
    return true;
  }
  resize() {
    if (!this.canvas) return;
    this.width = Math.max(1, this.win.innerWidth || 1);
    this.height = Math.max(1, this.win.innerHeight || 1);
    const dpr = Math.min(2, Math.max(1, this.win.devicePixelRatio || 1));
    if (dpr !== this.dpr) this.sprites.clear();
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  now() { return this.win.performance?.now?.() ?? 0; }
  syncLightning(time = this.now()) {
    const hadFlash = Boolean(this.lightning.flash);
    const allowed = this.running && !this.doc.hidden && !this.motion?.matches;
    // Recheck routes here too: callable frame/scheduler methods never bypass eligibility.
    const selected = activeConfigs(this.configs, this.win.location, Boolean(this.motion?.matches));
    const changed = this.lightning.update(selected, allowed, time);
    if (changed && hadFlash && this.ctx) this.ctx.clearRect(0, 0, this.width, this.height);
  }
  stepLightning(time = this.now()) {
    this.syncLightning(time);
    const flash = this.lightning.step(time);
    if (flash && flash.serial !== this.boltSerial) {
      this.boltSerial = flash.serial;
      if (flash.boltEnabled) this.lightningGeometry.generate(this.width, this.height, flash.length, flash.branches);
      else this.lightningGeometry.pathCount = 0;
    }
    return flash;
  }
  drawLightning(time = this.now()) {
    const flash = this.stepLightning(time);
    if (!flash || !this.ctx) return;
    const ctx = this.ctx, stage = lightningStage(flash, time, this.lightningStage);
    if (flash.flashEnabled && stage.wash > 0) {
      ctx.globalAlpha = stage.wash; ctx.fillStyle = "rgb(219,231,255)";
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (!flash.boltEnabled || stage.leader <= 0) return;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    // Dim, steadily propagating leader; a single bright return stroke then fade.
    const strength = stage.returning ? stage.fade : 0.22;
    for (let path = 0; path < this.lightningGeometry.pathCount; path++) {
      if (!this.lightningGeometry.trace(ctx, path, stage.leader)) continue;
      const branch = path ? 0.58 : 1;
      if (flash.glow > 0) {
        ctx.shadowColor = "rgb(119,171,255)"; ctx.shadowBlur = 9 * flash.glow;
        ctx.globalAlpha = strength * branch * flash.glow * 0.35;
        ctx.lineWidth = flash.thickness * (path ? 2 : 3);
        ctx.strokeStyle = "rgb(126,179,255)"; ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = strength * branch;
      ctx.lineWidth = flash.thickness * (path ? 0.55 : 1);
      ctx.strokeStyle = "rgb(231,244,255)"; ctx.stroke();
    }
    ctx.restore();
  }
  pause() {
    this.lightning.update([], false, this.now());
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null; this.lastFrame = null;
    if (this.canvas) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.canvas.hidden = true;
      this.canvas.style.visibility = "hidden";
    }
  }
  buildScenes() {
    // One seed per build, not per candidate or frame.
    let cloudSeed = 1 + Math.floor(Math.random() * 2147483646);
    const cloudRandom = () => { cloudSeed = cloudSeed * 16807 % 2147483647; return cloudSeed / 2147483647; };
    const plans = this.active.map(config => {
      const layers = effectLayers(config.effect);
      const density = source => componentConfig(config, source).density;
      const rain = layers.includes("rain") || layers.includes("downpour");
      const mixed = rain && layers.includes("snow");
      return {
        clouds: layers.some(layer => layer === "clouds" || layer === "storm_clouds")
          ? Math.ceil(density("clouds") / 22 * (config.intensity.cloud === null ? 1 : 0.35 + 1.65 * config.intensity.cloud)) : 0,
        fog: layers.includes("fog") ? Math.ceil(density("fog") / 16) : 0,
        wind: layers.includes("wind") ? Math.ceil(density("wind") / 9) : 0,
        rain: rain ? Math.round(density("rain") * (mixed ? 0.56 : layers.includes("downpour") ? 1.8 : 1)) : 0,
        snow: layers.includes("snow") ? Math.round(density("snow") * (mixed ? 0.44 : 1)) : 0,
        hail: layers.includes("hail") ? density("hail") : 0,
        ripples: rain ? Math.ceil(density("rain") / 18) : 0,
        stars: layers.includes("night") ? Math.ceil(density("night") / 5) : 0,
        sun: layers.includes("sun") ? 1 : 0,
        moon: layers.includes("night") ? 1 : 0,
        heat: layers.includes("sun") && config.intensity.heat > 0 ? Math.ceil(3 * config.intensity.heat) : 0,
        heatGlow: layers.includes("sun") && config.intensity.heat > 0 ? 1 : 0,
      };
    });
    // Reserve the maximum global strike (main + eight sidebranches + wash),
    // including an in-flight strike whose settings changed since scene creation.
    const boltBudget = this.active.some(lightningEligible) ? 10 : 0;
    const budgets = allocateBudget(plans.map(plan => Object.values(plan).reduce((a, b) => a + b, 0)), MAX_PARTICLES - boltBudget);
    this.scenes = this.active.map((config, i) => {
      const counts = allocateBudget(SCENE_ARRAYS.map(key => plans[i][key]), budgets[i]);
      const previous = this.scenes[i];
      const compatible = config.layer_settings && previous?.layerViews
        && previous.config.id === config.id && previous.config.effect === config.effect
        && previous.viewportWidth === this.width && previous.viewportHeight === this.height;
      const reuse = {};
      if (compatible) for (const source of Object.keys(config.layer_settings)) {
        const before = previous.layerViews[source]?.config;
        const after = componentConfig(config, source);
        reuse[source] = Boolean(before)
          && Object.keys(APPEARANCE_BOUNDS).every(key => before[key] === after[key])
          && (source !== "clouds" || before.intensity.cloud === config.intensity.cloud)
          && (source !== "sun" || before.intensity.heat === config.intensity.heat)
          && SCENE_ARRAYS.every((key, index) => ARRAY_SOURCES[key] !== source || previous[key].length === counts[index]);
      }
      const scene = { config, layers: effectLayers(config.effect), time: Math.random() * 30,
        viewportWidth: this.width, viewportHeight: this.height };
      SCENE_ARRAYS.forEach((key, index) => {
        // A global-budget redistribution may change another component's counts;
        // only then must its arrays/clock restart despite unchanged appearance.
        if (reuse[ARRAY_SOURCES[key]]) { scene[key] = previous[key]; return; }
        scene[key] = Array.from({ length: counts[index] }, (_, n) => ({
          x: Math.random() * this.width, y: Math.random() * this.height,
          depth: 0.25 + Math.random() * 0.75, phase: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.6, variant: n % 3,
          scale: (0.65 + Math.random() * 0.65) * componentConfig(config, ARRAY_SOURCES[key]).size,
          life: Math.random(),
        }));
      });
      if (!reuse.clouds) scene.clouds = layoutClouds(scene.clouds, this.width, this.height, componentConfig(config, "clouds"), cloudRandom);
      scene.cloudPadding = Math.max(0, ...scene.clouds.map(p => 160 * p.scale));
      if (!reuse.fog) for (const bank of scene.fog) bank.y = this.height * (0.72 + Math.random() * 0.27);
      if (!reuse.night) for (const star of scene.stars) star.y *= 0.48;
      // Warm only used sprites. The finite key set caps cache size at 13;
      // all sprites are <=320x160 CSS px (DPR capped at 2), never viewport-sized.
      scene.cloudSprite = scene.layers.includes("storm_clouds") || (config.intensity.cloud !== null && config.intensity.cloud >= 0.65) ? "darkCloud" : "cloud";
      for (const key of ["clouds", "fog", "snow", "hail", "stars", "sun", "moon", "heatGlow"]) {
        if (!scene[key].length) continue;
        const names = key === "clouds" ? [scene.cloudSprite + "0", scene.cloudSprite + "1"]
          : key === "snow" ? ["snow0", "snow1", "snow2"]
          : [({ stars: "star", clouds: "cloud" })[key] || key];
        for (const name of names) this.sprite(name);
      }
      if (config.layer_settings) {
        const views = {};
        for (const source of Object.keys(config.layer_settings)) {
          // Snapshot once at build time. All views retain the scene's actual arrays
          // and physical layer IDs; global intensity/gates cannot come from a layer.
          views[source] = {...scene, config: {...config, ...config.layer_settings[source]},
            time: reuse[source] ? previous.layerViews[source].time : scene.time};
        }
        scene.layerViews = views;
      }
      return scene;
    });
  }
  // Cache shaped cloud silhouettes and soft fog separately, never rasterize per frame.
  sprite(name) {
    if (!SPRITE_KEYS.has(name)) return null;
    if (this.sprites.has(name)) return this.sprites.get(name);
    const cloud = name.startsWith("cloud") || name.startsWith("darkCloud");
    const width = cloud || name === "fog" ? 320 : name === "sun" || name === "heatGlow" ? 256 : name === "moon" ? 128 : 64;
    const height = cloud ? 160 : name === "fog" ? 96 : width;
    const canvas = this.doc.createElement("canvas");
    canvas.width = width * this.dpr; canvas.height = height * this.dpr;
    const c = canvas.getContext("2d");
    c.scale(this.dpr, this.dpr);
    const glow = (x, y, radius, color, alpha) => {
      const g = c.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(${color},${alpha})`);
      g.addColorStop(0.5, `rgba(${color},${alpha * 0.65})`);
      g.addColorStop(1, `rgba(${color},0)`);
      c.fillStyle = g; c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };
    if (cloud) {
      const dark = name.startsWith("dark"), variant = name.endsWith("1") ? 1 : 0;
      // Clear silhouette with soft internal shading, rather than a blurred bank.
      const body = c.createLinearGradient(0, 25, 0, 142);
      body.addColorStop(0, dark ? "#b8c5d8" : "#ffffff");
      body.addColorStop(0.52, dark ? "#8395ae" : "#e6f0f8");
      body.addColorStop(1, dark ? "#475d78" : "#a5bdd2");
      c.save(); cloudSilhouette(c, variant);
      c.shadowColor = dark ? "rgba(12,23,41,0.25)" : "rgba(25,47,70,0.15)";
      c.shadowBlur = 5; c.shadowOffsetY = 3; c.fillStyle = body; c.fill();
      c.shadowBlur = 0; c.shadowOffsetY = 0;
      c.clip();
      glow(variant ? 104 : 147, 56, 49, dark ? "219,230,242" : "255,255,255", 0.38);
      glow(218, 86, 38, dark ? "192,210,230" : "255,255,255", 0.24);
      glow(79, 94, 35, dark ? "192,210,230" : "255,255,255", 0.2);
      c.restore();
      cloudSilhouette(c, variant); c.lineWidth = 1.1;
      c.strokeStyle = dark ? "rgba(223,236,250,0.3)" : "rgba(255,255,255,0.65)";
      c.stroke();
    } else if (name === "fog") {
      // Fog intentionally stays diffuse; it must not become a row of cloud icons.
      let seed = 23;
      const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      c.save(); c.translate(160, 48); c.scale(1, 0.25);
      for (let i = 0; i < 34; i++) {
        glow((random() - 0.5) * 208, (random() - 0.5) * 60, 30 + random() * 36, "219,232,239", 0.12);
      }
      c.restore();
    } else if (name.startsWith("snow")) {
      glow(32, 32, 29, "220,240,255", 0.19);
      if (name === "snow2") {
        glow(32, 32, 12, "246,252,255", 0.85);
      } else {
        c.translate(32, 32); c.strokeStyle = "rgba(242,250,255,0.94)";
        c.lineWidth = name === "snow0" ? 1.6 : 1.2; c.lineCap = "round"; c.beginPath();
        for (let arm = 0; arm < 6; arm++) {
          const a = arm * Math.PI / 3, x = Math.cos(a), y = Math.sin(a);
          c.moveTo(0, 0); c.lineTo(x * 24, y * 24);
          for (const along of [0.48, 0.73]) {
            for (const side of [-1, 1]) {
              const branch = a + side * Math.PI / 3, length = name === "snow0" ? 6 : 4.5;
              c.moveTo(x * 24 * along, y * 24 * along);
              c.lineTo(x * 24 * along - Math.cos(branch) * length, y * 24 * along - Math.sin(branch) * length);
            }
          }
        }
        c.stroke();
      }
    } else if (name === "heatGlow") {
      glow(128, 128, 126, "255,126,38", 0.65);
      glow(128, 128, 74, "255,181,63", 0.25);
    } else if (name === "sun") {
      glow(128, 128, 126, "255,213,121", 0.32);
      c.translate(128, 128); c.strokeStyle = "rgba(255,222,149,0.28)"; c.lineWidth = 2; c.lineCap = "round";
      c.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        c.moveTo(Math.cos(a) * 49, Math.sin(a) * 49);
        c.lineTo(Math.cos(a) * 65, Math.sin(a) * 65);
      }
      c.stroke();
      const disc = c.createRadialGradient(-9, -9, 0, 0, 0, 34);
      disc.addColorStop(0, "rgba(255,249,215,0.92)"); disc.addColorStop(1, "rgba(255,211,118,0.7)");
      c.fillStyle = disc; c.beginPath(); c.arc(0, 0, 34, 0, Math.PI * 2); c.fill();
    } else if (name === "moon") {
      // Decorative crescent, not an assertion about the real lunar phase.
      glow(64, 64, 60, "191,213,243", 0.13);
      c.fillStyle = "rgba(228,237,250,0.86)"; c.beginPath();
      c.arc(64, 64, 24, Math.PI * 0.22, Math.PI * 1.7);
      c.bezierCurveTo(51, 47, 49, 74, 82.49, 79.3); c.closePath(); c.fill();
    } else if (name === "star") {
      glow(32, 32, 26, "219,235,255", 0.24);
      glow(32, 32, 8, "242,248,255", 0.9);
    } else if (name === "hail") {
      glow(32, 32, 24, "206,232,251", 0.22);
      const ice = c.createRadialGradient(27, 25, 1, 32, 32, 13);
      ice.addColorStop(0, "rgba(255,255,255,0.98)"); ice.addColorStop(1, "rgba(163,199,225,0.65)");
      c.fillStyle = ice; c.beginPath(); c.arc(32, 32, 13, 0, Math.PI * 2); c.fill();
    }
    this.sprites.set(name, canvas);
    return canvas;
  }
  snowSprite(index) { return this.sprite(`snow${index % 3}`); }
  animate(time) {
    this.frame = null;
    if (!this.running || !this.active.length || this.doc.hidden) { this.pause(); return; }
    const interval = 1000 / Math.min(...this.active.map(config => config.max_fps));
    if (this.lastFrame !== null && time - this.lastFrame < interval - 0.5) {
      this.frame = this.win.requestAnimationFrame(this.onFrame); return;
    }
    const dt = this.lastFrame === null ? 0 : Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    this.ctx.clearRect(0, 0, this.width, this.height);
    for (const scene of this.scenes) {
      scene.time += dt * scene.config.speed;
      if (scene.layerViews) for (const source in scene.layerViews) {
        const view = scene.layerViews[source];
        view.time += dt * view.config.speed;
      }
      this.drawSky(scene);
      this.drawHeat(scene);
      this.drawClouds(scene, dt);
      this.drawWind(scene, dt);
      this.drawRain(scene, dt);
      this.drawSnow(scene, dt);
      this.drawHail(scene, dt);
      this.drawFog(scene, dt);
      this.drawRipples(scene, dt);
    }
    this.drawLightning(time);
    this.ctx.globalAlpha = 1;
    this.frame = this.win.requestAnimationFrame(this.onFrame);
  }
  image(name, x, y, width, height = width) {
    this.ctx.drawImage(this.sprites.get(name), x - width / 2, y - height / 2, width, height);
  }
  wrap(p, margin = 50) {
    if (p.x > this.width + margin) p.x = -margin;
    if (p.x < -margin) p.x = this.width + margin;
    if (p.y > this.height + margin) { p.y = -margin; p.x = Math.random() * this.width; }
  }
  drawSky(scene) {
    const { config: c, time, sun, moon, stars } = scene.layerViews?.sun || scene.layerViews?.night || scene;
    const ctx = this.ctx, x = this.width * 0.82 + Math.sin(time * 0.035) * c.wind * 8;
    const y = Math.min(140, this.height * 0.17);
    for (const p of stars) {
      ctx.globalAlpha = c.opacity * (0.28 + p.depth * 0.32) * (0.85 + Math.sin(time * 0.35 + p.phase) * 0.15);
      this.image("star", p.x + Math.sin(time * 0.02) * c.wind * 4, p.y, (5 + p.depth * 7) * c.size);
    }
    if (sun.length) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(time * 0.015);
      ctx.globalAlpha = c.opacity * (0.9 + Math.sin(time * 0.3) * 0.025);
      this.image("sun", 0, 0, 300 * c.size); ctx.restore();
    }
    if (moon.length) { ctx.globalAlpha = c.opacity * 0.8; this.image("moon", x, y, 120 * c.size); }
  }
  drawHeat(scene) {
    const { config: c, heat, heatGlow, time } = scene.layerViews?.sun || scene;
    const intensity = c.intensity.heat, ctx = this.ctx;
    if (heatGlow.length) {
      ctx.globalAlpha = c.opacity * intensity * 0.7;
      this.image("heatGlow", this.width * 0.82, Math.min(140, this.height * 0.17), (340 + intensity * 110) * c.size);
    }
    // Local translucent rising ribbons, never sample or distort dashboard pixels.
    for (const p of heat) {
      const x = p.x + Math.sin(time * 0.45 + p.phase) * 9;
      const y = this.height * (0.4 + p.depth * 0.5);
      const bend = Math.sin(time * 0.65 + p.phase) * 12;
      ctx.globalAlpha = c.opacity * intensity * 0.12;
      ctx.strokeStyle = "rgb(255,185,106)"; ctx.lineWidth = 1.2 * c.size; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + bend, y - 22, x - bend, y - 45, x + bend * 0.4, y - 70);
      ctx.stroke();
    }
  }
  drawClouds(scene, dt) {
    const { config: c, clouds, cloudSprite, cloudPadding, time } = scene.layerViews?.clouds || scene;
    const spread = c.cloud_spread / 100, period = this.width + 2 * cloudPadding;
    const top = this.height * c.cloud_top / 100, bottom = this.height * c.cloud_bottom / 100;
    for (const p of clouds) {
      // At full spread all centers share one velocity and wrap period: the
      // build-time spacing cannot immediately collapse through depth parallax.
      p.x += (5 + c.wind * 14) * c.speed * (p.depth * (1 - spread) + 0.625 * spread) * dt;
      if (p.x > this.width + cloudPadding || p.x < -cloudPadding)
        p.x = ((p.x + cloudPadding) % period + period) % period - cloudPadding;
      this.ctx.globalAlpha = c.opacity * (cloudSprite === "darkCloud" ? 0.88 : 0.82) * (0.82 + p.depth * 0.18)
        * (c.intensity.cloud === null ? 1 : 0.75 + 0.25 * c.intensity.cloud);
      const y = Math.min(bottom, Math.max(top, p.y + Math.sin(time * 0.14 + p.phase) * 4 * (1 - spread)));
      this.image(cloudSprite + p.variant % 2, p.x, y, 320 * p.scale, 160 * p.scale);
    }
  }
  drawFog(scene, dt) {
    const { config: c, fog, time } = scene.layerViews?.fog || scene;
    for (const p of fog) {
      p.x += (7 + c.wind * 12) * c.speed * dt;
      this.wrap(p, 300 * p.scale);
      // Independent, low-lying transparent banks leave the dashboard readable.
      this.ctx.globalAlpha = c.opacity * 0.2;
      this.image("fog", p.x, p.y + Math.sin(time * 0.17 + p.phase) * 9, 600 * p.scale, 150 * p.scale);
    }
  }
  drawWind(scene, dt) {
    const { config: c, wind, time } = scene.layerViews?.wind || scene;
    const ctx = this.ctx;
    for (const p of wind) {
      const direction = c.wind < 0 ? -1 : 1;
      p.x += direction * (24 + Math.abs(c.wind) * 22) * c.speed * (0.6 + p.depth) * dt;
      this.wrap(p, 200 * c.size);
      const length = (65 + p.depth * 100) * c.size, bend = Math.sin(time * 0.45 + p.phase) * 18 * c.size;
      ctx.globalAlpha = c.opacity * 0.16 * (0.5 + 0.5 * Math.sin(time * 0.6 + p.phase) ** 2);
      ctx.strokeStyle = "rgb(214,230,241)"; ctx.lineWidth = (0.5 + p.depth * 0.65) * c.size; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
      ctx.bezierCurveTo(p.x - length * 0.35 * direction, p.y + bend, p.x - length * 0.65 * direction, p.y - bend, p.x - length * direction, p.y + bend * 0.3);
      ctx.stroke();
    }
  }
  drawRain(scene, dt) {
    const { config: c, rain, layers } = scene.layerViews?.rain || scene;
    const ctx = this.ctx, heavy = layers.includes("downpour"), storm = layers.includes("storm_clouds");
    const fallScale = heavy ? 1.45 : 1;
    for (const p of rain) {
      const fall = (330 + 470 * p.depth) * fallScale;
      const drift = c.wind * 130 + (heavy ? 42 : storm ? 58 : 15);
      p.y += fall * c.speed * dt; p.x += drift * c.speed * dt; this.wrap(p, 65 * c.size);
      const length = (9 + 22 * p.depth) * c.size * (heavy ? 1.55 : 1);
      ctx.globalAlpha = c.opacity * (0.2 + p.depth * (heavy ? 0.62 : 0.48));
      ctx.strokeStyle = "rgb(184,215,240)"; ctx.lineWidth = (0.45 + p.depth * (heavy ? 1.15 : 0.7)) * c.size;
      ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - drift / fall * length, p.y - length); ctx.stroke();
    }
  }
  drawSnow(scene, dt) {
    const { config: c, snow, time } = scene.layerViews?.snow || scene;
    const ctx = this.ctx;
    for (const p of snow) {
      p.y += (18 + 43 * p.depth) * c.speed * dt;
      p.x += (c.wind * 35 + Math.sin(time * 0.7 + p.phase) * 12) * c.speed * dt;
      const radius = (3 + 7 * p.depth) * c.size;
      this.wrap(p, radius);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.phase + time * p.spin);
      ctx.globalAlpha = c.opacity * (0.3 + p.depth * 0.65);
      this.image(`snow${p.depth < 0.45 ? 2 : p.variant % 2}`, 0, 0, radius * 2); ctx.restore();
    }
  }
  drawHail(scene, dt) {
    const { config: c, hail } = scene.layerViews?.hail || scene;
    for (const p of hail) {
      p.y += (260 + p.depth * 310) * c.speed * dt;
      p.x += (c.wind * 85 + 12) * c.speed * dt; this.wrap(p, 16);
      this.ctx.globalAlpha = c.opacity * (0.5 + p.depth * 0.45);
      this.image("hail", p.x, p.y, (7 + 8 * p.depth) * c.size);
    }
  }
  drawRipples(scene, dt) {
    const { config: c, ripples } = scene.layerViews?.rain || scene;
    const ctx = this.ctx;
    for (const p of ripples) {
      p.life += dt * c.speed * 0.7;
      if (p.life >= 1) { p.life %= 1; p.x = Math.random() * this.width; p.y = this.height * (0.82 + Math.random() * 0.17); }
      ctx.globalAlpha = c.opacity * 0.17 * Math.sin(p.life * Math.PI);
      ctx.strokeStyle = "rgb(192,218,237)"; ctx.lineWidth = 0.7 * c.size;
      ctx.beginPath(); ctx.ellipse(p.x, Math.max(this.height * 0.82, p.y), (2 + p.life * 13) * c.size, (0.5 + p.life * 3) * c.size, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

// add_extra_js_url loads once globally; tolerate reinjection during development.
if (typeof document !== "undefined" && typeof window !== "undefined") {
  window.__weatherEffectsOverlay?.stop?.();
  window.__weatherEffectsOverlay = new WeatherEffectsOverlay(window, document).start();
}
