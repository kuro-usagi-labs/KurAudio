import * as audio from '../src/audio';
import * as loudness from '../src/loudness';
import * as model from '../src/model';
import { createElement, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/theme.css';
import '../src/styles.css';

async function mountPanel() {
  try {
    const { LoudnessPanel } = await import('../src/LoudnessPanel');
    function Harness() {
      const { project, selected } = useSyncExternalStore(model.editor.subscribe, model.editor.get);
      return createElement(LoudnessPanel, { project, selected, onBeforeWork: () => audio.playback.stop() });
    }
    const root = createRoot(document.getElementById('loudness-root')!);
    root.render(createElement(Harness));
    return true;
  } catch { return false; }
}
Object.assign(window, { loudnessHarness: { audio, loudness, model, mountPanel } });
