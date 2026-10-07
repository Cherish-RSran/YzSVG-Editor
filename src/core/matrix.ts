import { IDENTITY, Mat } from './types';

export type { Mat } from './types';
export { IDENTITY } from './types';

/** 2x3 仿射矩阵工具（列主序与 SVG 一致：a b c d e f） */

export function mat(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0): Mat {
  return { a, b, c, d, e, f };
}

export function isIdentity(m: Mat, eps = 1e-9): boolean {
  return (
    Math.abs(m.a - 1) < eps &&
    Math.abs(m.b) < eps &&
    Math.abs(m.c) < eps &&
    Math.abs(m.d - 1) < eps &&
    Math.abs(m.e) < eps &&
    Math.abs(m.f) < eps
  );
}

/** m1 * m2 （先应用 m2，再应用 m1） */
export function mul(m1: Mat, m2: Mat): Mat {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function translation(tx: number, ty: number): Mat {
  return mat(1, 0, 0, 1, tx, ty);
}

export function scaling(sx: number, sy: number): Mat {
  return mat(sx, 0, 0, sy, 0, 0);
}

export function rotation(deg: number, cx = 0, cy = 0): Mat {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return mat(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy);
}

/** 只应用线性部分（忽略平移），用于向量变换 */
export function applyVec(m: Mat, p: { x: number; y: number }) {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

export function invert(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return { ...IDENTITY };
  const id = 1 / det;
  return {
    a: m.d * id,
    b: -m.b * id,
    c: -m.c * id,
    d: m.a * id,
    e: (m.c * m.f - m.d * m.e) * id,
    f: (m.b * m.e - m.a * m.f) * id,
  };
}

/** 将矩阵序列化为 SVG transform 字符串 */
export function matToStr(m: Mat, precision = 6): string {
  if (isIdentity(m)) return '';
  const n = (v: number) => {
    const r = Number(v.toFixed(precision));
    return String(Object.is(r, -0) ? 0 : r);
  };
  return `matrix(${n(m.a)},${n(m.b)},${n(m.c)},${n(m.d)},${n(m.e)},${n(m.f)})`;
}

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/** 解析 SVG transform 属性（支持 matrix/translate/scale/rotate/skewX/skewY 列表） */
export function parseTransform(s: string | undefined | null): Mat {
  if (!s) return { ...IDENTITY };
  let result: Mat = { ...IDENTITY };
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = re.exec(s))) {
    matched = true;
    const nums = (m[2].match(NUM) || []).map(Number);
    let t: Mat = { ...IDENTITY };
    switch (m[1]) {
      case 'matrix':
        t = mat(nums[0] ?? 1, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1, nums[4] ?? 0, nums[5] ?? 0);
        break;
      case 'translate':
        t = translation(nums[0] ?? 0, nums[1] ?? 0);
        break;
      case 'scale':
        t = scaling(nums[0] ?? 1, nums.length > 1 ? nums[1] : nums[0] ?? 1);
        break;
      case 'rotate': {
        const a = nums[0] ?? 0;
        if (nums.length >= 3) t = rotation(a, nums[1], nums[2]);
        else t = rotation(a);
        break;
      }
      case 'skewX': {
        const a = ((nums[0] ?? 0) * Math.PI) / 180;
        t = mat(1, 0, Math.tan(a), 1, 0, 0);
        break;
      }
      case 'skewY': {
        const a = ((nums[0] ?? 0) * Math.PI) / 180;
        t = mat(1, Math.tan(a), 0, 1, 0, 0);
        break;
      }
    }
    result = mul(result, t);
  }
  if (!matched) return { ...IDENTITY };
  return result;
}

/** 从矩阵分解出旋转角度（度） */
export function rotationOf(m: Mat): number {
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

