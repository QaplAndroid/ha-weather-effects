/* Optional real-Chromium graphics smoke test; no npm libraries or live HA needed.
 * Uses an isolated temporary browser profile. Never attaches to a user's browser.
 * WEATHER_EFFECTS_BROWSER can override the Chromium executable.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'visual-preview');
const candidates = [process.env.WEATHER_EFFECTS_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error('Set WEATHER_EFFECTS_BROWSER to an installed Chromium/Chrome/Edge executable.');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'weather-effects-browser-'));
const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let launchError;
child.on('error', error => { launchError = error; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map(), exceptions = [];
let socket, sessionId, nextId = 0;
function command(method, params = {}, session = sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  let endpoint;
  const deadline = Date.now() + 20000;
  while (!endpoint && Date.now() < deadline) {
    if (launchError) throw launchError;
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      if (port && path) endpoint = `ws://127.0.0.1:${port}${path}`;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!endpoint) await delay(100);
  }
  if (!endpoint) throw new Error('Chromium did not expose its isolated debugging endpoint.');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  sessionId = (await command('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false });
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await command('Page.navigate', { url: pathToFileURL(join(root, 'demo', 'index.html')).href });
  const readyBy = Date.now() + 15000;
  while (!(await evaluate('Boolean(window.weatherEffectsDemo || window.weatherEffectsDemoError)')) && Date.now() < readyBy) await delay(100);
  const startupError = await evaluate('window.weatherEffectsDemoError || null');
  assert.equal(startupError, null, 'Demo module failed to load');
  const effects = await evaluate('window.weatherEffectsDemo.effects');
  assert.equal(effects.length, 18);
  const results = [];
  for (const effect of effects) {
    const result = await evaluate(`(async () => {
      const demo = window.weatherEffectsDemo; demo.setEffect(${JSON.stringify(effect)});
      await new Promise(resolve => setTimeout(resolve, 300));
      const overlay = demo.overlay, canvas = overlay.canvas;
      let painted = 0;
      if (canvas && !canvas.hidden) {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) painted++;
      }
      return { effect: demo.config.effect, painted, active: overlay.active.length,
        pointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : null,
        hidden: canvas ? canvas.hidden : true, frame: overlay.frame !== null };
    })()`);
    assert.equal(result.effect, effect);
    if (effect === 'off') assert.equal(result.frame, false);
    else { assert.ok(result.painted > 0, `${effect}: no visible real-canvas pixels`); assert.equal(result.pointerEvents, 'none'); }
    if (['clouds', 'snow', 'rain_clouds', 'partlycloudy', 'fog', 'wind', 'night', 'hail', 'storm'].includes(effect)) {
      const { data } = await command('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(output, `${effect}.png`), Buffer.from(data, 'base64'));
    }
    results.push(result);
  }
  const cloudShapes = await evaluate(`(() => {
    const overlay = window.weatherEffectsDemo.overlay;
    return ['cloud0','cloud1','darkCloud0','darkCloud1'].map(name => {
      const sprite = overlay.sprites.get(name), ctx = sprite.getContext('2d'), dpr = overlay.dpr;
      const alpha = (x,y) => ctx.getImageData(Math.floor(x*dpr),Math.floor(y*dpr),1,1).data[3];
      return {name, center: alpha(160,90), corner: alpha(10,10)};
    });
  })()`);
  for (const cloud of cloudShapes) {
    assert.ok(cloud.center > 220, `${cloud.name}: cloud body is still too diffuse`);
    assert.equal(cloud.corner, 0, `${cloud.name}: sprite should have transparent surroundings`);
  }
  const adaptiveVisuals = await evaluate(`(async () => {
    const demo=window.weatherEffectsDemo;
    demo.setConfig({effect:'sun',intensity:{heat:0,cloud:null}});
    const cool=demo.overlay.scenes[0].heat.length;
    demo.setConfig({intensity:{heat:1}});
    await new Promise(resolve=>setTimeout(resolve,100));
    const hot=demo.overlay.scenes[0].heat.length;
    return {cool,hot,glow:demo.overlay.scenes[0].heatGlow.length};
  })()`);
  assert.equal(adaptiveVisuals.cool,0); assert.ok(adaptiveVisuals.hot>0); assert.equal(adaptiveVisuals.glow,1);
  await writeFile(join(output,'heat.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const coverage=await evaluate(`(() => {
    const demo=window.weatherEffectsDemo;
    demo.setConfig({effect:'clouds',intensity:{heat:0,cloud:0}});
    const low=demo.overlay.scenes[0].clouds.length;
    demo.setConfig({intensity:{cloud:1}});
    return {low,high:demo.overlay.scenes[0].clouds.length,palette:demo.overlay.scenes[0].cloudSprite};
  })()`);
  assert.ok(coverage.high>coverage.low); assert.equal(coverage.palette,'darkCloud');
  await writeFile(join(output,'overcast.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const lightning=await evaluate(`(() => {
    const demo=window.weatherEffectsDemo,o=demo.overlay;
    demo.setConfig({effect:'storm',lightning_enabled:false,intensity:{heat:0,cloud:null}});
    const optedOut=o.stepLightning(performance.now()+60000)===null;
    demo.setConfig({lightning_enabled:true,lightning_interval:5,lightning_brightness:0.1});
    const now=performance.now(),next=o.lightning.nextAt;
    const before=o.stepLightning(next-1)===null;
    const first=o.stepLightning(next);
    if(o.frame!==null)cancelAnimationFrame(o.frame);o.frame=null;
    o.drawLightning(next+20);
    return {optedOut,before,wait:next-now,serial:first?.serial,brightness:first?.brightness};
  })()`);
  assert.equal(lightning.optedOut,true);assert.equal(lightning.before,true);assert.ok(lightning.wait>=4900);assert.equal(lightning.serial,1);assert.equal(lightning.brightness,0.1);
  await writeFile(join(output,'lightning.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const cooldown=await evaluate(`(() => {
    const demo=window.weatherEffectsDemo,o=demo.overlay,first=o.lightning.lastAt;
    const between=o.stepLightning(first+4999)===null;
    const noSecond=o.lightning.serial===1;
    const second=o.stepLightning(first+5000);
    demo.setConfig({lightning_enabled:false});
    return {between,noSecond,second:second?.serial,cleared:o.lightning.flash===null};
  })()`);
  assert.deepEqual(cooldown,{between:true,noSecond:true,second:2,cleared:true});
  await evaluate('window.weatherEffectsDemo.setConfig({effect:"storm",lightning_enabled:true,respect_reduced_motion:false})');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await delay(100);
  assert.equal(await evaluate('window.weatherEffectsDemo.overlay.stepLightning(performance.now()+1000000)===null'),true,'Lightning bypassed reduced motion override');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await delay(100);
  const routeSafety=await evaluate(`(() => {
    const demo=window.weatherEffectsDemo;
    demo.route.pathname='/config';window.dispatchEvent(new Event('location-changed'));
    const paused=demo.overlay.frame===null&&demo.overlay.stepLightning(performance.now()+1000000)===null;
    demo.route.pathname='/lovelace/preview';window.dispatchEvent(new Event('location-changed'));
    const delayed=demo.overlay.lightning.nextAt>=performance.now()+4900;
    demo.setConfig({lightning_enabled:false,respect_reduced_motion:true});
    return {paused,delayed};
  })()`);
  assert.deepEqual(routeSafety,{paused:true,delayed:true});
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate('window.weatherEffectsDemo.setEffect("fog")');
  await delay(200);
  assert.equal(await evaluate('window.weatherEffectsDemo.overlay.canvas.width'), 780);
  await writeFile(join(output, 'fog-mobile.png'), Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await delay(100);
  assert.equal(await evaluate('window.weatherEffectsDemo.overlay.frame === null'), true, 'Reduced motion did not pause rendering');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await command('Emulation.setDeviceMetricsOverride',{width:1100,height:950,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:pathToFileURL(join(root,'demo','controls.html')).href});
  const cardReadyBy=Date.now()+15000;
  while (!(await evaluate('Boolean(window.weatherEffectsControlDemo || window.weatherEffectsControlDemoError)')) && Date.now()<cardReadyBy) await delay(100);
  assert.equal(await evaluate('window.weatherEffectsControlDemoError || null'),null);
  await delay(100);
  const cardChecks=await evaluate(`(async () => {
    const d=window.weatherEffectsControlDemo,root=d.card.shadowRoot;
    const find=key=>root.querySelector('[data-control="'+key+'"]');
    const change=async(key,value)=>{const input=find(key);if(!input||input.disabled)throw Error('Unavailable control: '+key);if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,20));};
    const initiallyOff=find('lightning_enabled').checked===false;
    const warned=Boolean(root.querySelector('#lightning-warning')?.textContent);
    await change('mode','automatic');
    const autoLocked=find('effect').disabled&&!find('settings_effect').disabled;
    await change('settings_effect','rain');await change('speed',2.2);
    const independent=d.presets.rain.speed===2.2&&d.settings.effect==='snow'&&d.settings.mode==='automatic';
    await change('settings_effect','snow');const snowUnchanged=Number(find('speed').value)===1;
    await change('settings_effect','rain');const restored=Number(find('speed').value)===2.2;
    await change('lightning_enabled',true);const explicit=d.settings.lightning_enabled===true;
    await change('lightning_enabled',false);
    return {initiallyOff,warned,autoLocked,independent,snowUnchanged,restored,explicit,
      service:d.calls.find(call=>call.domain==='number'&&call.data.value===2.2)?.service};
  })()`);
  assert.deepEqual(cardChecks,{initiallyOff:true,warned:true,autoLocked:true,independent:true,snowUnchanged:true,restored:true,explicit:true,service:'set_value'});
  await writeFile(join(output,'preset-controls.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.scrollTo(0,850)');
  await writeFile(join(output,'lightning-controls.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(exceptions, [], 'Uncaught browser exceptions');
  await writeFile(join(output, 'report.json'), JSON.stringify({ browser: executable, effects: results, reducedMotion: 'passed', mobile: 'passed', adaptiveVisuals, coverage, lightning, cooldown, routeSafety, cardChecks, uncaughtExceptions: exceptions.length }, null, 2) + '\n');
  console.log(`Real Chromium test passed: ${effects.length} effects, heat/cloud intensity, lightning opt-in/cooldown/motion/routes, and dashboard preset controls. Screenshots: ${output}`);
} finally {
  // Close the isolated browser (including its renderer children) before fallback kill.
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close', {}, null); } catch { /* browser already closed */ }
  }
  for (const request of pending.values()) clearTimeout(request.timeout);
  socket?.close();
  child.kill();
  console.log(`Isolated temporary browser profile (not a user profile): ${profile}`);
}
