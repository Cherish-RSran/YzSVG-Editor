import React from 'react';
import { store } from '../state/store';
import { SvgDoc, SvgNode } from '../core/types';
import { matToStr } from '../core/matrix';
import { ATTR_MAP, CSS_ONLY, camel } from '../core/attrMap';

function parseStyleString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[camel(k)] = v;
  }
  return out;
}

export function toSvgProps(attrs: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const style: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') {
      props.className = v;
      continue;
    }
    if (k === 'style') {
      Object.assign(style, parseStyleString(String(v)));
      continue;
    }
    if (CSS_ONLY.has(k)) {
      style[camel(k)] = String(v);
      continue;
    }
    props[ATTR_MAP[k] ?? k] = v;
  }
  if (Object.keys(style).length > 0) props.style = style;
  return props;
}

function tagOf(node: SvgNode): string {
  if (node.type === 'group') return 'g';
  if (node.type === 'unknown') return node.tag ?? 'g';
  return node.type;
}

export const NodeView: React.FC<{ doc: SvgDoc; id: string }> = ({ doc, id }) => {
  const node = doc.nodes[id];
  if (!node) return null;
  const t = matToStr(node.transform);
  const hidden = !node.visible;
  // 正在被就地编辑的文字要隐形，避免与编辑框叠出重影。
  // 必须用 visibility 而非 display:none —— 后者会让 getBBox() 返回 0，编辑框就会跳到左上角。
  const invisible = store.state.editingTextId === id;
  if (node.type === 'unknown') {
    return (
      <g
        data-id={id}
        transform={t || undefined}
        display={hidden ? 'none' : undefined}
        pointerEvents="all"
        dangerouslySetInnerHTML={{ __html: node.raw ?? '' }}
      />
    );
  }
  const props = toSvgProps({ ...node.attrs, ...(node.rawAttrs ?? {}) });
  const Tag = tagOf(node) as keyof React.JSX.IntrinsicElements;
  const fillRaw = (node.attrs['fill'] ?? node.rawAttrs?.['fill'] ?? '')
    .toString()
    .trim()
    .toLowerCase();
  const needHit = fillRaw === '' || fillRaw === 'none' || fillRaw === 'transparent';
  const common: Record<string, unknown> = {
    ...props,
    'data-id': id,
    transform: t || undefined,
    display: hidden ? 'none' : undefined,
    visibility: invisible ? 'hidden' : undefined,
    // 文字用 bounding-box：默认只有字形笔画能点中，字间空隙与行距会穿透
    ...(node.type === 'text' ? { pointerEvents: 'bounding-box' } : needHit ? { pointerEvents: 'all' } : null),
  };
  if (node.type === 'text') {
    if (node.pathId) {
      // pathId 可能是内部节点 id，也可能是 defs 中路径的原始 id
      const ref = doc.nodes[node.pathId];
      const href = ref ? ref.rawAttrs?.['id'] ?? ref.id : node.pathId;
      return React.createElement(
        Tag,
        common,
        React.createElement('textPath', { href: `#${href}`, key: 'tp' }, node.text ?? ''),
      );
    }
    return React.createElement(Tag, common, node.text ?? '');
  }
  const kids = node.children.map((c) => <NodeView key={c} doc={doc} id={c} />);
  if (kids.length === 0) return React.createElement(Tag, common);
  return React.createElement(Tag, common, kids);
};

export const DefsView: React.FC<{ doc: SvgDoc }> = ({ doc }) => {
  if (doc.defs.length === 0) return null;
  const raws = doc.defs.filter((d) => d.raw).map((d) => d.raw as string);
  return (
    <>
      <defs>
        {doc.defs
          .filter((d) => !d.raw)
          .map((d) => {
            if (d.kind === 'linearGradient' || d.kind === 'radialGradient') {
              const Tag = d.kind === 'linearGradient' ? 'linearGradient' : 'radialGradient';
              return React.createElement(
                Tag,
                { key: d.id, id: d.id, ...toSvgProps(d.attrs) },
                (d.stops ?? []).map((s, i) =>
                  React.createElement('stop', {
                    key: i,
                    offset: `${s.offset}%`,
                    stopColor: s.color,
                    stopOpacity: s.opacity ?? undefined,
                  }),
                ),
              );
            }
            return React.createElement(d.kind === 'other' ? 'g' : d.kind, {
              key: d.id,
              id: d.id,
              ...toSvgProps(d.attrs),
            });
          })}
      </defs>
      {raws.length > 0 && <defs dangerouslySetInnerHTML={{ __html: raws.join('\n') }} />}
    </>
  );
};
