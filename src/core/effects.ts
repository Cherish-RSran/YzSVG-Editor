import { DefEntry, SvgDoc } from './types';
import { newId } from './model';

/** 滤镜预设（P9） */
export type FilterPreset = 'none' | 'shadow' | 'blur' | 'glow';

export interface FilterParams {
  blur: number;
  dx: number;
  dy: number;
  color: string;
  opacity: number;
}

export const DEFAULT_FILTER_PARAMS: FilterParams = {
  blur: 4,
  dx: 3,
  dy: 4,
  color: '#000000',
  opacity: 0.35,
};

function filterMarkup(kind: Exclude<FilterPreset, 'none'>, p: FilterParams): string {
  if (kind === 'blur') {
    return `<filter id="FILTER_ID" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${p.blur}"/></filter>`;
  }
  if (kind === 'shadow') {
    return `<filter id="FILTER_ID" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="${p.dx}" dy="${p.dy}" stdDeviation="${p.blur}" flood-color="${p.color}" flood-opacity="${p.opacity}"/></filter>`;
  }
  return `<filter id="FILTER_ID" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${p.blur}" result="b"/><feFlood flood-color="${p.color}" flood-opacity="${p.opacity}" result="c"/><feComposite in="c" in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

/** 创建或更新滤镜定义，返回 url(#id) */
export function applyFilter(
  doc: SvgDoc,
  kind: FilterPreset,
  params: FilterParams = DEFAULT_FILTER_PARAMS,
  existingId?: string,
): string | null {
  if (kind === 'none') return null;
  const id = existingId && doc.defs.some((d) => d.id === existingId) ? existingId : `flt_${newId('')}`;
  const raw = filterMarkup(kind, params).replace(/FILTER_ID/g, id);
  const entry: DefEntry = { id, kind: 'other', attrs: {}, raw };
  const idx = doc.defs.findIndex((d) => d.id === id);
  if (idx >= 0) doc.defs[idx] = entry;
  else doc.defs.push(entry);
  return `url(#${id})`;
}

/** 从 url(#id) 中取出 def id */
export function defIdFromUrl(value: string | undefined): string | null {
  const m = /url\(['"]?#([^'")\s]+)['"]?\)/.exec(value ?? '');
  return m ? m[1] : null;
}

export type ArrowStyle = 'triangle' | 'open' | 'circle' | 'square' | 'diamond';

/** 箭头形状（10×10 viewBox；marker 默认 markerUnits=strokeWidth，即整体随线宽缩放） */
function arrowShape(style: ArrowStyle, forward: boolean, color: string): { inner: string; refX: number } {
  // refX = 「线的端点落在 marker 的哪个 x 上」。实心箭头要让端点落在**箭头身体里**（箭头比线宽得多，
  // 端点就被完全盖住）；若落在靠近箭尖处，线会从箭头两侧露出来（曾经的 bug：refX=9）。
  switch (style) {
    case 'open': {
      // 开口 V 形：端点必须落在 V 的交汇点，否则线与箭尖之间会空出一段
      const d = forward ? 'M 1 1 L 9 5 L 1 9' : 'M 9 1 L 1 5 L 9 9';
      const inner = `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
      return { inner, refX: forward ? 9 : 1 };
    }
    case 'circle':
      return { inner: `<circle cx="5" cy="5" r="4" fill="${color}"/>`, refX: 5 };
    case 'square':
      return { inner: `<rect x="1" y="1" width="8" height="8" fill="${color}"/>`, refX: 5 };
    case 'diamond':
      return { inner: `<path d="M 5 0 L 10 5 L 5 10 L 0 5 z" fill="${color}"/>`, refX: 5 };
    case 'triangle':
    default: {
      // 起点处 orient="auto" 的 +x 指进线里，所以起点箭头要左右镜像（尖在 x=0）
      const d = forward ? 'M 0 0 L 10 5 L 0 10 z' : 'M 10 0 L 0 5 L 10 10 z';
      return { inner: `<path d="${d}" fill="${color}"/>`, refX: forward ? 2 : 8 };
    }
  }
}

/** 箭头 marker 的原始字符串 */
export function arrowMarkerRaw(
  which: 'start' | 'end',
  id: string,
  color: string,
  style: ArrowStyle = 'triangle',
): string {
  const { inner, refX } = arrowShape(style, which === 'end', color);
  return `<marker id="${id}" viewBox="0 0 10 10" refX="${refX}" refY="5" markerWidth="6" markerHeight="6" orient="auto">${inner}</marker>`;
}

/** 图案填充预设（P10） */
export type PatternPreset = 'dots' | 'stripes' | 'grid' | 'cross';

export function patternMarkup(kind: PatternPreset, color = '#2563eb', bg = 'none', size = 10): string {
  const bgRect = bg && bg !== 'none' ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '';
  const s = size;
  let inner = '';
  if (kind === 'dots') inner = `<circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.18}" fill="${color}"/>`;
  if (kind === 'stripes') inner = `<rect x="0" y="0" width="${s * 0.4}" height="${s}" fill="${color}"/>`;
  if (kind === 'grid')
    inner = `<path d="M 0 0 H ${s} M 0 0 V ${s}" stroke="${color}" stroke-width="1" fill="none"/>`;
  if (kind === 'cross')
    inner = `<path d="M 0 0 L ${s} ${s} M ${s} 0 L 0 ${s}" stroke="${color}" stroke-width="1" fill="none"/>`;
  return `<pattern id="PATTERN_ID" width="${s}" height="${s}" patternUnits="userSpaceOnUse">${bgRect}${inner}</pattern>`;
}

export function applyPattern(
  doc: SvgDoc,
  kind: PatternPreset,
  color = '#2563eb',
  bg = 'none',
  size = 10,
  existingId?: string,
): string {
  const id = existingId && doc.defs.some((d) => d.id === existingId) ? existingId : `pat_${newId('')}`;
  const raw = patternMarkup(kind, color, bg, size).replace(/PATTERN_ID/g, id);
  const entry: DefEntry = { id, kind: 'other', attrs: {}, raw };
  const idx = doc.defs.findIndex((d) => d.id === id);
  if (idx >= 0) doc.defs[idx] = entry;
  else doc.defs.push(entry);
  return `url(#${id})`;
}
