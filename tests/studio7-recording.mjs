import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const server = await createServer({ cacheDir: 'node_modules/.vite-studio7-recording', optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 1457, strictPort: true, hmr: false }, clearScreen: false });
await server.listen();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
async function setup(maximumTracks) {
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:1457');
  await page.getByRole('button', { name: 'Proyek baru', exact: true }).click();
  const original = await page.evaluate(async maximumTracks => {
    const url = name => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === `/src/${name}.ts`).name;
    const model = await import(url('model')), audio = await import(url('audio'));
    window.__recordingAudit = { model, audio, recording: await import(url('recording')) };
    const project = model.emptyProject();
    if (maximumTracks) project.tracks = Array.from({ length: model.MAX_TRACKS }, (_, index) => model.makeTrack(index));
    else {
      const buffer = new AudioBuffer({ numberOfChannels: 1, length: 96000, sampleRate: 48000 }); buffer.getChannelData(0).fill(0.1);
      const asset = audio.putMedia(buffer, audio.encodeFloatWav(buffer), 'Protected audio'); project.assets = [asset];
      const clip = model.makeClip(asset, project.tracks[0].id, 2); clip.automation = [{ time: 0, gain: 0.5 }, { time: 2, gain: 1.5 }]; clip.loudnessGain = 2; project.clips = [clip];
    }
    project.tracks[0].locked = true; model.editor.load(project); return project;
  }, maximumTracks);
  return { context, page, original };
}
async function record(page) {
  await page.getByRole('button', { name: 'Siapkan mikrofon', exact: true }).click();
  await page.getByRole('button', { name: 'Mulai rekam', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Stop & tambahkan', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  return page.evaluate(() => {
    const { model, audio, recording } = window.__recordingAudit, state = model.editor.get();
    return { ...structuredClone(state), media: audio.media.size, released: !recording.recorder.active && !recording.recorder.hasPending && !recording.recorder.stream, message: document.querySelector('.toast')?.textContent };
  });
}
try {
  {
    const { context, page, original } = await setup(false);
    try {
      await page.getByRole('button', { name: 'Rekam mikrofon', exact: true }).click();
      check((await page.getByRole('group', { name: 'Tujuan rekaman' }).innerText()).includes('Track rekaman baru'), 'locked target clearly announces a new recording track');
      const after = await record(page), recorded = after.project.clips.find(clip => clip.id !== original.clips[0].id);
      check(after.project.tracks.length === 4 && !!recorded && recorded.trackId === after.project.tracks.at(-1).id, 'fake microphone recording is committed to an unlocked new track');
      check(JSON.stringify(after.project.clips.find(clip => clip.id === original.clips[0].id)) === JSON.stringify(original.clips[0]) && after.project.tracks[0].locked, 'recording preserves the locked arrangement, automation and output gain');
      check(after.project.assets.length === 2 && after.media === 2 && after.project.assets.at(-1).duration >= 0.02 && after.project.assets.at(-1).channels === 1, 'real worklet PCM is retained as one referenced mono asset');
      check(after.released && after.message?.includes('track baru'), 'recording releases the fake microphone and reports its actual destination');
      await page.evaluate(() => window.__recordingAudit.model.editor.undo());
      check(await page.evaluate(() => { const p = window.__recordingAudit.model.editor.get().project; return p.tracks.length === 3 && p.assets.length === 1 && p.clips.length === 1; }), 'one Undo restores the project before the recording track and asset were added');
    } finally { await context.close(); }
  }
  {
    const { context, page } = await setup(true);
    try {
      await page.getByRole('button', { name: 'Rekam mikrofon', exact: true }).click();
      check((await page.getByRole('group', { name: 'Tujuan rekaman' }).innerText()).includes('Media'), 'full track capacity announces the Media destination before recording');
      const after = await record(page);
      check(after.project.tracks.length === 128 && after.project.clips.length === 0 && after.project.assets.length === 1 && after.media === 1, 'track capacity preserves recorded audio in Media without touching the locked target');
      check(after.released && after.message?.includes('disimpan di Media'), 'the Media fallback releases the fake microphone and reports the actual result');
    } finally { await context.close(); }
  }
  {
    const { context, page, original } = await setup(false);
    try {
      await page.evaluate(() => { const { model } = window.__recordingAudit; model.editor.edit('Unlock target', p => { p.tracks[0].locked = false; }); model.editor.edit('Position fixture', p => { p.clips[0].start = 0; }); model.editor.select([model.editor.get().project.clips[0].id]); });
      await page.getByRole('button', { name: 'Ripple editing', exact: true }).click();
      await page.getByRole('button', { name: 'Track edit', exact: true }).click(); await page.keyboard.press('Escape');
      const zoom = page.getByRole('button', { name: 'Perbesar timeline (+)', exact: true });
      while (await zoom.isEnabled()) await zoom.click();
      await page.locator('.ruler').click({ position: { x: 9.6, y: 8 } });
      const at = Number(await page.getByRole('slider', { name: 'Posisi playhead', exact: true }).getAttribute('aria-valuenow'));
      check(at > 0 && at < 0.02, 'ripple rejection fixture seeks inside the first minimum-length boundary');
      const before = await page.evaluate(() => structuredClone(window.__recordingAudit.model.editor.get()));
      await page.locator('.asset-item').first().press('Enter');
      const rejected = await page.evaluate(() => ({ ...structuredClone(window.__recordingAudit.model.editor.get()), message: document.querySelector('.toast')?.textContent }));
      check(rejected.revision === before.revision && JSON.stringify(rejected.selected) === JSON.stringify(before.selected), 'a rejected ripple insertion preserves actual selection and project history');
      check(rejected.message?.includes('Ripple terlalu dekat'), 'rejected Media insertion explains the boundary instead of silently selecting a missing clip');
      await page.getByRole('button', { name: 'Rekam mikrofon', exact: true }).click();
      const recorded = await record(page);
      check(recorded.project.clips.length === 1 && recorded.project.assets.length === 2 && recorded.media === 2 && recorded.project.assets.at(-1).duration >= 0.02, 'near-edge ripple recording retains actual captured PCM in Media');
      check(recorded.selected.length === 1 && recorded.selected[0] === original.clips[0].id && recorded.project.clips[0].start === 0 && recorded.project.clips[0].duration === 2, 'recording fallback preserves selected original audio and its arrangement');
      check(recorded.message?.includes('Ripple terlalu dekat') && recorded.message?.includes('Rekaman disimpan di Media'), 'recording fallback reports its actual Media destination truthfully');
      const persistence = await page.evaluate(async () => {
        const { model, audio } = window.__recordingAudit;
        const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/storage.ts').name, storage = await import(url);
        model.editor.edit('Persistence fixture', p => { Object.assign(p.clips[0], { locked: true, groupId: 'roundtrip-group', curve: [{ time: 0, gain: 0.8 }, { time: 2, gain: 0.5 }], effects: { ...model.defaultEffects(), compression: 30, reverb: 20, decay: 0.5 } }); p.tracks[0].locked = true; });
        const project = model.editor.get().project, content = storage.serializeProject(project), document = JSON.parse(content), decoded = await storage.deserializeProject(content), before = await audio.renderProject(project);
        storage.installMedia(decoded.decoded); const after = await audio.renderProject(decoded.project);
        let error = 0; for (let channel = 0; channel < 2; channel++) for (let sample = 0; sample < before.length; sample++) error = Math.max(error, Math.abs(before.getChannelData(channel)[sample] - after.getChannelData(channel)[sample]));
        const legacy = [];
        for (const version of [1, 2]) {
          const old = JSON.parse(content); old.version = version; for (const track of old.project.tracks) delete track.locked;
          for (const clip of old.project.clips) for (const key of ['locked', 'groupId', 'automation', 'loudnessGain']) delete clip[key];
          const opened = await storage.deserializeProject(JSON.stringify(old)); legacy.push(opened.project.clips.every(clip => clip.automation === undefined && clip.loudnessGain === undefined && clip.locked === undefined && clip.groupId === undefined));
        }
        return { version: document.version, metadataEqual: JSON.stringify(project) === JSON.stringify(decoded.project), error, legacy };
      });
      check(persistence.version === 3 && persistence.metadataEqual, 'portable v3 projects retain lock, group, automation, baked curve, output gain and effects metadata');
      check(persistence.error < 1e-7, 'actual decoded portable audio renders identically after v3 metadata roundtrip');
      check(persistence.legacy.every(Boolean), 'v1 and v2 projects keep the original defaults when new metadata is absent');
    } finally { await context.close(); }
  }
  {
    const { context, page } = await setup(false);
    try {
      await page.evaluate(() => {
        const { model } = window.__recordingAudit;
        model.editor.edit('Unlock track', p => { p.tracks[0].locked = false; });
        model.editor.edit('Locked silence fixture', p => { p.clips[0].start = 0; p.clips[0].locked = true; p.clips.push(model.makeClip(p.assets[0], p.tracks[0].id, 3)); });
        model.editor.select([model.editor.get().project.clips[0].id]);
      });
      const before = await page.evaluate(() => JSON.stringify(window.__recordingAudit.model.editor.get().project));
      await page.getByRole('button', { name: 'Alat audio', exact: true }).click(); await page.getByRole('tab', { name: 'Pangkas hening', exact: true }).click();
      check(await page.getByRole('button', { name: 'Analisis hening', exact: true }).isDisabled() && await page.getByText('Pilih klip yang tidak terkunci untuk memangkas hening.', { exact: true }).count() === 1, 'locked clip selection cannot drive destructive silence analysis or ripple followers');
      await page.getByRole('button', { name: 'Tutup dialog', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      await page.evaluate(() => { const { model } = window.__recordingAudit, p = model.editor.get().project; model.editor.setRange({ start: 0, end: 2, trackIds: [p.tracks[0].id] }); });
      await page.getByRole('button', { name: 'Alat audio', exact: true }).click(); await page.getByRole('tab', { name: 'Pangkas hening', exact: true }).click();
      check(await page.getByRole('button', { name: 'Analisis hening', exact: true }).isDisabled(), 'a range over locked audio cannot bypass silence target protection');
      check(await page.evaluate(() => JSON.stringify(window.__recordingAudit.model.editor.get().project)) === before, 'locked silence exclusion leaves both protected audio and the unselected follower unchanged');
    } finally { await context.close(); }
  }
  console.log(`RESULT: ${checks} recording, locked-tool, insertion and persistence checks passed`);
} finally { await browser.close(); await server.close(); }
