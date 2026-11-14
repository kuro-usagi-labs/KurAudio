import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch();
const check = (value, label) => { assert.ok(value, label); console.log(`PASS ${label}`); };
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:1422/tests/loudness-harness.html');
  await page.waitForFunction(() => !!window.loudnessHarness);
  await page.mouse.click(10, 10);
  const result = await page.evaluate(async () => {
    const { audio, loudness, model } = window.loudnessHarness;
    if (typeof audio.renderClipAudio !== 'function' || typeof loudness.measureLoudnessInWorker !== 'function') return { missing: true };
    const p = model.emptyProject(), rate = 44100;
    const buffer = new AudioBuffer({ numberOfChannels: 1, length: rate * 2, sampleRate: rate });
    const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / rate);
    // Decode the actual WAV, rather than analyzing a JS-only synthetic stand-in.
    const decoded = await audio.audioContext().decodeAudioData(audio.encodeFloatWav(buffer).buffer);
    const asset = audio.putMedia(decoded, audio.encodeFloatWav(decoded), 'fixture.wav'); p.assets = [asset];
    const clip = model.makeClip(asset, p.tracks[0].id, 25); clip.duration = 1.5; clip.offset = 0.2;
    clip.gain = 0.5; clip.automation = [{ time: 0, gain: 0.5 }, { time: 1.5, gain: 1.5 }]; clip.curve = [{ time: 0, gain: 0.8 }, { time: 1.5, gain: 0.8 }];
    clip.effects = { ...model.defaultEffects(), compression: 80, reverb: 20, decay: 0.5 }; p.clips = [clip];
    p.tracks[0].muted = true; p.tracks[0].gain = 0; p.tracks[1].solo = true;
    const before = await audio.renderClipAudio(p, clip.id), measured = await loudness.measureLoudnessInWorker(before);
    clip.loudnessGain = 2;
    const after = await audio.renderClipAudio(p, clip.id), second = await loudness.measureLoudnessInWorker(after);
    let error = 0, peak = 0; for (let ch = 0; ch < after.numberOfChannels; ch++) for (let i = 0; i < after.length; i++) { error = Math.max(error, Math.abs(after.getChannelData(ch)[i] - 2 * before.getChannelData(ch)[i])); peak = Math.max(peak, Math.abs(after.getChannelData(ch)[i])); }
    p.tracks.forEach(t => { t.muted = false; t.solo = false; t.gain = 1; }); p.clips[0].start = 0;
    const exported = await audio.renderProject(p, 48000);
    let exportError = 0; for (let ch = 0; ch < 2; ch++) for (let i = 0; i < after.length; i++) exportError = Math.max(exportError, Math.abs(after.getChannelData(ch)[i] - exported.getChannelData(ch)[i]));
    const capped = loudness.loudnessMatch(second, 2, -1, -12); p.clips[0].loudnessGain = capped.gain;
    const cappedMeasurement = await loudness.measureLoudnessInWorker(await audio.renderClipAudio(p, clip.id)); p.clips[0].loudnessGain = 2;
    const controller = new AbortController(), pending = loudness.measureLoudnessInWorker(after, { signal: controller.signal }); controller.abort();
    let abortName; try { await pending; } catch (error) { abortName = error.name; }
    const long = new AudioBuffer({ numberOfChannels: 2, length: 48000 * 30, sampleRate: 48000 });
    for (let ch = 0; ch < 2; ch++) long.getChannelData(ch).fill(0.5);
    const longController = new AbortController(), longWork = loudness.measureLoudnessInWorker(long, { signal: longController.signal });
    let responsive = false; await new Promise(resolve => setTimeout(() => { responsive = true; longController.abort(); resolve(); }, 10));
    let longAbort; try { await longWork; } catch (error) { longAbort = error.name; }
    const recovery = await loudness.measureLoudnessInWorker(after);
    const source = await loudness.measureClipLoudness(p, p.clips[0]);
    const fresh = loudness.isLoudnessResultCurrent(p, source);
    audio.media.set(asset.id, { ...audio.media.get(asset.id), buffer: decoded });
    const stable = loudness.isLoudnessResultCurrent(p, source);
    audio.media.set(asset.id, { ...audio.media.get(asset.id), buffer: new AudioBuffer({ numberOfChannels: decoded.numberOfChannels, length: decoded.length, sampleRate: decoded.sampleRate }) });
    const stale = loudness.isLoudnessResultCurrent(p, source);
    const another = { ...p, id: 'other-project' };
    const automated = model.emptyProject(), steady = new AudioBuffer({ numberOfChannels: 1, length: 96000, sampleRate: 48000 }); steady.getChannelData(0).fill(0.5);
    const steadyAsset = audio.putMedia(steady, new Uint8Array(), 'Automation fixture'); automated.assets = [steadyAsset];
    const automatedClip = model.makeClip(steadyAsset, automated.tracks[0].id, 0); automatedClip.effects = { ...model.defaultEffects(), bypassed: true };
    automatedClip.curve = [{ time: 0, gain: 0 }, { time: 2, gain: 1 }]; automatedClip.automation = [{ time: 0, gain: 2 }, { time: 2, gain: 0 }]; automated.clips = [automatedClip];
    const automatedAudio = await audio.renderClipAudio(automated, automatedClip.id);
    const reviewProject = model.emptyProject(), live = new AudioBuffer({ numberOfChannels: 1, length: 96000, sampleRate: 48000 }); live.getChannelData(0).fill(0.1);
    const liveAsset = audio.putMedia(live, new Uint8Array(), 'Live gain'); reviewProject.assets = [liveAsset];
    const reviewClip = model.makeClip(liveAsset, reviewProject.tracks[0].id, 0); reviewClip.loudnessGain = 2; reviewClip.effects = { ...model.defaultEffects(), bypassed: true }; reviewProject.clips = [reviewClip];
    let reviewEnded = false, reviewPosition = 0;
    await audio.playback.play(reviewProject, 0, time => reviewPosition = time, () => reviewEnded = true, 0.65);
    const readPeak = () => { const samples = new Float32Array(1024); audio.playback.analyser.getFloatTimeDomainData(samples); return Math.max(...samples.map(Math.abs)); };
    await new Promise(resolve => setTimeout(resolve, 120)); const liveBefore = readPeak();
    const refreshed = structuredClone(reviewProject); delete refreshed.clips[0].loudnessGain; refreshed.clips.push({ ...refreshed.clips[0], id: 'excluded-clip' });
    await audio.playback.updateEffects(refreshed); await new Promise(resolve => setTimeout(resolve, 120)); const liveAfter = readPeak(), reviewSources = audio.playback.sources.length;
    await new Promise(resolve => setTimeout(resolve, 550)); audio.playback.stop();
    return { missing: false, channels: before.numberOfChannels, rate: before.sampleRate, duration: before.duration, error, peak, measured, second, exportError, capped, cappedMeasurement, abortName, responsive, longAbort, recovery: recovery.integratedLufs, fresh, stable, stale, another: loudness.isLoudnessResultCurrent(another, source), automationMiddle: automatedAudio.getChannelData(0)[48000], liveBefore, liveAfter, reviewSources, reviewEnded, reviewPosition };
  });
  check(!result.missing, 'clip renderer and worker APIs are available');
  check(result.channels === 2 && result.rate === 48000 && Math.abs(result.duration - 2.006) < 1.01 / 48000, 'clip scope resamples decoded audio and includes effect tails without timeline silence');
  check(result.peak > 0.01 && result.error < 1e-6, 'post-rack gain scales compressed/reverberated audio linearly despite track mute, solo and zero gain');
  check(Math.abs(result.second.integratedLufs - result.measured.integratedLufs - 6.0205999) < 0.02, 'real worker measures a 6.02LU change after output gain doubles');
  check(result.exportError < 1e-6, 'clip measurement and actual stereo export use the same audio path');
  check(result.capped.limited && result.cappedMeasurement.truePeakDbtp <= -12 + 0.0001 && Math.abs(result.capped.integratedLufs - result.cappedMeasurement.integratedLufs) < 0.02, 'a capped target is reported honestly and actual re-render stays below the measured true-peak ceiling');
  check(result.abortName === 'AbortError' && result.recovery !== null, 'cancellation terminates work and a later actual worker succeeds');
  check(result.responsive && result.longAbort === 'AbortError', 'main thread stays responsive and can terminate a busy long-audio worker');
  check(result.fresh && result.stable && !result.stale && !result.another, 'results use stable source identity and reject replaced audio or another project');
  check(Math.abs(result.automationMiddle - 0.25) < 0.0001, 'rendered automation multiplies a varying baked curve throughout each segment');
  check(Math.abs(result.liveBefore - 0.2) < 0.002 && Math.abs(result.liveAfter - 0.1) < 0.002, 'live output gain updates and returns to default when the optional gain is removed');
  check(result.reviewSources === 1 && result.reviewEnded && Math.abs(result.reviewPosition - 0.65) < 0.02, 'gain refresh preserves temporary clip scope and the exact bounded review endpoint');
} finally { await browser.close(); }
