import React, { useEffect, useState } from 'react';
import { store, useVersion } from '../state/store';
import { useT } from '../i18n';
import {
  moveNodeAction,
  renameNode,
  selectOnly,
  toggleLock,
  toggleVisible,
  setSelection,
} from '../state/actions';
import { SvgDoc, SvgNode } from '../core/types';
import { IconLockClosed, IconLockOpen } from './icons';

interface DropTarget {
  id: string;
  pos: 'before' | 'after' | 'inside';
}

/** 图层名后缀的类型标签：[中文, 英文]。名字在前、类型在后，如「左上角组1（组）」 */
const TYPE_LABEL: Record<string, [string, string]> = {
  rect: ['矩形', 'Rectangle'],
  ellipse: ['椭圆', 'Ellipse'],
  circle: ['圆形', 'Circle'],
  line: ['直线', 'Line'],
  polyline: ['折线', 'Polyline'],
  polygon: ['多边形', 'Polygon'],
  path: ['路径', 'Path'],
  text: ['文本', 'Text'],
  group: ['组', 'Group'],
  star: ['星形', 'Star'],
  image: ['图片', 'Image'],
  unknown: ['元素', 'Element'],
};

function typeLabel(type: string, lang: 'zh' | 'en'): string {
  const e = TYPE_LABEL[type];
  return e ? (lang === 'en' ? e[1] : e[0]) : type;
}

const LayersPanel: React.FC<{ onCollapse?: () => void }> = ({ onCollapse }) => {
  useVersion();
  const t = useT();
  const doc = store.state.doc;
  const selection = store.state.selection;
  const lang = store.state.lang;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Shift 连选的起点：上次点过的那一行 */
  const [anchor, setAnchor] = useState<string | null>(null);

  // 选中的元素如果滚出了图层面板可视区，自动把它滚进视野——
  // 否则用户点画布选中一个元素，左侧却毫无反应，得自己翻列表去找。
  const selKey = selection.join(',');
  useEffect(() => {
    if (!selKey) return;
    // 能力检测兜底：个别环境没有实现 scrollIntoView，别让它把整个面板拖崩。
    const row = document.querySelector('.layers-list .selected') as HTMLElement | null;
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [selKey]);

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const rows: JSX.Element[] = [];
  /** 列表的可见顺序（层级面板是倒 z 序：上面的行在图上盖住下面的行）。Shift 连选取的就是这段区间 */
  const flat: string[] = [];

  /**
   * 行的点击语义：
   * - 直接点：只选这一个
   * - Ctrl/Cmd + 点：加 / 减多选
   * - Shift + 点：选中「上次点的那一行」到「这一行」之间的所有可见行
   */
  const onRowClick = (id: string, e: React.MouseEvent) => {
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && anchor) {
      const a = flat.indexOf(anchor);
      const b = flat.indexOf(id);
      if (e.shiftKey && a >= 0 && b >= 0 && a !== b) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        // 并入而不是替换：连选时把之前选的也带上，免得手一抖前功尽弃
        setSelection([...new Set([...selection, ...flat.slice(lo, hi + 1)])]);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelection(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
      setAnchor(id);
      return;
    }
    selectOnly(id);
    setAnchor(id);
  };

  const build = (doc: SvgDoc, node: SvgNode, depth: number) => {
    const isGroup = node.children.length > 0;
    const selected = selection.includes(node.id);
    const isCollapsed = collapsed.has(node.id);
    const dropClass =
      drop?.id === node.id
        ? drop.pos === 'inside'
          ? 'layer-row drop-inside'
          : drop.pos === 'before'
            ? 'layer-row drop-before'
            : 'layer-row drop-after'
        : 'layer-row';

    rows.push(
      <div
        key={node.id}
        className={`${dropClass} ${selected ? 'selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={editing !== node.id}
        onDragStart={() => setDragId(node.id)}
        onDragEnd={() => {
          setDragId(null);
          setDrop(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const ratio = (e.clientY - rect.top) / rect.height;
          const pos = isGroup && ratio > 0.3 && ratio < 0.7 ? 'inside' : ratio < 0.5 ? 'before' : 'after';
          setDrop({ id: node.id, pos });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!dragId || !drop) return;
          if (dragId === drop.id) return;
          const target = doc.nodes[drop.id];
          if (!target) return;
          if (drop.pos === 'inside') {
            moveNodeAction(dragId, drop.id, target.children.length);
          } else {
            const parentId = target.parent;
            if (!parentId) return;
            const parent = doc.nodes[parentId];
            let index = parent.children.indexOf(drop.id);
            if (drop.pos === 'after') index += 1;
            moveNodeAction(dragId, parentId, index);
          }
          setDrop(null);
          setDragId(null);
        }}
        onClick={(e) => onRowClick(node.id, e)}
      >
        <span
          className="layer-caret"
          onClick={(e) => {
            e.stopPropagation();
            if (isGroup) toggleCollapse(node.id);
          }}
        >
          {isGroup ? (isCollapsed ? '▸' : '▾') : ''}
        </span>
        <span className="layer-name">
          {editing === node.id ? (
            <input
              autoFocus
              className="layer-rename"
              defaultValue={node.name}
              onBlur={(e) => {
                renameNode(node.id, e.target.value || node.name);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <span onDoubleClick={() => setEditing(node.id)}>
              {node.name}
              <span className="layer-type-inline">（{typeLabel(node.type, lang)}）</span>
            </span>
          )}
          {node.notes ? (
            <span className="layer-note" data-tip={node.notes}>
              📝
            </span>
          ) : null}
        </span>
        <button
          className="layer-btn"
          data-tip={node.visible ? t('layer_hide') : t('layer_show')}
          onClick={(e) => {
            e.stopPropagation();
            toggleVisible(node.id);
          }}
        >
          {node.visible ? '👁' : '—'}
        </button>
        <button
          className="layer-btn"
          data-tip={node.locked ? t('layer_unlock') : t('layer_lock')}
          onClick={(e) => {
            e.stopPropagation();
            toggleLock(node.id);
          }}
        >
          {node.locked ? <IconLockClosed /> : <IconLockOpen />}
        </button>
      </div>,
    );
    flat.push(node.id);

    if (isGroup && !isCollapsed) {
      for (const cid of [...node.children].reverse()) {
        const child = doc.nodes[cid];
        if (child) build(doc, child, depth + 1);
      }
    }
  };

  const root = doc.nodes[doc.rootId];
  for (const cid of [...root.children].reverse()) {
    const child = doc.nodes[cid];
    if (child) build(doc, child, 0);
  }

  return (
    <div className="panel layers">
      <div className="panel-title" data-tip={`${t('layers')}\n${t('tip_layers_pick')}`}>
        {t('layers')}
        {onCollapse && (
          <button className="mini-btn panel-collapse" data-tip={t('collapse_panel')} onClick={onCollapse}>
            «
          </button>
        )}
      </div>
      <div className="layers-list">
        {rows.length === 0 && <div className="empty-hint">{t('layers_empty')}</div>}
        {rows}
      </div>
    </div>
  );
};

export default LayersPanel;
