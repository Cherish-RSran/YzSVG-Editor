import { SvgDoc } from './types';

/** 适应视口时四周留的空白（像素） */
export const FIT_PAD = 60;

function clampZoom(k: number): number {
  return Math.max(0.02, Math.min(64, k));
}

/** 让文档刚好铺满视口的缩放比例（短边优先，四周留白） */
export function fitZoomOf(w: number, h: number, doc: SvgDoc, pad = FIT_PAD): number {
  if (!doc.width || !doc.height || w <= 0 || h <= 0) return 1;
  return clampZoom(Math.min((w - pad) / doc.width, (h - pad) / doc.height));
}

/** 适应视口后的缩放 + 平移（文档居中） */
export function fitView(w: number, h: number, doc: SvgDoc, pad = FIT_PAD) {
  const zoom = fitZoomOf(w, h, doc, pad);
  return { zoom, panX: (w - doc.width * zoom) / 2, panY: (h - doc.height * zoom) / 2 };
}
