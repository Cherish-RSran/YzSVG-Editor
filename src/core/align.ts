import { invert, applyVec } from './matrix';
import { nodeBBox, parentWorldMatrix, unionBox, Box } from './geometry';
import { SvgDoc } from './types';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface Delta {
  id: string;
  dx: number;
  dy: number;
}

/** 计算对齐所需位移（世界坐标系） */
export function computeAlignDeltas(doc: SvgDoc, ids: string[], mode: AlignMode): Delta[] {
  if (ids.length === 0) return [];
  const boxes = ids.map((id) => ({ id, box: nodeBBox(doc, id) }));
  const frame = unionBox(boxes.map((b) => b.box));
  return boxes.map(({ id, box }) => {
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left':
        dx = frame.x - box.x;
        break;
      case 'hcenter':
        dx = frame.x + frame.w / 2 - (box.x + box.w / 2);
        break;
      case 'right':
        dx = frame.x + frame.w - (box.x + box.w);
        break;
      case 'top':
        dy = frame.y - box.y;
        break;
      case 'vcenter':
        dy = frame.y + frame.h / 2 - (box.y + box.h / 2);
        break;
      case 'bottom':
        dy = frame.y + frame.h - (box.y + box.h);
        break;
    }
    return { id, dx, dy };
  });
}

/** 等距分布（水平或垂直） */
export function computeDistributeDeltas(doc: SvgDoc, ids: string[], axis: 'h' | 'v'): Delta[] {
  if (ids.length < 3) return [];
  const items = ids
    .map((id) => ({ id, box: nodeBBox(doc, id) }))
    .sort((a, b) => (axis === 'h' ? a.box.x - b.box.x : a.box.y - b.box.y));
  const first = items[0].box;
  const last = items[items.length - 1].box;
  const total =
    axis === 'h'
      ? last.x + last.w - first.x
      : last.y + last.h - first.y;
  const sumSizes = items
    .slice(1, -1)
    .reduce((acc, it) => acc + (axis === 'h' ? it.box.w : it.box.h), 0);
  const gap = (total - sumSizes) / (items.length - 1);
  let cursor = axis === 'h' ? first.x + first.w : first.y + first.h;
  const out: Delta[] = [];
  for (let i = 1; i < items.length - 1; i++) {
    const it = items[i];
    const target = cursor + gap;
    const current = axis === 'h' ? it.box.x : it.box.y;
    out.push({ id: it.id, dx: axis === 'h' ? target - current : 0, dy: axis === 'h' ? 0 : target - current });
    cursor = target + (axis === 'h' ? it.box.w : it.box.h);
  }
  return out;
}

/** 把世界坐标位移换算到父坐标系（考虑父级缩放/旋转） */
export function toParentDelta(doc: SvgDoc, id: string, dx: number, dy: number): { dx: number; dy: number } {
  const inv = invert(parentWorldMatrix(doc, id));
  const v = applyVec(inv, { x: dx, y: dy });
  return { dx: v.x, dy: v.y };
}

export interface SnapGuide {
  axis: 'x' | 'y';
  /** 参考线位置（世界坐标） */
  pos: number;
  /** 绘制范围 */
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

function edges(box: Box, axis: 'x' | 'y'): number[] {
  return axis === 'x'
    ? [box.x, box.x + box.w / 2, box.x + box.w]
    : [box.y, box.y + box.h / 2, box.y + box.h];
}

/** 智能吸附：与其它元素/画板的边、中线比对 */
export function computeSnap(
  moving: Box,
  targets: Box[],
  threshold: number,
  artboard?: Box,
): SnapResult {
  let bestDx = 0;
  let bestDy = 0;
  let bestDxScore = Infinity;
  let bestDyScore = Infinity;
  const guides: SnapGuide[] = [];
  const all = artboard ? [...targets, artboard] : targets;

  const consider = (axis: 'x' | 'y') => {
    const mEdges = edges(moving, axis);
    for (const t of all) {
      const tEdges = edges(t, axis);
      for (const me of mEdges) {
        for (const te of tEdges) {
          const diff = te - me;
          if (Math.abs(diff) <= threshold && Math.abs(diff) < (axis === 'x' ? bestDxScore : bestDyScore)) {
            if (axis === 'x') {
              bestDxScore = Math.abs(diff);
              bestDx = diff;
            } else {
              bestDyScore = Math.abs(diff);
              bestDy = diff;
            }
            const from = Math.min(
              axis === 'x' ? moving.y : moving.x,
              axis === 'x' ? t.y : t.x,
            );
            const to = Math.max(
              axis === 'x' ? moving.y + moving.h : moving.x + moving.w,
              axis === 'x' ? t.y + t.h : t.x + t.w,
            );
            guides.push({ axis, pos: te, from, to });
          }
        }
      }
    }
  };
  consider('x');
  consider('y');
  // 每个轴只保留最优的一条参考线
  const bestGuides: SnapGuide[] = [];
  const gx = guides.filter((g) => g.axis === 'x').sort((a, b) => Math.abs(a.pos - (moving.x + bestDx)) - Math.abs(b.pos - (moving.x + bestDx)));
  const gy = guides.filter((g) => g.axis === 'y').sort((a, b) => Math.abs(a.pos - (moving.y + bestDy)) - Math.abs(b.pos - (moving.y + bestDy)));
  if (gx.length) bestGuides.push(gx[0]);
  if (gy.length) bestGuides.push(gy[0]);
  return { dx: bestDx, dy: bestDy, guides: bestGuides };
}
