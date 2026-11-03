import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element {
  constructor(tag = '') { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.value = ''; this.type = ''; }
  attachShadow() { return this.shadowRoot = new Element('shadow'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { this.lastEvent = event; for (const fn of this.listeners[event.type] || []) fn(event); return true; }
  fire(type) { this.dispatchEvent({ type }); }
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
function dom() {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
}
function fixture() {
  dom();
  const states = {}, controls = {};
  for (const key of ['enabled', 'respect_reduced_motion', 'mode', 'effect', 'forecast_offset', 'speed', 'size', 'density', 'opacity', 'wind', 'max_fps', 'status']) {
    const domain = ['enabled', 'respect_reduced_motion'].includes(key) ? 'switch' : ['mode', 'effect'].includes(key) ? 'select' : key === 'status' ? 'sensor' : 'number';
    const id = `${domain}.${key}`; controls[key] = id;
    states[id] = { state: domain === 'switch' ? 'on' : key === 'mode' ? 'manual' : key === 'effect' ? 'rain' : key === 'status' ? 'active' : '1', attributes: { options: key === 'mode' ? ['automatic', 'manual'] : ['off', 'rain', 'snow'], min: 0, max: 100, step: 0.1 } };
  }
  const calls = [];
  const connection = { connected: true, calls: 0, cleanups: 0,
    subscribeMessage(cb, msg) { assert.deepEqual(msg, { type: 'weather_effects/subscribe' }); this.calls++; this.callback = cb; return Promise.resolve(() => this.cleanups++); },
  };
  const profile = { id: 'one', title: '<img src=x>', controls, configured_enabled: true, effective_enabled: false, gate_entity: 'input_boolean.gate', effect: 'rain', source: 'weather', condition: 'rainy', weather_entity: 'weather.home', forecast_time: '2026-11-01T12:00Z', dashboards: ['lovelace'] };
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
  const range = control(card, 'speed'); range.value = '2.3'; range.fire('input'); await flush(); assert.equal(calls.length, 0);
  assert.ok(walk(card.shadowRoot).some(el => el.tagName === 'output' && el.textContent === '2.3'));
  range.fire('change'); await flush(); assert.deepEqual(calls, [['number', 'set_value', { entity_id: 'number.speed', value: 2.3 }]]);
  await card.commit('speed', 'nonsense'); await card.commit('speed', '101'); assert.equal(calls.length, 1);
});

test('automatic effect, unavailable and missing controls cannot call services', async () => {
  const { card, hass, profile, calls } = fixture();
  hass.states['select.mode'].state = 'automatic'; hass.states['number.speed'].state = 'unavailable'; delete profile.controls.size; card.hass = hass;
  assert.equal(control(card, 'effect').disabled, true); assert.equal(control(card, 'speed').disabled, true); assert.equal(control(card, 'size').disabled, true);
  assert.match(text(card), /automatic mode/); assert.match(text(card), /missing or disabled/); assert.match(text(card), /unavailable/);
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

test.after(() => { for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
