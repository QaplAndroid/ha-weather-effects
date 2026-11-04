import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element {
  constructor(tag = '') { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.value = ''; this.type = ''; }
  attachShadow() { return this.shadowRoot = new Element('shadow'); }
  append(...children) { for (const child of children) child.parent = this; this.children.push(...children); }
  replaceChildren(...children) { this.children = []; this.append(...children); this.activeElement = null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { this.lastEvent = event; for (const fn of this.listeners[event.type] || []) fn(event); return true; }
  fire(type, options = {}) { this.dispatchEvent({ type, ...options }); }
  querySelector(selector) { const match = selector.match(/\[data-tab="(.+)"\]/); return match ? walk(this).find(el => el.dataset.tab === match[1]) : undefined; }
  focus() { this.focused = true; let root = this; while (root.parent) root = root.parent; root.activeElement = this; }
  scrollIntoView() { this.scrolled = true; }
}
const globals = { HTMLElement: globalThis.HTMLElement, window: globalThis.window, customElements: globalThis.customElements, document: globalThis.document, CustomEvent: globalThis.CustomEvent };
const registered = new Map(), registry = { get: key => registered.get(key), define: (key, value) => registered.set(key, value) };
globalThis.HTMLElement = Element;
globalThis.window = {};
globalThis.customElements = registry;
const source = await readFile(new URL('../custom_components/weather_effects/frontend/weather-effects-card.js', import.meta.url), 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const metadata = globalThis.window.customCards;
for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
const { WeatherEffectsControlCard: Card, WeatherEffectsControlCardEditor: Editor, registerCards, validateConfig, selectProfile, labelsFor, serviceFor } = mod;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const walk = element => [element, ...element.children.flatMap(walk)];
const control = (card, key) => walk(card.shadowRoot).find(el => el.dataset.control === key);
const text = card => walk(card.shadowRoot).map(el => el.textContent || '').join(' ');
const showTab = (card, id) => { card._editing = false; card._tab = id; card.render(); };
const effects = ['off', 'sun', 'clouds', 'partlycloudy', 'rain', 'rain_clouds', 'snow', 'snow_clouds', 'fog', 'wind', 'wind_clouds', 'night', 'night_clouds', 'hail', 'sleet', 'downpour', 'storm', 'storm_clouds'];
const lightningNumbers = { lightning_interval: [5, 60, 1], lightning_brightness: [0.05, 0.25, 0.05], lightning_formation_time: [0.1, 3, 0.1], lightning_duration: [0.3, 2, 0.1], lightning_branches: [0, 8, 1], lightning_thickness: [0.5, 4, 0.5], lightning_glow: [0, 1, 0.1], lightning_length: [0.2, 0.9, 0.1] };
function dom() {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
}
function fixture() {
  dom();
  const states = {}, controls = {};
  for (const key of ['enabled', 'respect_reduced_motion', 'adaptive_weather', 'lightning_enabled', 'lightning_bolt_enabled', 'lightning_flash_enabled', 'mode', 'effect', 'settings_effect', 'forecast_offset', 'speed', 'size', 'density', 'opacity', 'wind', 'cloud_top', 'cloud_bottom', 'cloud_spread', 'max_fps', 'heat_threshold', ...Object.keys(lightningNumbers), 'status']) {
    const domain = ['enabled', 'respect_reduced_motion', 'adaptive_weather', 'lightning_enabled', 'lightning_bolt_enabled', 'lightning_flash_enabled'].includes(key) ? 'switch' : ['mode', 'effect', 'settings_effect'].includes(key) ? 'select' : key === 'status' ? 'sensor' : 'number';
    const id = `${domain}.${key}`; controls[key] = id;
    states[id] = { state: domain === 'switch' ? key === 'lightning_enabled' ? 'off' : 'on' : key === 'mode' ? 'manual' : ['effect', 'settings_effect'].includes(key) ? 'rain' : key === 'status' ? 'active' : '1', attributes: { options: key === 'mode' ? ['automatic', 'manual'] : effects, min: 0, max: 100, step: 0.1 } };
  }
  for (const [key, value] of Object.entries({ cloud_top: 10, cloud_bottom: 30, cloud_spread: 80 })) states[`number.${key}`].state = String(value);
  const calls = [];
  const connection = { connected: true, calls: 0, cleanups: 0,
    subscribeMessage(cb, msg) { assert.deepEqual(msg, { type: 'weather_effects/subscribe' }); this.calls++; this.callback = cb; return Promise.resolve(() => this.cleanups++); },
  };
  const profile = { appearance_model: 'components_v1', layer_sources: { rain: 'rain' }, layer_presets: { rain: { speed: 1.3 } }, layer_settings: { rain: { speed: 2.8 } }, id: 'one', title: '<img src=x>', controls, configured_enabled: true, effective_enabled: false, gate_entity: 'input_boolean.gate', effect: 'rain', source: 'weather', condition: 'rainy', weather_entity: 'weather.home', forecast_time: '2026-11-01T12:00Z', dashboards: ['lovelace'] };
  const hass = { language: 'en', states, connection, callService: async (...args) => { calls.push(args); } };
  const card = new Card(); card.setConfig({ type: 'custom:weather-effects-control-card' }); card.hass = hass; card._profiles = [profile]; card._loaded = true; card.render();
  return { card, profile, hass, connection, calls };
}

test('registers both custom elements and idempotent preview metadata on global load', () => {
  assert.equal(registered.get('weather-effects-control-card'), Card);
  assert.equal(registered.get('weather-effects-control-card-editor'), Editor);
  assert.equal(metadata[0].preview, true); assert.equal(metadata[0].name, 'Weather Effects Control Card');
  const win = { customCards: metadata }; registerCards(win, registry); assert.equal(win.customCards.length, 1);
  registerCards(undefined, undefined);
});

test('validates config, safe node import helpers, single profile default and ambiguous multiple profiles', () => {
  assert.equal(validateConfig({}).type, 'custom:weather-effects-control-card');
  assert.throws(() => validateConfig({ profile: 4 })); assert.throws(() => validateConfig({ title: {} }));
  assert.throws(() => validateConfig({ type: 'other' }));
  assert.equal(selectProfile([{ id: 'one' }]).id, 'one');
  assert.equal(selectProfile([{ id: 'one' }, { id: 'two' }]), undefined);
  assert.equal(selectProfile([{ id: 'one' }], 'missing'), undefined);
  assert.equal(labelsFor('hr-HR').profile, 'Profil');
  assert.equal(Card.getStubConfig().type, 'custom:weather-effects-control-card');
});

test('card displays safe text, runtime status, external gate, and prompts for multiple profiles', () => {
  const { card, profile, hass } = fixture();
  card.setConfig({ title: '<script>alert(1)</script>' });
  assert.match(text(card), /<script>alert\(1\)<\/script>/);
  assert.match(text(card), /paused by the external gate/);
  assert.match(text(card), /weather.home/); assert.match(text(card), /rainy/);
  assert.equal(walk(card.shadowRoot).some(el => el.tagName === 'script'), false);
  card._profiles.push({ ...profile, id: 'two' }); card.render(); assert.match(text(card), /Choose a profile/); assert.equal(control(card, 'enabled'), undefined);
  card.setConfig({ profile: 'one' }); assert.ok(control(card, 'enabled'));
  hass.language = 'hr'; card.hass = hass; assert.match(text(card), /Vremenski efekti/);
});

test('status uses sensor attributes, localized runtime values, and gate notice does not trust stale configured flags', () => {
  const { card, profile, hass } = fixture();
  hass.language = 'hr'; hass.states['sensor.status'].state = 'snow'; hass.states['sensor.status'].attributes.status = 'forecast_fallback';
  profile.effect = 'rain'; profile.source = 'forecast'; profile.status = 'ok'; card.hass = hass;
  assert.match(text(card), /Prognoza nije dostupna/); assert.match(text(card), /Kiša/); assert.match(text(card), /Prognoza/);
  delete hass.states['sensor.status'].attributes.status; card.render(); assert.match(text(card), /Spremno/);
  hass.language = 'en'; hass.states['switch.enabled'].state = 'off'; card.hass = hass; assert.doesNotMatch(text(card), /paused by the external gate/);
  hass.states['switch.enabled'].state = 'on'; profile.gate_enabled = true; card.hass = hass; assert.doesNotMatch(text(card), /paused by the external gate/);
  profile.gate_enabled = false; delete profile.gate_entity; card.render(); assert.doesNotMatch(text(card), /paused by the external gate/);
});

test('focused dropdown is stable across unrelated hass updates', () => {
  const { card, hass } = fixture(); const select = control(card, 'mode'); select.fire('focus'); card.hass = { ...hass };
  assert.equal(control(card, 'mode'), select); select.fire('blur'); assert.notEqual(control(card, 'mode'), select);
});

test('native controls dispatch only authorized standard entity services', async () => {
  const { card, calls } = fixture();
  const toggle = control(card, 'enabled'); toggle.checked = false; toggle.fire('change'); await flush();
  assert.deepEqual(calls.shift(), ['switch', 'turn_off', { entity_id: 'switch.enabled' }]);
  const mode = control(card, 'mode'); mode.value = 'automatic'; mode.fire('change'); await flush();
  assert.deepEqual(calls.shift(), ['select', 'select_option', { entity_id: 'select.mode', option: 'automatic' }]);
  await card.commit('effect', 'snow');
  assert.deepEqual(calls.shift(), ['select', 'select_option', { entity_id: 'select.effect', option: 'snow' }]);
  await card.commit('respect_reduced_motion', true);
  assert.deepEqual(calls.shift(), ['switch', 'turn_on', { entity_id: 'switch.respect_reduced_motion' }]);
  assert.throws(() => serviceFor('bogus', 1, 'x'));
});

test('range input only changes output; change commits a numeric value', async () => {
  const { card, calls } = fixture();
  showTab(card, 'rain');
  const range = control(card, 'speed'); range.value = '2.3'; range.fire('input'); await flush(); assert.equal(calls.length, 0);
  assert.ok(walk(card.shadowRoot).some(el => el.tagName === 'output' && el.textContent === '2.3'));
  range.fire('change'); await flush(); assert.deepEqual(calls, [['number', 'set_value', { entity_id: 'number.speed', value: 2.3 }]]);
  await card.commit('speed', 'nonsense'); await card.commit('speed', '101'); assert.equal(calls.length, 1);
});

test('automatic effect, unavailable and missing controls cannot call services', async () => {
  const { card, hass, profile, calls } = fixture();
  hass.states['select.mode'].state = 'automatic'; hass.states['number.speed'].state = 'unavailable'; delete profile.controls.size; card.hass = hass;
  assert.equal(control(card, 'effect').disabled, true); assert.match(text(card), /automatic mode/);
  showTab(card, 'rain'); assert.equal(control(card, 'speed').disabled, true); assert.equal(control(card, 'size').disabled, true); assert.match(text(card), /missing or disabled/); assert.match(text(card), /unavailable/);
  await card.commit('effect', 'snow'); await card.commit('speed', 2); await card.commit('size', 2); assert.equal(calls.length, 0);
});

test('permission failures show nonblocking error and release busy state', async () => {
  const { card, hass } = fixture();
  let reject; hass.callService = () => new Promise((_, no) => { reject = no; });
  const pending = card.commit('enabled', false); assert.equal(control(card, 'enabled').disabled, true); assert.match(text(card), /Saving/);
  reject(new Error('Permission denied')); await pending;
  assert.match(text(card), /Permission denied/); assert.equal(control(card, 'enabled').disabled, false);
});

test('editor provides dropdown and optional title, composed bubbling config-changed', () => {
  const { hass, profile } = fixture(); const editor = new Editor(); editor.setConfig({}); editor.hass = hass; editor._profiles = [profile]; editor.render();
  const select = walk(editor.shadowRoot).find(el => el.tagName === 'select'); assert.equal(select.value, 'one');
  select.value = 'one'; select.fire('change');
  assert.equal(editor.lastEvent.type, 'config-changed'); assert.equal(editor.lastEvent.bubbles, true); assert.equal(editor.lastEvent.composed, true); assert.equal(editor.lastEvent.detail.config.profile, 'one');
  const title = walk(editor.shadowRoot).find(el => el.type === 'text'); title.value = 'My weather'; title.fire('input'); editor.hass = { ...hass };
  assert.equal(walk(editor.shadowRoot).find(el => el.type === 'text'), title, 'hass updates preserve in-progress typing');
  title.fire('change');
  assert.equal(editor.lastEvent.detail.config.title, 'My weather'); title.value = ''; title.fire('change'); assert.equal('title' in editor.lastEvent.detail.config, false);
  assert.equal(Card.getConfigElement().tagName, 'weather-effects-control-card-editor');
});

test('subscription has one listener, accepts runtime arrays, cleans up and reconnects', async () => {
  const { card, hass, connection, profile } = fixture();
  try {
    card.connectedCallback(); await flush(); assert.equal(connection.calls, 1);
    card.hass = hass; card._sync(); await flush(); assert.equal(connection.calls, 1);
    connection.callback([profile]); assert.equal(card.profile.id, 'one');
    const oldCallback = connection.callback;
    connection.connected = false; card.hass = hass; assert.equal(connection.cleanups, 1);
    oldCallback([{ id: 'stale' }]); assert.equal(card._profiles.length, 0);
    connection.connected = true; card.hass = hass; await flush(); assert.equal(connection.calls, 2);
  } finally { card.disconnectedCallback(); }
  assert.equal(connection.cleanups, 2); assert.equal(card._profiles.length, 0); assert.equal(card._loaded, false);
});

test('deferred subscribe resolving after disconnect unsubscribes exactly once', async () => {
  const { card, connection } = fixture(); let resolve;
  connection.subscribeMessage = () => new Promise(yes => { resolve = yes; });
  card.connectedCallback(); await flush(); card.disconnectedCallback(); let cleaned = 0; resolve(() => cleaned++); await flush(); assert.equal(cleaned, 1);
});

test('subscription failure backs off without hass-update spam and can retry', async () => {
  const { card, hass, connection } = fixture();
  connection.subscribeMessage = () => { connection.calls++; throw new Error('Not authorized'); };
  try {
    card.connectedCallback(); await flush(); assert.match(text(card), /Unable to load profiles/);
    for (let i = 0; i < 10; i++) card.hass = hass; await flush(); assert.equal(connection.calls, 1);
    card._retryAt = 0; card._sync(); await flush(); assert.equal(connection.calls, 2);
  } finally { card.disconnectedCallback(); }
});

test('all effect options have HR/EN labels and can be selected through native controls', async () => {
  const translations = JSON.parse(await readFile(new URL('../custom_components/weather_effects/translations/en.json', import.meta.url), 'utf8'));
  const options = Object.keys(translations.selector.effect.options);
  assert.equal(options.length, 18);
  const { card, hass, calls } = fixture();
  hass.states['select.effect'].attributes.options = options;
  for (const effect of options) {
    assert.equal(typeof labelsFor('hr')[effect], 'string', `Missing HR label: ${effect}`);
    assert.equal(typeof labelsFor('en')[effect], 'string', `Missing EN label: ${effect}`);
    await card.commit('effect', effect);
    assert.equal(calls.at(-1)[2].option, effect);
  }
});


test('adaptive and lightning controls use standard services with hard safety bounds and persistent warning', async () => {
  const { card, calls } = fixture(); showTab(card, 'storm');
  assert.equal(control(card, 'lightning_enabled').checked, false);
  assert.equal(control(card, 'lightning_interval').min, '5');
  assert.equal(control(card, 'lightning_brightness').max, '0.25');
  assert.match(text(card), /Photosensitivity warning/); assert.match(text(card), /Disabled by default/);
  assert.match(control(card, 'lightning_enabled').attributes['aria-label'], /opt-in/);
  assert.match(control(card, 'lightning_enabled').attributes['aria-describedby'], /lightning-warning/);
  await card.commit('adaptive_weather', false); await card.commit('lightning_enabled', true);
  await card.commit('heat_threshold', 32); await card.commit('lightning_interval', 12); await card.commit('lightning_brightness', 0.15);
  await card.commit('lightning_interval', 4); await card.commit('lightning_brightness', 0.3);
  assert.deepEqual(calls, [
    ['switch', 'turn_off', { entity_id: 'switch.adaptive_weather' }], ['switch', 'turn_on', { entity_id: 'switch.lightning_enabled' }],
    ['number', 'set_value', { entity_id: 'number.heat_threshold', value: 32 }], ['number', 'set_value', { entity_id: 'number.lightning_interval', value: 12 }], ['number', 'set_value', { entity_id: 'number.lightning_brightness', value: 0.15 }],
  ]);
  assert.match(text(card), /Photosensitivity warning/);
});



test('range focus and drag survive hass updates without writes until change', async () => {
  const { card, hass, calls } = fixture(); showTab(card, 'rain'); const range = control(card, 'density');
  range.fire('focus'); card.hass = { ...hass }; assert.equal(control(card, 'density'), range);
  range.value = '35'; range.fire('input'); card.hass = { ...hass }; assert.equal(control(card, 'density'), range); assert.equal(calls.length, 0);
  range.fire('change'); await flush(); assert.equal(calls[0][2].value, 35);
});

test('stale preset slider refuses writes when another client changes the shared edit target', async () => {
  const { card, hass, calls } = fixture();
  showTab(card, 'rain'); const range = control(card, 'speed'); range.fire('focus'); range.value = '2.1'; range.fire('input');
  hass.states['select.settings_effect'].state = 'snow'; card.hass = { ...hass };
  assert.equal(control(card, 'speed'), range, 'in-progress edit remains visible until commit');
  range.fire('change'); await flush();
  assert.equal(calls.length, 0); assert.match(text(card), /changed in another control/); assert.match(text(card), /No preset was saved/);
  assert.equal(control(card, 'settings_effect'), undefined);
  assert.equal(control(card, 'speed').disabled, true);
  showTab(card, 'snow');
  assert.equal(control(card, 'settings_effect'), undefined);
  const fresh = control(card, 'speed'); fresh.value = '1.7'; fresh.fire('change'); await flush();
  assert.equal(calls.length, 1); assert.equal(calls[0][2].value, 1.7);
  hass.language = 'hr'; card.hass = { ...hass };
  const hrRange = control(card, 'speed'); hrRange.fire('focus'); hass.states['select.settings_effect'].state = 'rain'; card.hass = { ...hass };
  hrRange.fire('change'); await flush(); assert.equal(calls.length, 1); assert.match(text(card), /Postavka nije spremljena/);
});

test('General is the default, compact actual effect stays outside panels, and old config remains valid', async () => {
  const { card, hass, profile, calls } = fixture();
  assert.equal(card._tab, 'general'); assert.ok(control(card, 'enabled')); assert.ok(control(card, 'effect'));
  assert.equal(control(card, 'speed'), undefined); assert.equal(control(card, 'settings_effect'), undefined);
  assert.equal(control(card, 'lightning_enabled'), undefined); assert.equal(control(card, 'heat_threshold'), undefined);
  assert.equal(walk(card.shadowRoot).find(el => el.tagName === 'details').open, false);
  assert.deepEqual(control(card, 'effect').children.map(el => el.value), effects);
  assert.equal(effects.length, 18); assert.equal(new Set(effects).size, 18);
  const before = JSON.stringify(profile);
  await card.selectTab('rain'); await card.selectTab('general'); card.setConfig({ title: 'Legacy card', profile: 'one' });
  assert.equal(card._tab, 'general'); assert.equal(calls.length, 0); assert.equal(JSON.stringify(profile), before);
  hass.states['switch.lightning_enabled'].state = 'on'; card.hass = hass; assert.match(text(card), /Photosensitivity caution/);
  assert.ok(walk(card.shadowRoot).find(el => el.className === 'current'));
});

test('tabs have unique linked ARIA IDs, roving tabindex, keyboard wrapping and focus scrolling', async () => {
  const { card } = fixture(); const other = fixture().card;
  const tabs = () => walk(card.shadowRoot).filter(el => el.attributes.role === 'tab');
  assert.equal(tabs().length, 11); assert.equal(tabs().filter(el => el.tabIndex === 0).length, 1);
  assert.equal(walk(card.shadowRoot).filter(el => el.attributes.role === 'tablist').length, 1);
  const otherIds = new Set(walk(other.shadowRoot).map(el => el.id).filter(Boolean));
  for (const tab of tabs()) {
    assert.equal(otherIds.has(tab.id), false);
    const panel = walk(card.shadowRoot).find(el => el.id === tab.attributes['aria-controls']);
    assert.equal(panel.attributes.role, 'tabpanel'); assert.equal(panel.attributes['aria-labelledby'], tab.id);
    assert.equal(panel.hidden, tab.dataset.tab !== 'general');
  }
  let prevented = 0;
  tabs()[0].fire('keydown', { key: 'ArrowLeft', preventDefault: () => prevented++ }); await flush();
  assert.equal(card._tab, 'storm'); assert.equal(tabs().at(-1).attributes['aria-selected'], 'true');
  assert.equal(tabs().at(-1).focused, true); assert.equal(tabs().at(-1).scrolled, true);
  tabs().at(-1).fire('keydown', { key: 'ArrowRight', preventDefault: () => prevented++ }); await flush(); assert.equal(card._tab, 'general');
  tabs()[0].fire('keydown', { key: 'End', preventDefault: () => prevented++ }); await flush(); assert.equal(card._tab, 'storm');
  tabs().at(-1).fire('keydown', { key: 'Home', preventDefault: () => prevented++ }); await flush(); assert.equal(card._tab, 'general');
  assert.equal(prevented, 4); assert.equal(tabs().filter(el => el.tabIndex === 0).length, 1);
  assert.equal(await card.selectTab('off'), false);
});




test('all lightning controls use standard service classification and hard frontend bounds with localized descriptions', async () => {
  const { card, hass, calls } = fixture(); showTab(card, 'storm');
  assert.equal(control(card, 'lightning_bolt_enabled').checked, true); assert.equal(control(card, 'lightning_flash_enabled').checked, true);
  for (const key of ['lightning_bolt_enabled', 'lightning_flash_enabled']) {
    await card.commit(key, false); assert.deepEqual(calls.at(-1), ['switch', 'turn_off', { entity_id: `switch.${key}` }]);
    assert.match(control(card, key).attributes['aria-describedby'], /lightning-warning/);
  }
  for (const [key, [min, max, step]] of Object.entries(lightningNumbers)) {
    const slider = control(card, key); assert.equal(Number(slider.min), min); assert.equal(Number(slider.max), max); assert.equal(Number(slider.step), step);
    assert.match(slider.attributes['aria-describedby'], /lightning-warning/);
    const count = calls.length; await card.commit(key, min - step); await card.commit(key, max + step); assert.equal(calls.length, count);
    await card.commit(key, min); await card.commit(key, max); assert.deepEqual(calls.at(-1), ['number', 'set_value', { entity_id: `number.${key}`, value: max }]);
    hass.states[`number.${key}`].attributes.min = 'invalid'; hass.states[`number.${key}`].attributes.max = Infinity;
  }
  card.hass = hass;
  for (const [key, [min, max]] of Object.entries(lightningNumbers)) { assert.equal(Number(control(card, key).min), min); assert.equal(Number(control(card, key).max), max); }
  assert.match(text(card), /Smaller values draw the bolt faster/); assert.match(text(card), /not its drawing speed/);
  hass.language = 'hr'; card.hass = hass; assert.match(text(card), /Manja vrijednost brže iscrtava/); assert.match(text(card), /Trajanje nestajanja/);
});

const presetElement = (card, key, value) => walk(card.shadowRoot).find(el => Object.hasOwn(el.dataset, key) && (value === undefined || el.dataset[key] === value));
function presetFixture() {
  const f = fixture(); f.hass.user = { is_admin: true }; f.profile.saved_presets = [{ id: 'first', name: 'First' }];
  f.requests = []; f.hass.callWS = async message => { f.requests.push(message); return { action: message.action, preset_id: message.preset_id || 'new', name: message.name, saved_presets: message.action === 'delete' ? [] : [{ id: message.preset_id || 'new', name: message.name || 'First' }] }; };
  f.card.render(); return f;
}
function choosePreset(card, id = 'first') { const select = presetElement(card, 'presetSelect'); select.value = id; select.fire('change'); }
function namePreset(card, value) { const input = presetElement(card, 'presetName'); input.value = value; input.fire('input'); }

test('preset manager is strictly admin gated while absent/non-admin user keeps native controls', async () => {
  const { card, hass, calls } = fixture(); let requests = 0; hass.callWS = async () => requests++;
  for (const user of [undefined, {}, { is_admin: false }, { is_admin: 1 }]) {
    hass.user = user; card.hass = hass;
    for (const button of walk(card.shadowRoot).filter(el => el.dataset.presetAction)) assert.equal(button.disabled, true);
    assert.match(text(card), /Only administrators/);
    for (const action of ['save', 'load', 'delete', 'rename', 'factory_reset']) assert.equal(await card.managePreset(action), false);
  }
  await card.commit('enabled', false); assert.equal(calls.length, 1); assert.equal(requests, 0);
});

test('preset save/overwrite/load/rename/delete/factory requests use authenticated WS only and explicit confirmations', async () => {
  const { card, profile, requests, calls } = presetFixture();
  const before = JSON.stringify(profile), config = JSON.stringify(card._config); let confirmations = [];
  globalThis.window = { confirm: prompt => { confirmations.push(prompt); return true; } };
  try {
    namePreset(card, '  New visual  '); assert.equal(await card.managePreset('save'), true);
    assert.deepEqual(requests.at(-1), { type: 'weather_effects/preset', entry_id: 'one', action: 'save', name: 'New visual' });
    assert.equal(confirmations.length, 0); assert.equal(presetElement(card, 'presetSelect').value, 'new');
    await card.managePreset('save'); assert.deepEqual(requests.at(-1), { type: 'weather_effects/preset', entry_id: 'one', action: 'save', preset_id: 'new', name: 'New visual', overwrite: true });
    await card.managePreset('load'); assert.deepEqual(requests.at(-1), { type: 'weather_effects/preset', entry_id: 'one', action: 'load', preset_id: 'new' });
    namePreset(card, '<img src=x onerror=alert(1)>'); await card.managePreset('rename');
    assert.equal(requests.at(-1).name, '<img src=x onerror=alert(1)>'); assert.equal(confirmations.length, 2);
    assert.equal(walk(card.shadowRoot).some(el => el.tagName === 'img'), false); assert.match(text(card), /<img src=x/);
    await card.managePreset('delete'); assert.equal(requests.at(-1).action, 'delete'); assert.equal(presetElement(card, 'presetSelect').value, '');
    await card.managePreset('factory_reset'); assert.deepEqual(requests.at(-1), { type: 'weather_effects/preset', entry_id: 'one', action: 'factory_reset' });
    assert.equal(confirmations.length, 4); assert.match(confirmations[1], /bulk.*lightning master off/);
    assert.equal(calls.length, 0); assert.equal(JSON.stringify(profile), before); assert.equal(JSON.stringify(card._config), config);
    assert.match(text(card), /visual settings, not profile connection setup/);
  } finally { delete globalThis.window; }
});

test('dropdown never performs CRUD, invalid names and rejected/unavailable confirmations never send', async () => {
  const { card, requests } = presetFixture();
  choosePreset(card); assert.equal(requests.length, 0); assert.equal(presetElement(card, 'presetName').value, 'First');
  for (const confirm of [undefined, () => false, () => { throw new Error('blocked'); }]) {
    globalThis.window = { confirm };
    for (const action of ['save', 'load', 'delete', 'factory_reset']) assert.equal(await card.managePreset(action), false);
  }
  delete globalThis.window;
  choosePreset(card, '');
  for (const name of ['', '   ', 'a'.repeat(51)]) { namePreset(card, name); assert.equal(await card.managePreset('save'), false); }
  assert.match(text(card), /1–50/); assert.equal(requests.length, 0);
  for (const action of ['load', 'delete', 'rename', 'not-valid']) assert.equal(await card.managePreset(action), false);
});

test('preset focus/draft survives hass updates and metadata reconciles on server push without config mutation', async () => {
  const { card, profile, hass, requests } = presetFixture(); choosePreset(card);
  const input = presetElement(card, 'presetName'); input.fire('focus'); input.value = 'Draft'; input.fire('input');
  card.hass = { ...hass }; assert.equal(presetElement(card, 'presetName'), input); assert.equal(input.value, 'Draft');
  input.fire('blur'); assert.equal(presetElement(card, 'presetName').value, 'Draft');
  const selector = presetElement(card, 'presetSelect'); selector.fire('focus'); card.hass = { ...hass }; assert.equal(presetElement(card, 'presetSelect'), selector); selector.fire('blur');
  namePreset(card, 'Renamed'); await card.managePreset('rename');
  assert.equal(presetElement(card, 'presetSelect').children.at(-1).textContent, 'Renamed'); assert.equal(profile.saved_presets[0].name, 'First');
  card.hass = { ...hass }; assert.equal(presetElement(card, 'presetSelect').children.at(-1).textContent, 'Renamed');
  card._summaryRevision = (card._summaryRevision || 0) + 1; card.render(); assert.equal(presetElement(card, 'presetSelect').children.at(-1).textContent, 'First');
  profile.saved_presets = []; card.render(); assert.equal(presetElement(card, 'presetSelect').value, ''); assert.equal(presetElement(card, 'presetName').value, '');
  await card.managePreset('load'); assert.equal(requests.length, 1);
});

test('preset state is per profile, stale async responses and old buttons cannot affect a changed profile', async () => {
  const { card, profile, hass, requests } = presetFixture(); choosePreset(card); namePreset(card, 'Draft one');
  const oldButton = presetElement(card, 'presetAction', 'save'); let resolve;
  hass.callWS = message => { requests.push(message); return new Promise(yes => { resolve = yes; }); };
  const pending = card.managePreset('rename'); assert.equal(control(card, 'enabled').disabled, true);
  card._profiles = [profile, { ...profile, id: 'two', saved_presets: [{ id: 'second', name: 'Second' }] }]; card.setConfig({ profile: 'two' });
  assert.equal(presetElement(card, 'presetName').value, ''); oldButton.fire('click'); assert.equal(requests.length, 1);
  choosePreset(card, 'second'); namePreset(card, 'Draft two');
  card.setConfig({ profile: 'one' }); resolve({ saved_presets: [{ id: 'stale', name: 'Stale' }] }); assert.equal(await pending, false);
  assert.equal(presetElement(card, 'presetName').value, 'Draft one'); assert.equal(presetElement(card, 'presetSelect').value, 'first');
  card.setConfig({ profile: 'two' }); assert.equal(presetElement(card, 'presetName').value, 'Draft two');
});

test('disconnect invalidates pending preset replies and WS errors preserve draft and release busy', async () => {
  const { card, hass } = presetFixture(); namePreset(card, 'Keep me'); let resolve;
  hass.callWS = () => new Promise(yes => { resolve = yes; }); const pending = card.managePreset('save');
  card.disconnectedCallback(); resolve({ preset_id: 'bad', saved_presets: [{ id: 'bad', name: 'Bad' }] }); assert.equal(await pending, false);
  const f = presetFixture(); namePreset(f.card, 'Keep me'); f.hass.callWS = async () => { throw new Error('Name already exists'); };
  assert.equal(await f.card.managePreset('save'), false); assert.match(text(f.card), /Name already exists/);
  assert.equal(presetElement(f.card, 'presetName').value, 'Keep me'); assert.equal(control(f.card, 'enabled').disabled, false);
  delete f.hass.callWS; const messages = []; f.hass.connection.sendMessagePromise = async message => { messages.push(message); return { saved_presets: [] }; };
  assert.equal(await f.card.managePreset('save'), true); assert.equal(messages[0].type, 'weather_effects/preset');
});

test('real pointer focus transition retains Save button and busy/permission gates prevent duplicate actions', async () => {
  const { card, hass, requests } = presetFixture();
  const input = presetElement(card, 'presetName'); input.fire('focus'); input.value = 'Mouse save'; input.fire('input');
  const save = presetElement(card, 'presetAction', 'save'); input.fire('blur', { relatedTarget: save });
  assert.equal(presetElement(card, 'presetAction', 'save'), save, 'blur must not detach mousedown target before click');
  let resolve; hass.callWS = message => { requests.push(message); return new Promise(yes => { resolve = yes; }); };
  save.fire('click'); assert.equal(requests.length, 1); assert.equal(requests[0].name, 'Mouse save');
  await card.managePreset('save'); assert.equal(requests.length, 1);
  resolve({ saved_presets: [] }); await flush();
  const focused = presetElement(card, 'presetName'); focused.fire('focus'); hass.user = { is_admin: false }; card.hass = { ...hass };
  assert.equal(presetElement(card, 'presetAction', 'save').disabled, true); assert.match(text(card), /Only administrators/);
});

test('remote removal resets a focused saved selector without issuing implicit requests', async () => {
  const { card, profile, requests } = presetFixture(); choosePreset(card);
  presetElement(card, 'presetSelect').fire('focus'); profile.saved_presets = []; card.render();
  assert.equal(presetElement(card, 'presetSelect').value, ''); assert.equal(presetElement(card, 'presetName').value, ''); assert.equal(requests.length, 0);
});

test('a newer summary wins over pending CRUD response metadata', async () => {
  const { card, profile, hass } = presetFixture(); choosePreset(card); let resolve;
  hass.callWS = () => new Promise(yes => { resolve = yes; }); const pending = card.managePreset('rename');
  profile.saved_presets = []; card._summaryRevision = 1; card.render(); resolve({ preset_id: 'first', saved_presets: [{ id: 'first', name: 'Old response' }] });
  await pending; assert.equal(presetElement(card, 'presetSelect').value, ''); assert.equal(presetElement(card, 'presetSelect').children.length, 1);
});



const componentLinks = card => walk(card.shadowRoot).filter(el => el.dataset.componentTab);
const retryBinding = card => walk(card.shadowRoot).find(el => el.dataset.componentRetry);
const componentNumbers = ['speed', 'size', 'density', 'opacity', 'wind', 'cloud_top', 'cloud_bottom', 'cloud_spread'];
const compositions = {
  off: {}, sun: { sun: 'sun' }, clouds: { clouds: 'clouds' }, partlycloudy: { sun: 'sun', clouds: 'clouds' },
  rain: { rain: 'rain' }, rain_clouds: { rain: 'rain', clouds: 'clouds' }, downpour: { rain: 'rain', clouds: 'clouds' },
  snow: { snow: 'snow' }, snow_clouds: { snow: 'snow', clouds: 'clouds' }, fog: { fog: 'fog' },
  wind: { wind: 'wind' }, wind_clouds: { wind: 'wind', clouds: 'clouds' }, night: { night: 'night' }, night_clouds: { night: 'night', clouds: 'clouds' },
  hail: { hail: 'hail', clouds: 'clouds' }, sleet: { rain: 'rain', snow: 'snow', clouds: 'clouds' },
  storm: { rain: 'rain', wind: 'wind', clouds: 'clouds' }, storm_clouds: { clouds: 'clouds' },
};

test('all 18 actual effects expose runtime-owned component jump buttons, never an edit dropdown', async () => {
  const { card, hass, profile, calls } = fixture();
  for (const effect of effects) {
    profile.effect = effect; profile.layer_sources = compositions[effect]; card.hass = hass;
    assert.deepEqual(componentLinks(card).map(el => el.dataset.componentTab), Object.values(compositions[effect]), effect);
    for (const link of componentLinks(card)) {
      assert.ok(link.textContent.includes('settings')); const target = link.dataset.componentTab;
      link.fire('click'); await flush(); assert.equal(card._tab, target);
      assert.equal(control(card, 'settings_effect'), undefined);
      assert.ok(calls.every(call => call[2].entity_id === 'select.settings_effect'));
      assert.equal(profile.effect, effect); assert.equal(hass.states['select.mode'].state, 'manual'); assert.equal(hass.states['switch.enabled'].state, 'on');
      showTab(card, 'general');
    }
    assert.deepEqual(control(card, 'effect').children.map(el => el.value), effects);
  }
});

test('canonical tab arrays have one fixed source each; special tabs never bind any target', async () => {
  const { card, hass, calls } = fixture(); assert.equal(Object.keys(mod.TAB_FAMILIES).length, 11);
  for (const [tab, sources] of Object.entries(mod.TAB_FAMILIES)) {
    calls.length = 0; hass.states['select.settings_effect'].state = 'downpour'; await card.selectTab(tab);
    assert.deepEqual(sources, ['general', 'sleet', 'storm'].includes(tab) ? [] : [tab]);
    assert.equal(control(card, 'settings_effect'), undefined);
    if (sources.length) {
      assert.deepEqual(calls, [['select', 'select_option', { entity_id: 'select.settings_effect', option: tab }]]);
      assert.equal(control(card, 'speed').disabled, true, 'Service success is not an HA acknowledgement');
      hass.states['select.settings_effect'].state = tab; card.hass = hass; assert.equal(control(card, 'speed').disabled, false);
      const count = calls.length;
      for (const wrong of effects.filter(value => value !== tab)) await card.commit('settings_effect', wrong);
      assert.equal(calls.length, count);
    } else { assert.equal(calls.length, 0); assert.equal(control(card, 'speed'), undefined); }
  }
});

test('Rain and clouds actual weather edits fixed Rain and shared Clouds, never the compound target', async () => {
  const { card, hass, profile, calls } = fixture();
  profile.effect = 'rain_clouds'; profile.layer_sources = compositions.rain_clouds;
  hass.states['select.settings_effect'].state = 'rain_clouds'; hass.states['select.mode'].state = 'automatic';
  await card.selectTab('rain'); assert.equal(calls.at(-1)[2].option, 'rain'); assert.equal(control(card, 'speed').disabled, true);
  hass.states['select.settings_effect'].state = 'rain'; card.hass = hass;
  await card.commit('speed', 1.8); assert.equal(calls.at(-1)[2].value, 1.8);
  componentLinks(card).find(el => el.dataset.componentTab === 'clouds').fire('click'); await flush(); assert.equal(calls.at(-1)[2].option, 'clouds');
  hass.states['select.settings_effect'].state = 'clouds'; card.hass = hass;
  await card.commit('cloud_spread', 70); assert.equal(calls.at(-1)[2].value, 70);
  assert.equal(profile.effect, 'rain_clouds'); assert.equal(hass.states['select.mode'].state, 'automatic');
  assert.ok(calls.every(call => !['select.effect', 'select.mode', 'switch.enabled'].includes(call[2].entity_id)));
});

test('every component binding handles failure, unconfirmed, missing, unavailable and absent-option targets with retry', async () => {
  for (const tab of Object.keys(mod.TAB_FAMILIES).filter(id => mod.TAB_FAMILIES[id].length)) {
    const { card, hass, profile, calls } = fixture(); hass.states['select.settings_effect'].state = 'off';
    hass.callService = async (...args) => { calls.push(args); throw new Error('Denied target'); };
    await card.selectTab(tab); assert.match(text(card), /Denied target/); assert.ok(retryBinding(card));
    assert.equal(control(card, 'speed').disabled, true); await card.commit('speed', 2); assert.equal(calls.length, 1);
    hass.callService = async (...args) => calls.push(args);
    retryBinding(card).fire('click'); await flush(); assert.equal(calls.length, 2); assert.equal(control(card, 'speed').disabled, true);
    hass.states['select.settings_effect'].state = tab; card.hass = hass; assert.equal(control(card, 'speed').disabled, false);
    hass.states['select.settings_effect'].attributes.options = effects.filter(id => id !== tab); card.hass = hass;
    assert.equal(control(card, 'speed').disabled, true); assert.ok(retryBinding(card)); await card.commit('speed', 2); assert.equal(calls.length, 2);
    hass.states['select.settings_effect'].attributes.options = effects;
    for (const state of ['unknown', 'unavailable']) {
      hass.states['select.settings_effect'].state = state; await card.selectTab(tab);
      assert.equal(control(card, 'speed').disabled, true); assert.match(text(card), /unavailable/); assert.ok(retryBinding(card));
    }
    delete profile.controls.settings_effect; await card.selectTab(tab);
    assert.match(text(card), /missing or disabled/); assert.match(text(card), /enable it in the integration/); assert.equal(calls.length, 2);
  }
});

test('Sleet is help-only and Storm has lightning globals only, with shared component links in HR/EN', async () => {
  const { card, calls, hass } = fixture(); await card.selectTab('sleet'); assert.equal(calls.length, 0);
  assert.match(text(card), /no independent or hidden appearance parameters/);
  assert.deepEqual(componentLinks(card).slice(-3).map(el => el.dataset.componentTab), ['clouds', 'rain', 'snow']);
  for (const key of componentNumbers) assert.equal(control(card, key), undefined);
  await card.selectTab('storm'); assert.equal(calls.length, 0);
  assert.deepEqual(componentLinks(card).slice(-3).map(el => el.dataset.componentTab), ['clouds', 'wind', 'rain']);
  for (const key of componentNumbers) assert.equal(control(card, key), undefined);
  assert.ok(control(card, 'lightning_enabled')); assert.match(text(card), /Photosensitivity warning/);
  hass.language = 'hr'; card.hass = hass; assert.match(text(card), /Postavke: Oblaci/);
  await card.selectTab('sleet'); assert.match(text(card), /Nema neovisne ni skrivene/);
});

test('cloud three controls belong exclusively to Clouds and enforce bounds and stale drag guards', async () => {
  const { card, hass, profile, calls } = fixture();
  for (const tab of Object.keys(mod.TAB_FAMILIES)) {
    hass.states['select.settings_effect'].state = tab; showTab(card, tab);
    for (const key of ['cloud_top', 'cloud_bottom', 'cloud_spread']) assert.equal(Boolean(control(card, key)), tab === 'clouds', tab);
  }
  hass.states['select.settings_effect'].state = 'clouds'; showTab(card, 'clouds');
  assert.equal(control(card, 'cloud_top').max, '30'); assert.equal(control(card, 'cloud_bottom').min, '10');
  for (const [key, value] of Object.entries({ cloud_top: 10, cloud_bottom: 30, cloud_spread: 80 })) {
    assert.equal(control(card, key).value, String(value)); assert.equal(control(card, key).step, '5');
    await card.commit(key, value); assert.deepEqual(calls.at(-1), ['number', 'set_value', { entity_id: `number.${key}`, value }]);
  }
  const count = calls.length;
  for (const [key, value] of [['cloud_top', 35], ['cloud_bottom', 5], ['cloud_spread', -1], ['cloud_spread', 101]]) await card.commit(key, value);
  assert.equal(calls.length, count);
  const stale = control(card, 'cloud_top'); stale.fire('focus'); hass.states['select.settings_effect'].state = 'rain_clouds'; card.hass = { ...hass }; stale.value = '15'; stale.fire('change'); await flush();
  assert.equal(calls.length, count); assert.match(text(card), /changed in another control/);
  hass.states['select.settings_effect'].state = 'clouds'; showTab(card, 'clouds');
  const range = control(card, 'cloud_bottom'); range.fire('focus'); hass.states['number.cloud_top'].state = '40'; card.hass = { ...hass }; range.value = '35'; range.fire('change'); await flush(); assert.equal(calls.length, count);
  delete profile.controls.cloud_spread; card.render(); assert.equal(control(card, 'cloud_spread').disabled, true);
  assert.match(text(card), /refer to cloud centers/); assert.match(text(card), /cannot guarantee/);
});

test('missing or incompatible runtime model disables components but preserves native globals and named CRUD', async () => {
  const { card, hass, profile, calls, requests } = presetFixture();
  for (const model of [undefined, 'legacy', 'components_v2']) {
    profile.appearance_model = model; showTab(card, 'rain'); assert.match(text(card), /Update Weather Effects and restart Home Assistant/);
    assert.equal(control(card, 'speed').disabled, true);
    const count = calls.length; await card.commit('speed', 2); await card.selectTab('snow'); assert.equal(calls.length, count);
    showTab(card, 'general'); await card.commit('enabled', false); await card.commit('mode', 'manual'); await card.commit('effect', 'sleet');
    assert.equal(calls.length, count + 3); assert.equal(control(card, 'effect').children.length, 18);
    choosePreset(card, ''); namePreset(card, 'Compatible save'); assert.equal(await card.managePreset('save'), true);
    showTab(card, 'storm'); assert.equal(control(card, 'lightning_enabled').disabled, false); await card.commit('lightning_enabled', false);
  }
  assert.equal(requests.length, 3); hass.language = 'hr'; card.hass = hass; assert.match(text(card), /ponovno pokrenite Home Assistant/);
});

test('all component sliders reject external stale bindings and route registry IDs without exposing them', async () => {
  for (const tab of Object.keys(mod.TAB_FAMILIES).filter(id => mod.TAB_FAMILIES[id].length)) {
    const { card, hass, profile, calls } = fixture();
    const id = 'select.living_room_effect_settings_2'; hass.states[id] = hass.states['select.settings_effect']; delete hass.states['select.settings_effect']; profile.controls.settings_effect = id;
    hass.states[id].state = tab; showTab(card, tab);
    const slider = control(card, 'speed'); slider.fire('focus'); slider.value = '2'; slider.fire('input');
    hass.states[id].state = tab === 'rain' ? 'snow' : 'rain'; card.hass = { ...hass };
    assert.equal(control(card, 'speed'), slider); slider.fire('change'); await flush();
    assert.equal(calls.length, 0); assert.match(text(card), /changed in another control/); assert.equal(control(card, 'speed').disabled, true);
    retryBinding(card).fire('click'); await flush(); assert.deepEqual(calls.at(-1), ['select', 'select_option', { entity_id: id, option: tab }]);
    assert.doesNotMatch(text(card), /living_room/);
  }
});

test('advanced displays component saved bases and effective values, not flat compound values', () => {
  const { card, profile } = fixture(); profile.effect = 'rain_clouds'; profile.speed = 99; profile.preset = { speed: 98 };
  profile.layer_presets = { rain: { speed: 1.7 }, clouds: { cloud_spread: 65 } };
  profile.layer_settings = { rain: { speed: 2.1 }, clouds: { cloud_spread: 70 } }; card.render();
  assert.match(text(card), /Saved component bases · Rain/); assert.match(text(card), /Effective component values · Clouds/);
  for (const value of ['1.7', '2.1', '65', '70']) assert.ok(text(card).includes(value));
  assert.doesNotMatch(text(card), /99|98|Saved base for displayed effect/);
});

test('component tabs show only meaningful renderer controls while native appearance fields remain compatible', async () => {
  const { card, hass, calls } = fixture();
  for (const component of Object.keys(mod.TAB_FAMILIES).filter(id => mod.TAB_FAMILIES[id].length)) {
    hass.states['select.settings_effect'].state = component; showTab(card, component);
    const visible = componentNumbers.filter(key => control(card, key));
    const expected = component === 'sun' ? ['speed', 'size', 'opacity'] : component === 'night' ? ['speed', 'size', 'density', 'opacity'] : component === 'clouds' ? componentNumbers : componentNumbers.slice(0, 5);
    assert.deepEqual(visible, expected, component);
    assert.equal(Boolean(control(card, 'heat_threshold')), component === 'sun');
  }
  // A single Sun body has no density, and neither Sun nor Night drifts in wind.
  // Native services still exist for old automations/presets; only misleading UI is hidden.
  hass.states['select.settings_effect'].state = 'sun'; showTab(card, 'sun');
  await card.commit('density', 30); await card.commit('wind', 1);
  assert.deepEqual(calls.map(call => call[2].entity_id), ['number.density', 'number.wind']);
});

test.after(() => { for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
