import { IDENTITY, Mat, mul } from './matrix';
import { Box, SvgDoc, SvgNode } from './types';
import { parsePath, pathBBox } from './path';

export type { Box } from './types';

/** 退化维度（如水平线的高度）补齐时的最小可见厚度 */
const MIN_DEGENERATE_SIZE = 4;

/** 画直线时吸附到水平/竖直的角度阈值（度） */
export const AXIS_SNAP_DEG = 7;

/** 画直线时的轴向吸附：与水平或竖直的夹角在阈值内就直接拉正，返回新的终点。
 *  想画斜线就把拖拽偏离轴心更多一些（超过阈值），或按住 Alt 临时关掉吸附。 */
export function snapToAxis(
  a: { x: number; y: number },
  b: { x: number; y: number },
  thresholdDeg = AXIS_SNAP_DEG,
): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return b;
  let deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI); // 0..180
  if (deg > 90) deg = 180 - deg; // 折叠到 0..90：正负方向对称
  if (deg <= thresholdDeg) return { x: b.x, y: a.y }; // 水平
  if (90 - deg <= thresholdDeg) return { x: a.x, y: b.y }; // 竖直
  return b;
}

/** 从根节点到该节点的变换矩阵累乘 */
export function worldMatrix(doc: SvgDoc, id: string): Mat {
  const chain: SvgNode[] = [];
  let cur: SvgNode | undefined = doc.nodes[id];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent ? doc.nodes[cur.parent] : undefined;
  }
  let m: Mat = { ...IDENTITY };
  for (const n of chain) m = mul(m, n.transform);
  return m;
}

/** 父级世界矩阵（用于把世界坐标增量换算到父坐标系） */
export function parentWorldMatrix(doc: SvgDoc, id: string): Mat {
  const node = doc.nodes[id];
  if (!node || !node.parent) return { ...IDENTITY };
  return worldMatrix(doc, node.parent);
}

export function transformBox(box: Box, m: Mat): Box {
  const pts = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x, y: box.y + box.h },
    { x: box.x + box.w, y: box.y + box.h },
  ].map((p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function numAttr(node: SvgNode, key: string, fallback = 0): number {
  const v = node.attrs[key];
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function pointsBox(points: string): Box {
  const nums = (points.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []).map(Number);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 估算节点自身几何的包围盒（未应用自身 transform） */
export function estimateLocalBox(node: SvgNode): Box {
  switch (node.type) {
    case 'rect':
    case 'image': {
      const x = numAttr(node, 'x');
      const y = numAttr(node, 'y');
      const w = numAttr(node, 'width');
      const h = numAttr(node, 'height');
      return { x, y, w, h };
    }
    case 'circle': {
      const r = numAttr(node, 'r');
      return { x: numAttr(node, 'cx') - r, y: numAttr(node, 'cy') - r, w: 2 * r, h: 2 * r };
    }
    case 'ellipse': {
      const rx = numAttr(node, 'rx');
      const ry = numAttr(node, 'ry');
      return { x: numAttr(node, 'cx') - rx, y: numAttr(node, 'cy') - ry, w: 2 * rx, h: 2 * ry };
    }
    case 'line': {
      const x1 = numAttr(node, 'x1');
      const y1 = numAttr(node, 'y1');
      const x2 = numAttr(node, 'x2');
      const y2 = numAttr(node, 'y2');
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
      };
    }
    case 'polyline':
    case 'polygon':
      return pointsBox(node.attrs['points'] ?? '');
    case 'path':
      return pathBBox(parsePath(node.attrs['d'] ?? ''));
    case 'text': {
      const fs = numAttr(node, 'font-size', 16);
      const text = node.text ?? '';
      const w = Math.max(8, text.length * fs * 0.6);
      return { x: numAttr(node, 'x'), y: numAttr(node, 'y') - fs, w, h: fs * 1.3 };
    }
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** 优先用浏览器 getBBox（精确），否则用估算值 */
export function localBox(doc: SvgDoc, id: string): Box {
  const node = doc.nodes[id];
  if (!node) return { x: 0, y: 0, w: 0, h: 0 };
  if (typeof document !== 'undefined') {
    const el = document.querySelector(`[data-id="${id}"]`) as SVGGraphicsElement | null;
    if (el && typeof el.getBBox === 'function') {
      try {
        const b = el.getBBox();
        if (b && (b.width > 0 || b.height > 0 || node.type === 'text')) {
          // getBBox 不含描边：水平/垂直的线有一维为 0，选中框会退化成看不见的一条线，按描边宽度补齐
          const sw = Math.max(parseFloat(node.attrs['stroke-width'] ?? '') || 0, MIN_DEGENERATE_SIZE);
          return {
            x: b.width > 0 ? b.x : b.x - sw / 2,
            y: b.height > 0 ? b.y : b.y - sw / 2,
            w: b.width > 0 ? b.width : sw,
            h: b.height > 0 ? b.height : sw,
          };
        }
      } catch {
        /* 忽略，回退到估算 */
      }
    }
  }
  return estimateLocalBox(node);
}

/** 节点在文档根坐标系下的包围盒 */
export function nodeBBox(doc: SvgDoc, id: string): Box {
  const node = doc.nodes[id];
  if (!node) return { x: 0, y: 0, w: 0, h: 0 };
  return transformBox(localBox(doc, id), worldMatrix(doc, id));
}

export function unionBox(boxes: Box[]): Box {
  const valid = boxes.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  if (valid.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...valid.map((b) => b.x));
  const y = Math.min(...valid.map((b) => b.y));
  const x2 = Math.max(...valid.map((b) => b.x + b.w));
  const y2 = Math.max(...valid.map((b) => b.y + b.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

export function selectionBBox(doc: SvgDoc, ids: string[]): Box {
  return unionBox(ids.map((id) => nodeBBox(doc, id)));
}

/** 判断点是否落在包围盒内（文档坐标） */
export function pointInBox(p: { x: number; y: number }, box: Box, pad = 0): boolean {
  return p.x >= box.x - pad && p.x <= box.x + box.w + pad && p.y >= box.y - pad && p.y <= box.y + box.h + pad;
}

/** 两个包围盒是否相交（用于框选） */
export function boxIntersects(a: Box, b: Box): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/** 包围盒是否完全被另一个包含（Figma 式框选行为） */
export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

