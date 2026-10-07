import { SvgDoc, SvgNode } from './types';
import { deleteNode, subtreeIds } from './model';

export interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

export interface NodePatch {
  id: string;
  before: Partial<SvgNode>;
  after: Partial<SvgNode>;
}

export interface SubtreeSnapshot {
  /** 子树全部节点（含根），保持原始 id */
  nodes: SvgNode[];
  parentId: string;
  index: number;
}

/** 深拷贝子树快照（保留 id 与父子关系） */
export function snapshotSubtree(doc: SvgDoc, id: string): SubtreeSnapshot | null {
  const node = doc.nodes[id];
  if (!node || !node.parent) return null;
  const parent = doc.nodes[node.parent];
  const ids = subtreeIds(doc, id);
  return {
    nodes: ids.map((i) => ({ ...doc.nodes[i], children: [...doc.nodes[i].children], attrs: { ...doc.nodes[i].attrs }, transform: { ...doc.nodes[i].transform }, rawAttrs: doc.nodes[i].rawAttrs ? { ...doc.nodes[i].rawAttrs } : undefined })),
    parentId: parent.id,
    index: parent.children.indexOf(id),
  };
}

function restoreSnapshot(doc: SvgDoc, snap: SubtreeSnapshot): void {
  const rootId = snap.nodes[0].id;
  for (const n of snap.nodes) {
    doc.nodes[n.id] = {
      ...n,
      children: [...n.children],
      attrs: { ...n.attrs },
      transform: { ...n.transform },
      rawAttrs: n.rawAttrs ? { ...n.rawAttrs } : undefined,
    };
  }
  const parent = doc.nodes[snap.parentId];
  if (!parent) return;
  const idx = Math.min(Math.max(snap.index, 0), parent.children.length);
  parent.children.splice(idx, 0, rootId);
  doc.nodes[rootId].parent = parent.id;
}

/** 属性变更命令 */
export function makePatchCommand(doc: SvgDoc, label: string, patches: NodePatch[]): Command {
  const apply = (dir: 'undo' | 'redo') => {
    for (const p of patches) {
      const node = doc.nodes[p.id];
      if (!node) continue;
      const src = dir === 'undo' ? p.before : p.after;
      Object.assign(node, src);
    }
  };
  return {
    label,
    redo: () => apply('redo'),
    undo: () => apply('undo'),
  };
}

/** 新增节点命令 */
export function makeAddCommand(doc: SvgDoc, label: string, snaps: SubtreeSnapshot[]): Command {
  return {
    label,
    redo: () => {
      for (const s of snaps) restoreSnapshot(doc, s);
    },
    undo: () => {
      for (const s of snaps) deleteNode(doc, s.nodes[0].id);
    },
  };
}

/** 删除节点命令 */
export function makeDeleteCommand(doc: SvgDoc, label: string, snaps: SubtreeSnapshot[]): Command {
  return {
    label,
    redo: () => {
      for (const s of snaps) deleteNode(doc, s.nodes[0].id);
    },
    undo: () => {
      for (const s of snaps) restoreSnapshot(doc, s);
    },
  };
}

/** 结构变更命令（移动、编组、解组等），用一对闭包描述 */
export function makeStructuralCommand(doc: SvgDoc, label: string, doFn: () => void, undoFn: () => void): Command {
  void doc;
  return { label, redo: doFn, undo: undoFn };
}

export class History {
  private stack: Command[] = [];
  private index = -1;
  limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  push(cmd: Command): void {
    this.stack.splice(this.index + 1);
    this.stack.push(cmd);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  /** 把最近一条命令替换为合并后的命令（用于拖拽等连续操作） */
  replaceLast(cmd: Command): void {
    if (this.index < 0) return;
    this.stack[this.index] = cmd;
  }

  undo(): Command | null {
    if (this.index < 0) return null;
    const cmd = this.stack[this.index];
    cmd.undo();
    this.index -= 1;
    return cmd;
  }

  redo(): Command | null {
    if (this.index >= this.stack.length - 1) return null;
    const cmd = this.stack[this.index + 1];
    cmd.redo();
    this.index += 1;
    return cmd;
  }

  get canUndo(): boolean {
    return this.index >= 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  get length(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack = [];
    this.index = -1;
  }

  nextLabel(): string | null {
    return this.index >= 0 ? this.stack[this.index].label : null;
  }
}

