import { ATTR_MAP } from '../core/attrMap';

/** 把标准 SVG 字符串转成 React JSX 片段（属性名改为驼峰） */
export function svgToJsxBody(svg: string, indent = '      '): string {
  const parser = new DOMParser();
  const dom = parser.parseFromString(svg, 'image/svg+xml');
  const root = dom.documentElement;
  if (!root) return '';

  const serialize = (el: Element, depth: number): string => {
    const pad = indent + '  '.repeat(depth);
    const tag = el.tagName;
    const attrs: string[] = [];
    for (const a of Array.from(el.attributes)) {
      const name = a.name;
      if (name === 'xmlns' || name === 'xmlns:xlink') continue;
      if (/^on/i.test(name)) continue;
      const key = ATTR_MAP[name] ?? (/^[a-z]+(-[a-z]+)+$/.test(name) ? toCamel(name) : name);
      attrs.push(`${key}=${JSON.stringify(a.value)}`);
    }
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    const kids = Array.from(el.children);
    if (kids.length === 0) {
      if ((el.textContent ?? '').trim()) {
        return `${pad}${open}>${el.textContent ?? ''}</${tag}>`;
      }
      return `${pad}${open} />`;
    }
    const inner = kids.map((c) => serialize(c, depth + 1)).join('\n');
    return `${pad}${open}>\n${inner}\n${pad}</${tag}>`;
  };
  return serialize(root, 0);
}

function toCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function toReactComponent(svg: string, name = 'SvgIcon'): string {
  const body = svgToJsxBody(svg, '      ');
  return `import React from 'react';

export function ${name}(props: React.SVGProps<SVGSVGElement>) {
  return (
    ${body.startsWith('      ') ? body.replace(/^ {6}/, '') : body}
  );
}

export default ${name};
`;
}

export function toVueComponent(svg: string, name = 'SvgIcon'): string {
  const body = svgToJsxBody(svg, '    ');
  return `<template>
${body}
</template>

<script setup lang="ts">
defineOptions({ name: '${name}' });
</script>
`;
}

export function toDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/%20/g, ' ')
    .replace(/%3D/g, '=')
    .replace(/%3A/g, ':')
    .replace(/%2F/g, '/')
    .replace(/%22/g, "'");
  return `data:image/svg+xml;utf8,${encoded}`;
}

export function toBase64(svg: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(svg)));
  }
  return Buffer.from(svg, 'utf8').toString('base64');
}

export function toBase64Uri(svg: string): string {
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

export function toCssBackground(svg: string): string {
  return `.icon {\n  background-image: url("${toDataUri(svg)}");\n  background-repeat: no-repeat;\n}\n`;
}

export function toHtmlSnippet(svg: string): string {
  return `<!-- 直接粘贴到 HTML 中使用 -->\n${svg}\n`;
}
