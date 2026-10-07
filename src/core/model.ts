import { IDENTITY, NodeType, SvgDoc, SvgNode } from './types';

let counter = 0;
export function newId(prefix = 'n'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.floor(
    Math.random() * 1296,
  ).toString(36)}`;
}

export function createNode(type: NodeType, attrs: Record<string, string> = {}, text?: string): SvgNode {
  return {
    id: newId(type === 'group' ? 'g' : 'e'),
    type,
    name: defaultName(type),
    parent: null,
    children: [],
    attrs: { ...attrs },
    transform: { ...IDENTITY },
    visible: true,
    locked: false,
    text,
  };
}

export function defaultName(type: NodeType): string {
  switch (type) {
    case 'group':
      return '组';
    case 'rect':
      return '矩形';
    case 'circle':
      return '圆形';
    case 'ellipse':
      return '椭圆';
    case 'line':
      return '直线';
    case 'polyline':
      return '折线';
    case 'polygon':
      return '多边形';
    case 'path':
      return '路径';
    case 'text':
      return '文本';
    case 'image':
      return '图片';
    case 'use':
      return '引用';
    default:
      return '元素';
  }
}

/** 在 parentId 的 index 位置插入节点（index 省略则追加到末尾） */
export function insertNode(doc: SvgDoc, node: SvgNode, parentId: string, index?: number): void {
  const parent = doc.nodes[parentId];
  if (!parent) return;
  node.parent = parentId;
  doc.nodes[node.id] = node;
  if (index === undefined || index < 0 || index > parent.children.length) {
    parent.children.push(node.id);
  } else {
    parent.children.splice(index, 0, node.id);
  }
}

/** 从父节点摘下（不删除节点本身），返回其在父节点中的原索引 */
export function detachNode(doc: SvgDoc, id: string): { parentId: string; index: number } | null {
  const node = doc.nodes[id];
  if (!node || !node.parent) return null;
  const parent = doc.nodes[node.parent];
  if (!parent) return null;
  const index = parent.children.indexOf(id);
  if (index < 0) return null;
  parent.children.splice(index, 1);
  node.parent = null;
  return { parentId: parent.id, index };
}

/** 彻底删除节点及其子树 */
export function deleteNode(doc: SvgDoc, id: string): void {
  const node = doc.nodes[id];
  if (!node) return;
  for (const c of [...node.children]) deleteNode(doc, c);
  detachNode(doc, id);
  delete doc.nodes[id];
}

export function subtreeIds(doc: SvgDoc, id: string, out: string[] = []): string[] {
  const n = doc.nodes[id];
  if (!n) return out;
  out.push(id);
  for (const c of n.children) subtreeIds(doc, c, out);
  return out;
}

export function ancestorsOf(doc: SvgDoc, id: string): string[] {
  const out: string[] = [];
  let cur = doc.nodes[id];
  while (cur && cur.parent) {
    out.push(cur.parent);
    cur = doc.nodes[cur.parent];
  }
  return out;
}

export function isAncestor(doc: SvgDoc, maybeAncestor: string, id: string): boolean {
  return ancestorsOf(doc, id).includes(maybeAncestor);
}

/** 深拷贝子树（生成全新 id），返回新根 id */
export function cloneSubtree(doc: SvgDoc, id: string): string | null {
  const src = doc.nodes[id];
  if (!src) return null;
  const map: Record<string, string> = {};
  for (const sid of subtreeIds(doc, id)) {
    map[sid] = newId(doc.nodes[sid].type === 'group' ? 'g' : 'e');
  }
  for (const sid of subtreeIds(doc, id)) {
    const s = doc.nodes[sid];
    const copy: SvgNode = {
      ...s,
      id: map[sid],
      parent: s.parent ? map[s.parent] ?? s.parent : s.parent,
      children: s.children.map((c) => map[c] ?? c),
      attrs: { ...s.attrs },
      transform: { ...s.transform },
      rawAttrs: s.rawAttrs ? { ...s.rawAttrs } : undefined,
    };
    doc.nodes[copy.id] = copy;
  }
  return map[id];
}

/** 移动节点到新的父节点与索引位置（会处理同层索引偏移） */
export function moveNode(doc: SvgDoc, id: string, newParentId: string, newIndex: number): void {
  if (id === newParentId) return;
  if (isAncestor(doc, id, newParentId)) return;
  const detached = detachNode(doc, id);
  if (!detached) return;
  const parent = doc.nodes[newParentId];
  if (!parent) {
    // 回退
    insertNode(doc, doc.nodes[id], detached.parentId, detached.index);
    return;
  }
  let idx = newIndex;
  if (detached.parentId === newParentId && detached.index < newIndex) idx -= 1;
  idx = Math.max(0, Math.min(idx, parent.children.length));
  insertNode(doc, doc.nodes[id], newParentId, idx);
}

/** 将某节点在父层级中上移/下移/置顶/置底 */
export function reorderNode(doc: SvgDoc, id: string, op: 'up' | 'down' | 'top' | 'bottom'): void {
  const node = doc.nodes[id];
  if (!node || !node.parent) return;
  const parent = doc.nodes[node.parent];
  const i = parent.children.indexOf(id);
  const len = parent.children.length;
  let target = i;
  if (op === 'up') target = Math.min(len - 1, i + 1);
  else if (op === 'down') target = Math.max(0, i - 1);
  else if (op === 'top') target = len - 1;
  else target = 0;
  if (target === i) return;
  parent.children.splice(i, 1);
  parent.children.splice(target, 0, id);
}

/** 把一组节点打包成 group（保持它们在父节点中的相对顺序） */
export function groupNodes(doc: SvgDoc, ids: string[]): string | null {
  const valid = ids.filter((id) => doc.nodes[id] && doc.nodes[id].parent && id !== doc.rootId);
  if (valid.length === 0) return null;
  const parentIds = new Set(valid.map((id) => doc.nodes[id].parent as string));
  if (parentIds.size !== 1) return null;
  const parentId = [...parentIds][0];
  const parent = doc.nodes[parentId];
  // 按当前层级顺序排序
  valid.sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b));
  const insertAt = parent.children.indexOf(valid[0]);
  const g = createNode('group');
  const bboxLike = valid.map((id) => doc.nodes[id]);
  g.name = bboxLike.length === 1 ? bboxLike[0].name + ' 组' : `组 (${valid.length})`;
  for (const id of valid) {
    detachNode(doc, id);
    doc.nodes[id].parent = g.id;
    g.children.push(id);
  }
  doc.nodes[g.id] = g;
  insertNode(doc, g, parentId, insertAt);
  return g.id;
}

/** 解散 group：把子节点提上来替换该 group 的位置 */
export function ungroupNode(doc: SvgDoc, id: string): string[] | null {
  const g = doc.nodes[id];
  if (!g || g.type !== 'group' || !g.parent) return null;
  const parent = doc.nodes[g.parent];
  const index = parent.children.indexOf(id);
  const kids = [...g.children];
  for (const k of kids) {
    const child = doc.nodes[k];
    // 继承 group 的变换：把 group 的矩阵前乘到子节点上
    child.transform = mulTransform(g.transform, child.transform);
    detachNode(doc, k);
  }
  detachNode(doc, id);
  delete doc.nodes[id];
  parent.children.splice(index, 0, ...kids);
  for (const k of kids) doc.nodes[k].parent = parent.id;
  return kids;
}

function mulTransform(a: { a: number; b: number; c: number; d: number; e: number; f: number }, b: Mat2): Mat2 {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}
type Mat2 = { a: number; b: number; c: number; d: number; e: number; f: number };

export function isLockedChain(doc: SvgDoc, id: string): boolean {
  let cur: SvgNode | undefined = doc.nodes[id];
  while (cur) {
    if (cur.locked) return true;
    cur = cur.parent ? doc.nodes[cur.parent] : undefined;
  }
  return false;
}

