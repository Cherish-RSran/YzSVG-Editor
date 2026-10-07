import * as polygonClipping from 'polygon-clipping';
import { SvgDoc, SvgNode } from './types';
import { parsePath, serializePath, Segment } from './path';
import { worldMatrix, localBox } from './geometry';
import { mat } from './matrix';

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[];

/** 把路径段离散成多边形（曲线按精度采样） */
export function segmentsToRings(segs: Segment[], precision = 24): Poly[] {
  const polys: Poly[] = [];
  let cur: Ring = [];
  let start: Pt | null = null;
  let last: Pt = [0, 0];

  const flush = () => {
    if (cur.length >= 3) polys.push([cur.slice()]);
    cur = [];
  };

  for (const s of segs) {
    if (s.cmd === 'M') {
      flush();
      start = [s.args[0], s.args[1]];
      last = [s.args[0], s.args[1]];
      cur.push([s.args[0], s.args[1]]);
    } else if (s.cmd === 'L') {
      last = [s.args[0], s.args[1]];
      cur.push(last);
    } else if (s.cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = s.args;
      const [x0, y0] = last;
      for (let i = 1; i <= precision; i++) {
        const t = i / precision;
        const mt = 1 - t;
        cur.push([
          mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
          mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
        ]);
      }
      last = [x3, y3];
    } else if (s.cmd === 'Q') {
      const [x1, y1, x2, y2] = s.args;
      const [x0, y0] = last;
      for (let i = 1; i <= precision; i++) {
        const t = i / precision;
        const mt = 1 - t;
        cur.push([mt * mt * x0 + 2 * mt * t * x1 + t * t * x2, mt * mt * y0 + 2 * mt * t * y1 + t * t * y2]);
      }
      last = [x2, y2];
    } else if (s.cmd === 'A') {
      cur.push([s.args[5], s.args[6]]);
      last = [s.args[5], s.args[6]];
    } else if (s.cmd === 'Z') {
      if (start) cur.push([start[0], start[1]]);
      flush();
    }
  }
  flush();
  void start;
  return polys;
}

/** 节点 → 世界坐标系下的多边形 */
function nodePolys(doc: SvgDoc, node: SvgNode): Poly[] {
  const m = worldMatrix(doc, node.id);
  const tf = (p: Pt): Pt => [
    m.a * p[0] + m.c * p[1] + m.e,
    m.b * p[0] + m.d * p[1] + m.f,
  ];
  const applyTf = (polys: Poly[]): Poly[] => polys.map((rings) => rings.map((ring) => ring.map(tf)));

  if (node.type === 'path') {
    return applyTf(segmentsToRings(parsePath(node.attrs['d'] ?? '')));
  }
  if (node.type === 'polygon' || node.type === 'polyline') {
    const nums = (node.attrs['points'] ?? '')
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    const ring: Ring = [];
    for (let i = 0; i + 1 < nums.length; i += 2) ring.push(tf([nums[i], nums[i + 1]]));
    return ring.length >= 3 ? [[ring]] : [];
  }
  const b = localBox(doc, node.id);
  if (b.w + b.h === 0) return [];
  const ring: Ring = [];
  if (node.type === 'ellipse' || node.type === 'circle') {
    for (let i = 0; i < 32; i++) {
      const a = (Math.PI * 2 * i) / 32;
      ring.push(
        tf([b.x + b.w / 2 + (b.w / 2) * Math.cos(a), b.y + b.h / 2 + (b.h / 2) * Math.sin(a)]),
      );
    }
  } else {
    ring.push(tf([b.x, b.y]), tf([b.x + b.w, b.y]), tf([b.x + b.w, b.y + b.h]), tf([b.x, b.y + b.h]));
  }
  return [[ring]];
}

type ClipApi = {
  union: (a: Poly[], b: Poly[]) => Poly[];
  intersection: (a: Poly[], b: Poly[]) => Poly[];
  difference: (a: Poly[], b: Poly[]) => Poly[];
  xor: (a: Poly[], b: Poly[]) => Poly[];
};

/**
 * polygon-clipping 是 CJS 模块，不同打包方式下可能被包一层 default，
 * 这里做一次归一化，保证在 Vite 构建产物里一定能取到函数。
 */
function clipApi(): ClipApi | null {
  const m = polygonClipping as unknown as Record<string, unknown>;
  const candidates = [m, m?.default, (m?.default as Record<string, unknown>)?.default];
  for (const c of candidates) {
    const api = c as Partial<ClipApi> | undefined;
    if (api && typeof api.union === 'function' && typeof api.intersection === 'function') {
      return api as ClipApi;
    }
  }
  return null;
}

/** 执行布尔运算，返回结果路径的 d 属性（世界坐标系） */
export function booleanOp(doc: SvgDoc, ids: string[], op: BoolOp): string | null {
  if (ids.length === 0) return null;
  const polysList = ids
    .map((id) => (doc.nodes[id] ? nodePolys(doc, doc.nodes[id]) : []))
    .filter((p) => p.length > 0);
  if (polysList.length === 0) return null;

  const pc = clipApi();
  if (!pc) return null;
  let acc: Poly[] = polysList[0];
  for (let i = 1; i < polysList.length; i++) {
    try {
      acc =
        op === 'union'
          ? pc.union(acc, polysList[i])
          : op === 'intersect'
            ? pc.intersection(acc, polysList[i])
            : op === 'subtract'
              ? pc.difference(acc, polysList[i])
              : pc.xor(acc, polysList[i]);
    } catch {
      return null;
    }
  }
  if (!acc || acc.length === 0) return null;

  const segs: Segment[] = [];
  // polygon-clipping 返回 MultiPolygon：多边形数组 → 每个多边形是环数组
  for (const poly of acc) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      segs.push({ cmd: 'M', args: [ring[0][0], ring[0][1]] });
      for (let i = 1; i < ring.length; i++) segs.push({ cmd: 'L', args: [ring[i][0], ring[i][1]] });
      segs.push({ cmd: 'Z', args: [] });
    }
  }
  return segs.length > 0 ? serializePath(segs) : null;
}

/** 布尔运算后生成一个新路径节点 */
export function buildBooleanNode(doc: SvgDoc, ids: string[], op: BoolOp): SvgNode | null {
  const d = booleanOp(doc, ids, op);
  if (!d) return null;
  const src = doc.nodes[ids[0]];
  return {
    id: `bp_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    type: 'path',
    name: `布尔·${op}`,
    parent: null,
    children: [],
    attrs: { d, fill: src?.attrs['fill'] ?? '#3b82f6', stroke: src?.attrs['stroke'] ?? 'none' },
    transform: { ...mat() },
    visible: true,
    locked: false,
  };
}
