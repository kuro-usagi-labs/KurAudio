import { useLayoutEffect, useRef } from 'react';
import { media } from './audio';
import {onAppearanceChange} from './appearance';
export function Waveform({ assetId, offset = 0, duration, scale, color = 'currentColor', mini = false }: { assetId: string; offset?: number; duration: number; scale: number; color?: string; mini?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const el = canvas.current; if (!el) return;
    const container = el.parentElement!, clip = el.closest<HTMLElement>('.audio-clip'), viewport = el.closest<HTMLElement>('.timeline-scroll'); let frame = 0;
    const draw = () => {
      const m = media.get(assetId); if (!m) return;
      const bounds = container.getBoundingClientRect(), viewportBounds = viewport?.getBoundingClientRect();
      // This plane represents the entire source at a fixed time scale. A trim
      // changes its clipping window, never its samples or horizontal scale.
      const fullWidth = Math.max(1, m.buffer.duration * scale), header = parseFloat(getComputedStyle(el).getPropertyValue('--layout-track-header')) || 0;
      const left = viewportBounds ? Math.min(fullWidth, Math.max(0, viewportBounds.left + header - bounds.left)) : 0;
      const right = viewportBounds ? Math.min(fullWidth, viewportBounds.left + viewport!.clientWidth - bounds.left) : fullWidth;
      const visibleWidth = Math.max(0, right - left);
      el.style.width = `${visibleWidth}px`; el.style.marginLeft = `${left}px`;
      if (!visibleWidth) { el.width = 1; return; }
      const rect = el.getBoundingClientRect(), width = Math.max(1, visibleWidth), height = Math.max(1, rect.height), dpr = Math.min(2, devicePixelRatio || 1);
      el.width = width * dpr; el.height = height * dpr;
      const ctx = el.getContext('2d')!; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color === 'currentColor' ? getComputedStyle(el).color : color;
      const stride = mini ? 3 : 2, peakRate = m.buffer.sampleRate / 256;
      const detailed = !mini && m.buffer.sampleRate * stride / scale < 256;
      el.dataset.waveformDetail = detailed ? 'pcm' : 'peaks';
      const channels = detailed ? Array.from({ length: m.buffer.numberOfChannels }, (_, channel) => m.buffer.getChannelData(channel)) : [];
      for (let x = 0; x < width; x += stride) {
        let lo = 0, hi = 0;
        if (detailed) {
          const first = Math.max(0, Math.floor((left + x) / scale * m.buffer.sampleRate)), last = Math.min(m.buffer.length - 1, Math.ceil((left + Math.min(width, x + stride)) / scale * m.buffer.sampleRate));
          for (const samples of channels) for (let i = first; i <= last; i++) { lo = Math.min(lo, samples[i]); hi = Math.max(hi, samples[i]); }
        } else {
          const first = Math.floor((left + x) / scale * peakRate), last = Math.ceil((left + Math.min(width, x + stride)) / scale * peakRate);
          for (let i = first; i <= Math.min(m.peaks.length / 2 - 1, last); i++) { lo = Math.min(lo, m.peaks[i * 2] || 0); hi = Math.max(hi, m.peaks[i * 2 + 1] || 0); }
        }
        const amplitude = height * 0.46;
        ctx.fillRect(x, height / 2 - Math.max(1, hi * amplitude), stride - 0.65, Math.max(1.2, (hi - lo) * amplitude));
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    const observer = new ResizeObserver(schedule); observer.observe(container); if (viewport) observer.observe(viewport);
    const stopAppearance = onAppearanceChange(schedule);
    viewport?.addEventListener('scroll', schedule); clip?.addEventListener('kuraudio:waveform-preview', schedule); draw();
    return () => { stopAppearance(); observer.disconnect(); cancelAnimationFrame(frame); viewport?.removeEventListener('scroll', schedule); clip?.removeEventListener('kuraudio:waveform-preview', schedule); };
  }, [assetId, scale, color, mini]);
  return <canvas className="waveform" ref={canvas} data-source-offset={offset} data-source-duration={duration} aria-hidden="true" />;
}
