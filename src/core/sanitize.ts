/** 导入时的安全消毒：元素白名单 + 属性白名单 + URL 校验 */

export const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'textpath',
  'image',
  'lineargradient',
  'radialgradient',
  'stop',
  'pattern',
  'clippath',
  'mask',
  'marker',
  'switch',
  'title',
  'desc',
]);

/** 保留但以原始 markup 形式承载（不结构化编辑） */
export const RAW_ELEMENTS = new Set([
  'filter',
  'fegaussianblur',
  'fedropshadow',
  'feoffset',
  'feblend',
  'fecolormatrix',
  'fecomposite',
  'femerge',
  'femergenode',
  'feflood',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
  'style',
  'metadata',
  'view',
]);

/** 一律移除的危险元素 */
export const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'handler',
  'listener',
]);

const GEOMETRY_ATTRS = [
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'd',
  'points',
  'transform',
  'offset',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'fx',
  'fy',
  'fr',
  'patternunits',
  'patterntransform',
  'preserveaspectratio',
  'marker-start',
  'marker-mid',
  'marker-end',
  'refx',
  'refy',
  'markerwidth',
  'markerheight',
  'markerunits',
  'orient',
  'viewbox',
  'clippathunits',
  'maskunits',
  'filterunits',
  'primitiveunits',
  'stddeviation',
  'flood-color',
  'flood-opacity',
  'in',
  'in2',
  'result',
  'mode',
  'values',
  'type',
  'from',
  'to',
  'by',
  'dur',
  'begin',
  'end',
  'repeatcount',
  'fill-freeze',
  'attributename',
  'keytimes',
  'keysplines',
  'calcmode',
];

const PRESENTATION_ATTRS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'color',
  'display',
  'visibility',
  'mix-blend-mode',
  'isolation',
  'shape-rendering',
  'vector-effect',
  'paint-order',
  'clip-rule',
  'clip-path',
  'mask',
  'filter',
  'stop-color',
  'stop-opacity',
];

const TEXT_ATTRS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
  'baseline-shift',
  'dx',
  'dy',
  'rotate',
  'textlength',
  'lengthadjust',
  'writing-mode',
];

const REF_ATTRS = ['href', 'xlink:href', 'src'];

const MISC_ATTRS = ['id', 'class', 'style', 'xml:space', 'requiredfeatures', 'systemlanguage'];

export const ALLOWED_ATTRS = new Set([
  ...GEOMETRY_ATTRS,
  ...PRESENTATION_ATTRS,
  ...TEXT_ATTRS,
  ...REF_ATTRS,
  ...MISC_ATTRS,
]);

/** 事件处理器与其它危险属性 */
function isDangerousAttr(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('on')) return true;
  if (lower === 'xmlns:javascript' || lower === 'javascript') return true;
  return false;
}

/** 判断 URL 是否安全：仅允许片段引用与 data:image */
export function isSafeUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === '') return false;
  if (v.startsWith('#')) return true;
  if (v.startsWith('data:image/')) return true;
  if (v.startsWith('data:application/octet-stream')) return false;
  if (v.startsWith('javascript:')) return false;
  if (v.startsWith('vbscript:')) return false;
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('//')) return false;
  if (v.startsWith('data:')) return false;
  return true;
}

/** 清理 style 属性中的危险内容 */
export function sanitizeStyle(value: string): string {
  let out = value.replace(/javascript\s*:/gi, '').replace(/expression\s*\(/gi, '');
  // 移除外部 url() 引用
  out = out.replace(/url\s*\(\s*['"]?(https?:)?\/\/[^)]*\)/gi, 'none');
  return out;
}

export interface SanitizeResult {
  removedElements: string[];
  removedAttrs: string[];
}

/** 过滤单个元素的属性（就地），返回被移除的属性名 */
export function sanitizeAttributes(el: Element, removedAttrs: string[] = []): string[] {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (isDangerousAttr(name)) {
      removedAttrs.push(attr.name);
      el.removeAttribute(attr.name);
      continue;
    }
    if (!ALLOWED_ATTRS.has(name)) {
      removedAttrs.push(attr.name);
      el.removeAttribute(attr.name);
      continue;
    }
    if (REF_ATTRS.includes(name) && !isSafeUrl(attr.value)) {
      removedAttrs.push(attr.name);
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'style') {
      const cleaned = sanitizeStyle(attr.value);
      if (cleaned !== attr.value) {
        removedAttrs.push('style(dangerous)');
        el.setAttribute('style', cleaned);
      }
    }
  }
  return removedAttrs;
}

/** 就地清理一棵 DOM 子树（含根元素自身属性），返回被移除内容清单 */
export function sanitizeTree(root: Element): SanitizeResult {
  const removedElements: string[] = [];
  const removedAttrs: string[] = sanitizeAttributes(root);

  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const svgTag = child.tagName;
      if (FORBIDDEN_ELEMENTS.has(tag)) {
        removedElements.push(tag);
        child.remove();
        continue;
      }
      if (!ALLOWED_ELEMENTS.has(tag) && !RAW_ELEMENTS.has(tag)) {
        removedElements.push(svgTag);
        child.remove();
        continue;
      }
      sanitizeAttributes(child, removedAttrs);
      // RAW_ELEMENTS 内部不再递归（整块保留）
      if (!RAW_ELEMENTS.has(tag)) walk(child);
    }
  };
  walk(root);
  return { removedElements, removedAttrs };
}

