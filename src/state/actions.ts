import {
  History,
  makeAddCommand,
  makeDeleteCommand,
  makePatchCommand,
  makeStructuralCommand,
  snapshotSubtree,
} from '../core/history';
import {
  cloneSubtree,
  createNode,
  deleteNode,
  detachNode,
  groupNodes,
  insertNode,
  isAncestor,
  isLockedChain,
  moveNode,
  reorderNode,
  subtreeIds,
  ungroupNode,
  newId,
} from '../core/model';
import { mul, translation, invert, scaling, rotation, rotationOf } from '../core/matrix';
import { nodeBBox, parentWorldMatrix, selectionBBox, Box } from '../core/geometry';
import { computeAlignDeltas, computeDistributeDeltas, toParentDelta, AlignMode } from '../core/align';
import { buildBooleanNode, booleanOp, BoolOp } from '../core/boolean';
import { DefEntry } from '../core/types';
import { fitView } from '../core/view';
import { SvgDoc, SvgNode, ToolId, emptyDoc } from '../core/types';
import { store, notify } from './store';
import { tf, currentLang } from '../i18n';

type Snapshot = Pick<SvgNode, 'transform' | 'attrs' | 'text' | 'name' | 'visible' | 'locked'>;

function snap(n: SvgNode): Snapshot {
  return {
    transform: { ...n.transform },
    attrs: { ...n.attrs },
    text: n.text,
    name: n.name,
    visible: n.visible,
    locked: n.locked,
  };
}

interface Transaction {
  label: string;
  before: Map<string, Snapshot>;
  ids: string[];
}

let pending: Transaction | null = null;

/** 开始一个可合并的事务（拖拽、连续输入等只产生一条撤销记录） */
export function beginTransaction(label: string, ids: string[]): void {
  const doc = store.state.doc;
  const before = new Map<string, Snapshot>();
  for (const id of ids) {
    const n = doc.nodes[id];
    if (n) before.set(id, snap(n));
  }
  pending = { label, before, ids };
}

/** 提交事务，产生一条撤销命令 */
export function commitTransaction(): void {
  if (!pending) return;
  const doc = store.state.doc;
  const patches = [];
  for (const [id, before] of pending.before) {
    const n = doc.nodes[id];
    if (!n) continue;
    const after = snap(n);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    patches.push({ id, before, after });
  }
  if (patches.length > 0) {
    store.history.push(makePatchCommand(doc, pending.label, patches));
  }
  pending = null;
  store.bump();
}

/** 直接修改节点（事务内或独立命令） */
export function patchNode(id: string, patch: Partial<SvgNode>, label = '修改属性'): void {
  const doc = store.state.doc;
  const node = doc.nodes[id];
  if (!node) return;
  const before = snap(node);
  Object.assign(node, patch);
  if (patch.attrs) node.attrs = { ...patch.attrs };
  const after = snap(node);
  if (pending && pending.before.has(id)) {
    store.bump();
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    store.history.push(makePatchCommand(doc, label, [{ id, before, after }]));
  }
  store.bump();
}

/** 修改属性字典中的若干键 */
export function setAttrs(ids: string[], attrs: Record<string, string>, label = '修改样式'): void {
  const doc = store.state.doc;
  const patches = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    const before = snap(node);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === '' || v === null || v === undefined) delete node.attrs[k];
      else node.attrs[k] = v;
    }
    const after = snap(node);
    if (JSON.stringify(before) !== JSON.stringify(after)) patches.push({ id, before, after });
  }
  if (patches.length > 0 && !pending) {
    store.history.push(makePatchCommand(doc, label, patches));
  }
  store.bump();
}

// ---------- 选择 ----------

// 「保持横纵比」是每次选择后的临时偏好：换一批选中元素就恢复默认勾选，
// 否则用户取消过一次，之后选任何元素都还是取消状态。
function keepAspectDefault() {
  return { keepAspect: true };
}

export function setSelection(ids: string[]): void {
  store.set({ selection: ids, ...keepAspectDefault() });
}

export function selectOnly(id: string | null): void {
  store.set({ selection: id ? [id] : [], ...keepAspectDefault() });
}

export function toggleSelection(id: string): void {
  const sel = store.state.selection;
  store.set({
    selection: sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id],
    ...keepAspectDefault(),
  });
}

export function selectAll(): void {
  const doc = store.state.doc;
  const root = doc.nodes[doc.rootId];
  store.set({ selection: [...root.children], ...keepAspectDefault() });
}

// ---------- 结构 ----------

export function addNode(node: SvgNode, parentId?: string, label = '新增元素'): string {
  const doc = store.state.doc;
  const pid = parentId ?? doc.rootId;
  const parent = doc.nodes[pid];
  if (!parent) return node.id;
  const index = parent.children.length;
  insertNode(doc, node, pid);
  store.history.push(
    makeAddCommand(doc, label, [{ nodes: [node], parentId: pid, index }]),
  );
  store.set({ selection: [node.id] });
  return node.id;
}

export function deleteSelection(): void {
  const doc = store.state.doc;
  const ids = store.state.selection.filter((id) => id !== doc.rootId && doc.nodes[id]);
  if (ids.length === 0) return;
  const snaps = ids
    .map((id) => snapshotSubtree(doc, id))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  if (snaps.length === 0) return;
  for (const id of ids) deleteNode(doc, id);
  store.history.push(makeDeleteCommand(doc, `删除 ${ids.length} 个元素`, snaps));
  store.set({ selection: [] });
}

/**
 * 清空画布：删掉画板下所有元素（含分组），并把画板重新适应到窗口。
 * 走一条删除命令，所以 Ctrl+Z 一次就能全部回来 —— 一键清空不该让人不敢点。
 */
export function clearCanvas(): void {
  const doc = store.state.doc;
  const root = doc.nodes[doc.rootId];
  if (!root) return;
  if (root.children.length === 0) {
    fitToViewport();
    notify(tf('msg_clear_empty', currentLang()), 'info');
    return;
  }
  const ids = [...root.children];
  const snaps = ids
    .map((id) => snapshotSubtree(doc, id))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  if (snaps.length === 0) return;
  for (const id of ids) deleteNode(doc, id);
  store.history.push(makeDeleteCommand(doc, `清空画布（${ids.length} 个元素）`, snaps));
  store.set({ selection: [], pathEditId: null });
  fitToViewport();
  notify(tf('msg_clear_canvas', currentLang(), { n: String(ids.length) }), 'success');
}

export function duplicateSelection(): void {
  const doc = store.state.doc;
  const ids = store.state.selection.filter((id) => doc.nodes[id] && id !== doc.rootId);
  if (ids.length === 0) return;
  const newIds: string[] = [];
  const snaps = [];
  for (const id of ids) {
    const parentId = doc.nodes[id].parent as string;
    const parent = doc.nodes[parentId];
    const index = parent.children.length;
    const newId = cloneSubtree(doc, id);
    if (!newId) continue;
    const cloned: SvgNode = doc.nodes[newId];
    // 位移 10px 便于看到副本
    const delta = toParentDelta(doc, id, 10, 10);
    cloned.transform = mul(translation(delta.dx, delta.dy), cloned.transform);
    cloned.name = `${doc.nodes[id].name} 副本`;
    insertNode(doc, cloned, parentId);
    newIds.push(newId);
    snaps.push({ nodes: subtreeIds(doc, newId).map((i) => doc.nodes[i]), parentId, index });
  }
  store.history.push(makeAddCommand(doc, '复制', snaps));
  store.set({ selection: newIds });
}

export function groupSelection(): void {
  const doc = store.state.doc;
  const ids = store.state.selection.filter((id) => doc.nodes[id] && id !== doc.rootId);
  if (ids.length === 0) return;
  const parents = new Set(ids.map((id) => doc.nodes[id].parent));
  if (parents.size !== 1) {
    notify(tf('msg_group_need_same', currentLang()), 'error');
    return;
  }
  let gid: string | null = null;
  const doGroup = () => {
    gid = groupNodes(doc, ids);
    if (gid) store.set({ selection: [gid] });
  };
  const undoGroup = () => {
    if (!gid) return;
    ungroupNode(doc, gid);
    gid = null;
    store.set({ selection: ids });
  };
  doGroup();
  if (!gid) return;
  store.history.push({ label: '编组', redo: doGroup, undo: undoGroup });
}

export function ungroupSelection(): void {
  const doc = store.state.doc;
  const ids = store.state.selection.filter((id) => doc.nodes[id]?.type === 'group');
  if (ids.length === 0) {
    notify(tf('msg_need_group', currentLang()), 'error');
    return;
  }
  const snaps = ids
    .map((id) => snapshotSubtree(doc, id))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const doUngroup = () => {
    const kids: string[] = [];
    for (const s of snaps) {
      const got = ungroupNode(doc, s.nodes[0].id);
      if (got) kids.push(...got);
    }
    store.set({ selection: kids });
  };
  const undoUngroup = () => {
    for (const s of snaps) {
      const parent = doc.nodes[s.parentId];
      // 先把散落到父级的子节点摘掉，再把组放回原位
      if (parent) {
        for (const n of s.nodes) {
          const i = parent.children.indexOf(n.id);
          if (i >= 0) parent.children.splice(i, 1);
        }
      }
      for (const n of s.nodes) {
        doc.nodes[n.id] = {
          ...n,
          children: [...n.children],
          attrs: { ...n.attrs },
          transform: { ...n.transform },
          rawAttrs: n.rawAttrs ? { ...n.rawAttrs } : undefined,
        };
      }
      if (parent) {
        parent.children.splice(Math.min(s.index, parent.children.length), 0, s.nodes[0].id);
      }
    }
    store.set({ selection: snaps.map((s) => s.nodes[0].id) });
  };
  doUngroup();
  store.history.push({ label: '解组', redo: doUngroup, undo: undoUngroup });
}

/** 布尔运算：把选中的多个形状合并为一个路径 */
export function applyBoolean(op: BoolOp): void {
  const doc = store.state.doc;
  const ids = store.state.selection.filter((id) => doc.nodes[id] && id !== doc.rootId);
  if (ids.length < 2) {
    notify('布尔运算需要至少 2 个元素', 'error');
    return;
  }
  const node = buildBooleanNode(doc, ids, op);
  if (!node) {
    notify('布尔运算失败：这些形状可能无法运算（请确认它们有重叠区域）', 'error');
    return;
  }
  const parentId = doc.nodes[ids[0]].parent ?? doc.rootId;
  const parent = doc.nodes[parentId];
  const index = parent.children.indexOf(ids[0]);
  const snaps = ids.map((id) => snapshotSubtree(doc, id)).filter((s): s is NonNullable<typeof s> => s !== null);
  const doOp = () => {
    for (const id of ids) if (doc.nodes[id]) deleteNode(doc, id);
    insertNode(doc, node, parentId, index);
    store.set({ selection: [node.id] });
  };
  const undoOp = () => {
    if (doc.nodes[node.id]) deleteNode(doc, node.id);
    for (const s of snaps) {
      for (const n of s.nodes) {
        doc.nodes[n.id] = {
          ...n,
          children: [...n.children],
          attrs: { ...n.attrs },
          transform: { ...n.transform },
          rawAttrs: n.rawAttrs ? { ...n.rawAttrs } : undefined,
        };
      }
      const p = doc.nodes[s.parentId];
      if (p && !p.children.includes(s.nodes[0].id)) {
        p.children.splice(Math.min(s.index, p.children.length), 0, s.nodes[0].id);
      }
    }
    store.set({ selection: ids.filter((id) => doc.nodes[id]) });
  };
  doOp();
  store.history.push({ label: `布尔·${op}`, redo: doOp, undo: undoOp });
  const names: Record<BoolOp, string> = { union: '并集', subtract: '差集', intersect: '交集', exclude: '排除' };
  notify(`已执行${names[op]}运算`, 'success');
}

/** 剪切蒙版：用最上面的形状裁剪下面的元素 */
export function applyClip(): void {
  const doc = store.state.doc;
  const ids = store.state.selection.filter((id) => doc.nodes[id] && id !== doc.rootId);
  if (ids.length < 2) {
    notify('请先选择裁剪形状（最上层）和被裁剪的元素', 'error');
    return;
  }
  const clipSourceId = ids[ids.length - 1];
  const targetIds = ids.slice(0, -1);
  const clipId = `clip_${newId('')}`;
  const src = doc.nodes[clipSourceId];
  const rings = nodeRingsOf(doc, src);
  if (!rings) {
    notify('裁剪形状无法转换为裁剪路径', 'error');
    return;
  }
  const before = targetIds.map((id) => ({ id, clip: doc.nodes[id].attrs['clip-path'] }));
  const entry: DefEntry = {
    id: clipId,
    kind: 'clipPath',
    attrs: {},
    raw: `<clipPath id="${clipId}"><path d="${rings}"/></clipPath>`,
  };
  const doOp = () => {
    if (!doc.defs.some((d) => d.id === clipId)) doc.defs.push(entry);
    for (const id of targetIds) doc.nodes[id].attrs['clip-path'] = `url(#${clipId})`;
    store.bump();
  };
  const undoOp = () => {
    const i = doc.defs.findIndex((d) => d.id === clipId);
    if (i >= 0) doc.defs.splice(i, 1);
    for (const b of before) {
      if (b.clip === undefined) delete doc.nodes[b.id].attrs['clip-path'];
      else doc.nodes[b.id].attrs['clip-path'] = b.clip;
    }
    store.bump();
  };
  doOp();
  store.history.push({ label: '剪切蒙版', redo: doOp, undo: undoOp });
  notify('已应用剪切蒙版', 'success');
}

function nodeRingsOf(doc: SvgDoc, node: SvgNode): string | null {
  // 用「自身与自身求并集」得到该形状在世界坐标系下的路径数据
  return booleanOp(doc, [node.id, node.id], 'union');
}

export function reorderSelection(op: 'up' | 'down' | 'top' | 'bottom'): void {
  const doc = store.state.doc;
  const ids = store.state.selection;
  if (ids.length === 0) return;
  const before = ids.map((id) => ({ id, parentId: doc.nodes[id]?.parent, index: -1 }));
  for (const b of before) {
    if (b.parentId) b.index = doc.nodes[b.parentId].children.indexOf(b.id);
  }
  for (const id of ids) reorderNode(doc, id, op);
  store.history.push(
    makeStructuralCommand(
      doc,
      '调整层级',
      () => {
        for (const id of ids) reorderNode(doc, id, op);
      },
      () => {
        for (const b of before) {
          if (!b.parentId) continue;
          const parent = doc.nodes[b.parentId];
          if (!parent) continue;
          const cur = parent.children.indexOf(b.id);
          if (cur >= 0) parent.children.splice(cur, 1);
          parent.children.splice(b.index, 0, b.id);
        }
      },
    ),
  );
  store.bump();
}

export function moveNodeAction(id: string, newParentId: string, newIndex: number): void {
  const doc = store.state.doc;
  if (!doc.nodes[id] || !doc.nodes[newParentId]) return;
  if (isAncestor(doc, id, newParentId)) return;
  const oldParentId = doc.nodes[id].parent as string;
  const oldIndex = doc.nodes[oldParentId]?.children.indexOf(id) ?? 0;
  moveNode(doc, id, newParentId, newIndex);
  store.history.push(
    makeStructuralCommand(
      doc,
      '移动图层',
      () => moveNode(doc, id, newParentId, newIndex),
      () => moveNode(doc, id, oldParentId, oldIndex),
    ),
  );
  store.bump();
}

export function toggleVisible(id: string): void {
  const doc = store.state.doc;
  const n = doc.nodes[id];
  if (!n) return;
  patchNode(id, { visible: !n.visible }, '显示/隐藏');
}

export function toggleLock(id: string): void {
  const doc = store.state.doc;
  const n = doc.nodes[id];
  if (!n) return;
  patchNode(id, { locked: !n.locked }, '锁定/解锁');
}

export function renameNode(id: string, name: string): void {
  patchNode(id, { name }, '重命名');
}

// ---------- 变换 ----------

/** 世界坐标位移（自动换算到各自的父坐标系） */
export function translateNodes(ids: string[], dx: number, dy: number): void {
  const doc = store.state.doc;
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || isLockedChain(doc, id)) continue;
    const d = toParentDelta(doc, id, dx, dy);
    node.transform = mul(translation(d.dx, d.dy), node.transform);
  }
  store.bump();
}

/** 以世界坐标的锚点为中心缩放 */
export function scaleNodes(ids: string[], sx: number, sy: number, anchor: { x: number; y: number }): void {
  const doc = store.state.doc;
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || isLockedChain(doc, id)) continue;
    const inv = invert(parentWorldMatrix(doc, id));
    const a = { x: anchor.x, y: anchor.y };
    const local = { x: inv.a * a.x + inv.c * a.y + inv.e, y: inv.b * a.x + inv.d * a.y + inv.f };
    const s = scaling(sx, sy);
    const t1 = translation(local.x, local.y);
    const t2 = translation(-local.x, -local.y);
    node.transform = mul(mul(mul(t1, s), t2), node.transform);
  }
  store.bump();
}

/** 缩放后补偿 stroke-width，使其视觉粗细保持不变（Figma/Illustrator 默认行为） */
export function compensateStrokeWidth(ids: string[], k: number, originals: Map<string, string | undefined>): void {
  const doc = store.state.doc;
  if (!Number.isFinite(k) || k <= 0) return;
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    const orig = originals.get(id);
    if (orig !== undefined) {
      // orig 可能是 '' 表示原本没有该属性；只有原本有描边（stroke 存在且非 none）才补偿
      const stroke = n.attrs['stroke'];
      const hasStroke = stroke !== undefined && stroke !== 'none';
      if (hasStroke) {
        const base = orig === '' ? 1 : parseFloat(orig);
        if (Number.isFinite(base)) n.attrs['stroke-width'] = String(base / k);
      }
    }
    for (const c of n.children) walk(c);
  };
  for (const id of ids) walk(id);
  store.bump();
}

/** 选区旋转角（度）——**永远从每个节点自己的 transform 反解**，不另存状态。
 *  单选 = 该元素自身的角度；多选时若所有元素角度一致就返回这个值（它就是「每个要素的角度」），
 *  不一致返回 null（= 混合，面板显示「混合」而不是编一个数）。
 *  这样单选/多选看到的永远是要素真实的角度，不会出现「单选 50°、多选 20°」两套数。 */
export function selectionRotation(): number | null {
  const s = store.state;
  if (s.selection.length === 0) return null;
  let shared: number | null = null;
  for (const id of s.selection) {
    const n = s.doc.nodes[id];
    const a = n ? rotationOf(n.transform) : 0;
    if (shared === null) shared = a;
    else if (Math.abs(a - shared) > 1e-6) return null;
  }
  return shared;
}

/** 把每个节点的旋转角**设定为** deg（绝对值，不是增量）。
 *  面板里输入角度时用它：起始角度相同的一组元素转完角度相同；
 *  混合选区则会各自补上差额，全部对齐到 deg。 */
export function rotateNodesTo(ids: string[], deg: number, center: { x: number; y: number }): void {
  const doc = store.state.doc;
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || isLockedChain(doc, id)) continue;
    rotateNodes([id], deg - rotationOf(node.transform), center);
  }
  store.bump();
}

/** 让画板铺满当前视口，并把「适应」设为缩放的 100% 基准。
 *  导入 SVG / 恢复自动保存时用它——否则换了一份尺寸完全不同的文档，视图还停在上一份的比例上。 */
export function fitToViewport(): void {
  const el = typeof document === 'undefined' ? null : document.querySelector('.canvas-wrap') as HTMLElement | null;
  if (!el || el.clientWidth < 10 || el.clientHeight < 10) return; // jsdom / 未挂载时静默跳过
  const v = fitView(el.clientWidth, el.clientHeight, store.state.doc);
  store.set({ ...v, fitZoom: v.zoom });
}

/** 绕世界坐标中心旋转（增量角度） */
export function rotateNodes(ids: string[], deg: number, center: { x: number; y: number }): void {
  const doc = store.state.doc;
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || isLockedChain(doc, id)) continue;
    const inv = invert(parentWorldMatrix(doc, id));
    const c = {
      x: inv.a * center.x + inv.c * center.y + inv.e,
      y: inv.b * center.x + inv.d * center.y + inv.f,
    };
    node.transform = mul(rotation(deg, c.x, c.y), node.transform);
  }
  store.bump();
}

/** 设置选中元素的包围盒位置（左上角） */
export function setSelectionPos(x: number, y: number): void {
  const doc = store.state.doc;
  const ids = store.state.selection;
  if (ids.length === 0) return;
  const box = selectionBBox(doc, ids);
  translateNodes(ids, x - box.x, y - box.y);
}

/** 设置选中元素包围盒尺寸（以左上角为锚点缩放） */
export function setSelectionSize(w: number, h: number): void {
  const doc = store.state.doc;
  const ids = store.state.selection;
  if (ids.length === 0) return;
  const box = selectionBBox(doc, ids);
  if (box.w < 1e-6 || box.h < 1e-6) return;
  scaleNodes(ids, w / box.w, h / box.h, { x: box.x, y: box.y });
}

// ---------- 对齐与分布 ----------

export function alignSelection(mode: AlignMode): void {
  const doc = store.state.doc;
  const ids = store.state.selection;
  if (ids.length < 2) {
    if (ids.length === 1) alignToArtboard(mode);
    return;
  }
  beginTransaction('对齐', ids);
  const deltas = computeAlignDeltas(doc, ids, mode);
  for (const d of deltas) {
    const pd = toParentDelta(doc, d.id, d.dx, d.dy);
    const node = doc.nodes[d.id];
    if (node) node.transform = mul(translation(pd.dx, pd.dy), node.transform);
  }
  commitTransaction();
}

function alignToArtboard(mode: AlignMode): void {
  const doc = store.state.doc;
  const ids = store.state.selection;
  if (ids.length !== 1) return;
  const box = nodeBBox(doc, ids[0]);
  const art: Box = { x: doc.viewBox[0], y: doc.viewBox[1], w: doc.viewBox[2], h: doc.viewBox[3] };
  let dx = 0;
  let dy = 0;
  if (mode === 'left') dx = art.x - box.x;
  if (mode === 'hcenter') dx = art.x + art.w / 2 - (box.x + box.w / 2);
  if (mode === 'right') dx = art.x + art.w - (box.x + box.w);
  if (mode === 'top') dy = art.y - box.y;
  if (mode === 'vcenter') dy = art.y + art.h / 2 - (box.y + box.h / 2);
  if (mode === 'bottom') dy = art.y + art.h - (box.y + box.h);
  beginTransaction('对齐画板', ids);
  translateNodes(ids, dx, dy);
  commitTransaction();
}

export function distributeSelection(axis: 'h' | 'v'): void {
  const doc = store.state.doc;
  const ids = store.state.selection;
  if (ids.length < 3) {
    notify(tf('msg_need_three', currentLang()), 'error');
    return;
  }
  beginTransaction('分布', ids);
  const deltas = computeDistributeDeltas(doc, ids, axis);
  for (const d of deltas) {
    const pd = toParentDelta(doc, d.id, d.dx, d.dy);
    const node = doc.nodes[d.id];
    if (node) node.transform = mul(translation(pd.dx, pd.dy), node.transform);
  }
  commitTransaction();
}

// ---------- 历史 ----------

export function undo(): void {
  const cmd = store.history.undo();
  if (cmd) {
    store.set({ selection: store.state.selection.filter((id) => !!store.state.doc.nodes[id]) });
    notify(tf('msg_undone', currentLang(), { label: cmd.label }));
  }
}

export function redo(): void {
  const cmd = store.history.redo();
  if (cmd) notify(tf('msg_redone', currentLang(), { label: cmd.label }));
}

// ---------- 文档 ----------

export function replaceDoc(doc: SvgDoc, keepHistory = false): void {
  store.state.doc = doc;
  if (!keepHistory) store.history.clear();
  store.set({ selection: [], pathEditId: null, editingTextId: null });
}

export function newDocument(width = 800, height = 600): void {
  replaceDoc(emptyDoc(width, height));
  notify(tf('msg_new_doc', currentLang()), 'success');
}

export function setTool(tool: ToolId): void {
  store.set({ tool, editingTextId: null });
}

export { detachNode, isAncestor };
export type { History };

export function createShapeNode(type: SvgNode['type'], attrs: Record<string, string>): SvgNode {
  return createNode(type, attrs);
}
