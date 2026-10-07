import { matToStr } from './matrix';
import { DefEntry, SvgDoc } from './types';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attrStr(attrs: Record<string, string>, skip: Set<string> = new Set()): string {
  return Object.entries(attrs)
    .filter(([k]) => !skip.has(k.toLowerCase()))
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(' ');
}

function defToString(def: DefEntry, indent: string): string {
  const attrs = attrStr(def.attrs);
  if (def.kind === 'linearGradient' || def.kind === 'radialGradient') {
    const stops = (def.stops ?? [])
      .map((s) => {
        const op = s.opacity !== undefined ? ` stop-opacity="${s.opacity}"` : '';
        return `${indent}  <stop offset="${s.offset}%" stop-color="${s.color}"${op}/>`;
      })
      .join('\n');
    return `${indent}<${def.kind} id="${def.id}"${attrs ? ' ' + attrs : ''}>\n${stops}\n${indent}</${def.kind}>`;
  }
  if (def.raw) return `${indent}${def.raw}`;
  return `${indent}<${def.raw ? def.kind : def.kind} id="${def.id}"${attrs ? ' ' + attrs : ''}/>`;
}

export function nodeToString(doc: SvgDoc, id: string, indent = ''): string {
  const node = doc.nodes[id];
  if (!node) return '';
  if (node.type === 'unknown' && node.raw) {
    return indent + node.raw;
  }
  const tag =
    node.type === 'group' ? 'g' : node.type === 'unknown' ? (node.tag ?? 'g') : node.type;
  const attrs: Record<string, string> = { ...node.attrs, ...(node.rawAttrs ?? {}) };
  if (!node.visible) attrs['display'] = 'none';
  const t = matToStr(node.transform);
  if (t) attrs['transform'] = t;
  if (!attrs['id']) attrs['id'] = node.id;
  const head = `<${tag} ${attrStr(attrs)}`;
  const kids = node.children.map((c) => nodeToString(doc, c, indent + '  ')).filter(Boolean);
  if (node.type === 'text') {
    if (node.pathId) {
      const ref = doc.nodes[node.pathId];
      const href = ref ? ref.rawAttrs?.['id'] ?? ref.id : node.pathId;
      return `${indent}${head}><textPath href="#${href}">${esc(node.text ?? '')}</textPath></${tag}>`;
    }
    return `${indent}${head}>${esc(node.text ?? '')}</${tag}>`;
  }
  if (kids.length === 0) {
    if (tag === 'g' || tag === 'text') return `${indent}${head}/>`;
    return `${indent}${head}/>`;
  }
  return `${indent}${head}>\n${kids.join('\n')}\n${indent}</${tag}>`;
}

export interface SerializeOptions {
  /** 是否保留内部生成的 id（默认保留，便于 use/引用） */
  keepIds?: boolean;
  title?: string;
}

export function serializeDoc(doc: SvgDoc, options: SerializeOptions = {}): string {
  const { title } = options;
  const vb = doc.viewBox.join(' ');
  const rootAttrs = attrStr(doc.rootAttrs, new Set(['width', 'height', 'viewbox', 'id']));
  const defs =
    doc.defs.length > 0
      ? `  <defs>\n${doc.defs.map((d) => defToString(d, '    ')).join('\n')}\n  </defs>\n`
      : '';
  const root = doc.nodes[doc.rootId];
  const body = (root?.children ?? []).map((c) => nodeToString(doc, c, '  ')).join('\n');
  const comment = title ? `  <title>${esc(title)}</title>\n` : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${doc.width}" height="${doc.height}" viewBox="${vb}"${rootAttrs ? ' ' + rootAttrs : ''}>`,
    comment,
    defs,
    body,
    `</svg>`,
  ]
    .filter((s) => s !== '')
    .join('\n');
}

/** 轻量级压缩：去掉注释、多余空白、多余精度（P5 的完整优化器再加 SVGO） */
export function minifySvg(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\/>/g, '/>')
    .replace(/([0-9])\.0+(?=\D)/g, '$1')
    .replace(/(\.\d{3})\d+/g, '$1')
    .trim();
}

