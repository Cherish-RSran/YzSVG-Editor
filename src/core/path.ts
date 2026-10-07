/** SVG path d 属性的解析、归一化与编辑 */

export type PathCmd = 'M' | 'L' | 'C' | 'Q' | 'A' | 'Z';

export interface Segment {
  cmd: PathCmd;
  args: number[];
}

interface Pt {
  x: number;
  y: number;
}

const CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
const NUM_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

interface NumTok {
  value: number;
  text: string;
}

function scanNumbers(s: string): NumTok[] {
  const out: NumTok[] = [];
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(s))) {
    out.push({ value: parseFloat(m[0]), text: m[0] });
  }
  return out;
}

/**
 * 解析 d 属性，归一化为绝对坐标的 M / L / C / Q / A / Z
 * H、V、S、T 会被展开，相对指令转换为绝对
 */
export function parsePath(d: string): Segment[] {
  const segs: Segment[] = [];
  if (!d) return segs;
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let lastC2: Pt | null = null;
  let lastQ: Pt | null = null;
  let m: RegExpExecArray | null;
  CMD_RE.lastIndex = 0;

  const ensureStart = () => {
    if (segs.length === 0) {
      segs.push({ cmd: 'M', args: [cur.x, cur.y] });
      start = { ...cur };
    }
  };

  while ((m = CMD_RE.exec(d))) {
    const raw = m[1];
    const up = raw.toUpperCase();
    const rel = raw !== up;
    const nums = scanNumbers(m[2]);
    let i = 0;
    const num = () => (i < nums.length ? nums[i++].value : 0);

    if (up === 'Z') {
      segs.push({ cmd: 'Z', args: [] });
      cur = { ...start };
      lastC2 = null;
      lastQ = null;
      continue;
    }

    if (up === 'M') {
      let first = true;
      while (i + 1 < nums.length) {
        const x = num();
        const y = num();
        const p: Pt = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
        if (first) {
          segs.push({ cmd: 'M', args: [p.x, p.y] });
          start = { ...p };
        } else {
          segs.push({ cmd: 'L', args: [p.x, p.y] });
        }
        cur = p;
        first = false;
      }
      lastC2 = null;
      lastQ = null;
      continue;
    }

    if (up === 'L' || up === 'H' || up === 'V') {
      ensureStart();
      if (up === 'H') {
        while (i < nums.length) {
          const x = num();
          const p: Pt = rel ? { x: cur.x + x, y: cur.y } : { x, y: cur.y };
          segs.push({ cmd: 'L', args: [p.x, p.y] });
          cur = p;
        }
      } else if (up === 'V') {
        while (i < nums.length) {
          const y = num();
          const p: Pt = rel ? { x: cur.x, y: cur.y + y } : { x: cur.x, y };
          segs.push({ cmd: 'L', args: [p.x, p.y] });
          cur = p;
        }
      } else {
        while (i + 1 < nums.length) {
          const x = num();
          const y = num();
          const p: Pt = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
          segs.push({ cmd: 'L', args: [p.x, p.y] });
          cur = p;
        }
      }
      lastC2 = null;
      lastQ = null;
      continue;
    }

    if (up === 'C' || up === 'S') {
      ensureStart();
      while (i < nums.length) {
        let p1: Pt;
        let p2: Pt;
        let p: Pt;
        if (up === 'C') {
          if (i + 5 >= nums.length) break;
          const x1 = num();
          const y1 = num();
          const x2 = num();
          const y2 = num();
          const x = num();
          const y = num();
          p1 = { x: x1, y: y1 };
          p2 = { x: x2, y: y2 };
          p = { x, y };
          if (rel) {
            p1 = { x: cur.x + x1, y: cur.y + y1 };
            p2 = { x: cur.x + x2, y: cur.y + y2 };
            p = { x: cur.x + x, y: cur.y + y };
          }
        } else {
          if (i + 3 >= nums.length) break;
          const x2 = num();
          const y2 = num();
          const x = num();
          const y = num();
          p2 = { x: x2, y: y2 };
          p = { x, y };
          if (rel) {
            p2 = { x: cur.x + x2, y: cur.y + y2 };
            p = { x: cur.x + x, y: cur.y + y };
          }
          p1 = lastC2 ? { x: 2 * cur.x - lastC2.x, y: 2 * cur.y - lastC2.y } : { ...cur };
        }
        segs.push({ cmd: 'C', args: [p1.x, p1.y, p2.x, p2.y, p.x, p.y] });
        lastC2 = p2;
        lastQ = null;
        cur = p;
      }
      continue;
    }

    if (up === 'Q' || up === 'T') {
      ensureStart();
      while (i < nums.length) {
        let p1: Pt;
        let p: Pt;
        if (up === 'Q') {
          if (i + 3 >= nums.length) break;
          const x1 = num();
          const y1 = num();
          const x = num();
          const y = num();
          p1 = { x: x1, y: y1 };
          p = { x, y };
          if (rel) {
            p1 = { x: cur.x + x1, y: cur.y + y1 };
            p = { x: cur.x + x, y: cur.y + y };
          }
        } else {
          if (i + 1 >= nums.length) break;
          const x = num();
          const y = num();
          p = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
          p1 = lastQ ? { x: 2 * cur.x - lastQ.x, y: 2 * cur.y - lastQ.y } : { ...cur };
        }
        segs.push({ cmd: 'Q', args: [p1.x, p1.y, p.x, p.y] });
        lastQ = p1;
        lastC2 = null;
        cur = p;
      }
      continue;
    }

    if (up === 'A') {
      ensureStart();
      while (i < nums.length) {
        const rest = nums.length - i;
        const flagTok = nums[i + 3];
        // 形式一：flag 单独打包成一个两位 token（... rot "01" x y）
        const packedFlags = rest === 6 && !!flagTok && flagTok.text.length === 2 && /^[01]{2}$/.test(flagTok.text);
        // 形式二：flag 与 x 粘在一起（... rot "0110" y），rest === 5
        const packedFlagsX =
          rest === 5 && !!flagTok && flagTok.text.length >= 3 && /^[01]{2}[0-9]/.test(flagTok.text);
        if (!packedFlags && !packedFlagsX && rest < 7) break;
        const rx = num();
        const ry = num();
        const rot = num();
        let laf: number;
        let sf: number;
        if (packedFlags) {
          laf = parseInt(flagTok.text[0], 10);
          sf = parseInt(flagTok.text[1], 10);
          i += 1;
        } else if (packedFlagsX) {
          laf = parseInt(flagTok.text[0], 10);
          sf = parseInt(flagTok.text[1], 10);
          // 剩余部分作为 x
          nums[i] = { value: parseFloat(flagTok.text.slice(2)), text: flagTok.text.slice(2) };
        } else {
          laf = num() ? 1 : 0;
          sf = num() ? 1 : 0;
        }
        const x = num();
        const y = num();
        const p: Pt = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
        segs.push({ cmd: 'A', args: [rx, ry, rot, laf, sf, p.x, p.y] });
        cur = p;
        lastC2 = null;
        lastQ = null;
      }
      continue;
    }
  }
  return segs;
}

function n(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Number(v.toFixed(3));
  return String(Object.is(r, -0) ? 0 : r);
}

export function serializePath(segs: Segment[]): string {
  return segs
    .map((s) => (s.cmd === 'Z' ? 'Z' : `${s.cmd} ${s.args.map(n).join(' ')}`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AnchorPoint {
  seg: number;
  p: Pt;
  in?: Pt;
  out?: Pt;
  cmd: PathCmd;
}

/** 提取所有可编辑锚点（含控制柄） */
export function anchorsOf(segs: Segment[]): AnchorPoint[] {
  const out: AnchorPoint[] = [];
  segs.forEach((s, idx) => {
    if (s.cmd === 'M' || s.cmd === 'L') {
      out.push({ seg: idx, p: { x: s.args[0], y: s.args[1] }, cmd: s.cmd });
    } else if (s.cmd === 'C') {
      out.push({
        seg: idx,
        p: { x: s.args[4], y: s.args[5] },
        in: { x: s.args[2], y: s.args[3] },
        out: { x: s.args[0], y: s.args[1] },
        cmd: 'C',
      });
    } else if (s.cmd === 'Q') {
      out.push({
        seg: idx,
        p: { x: s.args[2], y: s.args[3] },
        in: { x: s.args[0], y: s.args[1] },
        out: { x: s.args[0], y: s.args[1] },
        cmd: 'Q',
      });
    } else if (s.cmd === 'A') {
      out.push({ seg: idx, p: { x: s.args[5], y: s.args[6] }, cmd: 'A' });
    }
  });
  return out;
}

/** 移动锚点或控制柄 */
export function moveAnchor(
  segs: Segment[],
  segIndex: number,
  which: 'anchor' | 'in' | 'out',
  pt: Pt,
): Segment[] {
  const copy = segs.map((s) => ({ cmd: s.cmd, args: [...s.args] }));
  const s = copy[segIndex];
  if (!s) return copy;
  if (s.cmd === 'M' || s.cmd === 'L') {
    s.args[0] = pt.x;
    s.args[1] = pt.y;
  } else if (s.cmd === 'C') {
    if (which === 'anchor') {
      const dx = pt.x - s.args[4];
      const dy = pt.y - s.args[5];
      s.args[4] = pt.x;
      s.args[5] = pt.y;
      s.args[0] += dx;
      s.args[1] += dy;
      s.args[2] += dx;
      s.args[3] += dy;
    } else if (which === 'in') {
      s.args[2] = pt.x;
      s.args[3] = pt.y;
    } else {
      s.args[0] = pt.x;
      s.args[1] = pt.y;
    }
  } else if (s.cmd === 'Q') {
    if (which === 'anchor') {
      const dx = pt.x - s.args[2];
      const dy = pt.y - s.args[3];
      s.args[2] = pt.x;
      s.args[3] = pt.y;
      s.args[0] += dx;
      s.args[1] += dy;
    } else {
      s.args[0] = pt.x;
      s.args[1] = pt.y;
    }
  } else if (s.cmd === 'A') {
    s.args[5] = pt.x;
    s.args[6] = pt.y;
  }
  return copy;
}

/** 删除锚点 */
export function deleteAnchor(segs: Segment[], segIndex: number): Segment[] {
  const s = segs[segIndex];
  if (!s) return segs;
  const copy = segs.map((x) => ({ cmd: x.cmd, args: [...x.args] }));
  if (s.cmd === 'M') {
    const next = copy[segIndex + 1];
    if (!next) return segs;
    next.cmd = 'M';
    copy.splice(segIndex, 1);
    return copy;
  }
  copy.splice(segIndex, 1);
  return copy;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function endPoint(s: Segment): Pt {
  return { x: s.args[s.args.length - 2], y: s.args[s.args.length - 1] };
}

/** 采样估算 path 包围盒（无 DOM 环境使用） */
export function pathBBox(segs: Segment[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  let cur: Pt = { x: 0, y: 0 };
  for (const s of segs) {
    if (s.cmd === 'M' || s.cmd === 'L') {
      add(s.args[0], s.args[1]);
      cur = { x: s.args[0], y: s.args[1] };
    } else if (s.cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = s.args;
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const mt = 1 - t;
        add(
          mt * mt * mt * cur.x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
          mt * mt * mt * cur.y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
        );
      }
      cur = { x: x3, y: y3 };
    } else if (s.cmd === 'Q') {
      const [x1, y1, x2, y2] = s.args;
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const mt = 1 - t;
        add(mt * mt * cur.x + 2 * mt * t * x1 + t * t * x2, mt * mt * cur.y + 2 * mt * t * y1 + t * t * y2);
      }
      cur = { x: x2, y: y2 };
    } else if (s.cmd === 'A') {
      add(s.args[5], s.args[6]);
      cur = { x: s.args[5], y: s.args[6] };
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 一串点转平滑路径（Catmull-Rom 转贝塞尔），用于铅笔工具 */
export function pointsToSmoothPath(points: Pt[], tension = 1): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${n(points[0].x)} ${n(points[0].y)}`;
  const segs: Segment[] = [{ cmd: 'M', args: [points[0].x, points[0].y] }];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension;
    segs.push({ cmd: 'C', args: [c1x, c1y, c2x, c2y, p2.x, p2.y] });
  }
  return serializePath(segs);
}

export function dist2(a: Pt, b: Pt) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
