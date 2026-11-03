/* Globally loaded, dependency-free Lovelace card and visual editor. */
const BaseElement = globalThis.HTMLElement || class {};
const CARD = 'weather-effects-control-card';
const TYPE = `custom:${CARD}`;
const APPEARANCE = ['speed', 'size', 'density', 'opacity', 'wind'];
const SWITCHES = ['enabled', 'respect_reduced_motion', 'adaptive_weather', 'lightning_enabled'];
const SELECTS = ['mode', 'effect', 'settings_effect'];
const NUMBERS = { forecast_offset: [0, 72, 1], speed: [0.2, 3, 0.1], size: [0.3, 3, 0.1], density: [10, 200, 1], opacity: [0.05, 1, 0.05], wind: [-2, 2, 0.1], max_fps: [15, 60, 1], heat_threshold: [25, 45, 1], lightning_interval: [5, 60, 1], lightning_brightness: [0.05, 0.25, 0.05] };
const LABELS = {
  en: { ok: 'Ready', forecast_fallback: 'Forecast unavailable; using current weather', weather_unavailable: 'Weather unavailable', enable_entity_unavailable: 'External gate unavailable', current: 'Current weather', forecast: 'Forecast', fallback_current: 'Current weather (forecast fallback)', off: 'Off', snow: 'Snow', rain: 'Rain', sun: 'Sun', clouds: 'Clouds', partlycloudy: 'Partly cloudy', rain_clouds: 'Rain and clouds', snow_clouds: 'Snow and clouds', fog: 'Fog', wind_clouds: 'Wind and clouds', night: 'Clear night', night_clouds: 'Moon and clouds', hail: 'Hail', sleet: 'Sleet', downpour: 'Heavy rain', storm: 'Thunderstorm', storm_clouds: 'Storm clouds', title: 'Weather effects', profile: 'Profile', choose: 'Choose a profile', loading: 'Waiting for weather profiles…', empty: 'No weather profiles available.', enabled: 'Effects enabled', mode: 'Mode', effect: 'Effect', automatic: 'Automatic', manual: 'Manual', forecast_offset: 'Forecast offset (hours)', speed: 'Speed', size: 'Size', density: 'Density', opacity: 'Opacity', wind: 'Wind', max_fps: 'Maximum FPS', respect_reduced_motion: 'Respect reduced motion', missing: 'Control entity is missing or disabled.', unavailable: 'Control entity is unavailable.', auto: 'Effect follows the weather in automatic mode.', gate: 'Enabled in settings, but paused by the external gate', saving: 'Saving…', error: 'Unable to update', subscribe: 'Unable to load profiles. Retrying…', status: 'Status', source: 'Source', condition: 'Condition', forecast_time: 'Forecast time', weather_entity: 'Weather entity', dashboards: 'Dashboards', integration: 'Integration settings', optionalTitle: 'Title (optional)', notfound: 'Selected profile is not available.', unknown: 'Unknown' },
  hr: { ok: 'Spremno', forecast_fallback: 'Prognoza nije dostupna; koristi se trenutačno vrijeme', weather_unavailable: 'Vremenski podaci nisu dostupni', enable_entity_unavailable: 'Vanjski uvjet nije dostupan', current: 'Trenutačno vrijeme', forecast: 'Prognoza', fallback_current: 'Trenutačno vrijeme (zamjena za prognozu)', off: 'Isključeno', snow: 'Snijeg', rain: 'Kiša', sun: 'Sunce', clouds: 'Oblaci', partlycloudy: 'Djelomično oblačno', rain_clouds: 'Kiša i oblaci', snow_clouds: 'Snijeg i oblaci', fog: 'Magla', wind_clouds: 'Vjetar i oblaci', night: 'Vedra noć', night_clouds: 'Mjesec i oblaci', hail: 'Tuča', sleet: 'Susnježica', downpour: 'Pljusak', storm: 'Grmljavinsko nevrijeme', storm_clouds: 'Olujni oblaci', title: 'Vremenski efekti', profile: 'Profil', choose: 'Odaberite profil', loading: 'Čekanje vremenskih profila…', empty: 'Nema dostupnih vremenskih profila.', enabled: 'Efekti uključeni', mode: 'Način rada', effect: 'Efekt', automatic: 'Automatski', manual: 'Ručno', forecast_offset: 'Odmak prognoze (sati)', speed: 'Brzina', size: 'Veličina', density: 'Gustoća', opacity: 'Neprozirnost', wind: 'Vjetar', max_fps: 'Maksimalni FPS', respect_reduced_motion: 'Poštuj smanjeno kretanje', missing: 'Upravljački entitet nedostaje ili je onemogućen.', unavailable: 'Upravljački entitet nije dostupan.', auto: 'U automatskom načinu efekt prati vrijeme.', gate: 'Uključeno u postavkama, ali zaustavljeno vanjskim uvjetom', saving: 'Spremanje…', error: 'Ažuriranje nije uspjelo', subscribe: 'Profili se ne mogu učitati. Ponovni pokušaj…', status: 'Stanje', source: 'Izvor', condition: 'Vremensko stanje', forecast_time: 'Vrijeme prognoze', weather_entity: 'Vremenski entitet', dashboards: 'Nadzorne ploče', integration: 'Postavke integracije', optionalTitle: 'Naslov (neobavezno)', notfound: 'Odabrani profil nije dostupan.', unknown: 'Nepoznato' },
};
Object.assign(LABELS.en, {
  heat: 'Heat', displayed: 'Currently displayed effect / mode', settings_effect: 'Edit settings for effect', presets: 'Saved appearance preset', target_changed: 'The effect being edited changed in another control. No preset was saved. Review the selected effect and try again.', preset_help: 'These sliders save the selected effect’s base preset, not the currently adapted values. Selecting an edit target does not change the displayed effect.', target_missing: 'Select an available edit target to safely edit saved appearance presets. Update or enable the settings-effect control.', runtime: 'Actual runtime values', base: 'Saved base for displayed effect', adaptive: 'Weather adaptation (automatic mode only)', adaptive_weather: 'Adapt intensity to weather', adaptive_help: 'Uses available weather metrics in automatic mode only. Manual mode uses the saved preset unchanged.', heat_threshold: 'Heat threshold (°C)', lightning: 'Optional lightning', lightning_enabled: 'Enable lightning flashes (opt in)', lightning_interval: 'Lightning interval (seconds)', lightning_brightness: 'Lightning brightness (maximum 0.25)', lightning_warning: 'Photosensitivity warning: lightning creates flashes that may trigger seizures or discomfort. Disabled by default. Enable only if safe for everyone viewing this dashboard.', global: 'Global settings', intensity: 'Adapted intensity', temperature_c: 'Temperature (°C)', cloud_coverage: 'Cloud coverage (%)', precipitation_mm_h: 'Precipitation (mm/h)', wind_kmh: 'Wind (km/h)', precipitation_source: 'Precipitation source', weather_metrics: 'Weather metrics', cloud: 'Cloud', global_help: 'Forecast offset and maximum FPS apply to the whole profile.', metrics_unknown: 'Unavailable / not applied', none: 'Unavailable', current_rate: 'Current rate', hourly_forecast: 'Hourly forecast', forecast_hourly: 'Hourly forecast', forecast_daily: 'Daily forecast', forecast_rate: 'Forecast rate', forecast_hourly_amount: 'Hourly forecast amount', forecast_daily_amount: 'Daily forecast amount'
});
Object.assign(LABELS.hr, {
  heat: 'Vrućina', displayed: 'Trenutačno prikazani efekt / način rada', settings_effect: 'Uredi postavke za efekt', presets: 'Spremljena postavka izgleda', target_changed: 'Efekt za uređivanje promijenjen je drugom kontrolom. Postavka nije spremljena. Provjerite odabrani efekt i pokušajte ponovno.', preset_help: 'Klizači spremaju osnovne postavke odabranog efekta, a ne trenutačno prilagođene vrijednosti. Odabir cilja uređivanja ne mijenja prikazani efekt.', target_missing: 'Za sigurno uređivanje spremljenog izgleda odaberite dostupan ciljni efekt. Ažurirajte ili omogućite entitet za odabir postavki efekta.', runtime: 'Stvarne radne vrijednosti', base: 'Spremljena osnova prikazanog efekta', adaptive: 'Prilagodba vremenu (samo automatski način)', adaptive_weather: 'Prilagodi intenzitet vremenu', adaptive_help: 'Koristi dostupne vremenske podatke samo u automatskom načinu. Ručni način koristi spremljenu postavku bez prilagodbe.', heat_threshold: 'Prag vrućine (°C)', lightning: 'Neobavezni bljeskovi munje', lightning_enabled: 'Omogući bljeskove munje (izričit pristanak)', lightning_interval: 'Razmak bljeskova (sekunde)', lightning_brightness: 'Svjetlina bljeskova (najviše 0,25)', lightning_warning: 'Upozorenje na fotoosjetljivost: bljeskovi munje mogu izazvati napadaje ili nelagodu. Zadano isključeno. Uključite samo ako je sigurno za sve gledatelje ove nadzorne ploče.', global: 'Opće postavke', intensity: 'Prilagođeni intenzitet', temperature_c: 'Temperatura (°C)', cloud_coverage: 'Naoblaka (%)', precipitation_mm_h: 'Oborine (mm/h)', wind_kmh: 'Vjetar (km/h)', precipitation_source: 'Izvor podataka o oborinama', weather_metrics: 'Vremenski podaci', cloud: 'Oblaci', global_help: 'Odmak prognoze i maksimalni FPS primjenjuju se na cijeli profil.', metrics_unknown: 'Nedostupno / nije primijenjeno', none: 'Nedostupno', current_rate: 'Trenutačni intenzitet', hourly_forecast: 'Satna prognoza', forecast_hourly: 'Satna prognoza', forecast_daily: 'Dnevna prognoza', forecast_rate: 'Prognozirani intenzitet', forecast_hourly_amount: 'Satna prognozirana količina', forecast_daily_amount: 'Dnevna prognozirana količina'
});
export const labelsFor = language => LABELS[String(language || '').toLowerCase().startsWith('hr') ? 'hr' : 'en'];
export const profileId = profile => String(profile?.id ?? profile?.entry_id ?? '');
export function selectProfile(profiles, id) { return id ? profiles.find(p => profileId(p) === id) : profiles.length === 1 ? profiles[0] : undefined; }
export function validateConfig(config) {
  if (!config || typeof config !== 'object' || (config.type && config.type !== TYPE)) throw new Error('Invalid weather effects card configuration');
  if (config.profile != null && typeof config.profile !== 'string') throw new Error('Profile must be an entry ID');
  if (config.title != null && typeof config.title !== 'string') throw new Error('Title must be a string');
  return { ...config, type: TYPE };
}
export function controlState(hass, profile, key) {
  const entity_id = profile?.controls?.[key];
  const state = hass?.states?.[entity_id];
  return { entity_id, state, available: Boolean(entity_id && state && !['unavailable', 'unknown'].includes(state.state)), reason: !entity_id || !state ? 'missing' : ['unavailable', 'unknown'].includes(state.state) ? 'unavailable' : '' };
}
export function serviceFor(key, value, entity_id) {
  if (SWITCHES.includes(key)) return ['switch', value ? 'turn_on' : 'turn_off', { entity_id }];
  if (SELECTS.includes(key)) return ['select', 'select_option', { entity_id, option: String(value) }];
  if (key in NUMBERS && Number.isFinite(Number(value))) return ['number', 'set_value', { entity_id, value: Number(value) }];
  throw new Error('Invalid control');
}
const CSS = `:host{display:block;color:var(--primary-text-color,#202124)}ha-card{display:block;padding:20px;border-radius:var(--ha-card-border-radius,16px);background:var(--ha-card-background,var(--card-background-color,#fff));box-shadow:var(--ha-card-box-shadow,0 2px 8px #0001)}h2{margin:0 0 18px;font-size:1.35rem}.row{padding:12px 0;border-bottom:1px solid var(--divider-color,#ddd)}label{display:flex;gap:12px;align-items:center;justify-content:space-between;font-weight:500}.numbers{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:0 24px}input,select{font:inherit;accent-color:var(--primary-color,#03a9f4)}select,input[type=text]{box-sizing:border-box;max-width:60%;padding:9px;border:1px solid var(--divider-color,#bbb);border-radius:8px;background:var(--card-background-color,#fff);color:inherit}input[type=range]{width:100%;margin:16px 0 6px;min-height:28px}input[type=checkbox]{width:24px;height:24px;flex-shrink:0}.enabled{font-size:1.1rem}.enabled input{width:30px;height:30px}input:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:3px}small{display:block;margin-top:7px;color:var(--secondary-text-color,#666);line-height:1.4}.notice{padding:10px 0;line-height:1.4}.error{color:var(--error-color,#b00020)}dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 16px;font-size:.9rem}dt{color:var(--secondary-text-color,#666)}dd{margin:0;overflow-wrap:anywhere}a{display:inline-block;margin-top:12px;color:var(--primary-color,#0288d1)}output{font-variant-numeric:tabular-nums}button,input,select{touch-action:manipulation}:disabled{opacity:.5}h3{font-size:1rem;margin:24px 0 10px}label{overflow-wrap:anywhere}select{min-width:0}dl{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}@media(max-width:380px){ha-card{padding:14px}label{flex-wrap:wrap}select{max-width:100%;width:100%}}`;
function bounds(key, state) {
  const defaults = NUMBERS[key];
  const safe = key.startsWith('lightning_');
  const min = Number(state?.attributes?.min ?? defaults[0]), max = Number(state?.attributes?.max ?? defaults[1]);
  return [safe ? Math.max(defaults[0], min) : min, safe ? Math.min(defaults[1], max) : max, safe ? defaults[2] : state?.attributes?.step ?? defaults[2]];
}
function node(tag, text) { const el = document.createElement(tag); if (text != null) el.textContent = String(text); return el; }
function release(fn) { if (typeof fn === 'function') { try { Promise.resolve(fn()).catch(() => {}); } catch { /* closed socket */ } } }

class ProfileSubscriber extends BaseElement {
  constructor() { super(); this._profiles = []; this._epoch = 0; this._retryAt = 0; this._failures = 0; this._config = { type: TYPE }; this.attachShadow?.({ mode: 'open' }); }
  get hass() { return this._hass; }
  set hass(value) { this._hass = value; this._sync(); this.render(); }
  connectedCallback() { if (this._connected) return; this._connected = true; this._sync(); this._timer = setInterval(() => this._sync(), 2000); this.render(); }
  disconnectedCallback() { this._connected = false; this._editing = false; clearInterval(this._timer); this._disconnect(); }
  _disconnect() { this._editing = false; this._epoch++; release(this._unsubscribe); this._unsubscribe = null; this._pending = false; this._connection = null; this._retryAt = 0; this._failures = 0; this._profiles = []; this._loaded = false; this._subscriptionError = false; }
  _sync() {
    if (!this._connected) return;
    const connection = this.hass?.connection?.connected !== false ? this.hass?.connection : null;
    if (connection !== this._connection) { this._disconnect(); this._connection = connection; this._profiles = []; this._loaded = false; }
    if (!connection || this._pending || this._unsubscribe || Date.now() < this._retryAt) return;
    this._pending = true; const epoch = this._epoch;
    Promise.resolve().then(() => {
      if (!this._connected || epoch !== this._epoch) return null;
      return connection.subscribeMessage(profiles => {
        if (epoch !== this._epoch || !this._connected || !Array.isArray(profiles)) return;
        this._profiles = profiles.filter(p => p && typeof p === 'object'); this._loaded = true; this._subscriptionError = false; this.render();
      }, { type: 'weather_effects/subscribe' });
    }).then(unsubscribe => {
      if (epoch !== this._epoch || !this._connected) { release(unsubscribe); return; }
      if (typeof unsubscribe !== 'function') throw new Error('Missing subscription cleanup');
      this._pending = false; this._unsubscribe = unsubscribe; this._failures = 0;
    }).catch(() => {
      if (epoch !== this._epoch || !this._connected) return;
      this._pending = false; this._subscriptionError = true;
      this._retryAt = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(this._failures++, 5)); this.render();
    });
  }
  get labels() { return labelsFor(this.hass?.language); }
  get profile() { return selectProfile(this._profiles, this._config.profile); }
  _root(title) {
    if (!this.shadowRoot) return null;
    const style = node('style', CSS), card = node('ha-card');
    card.append(node('h2', title)); this.shadowRoot.replaceChildren(style, card); return card;
  }
  _profileSelect(card, change) {
    const row = node('div'); row.className = 'row'; const label = node('label', this.labels.profile); const select = node('select');
    const placeholder = node('option', this.labels.choose); placeholder.value = ''; select.append(placeholder);
    for (const profile of this._profiles) { const option = node('option', profile.title || profile.name || profileId(profile)); option.value = profileId(profile); select.append(option); }
    select.value = this._config.profile || (this._profiles.length === 1 ? profileId(this._profiles[0]) : '');
    select.addEventListener('focus', () => { this._editing = true; });
    select.addEventListener('change', () => { this._editing = false; change(select.value); });
    select.addEventListener('blur', () => { this._editing = false; this.render(); });
    label.append(select); row.append(label); card.append(row);
  }
  _notice(card, text, error = false) { const message = node('div', text); message.className = `notice${error ? ' error' : ''}`; message.setAttribute('role', error ? 'alert' : 'status'); card.append(message); }
}

export class WeatherEffectsControlCard extends ProfileSubscriber {
  setConfig(config) { this._config = validateConfig(config); this.render(); }
  static getConfigElement() { return globalThis.document?.createElement(`${CARD}-editor`); }
  static getStubConfig() { return { type: TYPE }; }
  getCardSize() { return 10; }
  async commit(key, value, expectedEdit) {
    const profile = this.profile, control = controlState(this.hass, profile, key);
    // Native number services share the backend's edit target. Refuse a stale
    // visible slider after another client changes that target (best effort;
    // standard HA services cannot make this cross-client check atomic).
    if (APPEARANCE.includes(key) && expectedEdit && (expectedEdit.profile !== profileId(profile) || expectedEdit.target !== controlState(this.hass, profile, 'settings_effect').state?.state)) {
      this._error = this.labels.target_changed; this._editing = false; this.render(); return;
    }
    if (this._busy || !control.available || (key === 'effect' && controlState(this.hass, profile, 'mode').state?.state !== 'manual')) return;
    if (SELECTS.includes(key)) { if (!(control.state.attributes?.options || []).includes(String(value))) return; }
    if (APPEARANCE.includes(key) && !controlState(this.hass, profile, 'settings_effect').available) return;
    if (key in NUMBERS) {
      const n = Number(value), [min, max] = bounds(key, control.state);
      if (!Number.isFinite(n) || n < min || n > max) return;
    }
    this._busy = true; this._error = ''; this.render();
    try { await this.hass.callService(...serviceFor(key, value, control.entity_id)); }
    catch (error) { this._error = `${this.labels.error}: ${error?.message || String(error)}`; }
    finally { this._busy = false; this.render(); }
  }
  _control(card, key) {
    const c = controlState(this.hass, this.profile, key), row = node('div'); row.className = `row ${key}`;
    const expectedEdit = APPEARANCE.includes(key) ? { profile: profileId(this.profile), target: controlState(this.hass, this.profile, 'settings_effect').state?.state } : undefined;
    const label = node('label', this.labels[key]); row.append(label);
    let input;
    if (SWITCHES.includes(key)) { input = node('input'); input.type = 'checkbox'; input.checked = c.state?.state === 'on'; }
    else if (key in NUMBERS) {
      input = node('input'); input.type = 'range'; const limits = bounds(key, c.state);
      for (const [i, attr] of ['min', 'max', 'step'].entries()) input[attr] = String(limits[i]);
      input.value = c.available ? c.state.state : input.min;
      const output = node('output', c.available ? c.state.state : '—'); label.append(output);
      input.addEventListener('input', () => { this._editing = true; output.textContent = input.value; });
    } else {
      input = node('select');
      for (const value of c.state?.attributes?.options || []) { const option = node('option', this.labels[value] || value); option.value = value; input.append(option); }
      input.value = c.state?.state || '';
    }
    input.addEventListener('focus', () => { this._editing = true; });
    input.dataset.control = key; input.setAttribute('aria-label', this.labels[key]);
    const automatic = key === 'effect' && controlState(this.hass, this.profile, 'mode').state?.state !== 'manual';
    const missingTarget = APPEARANCE.includes(key) && !controlState(this.hass, this.profile, 'settings_effect').available;
    input.disabled = this._busy || !c.available || automatic || missingTarget;
    input.addEventListener('change', () => { this._editing = false; this.commit(key, input.type === 'checkbox' ? input.checked : input.value, expectedEdit); });
    input.addEventListener('blur', () => { if (this._editing) { this._editing = false; this.render(); } });
    if (key in NUMBERS) row.append(input); else label.append(input);
    const reason = c.reason ? this.labels[c.reason] : automatic ? this.labels.auto : missingTarget ? this.labels.target_missing : '';
    if (reason) { const help = node('small', reason); help.id = `help-${key}`; input.setAttribute('aria-describedby', help.id); row.append(help); }
    if (key === 'lightning_enabled') input.setAttribute('aria-describedby', [reason ? `help-${key}` : '', 'lightning-warning'].filter(Boolean).join(' '));
    card.append(row);
  }
  _values(card, heading, values, keys, percent = false) {
    card.append(node('h3', heading));
    const details = node('dl');
    for (const key of keys) {
      const value = values?.[key];
      const display = value == null || (typeof value === 'number' && !Number.isFinite(value)) ? this.labels.metrics_unknown : percent && typeof value === 'number' ? `${Math.round(value * 100)}%` : this.labels[value] || String(value);
      details.append(node('dt', this.labels[key] || key), node('dd', display));
    }
    card.append(details);
  }
  render() {
    if (this._editing) return;
    const t = this.labels, card = this._root(this._config.title || t.title); if (!card) return;
    if (this._profiles.length > 1 || this._config.profile) this._profileSelect(card, id => { this._config = { ...this._config, profile: id }; this._error = ''; this.render(); });
    const profile = this.profile;
    if (!profile) this._notice(card, this._subscriptionError ? t.subscribe : !this._loaded ? t.loading : this._config.profile ? t.notfound : this._profiles.length ? t.choose : t.empty, this._subscriptionError);
    else {
      this._control(card, 'enabled');
      const enabledState = controlState(this.hass, profile, 'enabled').state;
      const configured = enabledState ? enabledState.state === 'on' : profile.configured_enabled === true;
      const gateEntity = profile.gate_entity || profile.enable_entity;
      if (configured && gateEntity && profile.gate_enabled !== true && (profile.effective_enabled ?? profile.enabled) === false) this._notice(card, `${t.gate} (${gateEntity}).`);
      card.append(node('h3', t.displayed));
      this._values(card, `${t.effect}: ${t[profile.effect] || profile.effect || t.unknown}`, { mode: controlState(this.hass, profile, 'mode').state?.state ?? profile.mode }, ['mode']);
      this._control(card, 'mode'); this._control(card, 'effect');
      card.append(node('h3', t.presets));
      this._control(card, 'settings_effect');
      card.append(node('small', t.preset_help));
      const numbers = node('div'); numbers.className = 'numbers'; for (const key of APPEARANCE) this._control(numbers, key); card.append(numbers);
      card.append(node('h3', t.adaptive), node('small', t.adaptive_help));
      this._control(card, 'adaptive_weather'); this._control(card, 'heat_threshold');
      card.append(node('h3', t.lightning));
      const warning = node('p', t.lightning_warning); warning.id = 'lightning-warning'; warning.className = 'notice'; card.append(warning);
      this._control(card, 'lightning_enabled'); this._control(card, 'lightning_interval'); this._control(card, 'lightning_brightness');
      card.append(node('h3', t.global), node('small', t.global_help));
      this._control(card, 'forecast_offset'); this._control(card, 'max_fps'); this._control(card, 'respect_reduced_motion');
      this._values(card, t.runtime, profile, APPEARANCE);
      this._values(card, t.base, profile.preset, APPEARANCE);
      this._values(card, t.intensity, profile.intensity, ['heat', 'cloud', 'rain', 'wind'], true);
      this._values(card, t.weather_metrics, profile.weather_metrics, ['temperature_c', 'cloud_coverage', 'precipitation_mm_h', 'wind_kmh', 'precipitation_source']);
      const details = node('dl'); const status = controlState(this.hass, profile, 'status').state;
      for (const key of ['status', 'effect', 'source', 'condition', 'forecast_time', 'weather_entity', 'dashboards']) {
        let value = key === 'status' ? status?.attributes?.status ?? profile.status : profile[key];
        if (['status', 'source', 'effect'].includes(key) && value != null) value = t[value] || value;
        details.append(node('dt', t[key]), node('dd', Array.isArray(value) ? value.join(', ') || '—' : value ?? '—'));
      }
      card.append(details);
    }
    if (this._busy) this._notice(card, t.saving);
    if (this._error) this._notice(card, this._error, true);
    const link = node('a', t.integration); link.href = '/config/integrations/integration/weather_effects'; card.append(link);
  }
}
export class WeatherEffectsControlCardEditor extends ProfileSubscriber {
  setConfig(config) { this._config = validateConfig(config); this.render(); }
  _change(key, value) {
    const config = { ...this._config }; if (value) config[key] = value; else delete config[key]; this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { ...config } }, bubbles: true, composed: true }));
  }
  render() {
    // HA state updates must not replace a title the user is currently typing.
    if (this._editing) return;
    const card = this._root(this.labels.title); if (!card) return;
    this._profileSelect(card, value => this._change('profile', value));
    const label = node('label', this.labels.optionalTitle), input = node('input'); input.type = 'text'; input.value = this._config.title || '';
    input.addEventListener('focus', () => { this._editing = true; });
    input.addEventListener('input', () => { this._editing = true; });
    input.addEventListener('change', () => { this._editing = false; this._change('title', input.value); });
    input.addEventListener('blur', () => { this._editing = false; this.render(); });
    label.append(input); const row = node('div'); row.className = 'row'; row.append(label); card.append(row);
    if (!this._profiles.length) this._notice(card, this._subscriptionError ? this.labels.subscribe : this._loaded ? this.labels.empty : this.labels.loading, this._subscriptionError);
  }
}
export function registerCards(win = globalThis.window, registry = globalThis.customElements) {
  if (!win || !registry) return;
  if (!registry.get(CARD)) registry.define(CARD, WeatherEffectsControlCard);
  if (!registry.get(`${CARD}-editor`)) registry.define(`${CARD}-editor`, WeatherEffectsControlCardEditor);
  win.customCards ||= [];
  if (!win.customCards.some(card => card.type === CARD)) win.customCards.push({ type: CARD, name: 'Weather Effects Control Card', description: 'Control weather effects profiles with native Home Assistant entities.', preview: true });
}
registerCards();
