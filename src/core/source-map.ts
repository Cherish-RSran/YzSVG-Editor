/**
 * 源码 ↔ 元素的双向定位。
 * 画布选中元素时要能在源码里圈出对应那一段；反过来点源码也要能知道点的是哪个元素。
 *
 * 前提：元素的「内部 id」必须和源码里写的 id 是同一个（parse 里沿用源文本 id 保证）。
 * 下面两个函数是为「万一不一致」兜底的，避免联动再次全线失效。
 */
import { SvgDoc } from './types';

/** 元素在源码里用的那个 id */
export function sourceIdOf(doc: SvgDoc, id: string): string {
  return doc.nodes[id]?.rawAttrs?.id ?? id;
}

/** 源码里的 id 反查内部节点 id：多数就是它自己，导入件里可能挂在 rawAttrs.id 上 */
export function nodeIdOf(doc: SvgDoc, sid: string): string | null {
  if (doc.nodes[sid]) return sid;
  for (const nid in doc.nodes) {
    if (doc.nodes[nid].rawAttrs?.id === sid) return nid;
  }
  return null;
}

/** 源码里某个 id 对应元素的字符范围：从 '<' 起，到 '>' 或 '/>' 止 */
export function rangeOfId(text: string, id: string): { from: number; to: number } | null {
  const at = text.indexOf(`id="${id}"`);
  if (at < 0) return null;
  const start = text.lastIndexOf('<', at);
  if (start < 0) return null;
  const gt = text.indexOf('>', at);
  if (gt < 0) return null;
  const self = text.indexOf('/>', at);
  return { from: start, to: self >= 0 && self < gt ? self + 2 : gt + 1 };
}

/** 光标落在哪个元素里：往前找最近的开标签，取它的 id（闭合标签返回 null） */
export function idAtCursor(text: string, pos: number): string | null {
  // 注意是 lastIndexOf('<', pos) 而不是 pos-1：点在标签开头的 '<' 上（很常见）
  // 时，pos-1 会跳到上一个元素去，用户就会觉得"点了没反应 / 选中的是别的"。
  const open = text.lastIndexOf('<', Math.min(pos, text.length - 1));
  if (open < 0) return null;
  // 只看到当前这个标签结束：否则窗口会跨到下一个标签，把别的元素 id 认成自己的
  const gt = text.indexOf('>', open);
  const seg = text.slice(open, gt < 0 ? open + 300 : gt + 1);
  if (seg.startsWith('</')) return null;
  const m = /id="([^"]+)"/.exec(seg);
  return m ? m[1] : null;
}
