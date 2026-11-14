import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const folder = 'test-results/comfort/media-preview';
await fs.mkdir(folder, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const checks = [];
const check = (value, name) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route('http://127.0.0.1:1422/', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>KurAudio preview module</title><link rel="stylesheet" href="/src/theme.css"><link rel="stylesheet" href="/src/styles.css"></head><body><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script></body></html>` }));
  await page.goto('http://127.0.0.1:1422');
  await page.waitForFunction(() => window.__vite_plugin_react_preamble_installed__);
  const available = await page.evaluate(async () => {
    try {
      try { window.__previewComponent = await import('/src/MediaAudition.tsx'); } catch { /* Engine can be tested before its component exists. */ }
      const resource = path => performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname === path).at(-1)?.name;
      const { mediaPreview } = await import(resource('/src/mediaPreview.ts') ?? '/src/mediaPreview.ts');
      window.__mediaPreview = mediaPreview;
      window.__previewAudioUrl = resource('/src/audio.ts');
      window.__previewModelUrl = resource('/src/model.ts');
      return ['get', 'subscribe', 'play', 'pause', 'seek', 'setVolume', 'clear'].every(key => typeof mediaPreview?.[key] === 'function');
    } catch { return false; }
  });
  check(available, 'media audition exposes its independent playback store');
  await page.evaluate(async () => {
    const { audioContext, putMedia, encodeFloatWav, playback } = await import(window.__previewAudioUrl);
    const { editor, emptyProject, makeClip } = await import(window.__previewModelUrl);
    const ctx = audioContext(); await ctx.resume();
    const tone = (seconds, frequency, name) => {
      const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 2 * Math.PI * frequency / ctx.sampleRate) * 0.4;
      return putMedia(buffer, encodeFloatWav(buffer), name);
    };
    window.__previewAssets = [tone(2, 440, 'Audisi satu.wav'), tone(1.2, 880, 'Audisi dua.wav'), tone(0.12, 220, 'Audisi singkat.wav')];
    const project = emptyProject(); project.assets = window.__previewAssets; project.clips = [makeClip(project.assets[0], project.tracks[0].id, 0)];
    editor.load(project); editor.edit('Fixture history', draft => { draft.name = 'Proyek pengujian audisi'; });
    window.__previewProjectBefore = JSON.stringify(editor.get());
    window.__previewNodes = { gains: [], sources: [] };
    const gain = ctx.createGain.bind(ctx), source = ctx.createBufferSource.bind(ctx);
    ctx.createGain = () => { const node = gain(); window.__previewNodes.gains.push(node); return node; };
    ctx.createBufferSource = () => { const node = source(); window.__previewNodes.sources.push(node); return node; };
    window.__previewContext = ctx; window.__previewPlayback = playback;
    window.__previewNotifications = 0;
    window.__previewUnsubscribe = window.__mediaPreview.subscribe(() => { window.__previewNotifications++; });
    await window.__mediaPreview.play(project.assets[0].id);
  });
  await page.waitForFunction(() => window.__mediaPreview.get().playing && window.__mediaPreview.get().position > 0.12, {timeout:5000});
  let snapshot = await page.evaluate(() => window.__mediaPreview.get());
  check(snapshot.playing && snapshot.position > 0.12 && snapshot.position < 0.7 && snapshot.duration === 2, 'position advances with the real audio sample clock');
  await page.evaluate(() => window.__mediaPreview.pause());
  const paused = await page.evaluate(() => window.__mediaPreview.get());
  await page.waitForTimeout(160);
  snapshot = await page.evaluate(() => window.__mediaPreview.get());
  check(!snapshot.playing && snapshot.position === paused.position && snapshot.position > 0, 'pause freezes the exact source position');
  await page.evaluate(() => { window.__mediaPreview.seek(1); window.__mediaPreview.setVolume(0.25); });
  snapshot = await page.evaluate(() => window.__mediaPreview.get());
  check(snapshot.position === 1 && snapshot.volume === 0.25, 'paused seek and volume remain local to audition');
  await page.evaluate(async () => {
    const preview = window.__mediaPreview, ctx = window.__previewContext;
    await window.__previewPlayback.play((await import(window.__previewModelUrl)).editor.get().project, 0, () => {}, () => {});
    window.__timelineMaster = window.__previewPlayback.master;
    await preview.play(window.__previewAssets[0].id);
    const previewGain = window.__previewNodes.gains.at(-1), analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    previewGain.connect(analyser); window.__previewGain = previewGain; window.__previewAnalyser = analyser;
  });
  await page.waitForTimeout(140);
  const output = await page.evaluate(() => {
    const samples = new Float32Array(window.__previewAnalyser.fftSize); window.__previewAnalyser.getFloatTimeDomainData(samples);
    return { peak: Math.max(...samples.map(Math.abs)), previewGain: window.__previewGain.gain.value, timelineGain: window.__timelineMaster.gain.value, snapshot: window.__mediaPreview.get() };
  });
  check(output.peak > 0.08 && output.peak < 0.12 && output.previewGain === 0.25 && output.timelineGain === 1, 'preview gain changes real samples independently of the timeline master');
  check(output.snapshot.position > 1.05 && output.snapshot.position < 1.5, 'resume continues from the seeked sample offset');
  await page.evaluate(() => { window.__previewPlayback.stop(); window.__mediaPreview.seek(0.45); });
  await page.waitForTimeout(90);
  snapshot = await page.evaluate(() => window.__mediaPreview.get());
  check(snapshot.playing && snapshot.position > 0.45 && snapshot.position < 0.8, 'seeking during audition restarts at the requested sample offset');
  await page.evaluate(async () => { await window.__mediaPreview.play(window.__previewAssets[1].id); });
  await page.waitForTimeout(140);
  const switched = await page.evaluate(() => {
    const samples = new Float32Array(window.__previewAnalyser.fftSize); window.__previewAnalyser.getFloatTimeDomainData(samples);
    return { oldPeak: Math.max(...samples.map(Math.abs)), snapshot: window.__mediaPreview.get() };
  });
  check(switched.snapshot.assetId === await page.evaluate(() => window.__previewAssets[1].id) && switched.snapshot.position < 0.5 && switched.snapshot.duration === 1.2 && switched.snapshot.volume === 0.25 && switched.oldPeak === 0, 'switching source resets time, retains volume, and disconnects the former graph');
  await page.evaluate(() => { window.__mediaPreview.seek(100); window.__mediaPreview.setVolume(100); });
  snapshot = await page.evaluate(() => window.__mediaPreview.get());
  check(!snapshot.playing && snapshot.position === 1.2 && snapshot.volume === 1, 'seek to the end stops audio and clamps excessive values');
  await page.evaluate(() => { window.__mediaPreview.seek(-10); window.__mediaPreview.setVolume(-10); });
  snapshot = await page.evaluate(() => window.__mediaPreview.get());
  check(snapshot.position === 0 && snapshot.volume === 0, 'negative seek and volume clamp to zero');
  await page.evaluate(() => { window.__mediaPreview.seek(Number.NaN); window.__mediaPreview.setVolume(Number.NaN); });
  snapshot = await page.evaluate(() => window.__mediaPreview.get());
  check(Number.isFinite(snapshot.position) && Number.isFinite(snapshot.volume), 'invalid numeric input cannot poison audition state');
  await page.evaluate(async () => { window.__mediaPreview.setVolume(0.5); await window.__mediaPreview.play(window.__previewAssets[2].id); });
  await page.waitForTimeout(260);
  snapshot = await page.evaluate(() => window.__mediaPreview.get());
  check(!snapshot.playing && snapshot.position === 0.12 && snapshot.assetId !== null, 'natural source end keeps the source selected at its exact duration');

  // The real AudioContext still resumes; this boundary gate only delays its promise,
  // allowing the same interruption window that a suspended device can produce.
  for (const action of ['pause', 'clear', 'switch', 'replace']) {
    const result = await page.evaluate(async action => {
      const preview = window.__mediaPreview, ctx = window.__previewContext;
      const originalResume = ctx.resume.bind(ctx); let release;
      ctx.resume = async () => { await originalResume(); await new Promise(resolve => { release = resolve; }); };
      const pending = preview.play(window.__previewAssets[0].id);
      while (!release) await new Promise(resolve => setTimeout(resolve, 0));
      if (action === 'pause') preview.pause();
      else if (action === 'switch') { ctx.resume = originalResume; await preview.play(window.__previewAssets[1].id); }
      else if (action === 'replace') { const { media } = await import(window.__previewAudioUrl); const entry = media.get(window.__previewAssets[0].id); media.set(window.__previewAssets[0].id, { ...entry }); }
      else preview.clear();
      release(); await pending; ctx.resume = originalResume;
      await new Promise(resolve => setTimeout(resolve, 50));
      const snapshot = preview.get(); preview.clear(); return snapshot;
    }, action);
    check(action === 'switch' ? result.playing && result.assetId === await page.evaluate(() => window.__previewAssets[1].id) : !result.playing && (action !== 'clear' || result.assetId === null), `pending resume cannot restart after ${action}`);
  }
  const unavailable = await page.evaluate(async () => {
    try { await window.__mediaPreview.play('missing-asset'); } catch { /* consumer handles error */ }
    return window.__mediaPreview.get();
  });
  check(!unavailable.playing && Boolean(unavailable.error), 'unavailable media reports an error without starting playback');
  await page.evaluate(() => { window.__mediaPreview.clear(); window.__previewUnsubscribe(); });
  const integrity = await page.evaluate(async () => ({ unchanged: JSON.stringify((await import(window.__previewModelUrl)).editor.get()) === window.__previewProjectBefore, notifications: window.__previewNotifications, snapshot: window.__mediaPreview.get() }));
  check(integrity.unchanged && integrity.notifications > 5 && integrity.snapshot.assetId === null && integrity.snapshot.position === 0 && integrity.snapshot.volume === 0.5, 'audition emits snapshots and clears without changing project or Undo history');

  const componentAvailable = await page.evaluate(async () => {
    try {
      const resource = path => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith(path)).name;
      const { default: React } = await import(resource('/deps/react.js'));
      const { default: { createRoot } } = await import(new URL('react-dom_client.js',resource('/deps/react.js')).href);
      const { MediaPreview } = window.__previewComponent ?? await import('/src/MediaAudition.tsx');
      const host = document.createElement('div'); host.id = 'media-preview-harness'; host.style.cssText = 'position:fixed;top:80px;right:40px;width:224px;z-index:1000'; document.body.append(host);
      window.__previewBeforePlay = 0; window.__previewErrors = [];
      const root = createRoot(host); root.render(React.createElement(MediaPreview, { assets: window.__previewAssets, onBeforePlay: () => { window.__previewBeforePlay++; }, onError: message => window.__previewErrors.push(message) }));
      window.__previewHarnessRoot = root; return true;
    } catch (error) { return String(error); }
  });
  check(componentAvailable === true, `compact preview component can render with only the public store${componentAvailable === true ? '' : `: ${componentAvailable}`}`);
  await page.evaluate(async () => { await window.__mediaPreview.play(window.__previewAssets[0].id); });
  const panel = page.getByRole('region', { name: 'Pratinjau media', exact: true }); await panel.waitFor();
  check(await panel.getByText('Audisi satu.wav', { exact: true }).isVisible() && await panel.getByRole('slider').count() === 2, 'preview shows the active source with custom seek and volume controls');
  await panel.getByRole('button', { name: 'Jeda pratinjau', exact: true }).click();
  check(await page.evaluate(() => window.__previewBeforePlay) === 0 && !(await page.evaluate(() => window.__mediaPreview.get())).playing, 'pausing preview never invokes the timeline interruption callback');
  await panel.getByRole('button', { name: 'Putar pratinjau', exact: true }).click();
  check(await page.evaluate(() => window.__previewBeforePlay) === 1 && (await page.evaluate(() => window.__mediaPreview.get())).playing, 'resuming preview invokes the interruption callback once');
  await panel.getByRole('button', { name: 'Jeda pratinjau', exact: true }).click();
  const seek = panel.getByRole('slider', { name: 'Posisi pratinjau', exact: true }); await seek.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  check((await page.evaluate(() => window.__mediaPreview.get())).position === 0.01, 'preview seek supports precise keyboard adjustment');
  const volume = panel.getByRole('slider', { name: 'Volume pratinjau', exact: true }); await volume.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  check((await page.evaluate(() => window.__mediaPreview.get())).volume === 0.01, 'preview volume supports keyboard adjustment');
  check(await seek.evaluate(el => getComputedStyle(el).opacity) === '0', 'range interaction uses the custom painted fader');
  await page.screenshot({ path: `${folder}/preview.png` });
  await panel.getByRole('button', { name: 'Tutup pratinjau', exact: true }).click();
  check(await panel.count() === 0 && (await page.evaluate(() => window.__mediaPreview.get())).assetId === null, 'closing preview clears its source and controls');
  await page.evaluate(() => { window.__previewHarnessRoot.unmount(); window.__previewAnalyser.disconnect(); });
  await fs.writeFile(`${folder}/results.json`, JSON.stringify({ checks: checks.length, results: checks }, null, 2));
  console.log(`RESULT: ${checks.length} media preview checks passed`);
} finally { await browser.close(); }
