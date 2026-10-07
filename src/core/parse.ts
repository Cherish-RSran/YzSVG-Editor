import { parseTransform } from './matrix';
import { createNode, insertNode } from './model';
import { DefEntry, NodeType, SvgDoc, emptyDoc } from './types';
import { ALLOWED_ELEMENTS, RAW_ELEMENTS, sanitizeTree, SanitizeResult } from './sanitize';

export interface ParseResult {
  doc: SvgDoc;
  warnings: string[];
  sanitize: SanitizeResult;
}

const TAG_TO_TYPE: Record<string, NodeType> = {
  g: 'group',
  rect: 'rect',
  circle: 'circle',
  ellipse: 'ellipse',
  line: 'line',
  polyline: 'polyline',
  polygon: 'polygon',
  path: 'path',
  text: 'text',
  image: 'image',
  use: 'use',
};

const DEF_TAGS: Record<string, DefEntry['kind']> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  pattern: 'pattern',
  clippath: 'clipPath',
  mask: 'mask',
  marker: 'marker',
};

function num(v: string | null | undefined, fallback: number): number {
  if (v === undefined || v === null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseViewBox(v: string | null | undefined, w: number, h: number): [number, number, number, number] {
  if (!v) return [0, 0, w, h];
  const parts = v.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
    return [parts[0], parts[1], parts[2], parts[3]];
  }
  return [0, 0, w, h];
}

function attrRecord(el: Element, skip: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (skip.has(a.name.toLowerCase())) continue;
    out[a.name] = a.value;
  }
  return out;
}

/** 把 style="a:b;c:d" 解析成属性表（kebab-case 原样保留） */
function parseStyleToAttrs(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/** 解析 SVG 文本为文档模型（含安全消毒） */
export function parseSvg(text: string): ParseResult {
  const warnings: string[] = [];
  const parser = new DOMParser();
  const dom = parser.parseFromString(text, 'image/svg+xml');
  const svgEl = dom.documentElement;
  if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
    throw new Error('不是合法的 SVG 文件');
  }
  if (dom.querySelector('parsererror')) {
    throw new Error('SVG 解析失败：文件可能存在语法错误');
  }
  const sanitize = sanitizeTree(svgEl);

  const width = num(svgEl.getAttribute('width'), 800);
  const height = num(svgEl.getAttribute('height'), 600);
  const viewBox = parseViewBox(svgEl.getAttribute('viewBox'), width, height);
  const doc = emptyDoc(
    Number.isFinite(width) && width > 0 ? width : 800,
    Number.isFinite(height) && height > 0 ? height : 600,
  );
  doc.viewBox = viewBox;
  doc.rootAttrs = attrRecord(
    svgEl,
    new Set(['width', 'height', 'viewbox', 'xmlns', 'xmlns:xlink', 'style']),
  );

  // 提取 defs
  const defsEls = Array.from(svgEl.querySelectorAll('defs'));
  const defContainers: Element[] = [...defsEls, svgEl];
  const collectedDefIds = new Set<string>();
  for (const container of defContainers) {
    for (const child of Array.from(container.children)) {
      const tag = child.tagName.toLowerCase();
      if (DEF_TAGS[tag] || RAW_ELEMENTS.has(tag)) {
        const id = child.getAttribute('id') || '';
        if (id && collectedDefIds.has(id)) continue;
        const kind = DEF_TAGS[tag] ?? 'other';
        const entry: DefEntry = {
          id: id || `def_${doc.defs.length}`,
          kind,
          attrs: attrRecord(child, new Set(['id'])),
          raw: kind === 'other' ? child.outerHTML : undefined,
        };
        if (kind === 'linearGradient' || kind === 'radialGradient') {
          entry.stops = Array.from(child.querySelectorAll('stop')).map((s) => ({
            offset: num(s.getAttribute('offset')?.replace('%', ''), 0),
            color: s.getAttribute('stop-color') || s.getAttribute('style')?.match(/stop-color:\s*([^;]+)/)?.[1]?.trim() || '#000000',
            opacity: s.getAttribute('stop-opacity') ? num(s.getAttribute('stop-opacity') ?? '1', 1) : undefined,
          }));
          if (entry.stops.length === 0) {
            entry.stops = [
              { offset: 0, color: '#cccccc' },
              { offset: 100, color: '#999999' },
            ];
          }
        }
        if (!child.getAttribute('id')) child.setAttribute('id', entry.id);
        doc.defs.push(entry);
        if (id) collectedDefIds.add(id);
      }
    }
  }

  const skipDefs = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    return (DEF_TAGS[tag] || RAW_ELEMENTS.has(tag)) && el.closest('defs') !== null;
  };

  // 解析 <style> 标签里的 CSS class 规则（Figma/AI 导出大量使用）
  const classRules = new Map<string, Record<string, string>>();
  svgEl.querySelectorAll('style').forEach((st) => {
    const css = st.textContent ?? '';
    const re = /\.([A-Za-z0-9_\-]+)\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const cls = m[1];
      const body = m[2].replace(/\/\*[\s\S]*?\*\//g, '');
      classRules.set(cls, { ...(classRules.get(cls) ?? {}), ...parseStyleToAttrs(body) });
    }
  });

  /**
   * 本文档里已经用掉的 id。
   * 「源码 ↔ 元素」的双向定位是靠 id 做的（core/source-map.ts）：选中元素要在源码里圈出
   * 那一段、点源码要反查是哪个元素。所以**解析时必须沿用源文本自带的 id 当内部 id**——
   * 否则内部 id 是新生成的一串，源码里写的还是原来那个，两边永远对不上，
   * 表现就是「改过代码 / 导入过 SVG / 恢复过自动保存之后，联动全线失效」。
   */
  const usedIds = new Set<string>([doc.rootId]);

  const walk = (el: Element, parentId: string) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'defs') continue;
      if (skipDefs(child)) continue;
      if (RAW_ELEMENTS.has(tag)) {
        const node = createNode('unknown', {});
        node.raw = child.outerHTML;
        node.tag = child.tagName;
        node.name = child.tagName;
        node.attrs = {};
        insertNode(doc, node, parentId);
        continue;
      }
      if (!ALLOWED_ELEMENTS.has(tag)) {
        warnings.push(`不支持的元素已忽略：${child.tagName}`);
        continue;
      }
      if (tag === 'title' || tag === 'desc') continue;
      const type = TAG_TO_TYPE[tag] ?? 'unknown';
      const attrs = attrRecord(child, new Set(['transform', 'id', 'style', 'display']));
      // 把内联 style 展开成 attrs（字体信息由此进入可编辑属性）
      const styleAttr = child.getAttribute('style');
      if (styleAttr) Object.assign(attrs, parseStyleToAttrs(styleAttr));
      // 合并 <style> 标签里的 class 规则（优先级：内联 style > class 规则 > 元素属性）
      const clsAttr = child.getAttribute('class');
      if (clsAttr) {
        const unresolved: string[] = [];
        for (const c of clsAttr.split(/\s+/)) {
          if (!c) continue;
          const r = classRules.get(c);
          if (r) {
            for (const [k, v] of Object.entries(r)) if (!(k in attrs)) attrs[k] = v;
          } else {
            unresolved.push(c); // 复合选择器等未能解析的 class 原样保留，避免丢样式
          }
        }
        // 已展开成属性的 class 必须移除：CSS 类规则优先级高于呈现属性，
        // 留着它会压过用户在面板里的后续修改（改字号看不见变化）
        if (unresolved.length > 0) attrs['class'] = unresolved.join(' ');
        else delete attrs['class'];
      }
      const idAttr = child.getAttribute('id');
      const node = createNode(type, attrs);
      node.tag = child.tagName;
      // id 没撞车就直接沿用源文本里的 id（让内部 id 与源码 id 一致，见上）；
      // 撞车了（文件里有重复 id、或和已生成的 id 重合）才退回新 id，
      // 并且**不写 rawAttrs.id**，这样序列化写出来的就是新的内部 id，仍然对得上。
      if (idAttr && /^[A-Za-z_][\w.:-]*$/.test(idAttr) && !usedIds.has(idAttr)) {
        node.id = idAttr;
        node.rawAttrs = { ...(node.rawAttrs ?? {}), id: idAttr };
      }
      usedIds.add(node.id);
      node.transform = parseTransform(child.getAttribute('transform') ?? '');
      if (child.getAttribute('display') === 'none') node.visible = false;
      if (type === 'text') {
        const tp = child.querySelector('textPath');
        if (tp) {
          const href = (tp.getAttribute('href') || tp.getAttribute('xlink:href') || '').replace(/^#/, '');
          node.pathId = href || undefined;
        }
        node.text = child.textContent ?? '';
        // style 内容已展开进 attrs，只保留 attrs 中没有的键，避免 rawAttrs.style 覆盖用户后续编辑
        if (styleAttr) {
          const all = parseStyleToAttrs(styleAttr);
          const rest: Record<string, string> = {};
          for (const [k, v] of Object.entries(all)) if (!(k in attrs)) rest[k] = v;
          if (Object.keys(rest).length > 0) {
            node.rawAttrs = { ...(node.rawAttrs ?? {}), style: Object.entries(rest).map(([k, v]) => `${k}:${v}`).join(';') };
          }
        }
      }
      insertNode(doc, node, parentId);
      if (type === 'text') {
        // tspan 暂不结构化，作为 text 内容的一部分
        const tspanCount = child.querySelectorAll('tspan').length;
        if (tspanCount > 0) warnings.push(`文本中的 ${tspanCount} 个 tspan 已合并为纯文本`);
      }
      if (child.children.length > 0 && type !== 'text') {
        walk(child, node.id);
      }
    }
  };
  walk(svgEl, doc.rootId);

  // textPath 引用的是原始 id，映射到内部节点 id
  const idMap = new Map<string, string>();
  for (const n of Object.values(doc.nodes)) {
    const rid = n.rawAttrs?.['id'];
    if (rid) idMap.set(rid, n.id);
  }
  for (const n of Object.values(doc.nodes)) {
    if (n.pathId && idMap.has(n.pathId)) n.pathId = idMap.get(n.pathId);
  }

  return { doc, warnings, sanitize };
}

/** 从 File 读取文本 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

