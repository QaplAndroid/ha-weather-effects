/* Weather Effects: dependency-free, globally loaded Home Assistant ES module. */
export const MAX_PARTICLES = 800;
export const EFFECTS = Object.freeze({
  off: [], snow: ["snow"], rain: ["rain"], sun: ["sun"], clouds: ["clouds"],
  partlycloudy: ["sun", "clouds"], rain_clouds: ["clouds", "rain"],
  snow_clouds: ["clouds", "snow"],
});
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
  return {
    id: String(raw.id ?? ""), enabled: raw.enabled === true,
    dashboards: [...new Set((Array.isArray(raw.dashboards) ? raw.dashboards : []).map(normalizeDashboard).filter(Boolean))],
    effect: Object.prototype.hasOwnProperty.call(EFFECTS, raw.effect) ? raw.effect : "off",
    speed: clamp(raw.speed, 0.2, 3, 1), size: clamp(raw.size, 0.3, 3, 1),
    density: Math.round(clamp(raw.density, 10, 200, 70)), opacity: clamp(raw.opacity, 0.05, 1, 0.65),
    wind: clamp(raw.wind, -2, 2, 0), respect_reduced_motion: raw.respect_reduced_motion !== false,
    max_fps: clamp(raw.max_fps, 15, 60, 30),
  };
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

export class WeatherEffectsOverlay {
  constructor(win = globalThis.window, doc = globalThis.document) {
    this.win = win; this.doc = doc;
    this.configs = []; this.active = []; this.scenes = []; this.sprites = [];
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
    this.sprites = []; this.scenes = [];
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
        this.refresh(true);
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
    const changed = force || active.length !== this.active.length || active.some((config, i) => config !== this.active[i]);
    this.active = active;
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
    this.dpr = Math.min(2, Math.max(1, this.win.devicePixelRatio || 1));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.sprites = [];
  }
  pause() {
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null; this.lastFrame = null;
    if (this.canvas) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.canvas.hidden = true;
      this.canvas.style.visibility = "hidden";
    }
  }
  buildScenes() {
    const counts = this.active.map(config => {
      const layers = effectLayers(config.effect);
      return (layers.includes("snow") || layers.includes("rain") ? config.density : 0)
        + (layers.includes("clouds") ? Math.min(10, Math.ceil(config.density / 22)) : 0);
    });
    const total = counts.reduce((a, b) => a + b, 0);
    this.scenes = this.active.map((config, i) => {
      const layers = effectLayers(config.effect);
      const budget = Math.floor(counts[i] * Math.min(1, MAX_PARTICLES / Math.max(1, total)));
      const cloudCount = layers.includes("clouds") ? Math.min(budget, Math.min(10, Math.ceil(config.density / 22))) : 0;
      const particles = Array.from({ length: budget - cloudCount }, () => ({
        x: Math.random() * this.width, y: Math.random() * this.height,
        depth: 0.35 + Math.random() * 0.65, phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.7,
      }));
      const clouds = Array.from({ length: cloudCount }, (_, index) => ({
        x: Math.random() * (this.width + 400) - 200,
        y: 25 + Math.random() * Math.min(this.height * 0.32, 230),
        scale: (0.65 + Math.random() * 0.8) * config.size,
        depth: 0.5 + index / Math.max(1, cloudCount),
      }));
      return { config, layers, particles, clouds, time: Math.random() * 30 };
    });
  }
  snowSprite(index) {
    if (this.sprites[index]) return this.sprites[index];
    const sprite = this.doc.createElement("canvas");
    sprite.width = sprite.height = 64 * this.dpr;
    const c = sprite.getContext("2d");
    c.scale(this.dpr, this.dpr); c.translate(32, 32);
    c.strokeStyle = "rgba(242,250,255,0.96)"; c.lineWidth = index === 0 ? 1.5 : 1.1;
    c.lineCap = "round"; c.beginPath();
    const radius = 26;
    for (let arm = 0; arm < 6; arm++) {
      const angle = arm * Math.PI / 3;
      const x = Math.cos(angle), y = Math.sin(angle);
      c.moveTo(0, 0); c.lineTo(x * radius, y * radius);
      for (const along of [0.48, 0.73]) {
        const bx = x * radius * along, by = y * radius * along;
        for (const side of [-1, 1]) {
          const branch = angle + side * Math.PI / 3;
          const length = radius * (index === 0 ? 0.24 : 0.19);
          c.moveTo(bx, by); c.lineTo(bx - Math.cos(branch) * length, by - Math.sin(branch) * length);
        }
      }
    }
    c.stroke(); this.sprites[index] = sprite;
    return sprite;
  }
  animate(time) {
    this.frame = null;
    if (!this.running || !this.active.length || this.doc.hidden) { this.pause(); return; }
    const interval = 1000 / Math.min(...this.active.map(config => config.max_fps));
    if (this.lastFrame !== null && time - this.lastFrame < interval - 0.5) {
      this.frame = this.win.requestAnimationFrame(this.onFrame); return;
    }
    const dt = this.lastFrame === null ? 0 : Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    for (const scene of this.scenes) {
      scene.time += dt * scene.config.speed;
      if (scene.layers.includes("sun")) this.drawSun(scene);
      if (scene.layers.includes("clouds")) this.drawClouds(scene, dt);
      if (scene.layers.includes("rain")) this.drawRain(scene, dt);
      if (scene.layers.includes("snow")) this.drawSnow(scene, dt);
    }
    ctx.globalAlpha = 1;
    this.frame = this.win.requestAnimationFrame(this.onFrame);
  }
  drawSun({ config: c, time }) {
    const ctx = this.ctx, x = this.width * 0.82, y = Math.min(150, this.height * 0.18);
    const radius = 46 * c.size;
    const glow = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius * 4.5);
    glow.addColorStop(0, "rgba(255,226,137,0.40)");
    glow.addColorStop(0.35, "rgba(255,216,110,0.15)"); glow.addColorStop(1, "rgba(255,221,150,0)");
    ctx.globalAlpha = c.opacity; ctx.fillStyle = glow;
    ctx.fillRect(x - radius * 4.5, y - radius * 4.5, radius * 9, radius * 9);
    ctx.save(); ctx.translate(x, y); ctx.rotate(time * 0.025);
    ctx.strokeStyle = "rgba(255,226,145,0.35)"; ctx.lineWidth = 2.5 * c.size; ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      ctx.moveTo(Math.cos(a) * radius * 1.35, Math.sin(a) * radius * 1.35);
      ctx.lineTo(Math.cos(a) * radius * 1.9, Math.sin(a) * radius * 1.9);
    }
    ctx.stroke(); ctx.restore();
    const disc = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
    disc.addColorStop(0, "rgba(255,249,207,0.9)"); disc.addColorStop(1, "rgba(255,209,101,0.68)");
    ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  }
  drawClouds({ config: c, clouds }, dt) {
    const ctx = this.ctx;
    for (const cloud of clouds) {
      cloud.x += (5 + c.wind * 15) * c.speed * cloud.depth * dt;
      const width = 160 * cloud.scale;
      if (cloud.x > this.width + width) cloud.x = -width;
      if (cloud.x < -width) cloud.x = this.width + width;
      ctx.save(); ctx.translate(cloud.x, cloud.y); ctx.scale(cloud.scale, cloud.scale);
      ctx.globalAlpha = c.opacity * 0.43;
      const shade = ctx.createLinearGradient(0, -45, 0, 36);
      shade.addColorStop(0, "rgba(250,253,255,0.9)"); shade.addColorStop(1, "rgba(160,179,199,0.45)");
      ctx.fillStyle = shade; ctx.beginPath();
      ctx.ellipse(-44, 5, 46, 27, 0, 0, Math.PI * 2);
      ctx.ellipse(-8, -16, 40, 38, 0, 0, Math.PI * 2);
      ctx.ellipse(34, -4, 45, 32, 0, 0, Math.PI * 2);
      ctx.ellipse(65, 11, 31, 22, 0, 0, Math.PI * 2);
      ctx.ellipse(0, 15, 78, 24, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.restore();
    }
  }
  drawRain({ config: c, particles }, dt) {
    const ctx = this.ctx;
    ctx.globalAlpha = c.opacity * 0.7; ctx.strokeStyle = "rgba(181,215,245,0.85)";
    ctx.lineWidth = Math.max(0.65, c.size * 0.9); ctx.lineCap = "round"; ctx.beginPath();
    for (const p of particles) {
      const fall = (330 + 430 * p.depth) * c.speed;
      p.y += fall * dt; p.x += (c.wind * 130 + 15) * c.speed * dt;
      if (p.y > this.height + 45) { p.y = -45; p.x = Math.random() * this.width; }
      if (p.x > this.width + 50) p.x = -50;
      if (p.x < -50) p.x = this.width + 50;
      const length = (12 + 19 * p.depth) * c.size;
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (c.wind * 130 + 15) / (330 + 430 * p.depth) * length, p.y - length);
    }
    ctx.stroke();
  }
  drawSnow({ config: c, particles, time }, dt) {
    const ctx = this.ctx;
    for (let index = 0; index < particles.length; index++) {
      const p = particles[index];
      p.y += (18 + 43 * p.depth) * c.speed * dt;
      p.x += (c.wind * 35 + Math.sin(time * 0.7 + p.phase) * 12) * c.speed * dt;
      const radius = (4 + 7 * p.depth) * c.size;
      if (p.y > this.height + radius) { p.y = -radius; p.x = Math.random() * this.width; }
      if (p.x > this.width + radius) p.x = -radius;
      if (p.x < -radius) p.x = this.width + radius;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.phase + time * p.spin);
      ctx.globalAlpha = c.opacity * (0.4 + p.depth * 0.6);
      ctx.drawImage(this.snowSprite(index % 2), -radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
  }
}

// add_extra_js_url loads once globally; tolerate reinjection during development.
if (typeof document !== "undefined" && typeof window !== "undefined") {
  window.__weatherEffectsOverlay?.stop?.();
  window.__weatherEffectsOverlay = new WeatherEffectsOverlay(window, document).start();
}
