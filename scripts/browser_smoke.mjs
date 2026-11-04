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
const pending = new Map(), exceptions = [], dialogs = [];
let acceptDialogs = true;
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
async function clickCard(selector) {
  const point=await evaluate(`(()=>{const input=window.weatherEffectsControlDemo.card.shadowRoot.querySelector(${JSON.stringify(selector)});if(!input||input.disabled)throw Error('Unavailable mouse target');input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
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
    if (message.method === 'Page.javascriptDialogOpening') {
      dialogs.push({type:message.params.type,accepted:acceptDialogs});
      if(message.params.type!=='confirm')exceptions.push({text:'Unexpected browser dialog: '+message.params.type});
      command('Page.handleJavaScriptDialog',{accept:message.params.type==='confirm'&&acceptDialogs}).catch(error=>exceptions.push({text:error.message}));
    }
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
  const cloudLayout=await evaluate(`(async()=>{
    const {layoutClouds,cloudOverlap}=await import('../custom_components/weather_effects/frontend/weather-effects.js');
    const d=window.weatherEffectsDemo,o=d.overlay;
    const particles=Array.from({length:12},(_,i)=>({scale:0.6+i%3*0.1,depth:0.5,phase:0,variant:i%2}));
    const rng=()=>{let seed=42;return()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);};
    const config={cloud_top:10,cloud_bottom:90,cloud_spread:0};
    const random=layoutClouds(particles,o.width,o.height,config,rng()),spread=layoutClouds(particles,o.width,o.height,{...config,cloud_spread:100},rng());
    const score=points=>{let value=0;const period=o.width+Math.max(...points.map(p=>320*p.scale));for(let i=0;i<points.length;i++)for(let j=0;j<i;j++)value+=cloudOverlap(points[i],points[j],period);return value;};
    d.setConfig({effect:'clouds',cloud_top:55,cloud_bottom:95,cloud_spread:100,density:150,size:0.8,intensity:{heat:0,cloud:null}});
    await new Promise(resolve=>setTimeout(resolve,100));
    const centers=o.scenes[0].clouds.map(p=>p.y/o.height);
    return {randomOverlap:score(random),spreadOverlap:score(spread),centers,allLower:centers.every(y=>y>=0.55&&y<=0.95),reachesBottom:centers.some(y=>y>0.75)};
  })()`);
  assert.ok(cloudLayout.spreadOverlap<cloudLayout.randomOverlap*0.75);
  assert.equal(cloudLayout.allLower,true);assert.equal(cloudLayout.reachesBottom,true);
  await writeFile(join(output,'clouds-lower-spread.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.weatherEffectsDemo.setConfig({cloud_top:10,cloud_bottom:30,cloud_spread:80,density:100,size:1})');
  const lightning=await evaluate(`(() => {
    const demo=window.weatherEffectsDemo,o=demo.overlay;
    demo.setConfig({effect:'storm',lightning_enabled:false,intensity:{heat:0,cloud:null}});
    const optedOut=o.stepLightning(performance.now()+60000)===null;
    demo.setConfig({lightning_enabled:true,lightning_interval:5,lightning_brightness:0.1,lightning_bolt_enabled:true,lightning_flash_enabled:true,lightning_formation_time:0.8,lightning_duration:0.7,lightning_branches:4});
    const now=performance.now(),next=o.lightning.nextAt;
    const before=o.stepLightning(next-1)===null;
    const first=o.stepLightning(next);
    if(o.frame!==null)cancelAnimationFrame(o.frame);o.frame=null;
    // Freeze only the demo's polling/RAF while capturing deterministic stages.
    // Otherwise its 1-second poll may legitimately repaint with the live clock.
    clearInterval(o.timer);o.timer=null;
    window.renderLightningTestFrame=(age)=>{
      o.ctx.clearRect(0,0,o.width,o.height);
      for(const scene of o.scenes){if(scene.clouds.length)o.drawClouds(scene,0);if(scene.wind.length)o.drawWind(scene,0);if(scene.rain.length)o.drawRain(scene,0);}
      const before=o.ctx.getImageData(0,0,o.canvas.width,o.canvas.height).data;
      o.drawLightning(first.started+age);o.ctx.globalAlpha=1;
      const after=o.ctx.getImageData(0,0,o.canvas.width,o.canvas.height).data;
      let changedPixels=0;for(let i=0;i<after.length;i+=4)if(after[i]!==before[i]||after[i+1]!==before[i+1]||after[i+2]!==before[i+2]||after[i+3]!==before[i+3])changedPixels++;
      return {...o.lightningGeometry.visibleStats(o.lightningStage.leader),...o.lightningStage,changedPixels};
    };
    return {optedOut,before,wait:next-now,serial:first?.serial,brightness:first?.brightness,formationTime:first.formationTime,duration:first.duration};
  })()`);
  assert.equal(lightning.optedOut,true);assert.equal(lightning.before,true);assert.ok(lightning.wait>=4900);assert.equal(lightning.serial,1);assert.equal(lightning.brightness,0.1);
  const leaderEarly=await evaluate('window.renderLightningTestFrame(200)');
  await writeFile(join(output,'lightning-leader-early.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const leaderLate=await evaluate('window.renderLightningTestFrame(600)');
  await writeFile(join(output,'lightning-leader-late.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const returnStroke=await evaluate('window.renderLightningTestFrame(890)');
  await writeFile(join(output,'lightning.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.equal(lightning.formationTime,800);assert.equal(lightning.duration,700);
  assert.equal(leaderEarly.leader,0.25);assert.equal(leaderLate.leader,0.75);
  assert.ok(leaderLate.segments>leaderEarly.segments);assert.ok(leaderLate.paths>=leaderEarly.paths);
  assert.equal(leaderEarly.wash,0);assert.equal(leaderLate.wash,0);
  assert.ok(leaderEarly.changedPixels>0&&leaderLate.changedPixels>leaderEarly.changedPixels,'Real canvas must show a growing bolt');
  assert.equal(returnStroke.returning,true);assert.equal(returnStroke.paths,5);assert.ok(returnStroke.wash>0&&returnStroke.wash<=0.1);
  await evaluate('window.weatherEffectsDemo.overlay.timer=setInterval(window.weatherEffectsDemo.overlay.onPoll,1000)');
  const cooldown=await evaluate(`(() => {
    const demo=window.weatherEffectsDemo,o=demo.overlay,first=o.lightning.lastAt;
    const between=o.stepLightning(first+4999)===null;
    const noSecond=o.lightning.serial===1;
    const second=o.stepLightning(first+5000);
    demo.setConfig({lightning_enabled:false});
    return {between,noSecond,second:second?.serial,cleared:o.lightning.flash===null};
  })()`);
  assert.deepEqual(cooldown,{between:true,noSecond:true,second:2,cleared:true});
  const componentChecks=await evaluate(`(() => {
    const d=window.weatherEffectsDemo,o=d.overlay,ctx=o.ctx;
    const fill=ctx.fillRect,stroke=ctx.stroke;let fills=0,strokes=0;
    ctx.fillRect=function(...args){fills++;return fill.apply(this,args);};
    ctx.stroke=function(...args){strokes++;return stroke.apply(this,args);};
    try{
      d.setConfig({lightning_enabled:true,lightning_bolt_enabled:true,lightning_flash_enabled:false});
      let event=o.stepLightning(o.lightning.nextAt);o.drawLightning(event.started+event.formationTime+90);
      const boltOnly=fills===0&&strokes>0;
      d.setConfig({lightning_enabled:false});fills=0;strokes=0;
      d.setConfig({lightning_enabled:true,lightning_bolt_enabled:false,lightning_flash_enabled:true});
      event=o.stepLightning(o.lightning.nextAt);o.drawLightning(event.started+event.formationTime+90);
      const flashOnly=fills===1&&strokes===0&&o.lightningGeometry.pathCount===0;
      d.setConfig({lightning_bolt_enabled:false,lightning_flash_enabled:false});
      const neither=o.stepLightning(performance.now()+1000000)===null;
      d.setConfig({lightning_enabled:false});
      return {boltOnly,flashOnly,neither};
    }finally{ctx.fillRect=fill;ctx.stroke=stroke;}
  })()`);
  assert.deepEqual(componentChecks,{boltOnly:true,flashOnly:true,neither:true});
  await evaluate('window.weatherEffectsDemo.setConfig({effect:"storm",lightning_enabled:true,lightning_bolt_enabled:true,lightning_flash_enabled:true,respect_reduced_motion:false})');
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
  // Media-query changes are delivered asynchronously in headless Chromium.
  const motionDeadline=Date.now()+2000;
  while(!(await evaluate('window.weatherEffectsDemo.overlay.motion.matches && window.weatherEffectsDemo.overlay.frame === null'))&&Date.now()<motionDeadline) await delay(50);
  const motionState=await evaluate('({matches:window.weatherEffectsDemo.overlay.motion.matches,paused:window.weatherEffectsDemo.overlay.frame===null,respect:window.weatherEffectsDemo.config.respect_reduced_motion,active:window.weatherEffectsDemo.overlay.active.length})');
  assert.equal(motionState.paused,true,'Reduced motion did not pause rendering: '+JSON.stringify(motionState));
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
    window.changeWeatherControl=change;
    const initiallyOff=d.settings.lightning_enabled===false;
    const defaultGeneral=root.querySelector('[role="tab"][aria-selected="true"]').dataset.tab==='general';
    const tabCount=root.querySelectorAll('[role="tab"]').length;
    await change('mode','automatic');
    const autoLocked=find('effect').disabled;
    await d.card.selectTab('rain');await change('speed',2.2);
    const filtered=[...find('settings_effect').options].map(option=>option.value).join(',')==='rain,rain_clouds,downpour';
    const independent=d.presets.rain.speed===2.2&&d.settings.effect==='snow'&&d.settings.mode==='automatic';
    await d.card.selectTab('snow');const snowUnchanged=Number(find('speed').value)===1;
    await d.card.selectTab('rain');const restored=Number(find('speed').value)===2.2;
    await d.card.selectTab('storm');
    const warned=Boolean(root.querySelector('[id$="-lightning-warning"]')?.textContent);
    await change('lightning_formation_time',1.2);await change('lightning_branches',6);
    const animationSaved=d.settings.lightning_formation_time===1.2&&d.settings.lightning_branches===6;
    await change('lightning_bolt_enabled',false);await change('lightning_flash_enabled',false);
    const switchesIndependent=!d.settings.lightning_bolt_enabled&&!d.settings.lightning_flash_enabled&&!d.settings.lightning_enabled;
    await change('lightning_enabled',true);const explicit=d.settings.lightning_enabled===true;
    await change('lightning_enabled',false);
    const before=d.calls.length;await d.card.selectTab('general');const generalNoWrite=d.calls.length===before;
    const general=root.querySelector('[data-tab="general"]');general.focus();general.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,20));
    const keyboard=root.activeElement?.dataset.tab==='storm'&&root.querySelectorAll('[role="tab"][tabindex="0"]').length===1;
    const style=getComputedStyle(root.querySelector('[role="tab"][aria-selected="true"]'));
    const luminance=color=>color.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
    const fg=luminance(style.color),bg=luminance(style.backgroundColor),readableTab=(Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05)>=4.5;
    return {initiallyOff,defaultGeneral,tabCount,warned,autoLocked,filtered,independent,snowUnchanged,restored,animationSaved,switchesIndependent,explicit,generalNoWrite,keyboard,readableTab,
      service:d.calls.find(call=>call.domain==='number'&&call.data.value===2.2)?.service};
  })()`);
  assert.deepEqual(cardChecks,{initiallyOff:true,defaultGeneral:true,tabCount:11,warned:true,autoLocked:true,filtered:true,independent:true,snowUnchanged:true,restored:true,animationSaved:true,switchesIndependent:true,explicit:true,generalNoWrite:true,keyboard:true,readableTab:true,service:'set_value'});
  await evaluate(`(async()=>{const d=window.weatherEffectsControlDemo;await d.card.selectTab('clouds');await window.changeWeatherControl('cloud_bottom',90);await window.changeWeatherControl('cloud_top',60);await window.changeWeatherControl('cloud_spread',95);await d.card.selectTab('general');})()`);
  // Exercise a real focus -> text entry -> mouse click, including blur ordering.
  await clickCard('[data-preset-name]');
  await command('Input.insertText',{text:'Oblaci nisko'});
  await clickCard('[data-preset-action="save"]');
  const saveDeadline=Date.now()+2000;
  while(!(await evaluate('window.weatherEffectsControlDemo.wsCalls.length'))&&Date.now()<saveDeadline)await delay(25);
  assert.equal(await evaluate('window.weatherEffectsControlDemo.wsCalls.length'),1,'Real Save click was lost during input blur');
  await evaluate('window.weatherEffectsPresetTestId=Object.keys(window.weatherEffectsControlDemo.savedPresets)[0]');
  await clickCard('[data-preset-name]');
  await evaluate('window.weatherEffectsControlDemo.card.shadowRoot.querySelector("[data-preset-name]").select()');
  await command('Input.insertText',{text:'Oblaci do dna'});
  await clickCard('[data-preset-action="rename"]');
  const renamed=await evaluate('window.weatherEffectsControlDemo.savedPresets[window.weatherEffectsPresetTestId].name');
  assert.equal(renamed,'Oblaci do dna','Native Rename mouse click must preserve the draft');
  const loadChecks=await evaluate(`(async()=>{const d=window.weatherEffectsControlDemo;await d.card.selectTab('clouds');await window.changeWeatherControl('cloud_bottom',65);await d.card.selectTab('general');await window.changeWeatherControl('forecast_offset',6);await window.changeWeatherControl('enabled',false);d.settings.lightning_enabled=true;d.refresh();const ok=await d.card.managePreset('load');return {ok,bottom:d.presets.clouds.cloud_bottom,top:d.presets.clouds.cloud_top,spread:d.presets.clouds.cloud_spread,masterOff:!d.settings.lightning_enabled,transport:d.settings.mode==='automatic'&&d.settings.forecast_offset===6&&d.settings.enabled===false,snapshotPrivate:!('mode' in d.savedPresets[window.weatherEffectsPresetTestId].settings)&&!('lightning_enabled' in d.savedPresets[window.weatherEffectsPresetTestId].settings)};})()`);
  assert.deepEqual(loadChecks,{ok:true,bottom:90,top:60,spread:95,masterOff:true,transport:true,snapshotPrivate:true});
  acceptDialogs=false;
  const countBeforeCancel=await evaluate('window.weatherEffectsControlDemo.wsCalls.length');
  assert.equal(await evaluate('window.weatherEffectsControlDemo.card.managePreset("delete")'),false);
  assert.equal(await evaluate('window.weatherEffectsControlDemo.wsCalls.length'),countBeforeCancel);
  acceptDialogs=true;
  const factoryChecks=await evaluate(`(async()=>{const d=window.weatherEffectsControlDemo;const ok=await d.card.managePreset('factory_reset');const kept=Object.keys(d.savedPresets).length===1;await d.card.selectTab('clouds');const root=d.card.shadowRoot,value=key=>Number(root.querySelector('[data-control="'+key+'"]').value);const values=[value('cloud_top'),value('cloud_bottom'),value('cloud_spread')];await d.card.selectTab('general');return {ok,kept,values,masterOff:!d.settings.lightning_enabled,transport:d.settings.mode==='automatic'&&d.settings.forecast_offset===6&&d.settings.enabled===false};})()`);
  assert.deepEqual(factoryChecks,{ok:true,kept:true,values:[10,30,80],masterOff:true,transport:true});
  assert.equal(await evaluate('window.weatherEffectsControlDemo.card.managePreset("load")'),true);
  await evaluate(`(async()=>{const d=window.weatherEffectsControlDemo;await d.card.selectTab('clouds');await window.changeWeatherControl('cloud_spread',85);await d.card.selectTab('general');})()`);
  assert.equal(await evaluate('window.weatherEffectsControlDemo.card.managePreset("save")'),true);
  assert.equal(await evaluate('window.weatherEffectsControlDemo.wsCalls.at(-1).overwrite'),true);
  const deletion=await evaluate(`(async()=>{const d=window.weatherEffectsControlDemo,before=JSON.stringify(d.presets);const ok=await d.card.managePreset('delete');return {ok,empty:Object.keys(d.savedPresets).length===0,unchanged:JSON.stringify(d.presets)===before};})()`);
  assert.deepEqual(deletion,{ok:true,empty:true,unchanged:true});
  await clickCard('[data-preset-name]');await command('Input.insertText',{text:'Oblaci do dna'});await clickCard('[data-preset-action="save"]');
  await delay(50);
  const adminOnly=await evaluate(`(async()=>{const d=window.weatherEffectsControlDemo,count=d.wsCalls.length;d.hass.user.is_admin=false;d.refresh();const disabled=[...d.card.shadowRoot.querySelectorAll('[data-preset-action]')].every(button=>button.disabled),refused=await d.card.managePreset('save')===false;d.hass.user.is_admin=true;d.refresh();return {disabled,refused,noWrite:d.wsCalls.length===count};})()`);
  assert.deepEqual(adminOnly,{disabled:true,refused:true,noWrite:true});
  const readableActions=await evaluate(`(()=>{const lum=color=>color.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);return [...window.weatherEffectsControlDemo.card.shadowRoot.querySelectorAll('[data-preset-action]')].filter(button=>!button.disabled).every(button=>{const style=getComputedStyle(button),a=lum(style.color),b=lum(style.backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5;});})()`);
  assert.equal(readableActions,true,'Enabled preset buttons must remain readable in dark fallback themes');
  assert.ok(dialogs.length>=5&&dialogs.every(dialog=>dialog.type==='confirm')&&dialogs.some(dialog=>!dialog.accepted));
  await evaluate('window.scrollTo(0,0)');
  await writeFile(join(output,'named-presets.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.weatherEffectsControlDemo.card.selectTab("clouds");window.scrollTo(0,0)');
  const cloudPage=(await command('Page.getLayoutMetrics')).cssContentSize;
  await writeFile(join(output,'cloud-position-controls.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1100,height:Math.min(cloudPage.height,1500),scale:1}})).data,'base64'));
  await evaluate('window.weatherEffectsControlDemo.card.selectTab("rain");window.scrollTo(0,0)');
  await writeFile(join(output,'preset-controls.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.weatherEffectsControlDemo.card.selectTab("general")');
  await writeFile(join(output,'general-tab.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.weatherEffectsControlDemo.card.selectTab("storm")');
  await writeFile(join(output,'lightning-controls.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.scrollTo(0,900)');
  await writeFile(join(output,'lightning-animation-controls.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await evaluate('window.scrollTo(0,0);window.weatherEffectsControlDemo.card.selectTab("rain")');
  await delay(100);
  const mobileTabs=await evaluate(`(()=>{const root=window.weatherEffectsControlDemo.card.shadowRoot,list=root.querySelector('[role="tablist"]');return {overflow:list.scrollWidth>list.clientWidth,bodyFits:document.documentElement.scrollWidth<=innerWidth+1};})()`);
  assert.deepEqual(mobileTabs,{overflow:true,bodyFits:true});
  await writeFile(join(output,'tabs-mobile.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.weatherEffectsControlDemo.card.selectTab("general")');
  await delay(50);
  const mobileManagerFits=await evaluate('document.documentElement.scrollWidth<=innerWidth+1');
  assert.equal(mobileManagerFits,true,'Mobile preset manager must not overflow the page');
  await evaluate('window.weatherEffectsControlDemo.card.shadowRoot.querySelector(".preset-actions").scrollIntoView({block:"center"})');
  await writeFile(join(output,'named-presets-mobile.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(exceptions, [], 'Uncaught browser exceptions');
  await writeFile(join(output, 'report.json'), JSON.stringify({ browser: executable, effects: results, reducedMotion: 'passed', mobile: 'passed', adaptiveVisuals, coverage, cloudLayout, lightning, leaderEarly, leaderLate, returnStroke, componentChecks, cooldown, routeSafety, cardChecks, loadChecks, factoryChecks, deletion, adminOnly, readableActions, dialogs, mobileTabs, mobileManagerFits, uncaughtExceptions: exceptions.length }, null, 2) + '\n');
  console.log(`Real Chromium test passed: ${effects.length} effects, cloud vertical bands/spread, real mouse/keyboard named preset CRUD/confirmations, lightning safety, and accessible tabs (desktop/mobile). Screenshots: ${output}`);
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
