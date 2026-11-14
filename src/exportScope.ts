import { bakeCrossfades, renderEndTime, effectTail, type Project, type AudioRange } from './model';

export type ExportScope = 'project' | 'selected' | 'range';
export type ExportFormat = 'wav' | 'mp3';
export type ResolvedExport = { project: Project; range?: AudioRange; start: number; end: number; duration: number; clipCount: number };
export function resolveExportScope(project: Project, selected: string[], range: AudioRange | null, scope: ExportScope): ResolvedExport {
  let scoped = project, bounds: AudioRange | undefined;
  if (scope === 'selected') {
    if (!project.clips.some(c => selected.includes(c.id))) throw new Error('Pilih klip yang akan diekspor.');
    scoped = structuredClone(project); bakeCrossfades(scoped, selected); scoped.clips = scoped.clips.filter(c => selected.includes(c.id));
    bounds = { start: Math.min(...scoped.clips.map(c => c.start)), end: renderEndTime(scoped), trackIds: scoped.tracks.map(t => t.id) };
  } else if (scope === 'range') {
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start || !range.trackIds.some(id => project.tracks.some(t => t.id === id))) throw new Error('Pilih rentang audio yang valid terlebih dahulu.');
    bounds = { ...range, trackIds: [...range.trackIds] };
  }
  if (!scoped.clips.length) throw new Error('Tambahkan audio ke timeline terlebih dahulu.');
  const start = bounds?.start ?? 0, end = bounds?.end ?? renderEndTime(scoped);
  const clipCount = scoped.clips.filter(c => (!bounds || bounds.trackIds.includes(c.trackId)) && c.start < end && c.start + c.duration + effectTail(c) > start).length;
  return { project: scoped, range: bounds, start, end, duration: end - start, clipCount };
}

export function exportFilename(name: string, format: ExportFormat, fallback = 'Audio') {
  const clean = (value: string) => value.trim().replace(/(?:\.(?:wav|mp3))+$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 160).replace(/[. ]+$/, '');
  let base = clean(name) || clean(fallback) || 'Audio';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base)) base = '_' + base;
  return `${base}.${format}`;
}
export function estimateExportBytes(duration: number, format: ExportFormat, sampleRate: number, bits: number, bitrate: number) {
  return format === 'wav' ? 44 + Math.ceil(duration * sampleRate) * 2 * bits / 8 : Math.ceil(duration * bitrate * 1000 / 8);
}
