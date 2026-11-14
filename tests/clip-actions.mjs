import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// The isolated harness uses the real Timeline, editor store, audio renderer and
// browser input. It catches menu shortcut leakage, fade history/cancellation,
// and vertical geometry drift independently of application command routing.
const folder = path.resolve('test-results/comfort/timeline');
await fs.mkdir(folder, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.25 });
const page = await context.newPage(), errors = [], results = [], failures = [];
page.on('pageerror', error => errors.push(String(error)));
const check = (ok, name) => { assert.ok(ok, name); results.push(name); console.log(`PASS ${name}`); };
const scenario = async (name, run) => { try { await run(); } catch (error) { failures.push({ name, message: String(error) }); console.error(`FAIL ${name}: ${error}`); } };
try {
  await page.goto('http://127.0.0.1:1422');
  await page.getByRole('button', { name: 'Proyek baru', exact: true }).click();
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource');
    const module = suffix => resources.find(e => new URL(e.name).pathname.endsWith(suffix)).name;
    const [{ default: React }, dom, { Timeline }, model, audio] = await Promise.all([
      import(module('/react.js')), import(module('/react-dom_client.js')), import(module('/Timeline.tsx')), import(module('/model.ts')), import(module('/audio.ts')),
    ]);
    window.__comfortModel = model; window.__comfortAudio = audio;
    const p = model.emptyProject(), buffer = audio.audioContext().createBuffer(1, 48000 * 8, 48000);
    buffer.getChannelData(0).fill(0.5);
    const asset = audio.putMedia(buffer, new Uint8Array(), 'constant.wav');
    p.assets = [asset]; p.tracks = p.tracks.slice(0, 2);
    p.clips = [model.makeClip(asset, p.tracks[0].id, 1), model.makeClip(asset, p.tracks[1].id, 2)];
    p.clips[0].duration = 4; p.clips[1].duration = 4;
    window.__comfortProject = structuredClone(p); model.editor.load(p);
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div'); host.id = 'comfort-harness';
    Object.assign(host.style, { position: 'fixed', left: '16px', top: '16px', width: '1000px', height: '600px', display: 'flex' }); document.body.append(host);
    const root = (dom.createRoot ?? dom.default.createRoot)(host); window.__clipActions = []; window.__comfortProps = { trackHeight: 116, canPaste: false, tool: 'move' };
    const render = () => {
      const state = model.editor.get(); root.render(React.createElement(Timeline, {
        project: state.project, selected: state.selected, range: state.range, activeTrack: state.project.tracks[0].id,
        scale: 100, playhead: 0, snap: false, onScale(value) { window.__comfortProps.scale = value; render(); }, onSeek() {}, onSplit() {}, onImport() {}, onTrack() {},
        onGesture() { audio.playback.stop(); }, onClipAction(action, id) { window.__clipActions.push({ action, id }); }, ...window.__comfortProps,
      }));
    };
    model.editor.subscribe(render); window.__comfortRender = render; render();
  });
  const clips = page.locator('#comfort-harness [data-clip-id]'), first = clips.first(); await first.waitFor();
  const state = () => page.evaluate(() => window.__comfortModel.editor.get());
  const reset = async () => { await page.evaluate(() => { window.__comfortProps = { trackHeight: 116, canPaste: false, tool: 'move' }; window.__comfortModel.editor.load(structuredClone(window.__comfortProject)); window.__comfortRender(); }); await page.waitForTimeout(40); };
  const handle = side => first.getByRole('slider', { name: `${side === 'in' ? 'Fade in' : 'Fade out'} constant`, exact: true });

  await scenario('context menu selection and keyboard', async () => {
    await page.evaluate(() => { const { editor } = window.__comfortModel; editor.select(editor.get().project.clips.map(c => c.id)); });
    check(await page.evaluate(async () => { const { playback } = window.__comfortAudio; await playback.play(window.__comfortModel.editor.get().project, 0, () => {}, () => {}); return playback.playing; }), 'real timeline playback starts before context-menu interaction');
    await first.click({ button: 'right', position: { x: 80, y: 55 } });
    check(await page.getByRole('menu', { name: 'Aksi klip' }).count() === 1, 'right-click opens the clip context menu');
    check(await page.evaluate(() => !window.__comfortAudio.playback.playing), 'opening the context menu stops real playback through onGesture');
    await page.screenshot({ path: path.join(folder, 'context-menu.png') });
    check((await state()).selected.length === 2, 'right-click on a selected clip retains the multi-selection');
    check(await page.getByRole('menuitem', { name: /^Tempel/ }).isDisabled(), 'paste is disabled when the application has no clipboard');
    check(!(await page.getByRole('menuitem', { name: /^Sambungkan/ }).isDisabled()), 'join is available for multiple selected clips');
    await page.keyboard.press('End');
    check(await page.getByRole('menuitem', { name: /^Ekspor pilihan/ }).evaluate(el => el === document.activeElement), 'End focuses the final enabled menu action');
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
    check(await page.getByRole('menuitem', { name: /^Potong/ }).evaluate(el => el === document.activeElement), 'ArrowDown follows menu action order');
    await page.keyboard.press('Control+d');
    check((await state()).project.clips.length === 2, 'global duplicate shortcut is suppressed inside the menu');
    await page.keyboard.press('Escape');
    check(await first.evaluate(el => el === document.activeElement), 'Escape dismisses the menu and restores its clip focus');
    await page.evaluate(() => window.__comfortModel.editor.select([]));
    await page.waitForFunction(() => !document.querySelector('#comfort-harness [data-clip-id]').classList.contains('is-selected'));
    await first.focus(); await page.keyboard.press('Shift+F10');
    check((await state()).selected.length === 1 && await page.getByRole('menuitem', { name: /^Sambungkan/ }).isDisabled(), 'keyboard context menu selects an unselected clip and disables join');
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
    check(await page.evaluate(() => window.__clipActions.at(-1)?.action === 'copy'), 'Space invokes the focused action once');
    await first.focus(); await page.keyboard.press('ContextMenu'); await page.keyboard.press('ArrowUp');
    check(await page.getByRole('menuitem', { name: /^Ekspor pilihan/ }).evaluate(el => el === document.activeElement), 'ContextMenu key opens the menu and ArrowUp wraps to its final action');
    await page.keyboard.press('Enter');
    check(await page.evaluate(() => window.__clipActions.at(-1)?.action === 'export'), 'Enter invokes export selection through the application callback');
    await page.evaluate(() => { window.__shiftEnterReached = false; const key = event => { if (event.key === 'Enter' && event.shiftKey) { window.__shiftEnterReached = true; window.removeEventListener('keydown', key); } }; window.addEventListener('keydown', key); });
    await first.focus(); await page.keyboard.press('Shift+Enter');
    check(await page.evaluate(() => window.__shiftEnterReached), 'Shift+Enter on a clip reaches the application playback shortcut');
  });

  await scenario('context menu viewport and outside dismissal', async () => {
    await reset();
    for (const position of [{ x: 1, y: 1 }, { x: 1278, y: 898 }]) {
      await first.dispatchEvent('contextmenu', { clientX: position.x, clientY: position.y, button: 2 });
      const menu = page.getByRole('menu', { name: 'Aksi klip' }); check(await menu.count() === 1, 'context menu opens at viewport test location');
      const b = await menu.boundingBox();
      check(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 900, 'context menu stays inside each viewport edge');
      await page.keyboard.press('Escape');
    }
    await first.click({ button: 'right', position: { x: 80, y: 55 } });
    const input = page.locator('#comfort-harness input').first(); await input.click();
    check(await page.getByRole('menu').count() === 0 && await input.evaluate(el => el === document.activeElement), 'outside click dismisses without stealing the new focus');
  });

  await scenario('fade pointer preview, DSP and one Undo', async () => {
    await reset(); await page.evaluate(() => window.__comfortModel.editor.select([window.__comfortModel.editor.get().project.clips[0].id]));
    check(await handle('in').count() === 1, 'selected clips expose a fade-in slider');
    const before = await state(), box = await handle('in').boundingBox(), source = await first.locator('.waveform-source').boundingBox();
    await page.evaluate(async () => { await window.__comfortAudio.playback.play(window.__comfortModel.editor.get().project, 0, () => {}, () => {}); });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    check(await page.evaluate(() => !window.__comfortAudio.playback.playing), 'a fade gesture stops real playback before previewing');
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 8 });
    check(Math.abs(Number(await handle('in').getAttribute('aria-valuenow')) - 1) < 0.001 && (await state()).undoCount === 0, 'fade pointer movement previews the delta without editing history');
    check(Math.abs((await first.locator('.waveform-source').boundingBox()).x - source.x) < 0.01, 'fading keeps the source plane stationary');
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -80); await page.keyboard.up('Control'); await page.waitForTimeout(40);
    const heldWidth = (await first.boundingBox()).width;
    await page.mouse.up();
    check(Math.abs(heldWidth - 400) < 0.1, 'Ctrl+wheel keeps the time scale fixed during a held fade');
    const faded = await state(), c = faded.project.clips[0];
    check(Math.abs(c.fadeIn - 1) < 0.001 && c.start === before.project.clips[0].start && c.offset === 0 && c.duration === 4 && faded.undoCount === 1, 'pointer release commits one fade edit without moving or trimming');
    await page.screenshot({ path: path.join(folder, 'fade-edited.png') });
    const levels = await page.evaluate(async () => { const { renderProject } = window.__comfortAudio, { editor } = window.__comfortModel; const p = structuredClone(editor.get().project); p.clips = [p.clips[0]]; const b = await renderProject(p); const data = b.getChannelData(0); return [data[48000 + 12000], data[48000 + 60000]]; });
    check(levels[0] > 0.1 && levels[0] < 0.14 && levels[1] > 0.49 && levels[1] < 0.51, 'rendered audio follows the edited fade envelope');
    await handle('in').focus(); await page.keyboard.press('Control+z');
    check((await state()).project.clips[0].fadeIn === 0 && (await state()).undoCount === 0, 'Ctrl+Z from the fade handle restores the complete pre-gesture fade');
  });

  await scenario('fade targets remain accessible without entering trim zones', async () => {
    await reset(); await page.evaluate(() => { const { editor } = window.__comfortModel; editor.select([editor.get().project.clips[0].id]); });
    const a = await handle('in').boundingBox(), b = await handle('out').boundingBox();
    check(a.width >= 24 && a.height >= 24 && b.width >= 24 && b.height >= 24, 'fade controls provide at least 24 by 24 pixel hit targets');
    const left = await first.locator('.trim-handle.left').boundingBox(), right = await first.locator('.trim-handle.right').boundingBox();
    check(a.x + 0.1 >= left.x + left.width && b.x + b.width <= right.x + 0.1, 'zero-fade hit targets leave both trim edge zones clear');
    await page.evaluate(() => { const { editor } = window.__comfortModel; editor.edit('Meeting fades', p => { p.clips[0].fadeIn = 2; p.clips[0].fadeOut = 2; }); });
    const meetingIn = await handle('in').boundingBox(), meetingOut = await handle('out').boundingBox();
    check(Math.abs(meetingIn.x - meetingOut.x) <= 3 && meetingOut.y + 0.1 >= meetingIn.y + meetingIn.height, 'fade hit targets remain vertically separate when envelopes meet');
    await page.evaluate(() => { const { editor } = window.__comfortModel; editor.edit('Narrow test clip', p => { p.clips[0].duration = 0.5; p.clips[0].fadeIn = 0; p.clips[0].fadeOut = 0; }); });
    check(!(await handle('in').isVisible()) && !(await handle('out').isVisible()), 'clips too narrow for safe fade targets hide them from input and focus');
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; const { editor } = window.__comfortModel; editor.edit('Scaled test clip', p => { p.clips[0].duration = 0.8; }); });
    try {
      const scaled = await handle('in').boundingBox(), edge = await first.locator('.trim-handle.left').boundingBox();
      check(scaled.width >= 30 && scaled.height >= 30 && scaled.x >= edge.x + edge.width, 'fade targets scale with root text size and still protect trim edges');
    } finally { await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); }
  });

  await scenario('fade cancellation and keyboard bounds', async () => {
    await reset(); await first.focus(); await page.keyboard.press('Enter');
    check(await handle('out').count() === 1, 'selected clips expose a fade-out slider');
    for (const cancel of ['Escape', 'pointercancel', 'lostpointercapture']) {
      const box = await handle('out').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 75, box.y + box.height / 2, { steps: 4 });
      if (cancel === 'Escape') await page.keyboard.press('Escape'); else await handle('out').dispatchEvent(cancel, { pointerId: 1 });
      await page.mouse.up();
      check((await state()).undoCount === 0 && (await state()).project.clips[0].fadeOut === 0 && Number(await handle('out').getAttribute('aria-valuenow')) === 0, `${cancel} discards the live fade without history`);
    }
    await handle('in').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
    check(Math.abs((await state()).project.clips[0].fadeIn - 0.11) < 0.001, 'fade keyboard arrows support precise and larger steps');
    await handle('out').focus(); await page.keyboard.press('End');
    check(Math.abs((await state()).project.clips[0].fadeOut - 3.89) < 0.001, 'fade maximum respects the opposite fade duration');
    await page.keyboard.press('Home'); check((await state()).project.clips[0].fadeOut === 0, 'Home removes the focused fade');
    await page.evaluate(() => { window.__comfortProps.tool = 'range'; window.__comfortRender(); });
    await page.waitForFunction(() => document.querySelectorAll('#comfort-harness .fade-handle').length === 0);
    check(await first.locator('.fade-handle').count() === 0, 'range tool removes fade controls from hit testing and keyboard order');
    const clipBefore = (await state()).project.clips[0], bounds = await first.boundingBox(), count = (await state()).undoCount;
    await page.mouse.move(bounds.x + 18, bounds.y + 34); await page.mouse.down(); await page.mouse.move(bounds.x + 118, bounds.y + 34, { steps: 5 }); await page.mouse.up();
    const ranged = await state();
    check(ranged.range && Math.abs(ranged.range.end - ranged.range.start - 1) < 0.001 && ranged.undoCount === count, 'range selection still works through the fade-handle location without editing history');
    check(JSON.stringify(ranged.project.clips[0]) === JSON.stringify(clipBefore), 'range selection keeps clip fades and source geometry unchanged');
  });

  await scenario('direct fades after a split preserve envelope metadata correctly', async () => {
    await reset();
    await page.evaluate(() => {
      const { editor } = window.__comfortModel, p = structuredClone(editor.get().project), c = p.clips[0];
      c.fadeIn = 1; c.fadeOut = 1; c.fadeInStart = 0.4; c.fadeOutEnd = 0.3; editor.load(p); editor.select([c.id]);
    });
    const original = await state();
    await handle('in').focus(); await page.keyboard.press('ArrowRight');
    const edited = (await state()).project.clips[0];
    check(edited.fadeInStart === undefined && edited.fadeOutEnd === 0.3 && Math.abs(edited.fadeIn - 1.01) < 0.001, 'editing a split fade resets only its own inherited endpoint');
    await page.keyboard.press('Control+z');
    check(JSON.stringify((await state()).project) === JSON.stringify(original.project), 'keyboard Undo restores the exact split envelope');
    const box = await handle('out').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 35, box.y + box.height / 2, { steps: 4 }); await page.keyboard.press('Escape'); await page.mouse.up();
    check(JSON.stringify((await state()).project) === JSON.stringify(original.project) && (await state()).undoCount === 0, 'cancelling a split fade retains both original envelope endpoints');
  });

  await scenario('track height and trim geometry', async () => {
    await reset(); const source = await first.locator('.waveform-source').boundingBox();
    for (const [height, expected] of [[90, 104], [200, 200], [300, 240]]) {
      await page.evaluate(value => { window.__comfortProps.trackHeight = value; window.__comfortRender(); }, height); await page.waitForTimeout(40);
      const row = await page.locator('#comfort-harness .track-row').first().boundingBox(), box = await first.boundingBox(), plane = await first.locator('.waveform-source').boundingBox();
      check(Math.abs(row.height - expected) < 0.1 && Math.abs(box.height - (expected - 16)) < 0.1, `track and clip heights adapt to ${expected}px`);
      check(Math.abs(plane.x - source.x) < 0.01 && Math.abs(plane.width - source.width) < 0.01, 'track resizing preserves source scale and timeline origin');
    }
    const before = await first.boundingBox(); await page.mouse.move(before.x + 10, before.y + 58); await page.mouse.down(); await page.mouse.move(before.x + 60, before.y + 58, { steps: 6 });
    check(await first.evaluate(el => el.classList.contains('trimming')) && Math.abs((await first.boundingBox()).x + (await first.boundingBox()).width - before.x - before.width) < 0.1, 'the ten-pixel edge zone remains stationary trim at custom heights');
    await page.keyboard.press('Escape'); await page.mouse.up();
    check((await state()).undoCount === 0 && (await state()).project.clips[0].offset === 0, 'cancelled custom-height trim leaves source and history unchanged');
    await page.evaluate(() => {
      const { editor } = window.__comfortModel, p = structuredClone(editor.get().project), second = p.clips[1];
      second.trackId = p.tracks[0].id; second.start = 4;
      p.crossfades = [{ id: 'comfort-crossfade', leftId: p.clips[0].id, rightId: second.id, duration: 1 }]; editor.load(p);
    });
    const fade = page.locator('#comfort-harness .crossfade-overlay');
    await fade.waitFor();
    check(Math.abs((await fade.boundingBox()).height - 196) < 0.1, 'crossfade overlay grows with the custom track height');
    await page.evaluate(() => {
      window.__comfortProps.trackHeight = 104;
      const { editor } = window.__comfortModel;
      editor.edit('Short crossfade', p => { p.crossfades[0].duration = 0.24; }); editor.select([editor.get().project.clips[0].id]); window.__comfortRender();
    });
    await page.waitForTimeout(40);
    const crossfade = page.locator('#comfort-harness .crossfade-handle');
    const hit = element => element.evaluate(el => { const b = el.getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === el; });
    check(await hit(handle('out')) && await hit(crossfade), 'short crossfade and fade-out both retain unobscured targets at the minimum track height');
    let box = await crossfade.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 12, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
    check(Math.abs((await state()).project.crossfades[0].duration - 0.36) < 0.001, 'the separated crossfade target still adjusts its audio duration by pointer delta');
    box = await handle('out').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
    check(Math.abs((await state()).project.clips[0].fadeOut - 0.2) < 0.001 && Math.abs((await state()).project.crossfades[0].duration - 0.36) < 0.001, 'fade-out remains independently draggable alongside the short crossfade');
  });
  if (errors.length) console.error('RENDERER ERRORS', errors);
  check(errors.length === 0, 'timeline actions and fades produce no renderer errors');
  await page.screenshot({ path: path.join(folder, 'timeline-tools.png') });
  await fs.writeFile(path.join(folder, 'results.json'), JSON.stringify({ checks: results.length, results, failures, errors }, null, 2));
  assert.deepEqual(failures, []);
  console.log(`RESULT: ${results.length} clip action checks passed`);
} finally { await browser.close(); }

