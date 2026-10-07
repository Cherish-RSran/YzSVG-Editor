import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { store, useVersion, notify } from '../state/store';
import { useT, tf, currentLang } from '../i18n';
import {
  addNode,
  beginTransaction,
  commitTransaction,
  patchNode,
  selectOnly,
  setSelection,
  toggleSelection,
  createShapeNode,
  duplicateSelection,
  groupSelection,
  ungroupSelection,
  reorderSelection,
  deleteSelection,
  compensateStrokeWidth,
} from '../state/actions';
import { NodeView, DefsView } from './NodeView';
import { Overlay, AnchorView, CURSOR } from './Overlay';
import {
  Box,
  NodeType,
  SvgDoc,
  SvgNode,
  ToolId,
} from '../core/types';
import {
  invert,
  mul,
  rotation,
  scaling,
  translation,
  Mat,
} from '../core/matrix';
import {
  boxContains,
  boxIntersects,
  nodeBBox,
  parentWorldMatrix,
  pointInBox,
  selectionBBox,
  snapToAxis,
} from '../core/geometry';
import { computeSnap, SnapGuide } from '../core/align';
import { fitView, fitZoomOf } from '../core/view';
import { themeOf } from '../core/theme';
import { anchorsOf, parsePath, serializePath, pointsToSmoothPath, dist2, deleteAnchor, moveAnchor, Segment } from '../core/path';
import { deleteNode, insertNode, isLockedChain, ancestorsOf } from '../core/model';
import { makeAddCommand, snapshotSubtree } from '../core/history';

type Pt = { x: number; y: number };

interface DragState {
  mode: 'none' | 'pan' | 'move' | 'marquee' | 'resize' | 'rotate' | 'create' | 'pencil' | 'anchor';
  ids: string[];
  start: Pt;
  last: Pt;
  before: Map<string, Mat>;
  startBox: Box | null;
  handle?: string;
  node?: SvgNode;
  type?: NodeType | 'star';
  points?: Pt[];
  /** 本次按下是否真的拖动过（用于把「拖动」和「点一下」区分开） */
  moved?: boolean;
  /** 在别的元素上按下时：松手若没拖动就清空选择（等同点空白，回到挑选状态） */
  deselectOnClick?: boolean;
  anchorIndex?: number;
  anchorWhich?: 'anchor' | 'in' | 'out';
  segs?: Segment[];
  additive?: boolean;
  beforeStroke?: Map<string, string | undefined>;
}

const DEFAULT_FILL = '#3b82f6';
const DEFAULT_STROKE = '#111827';
/** 命中容差（屏幕像素）：点击点周围这个半径内的元素也算命中 */
const HIT_TOLERANCE = 4;
/** 拖动阈值（屏幕像素）：位移小于它算点击，不算拖动，避免手抖把元素挪走 */
const DRAG_THRESHOLD = 3;

function styleFor(type: NodeType | 'star'): Record<string, string> {
  if (type === 'line') return { stroke: DEFAULT_STROKE, 'stroke-width': '2', fill: 'none' };
  if (type === 'polyline') return { stroke: DEFAULT_STROKE, 'stroke-width': '2', fill: 'none' };
  return { fill: 'none', stroke: DEFAULT_STROKE, 'stroke-width': '2' };
}

function starPoints(cx: number, cy: number, r: number, inner = 0.45, n = 5): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const a = (Math.PI / n) * i - Math.PI / 2;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(2)},${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return pts.join(' ');
}

function polygonPoints(cx: number, cy: number, r: number, n = 6, rot = -Math.PI / 2): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((Math.PI * 2) / n) * i + rot;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return pts.join(' ');
}

function normalizeBox(a: Pt, b: Pt): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 世界坐标变换 A 应用到多个节点 */
function applyWorld(ids: string[], A: Mat, before: Map<string, Mat>): void {
  const doc = store.state.doc;
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || isLockedChain(doc, id)) continue;
    const P = parentWorldMatrix(doc, id);
    const invP = invert(P);
    const M0 = before.get(id);
    if (!M0) continue;
    node.transform = mul(mul(mul(invP, A), P), M0);
  }
}

const LITE_THRESHOLD = 500;

export const Canvas: React.FC = () => {
  useVersion();
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** 按住 Ctrl/Meta = 临时回到「挑选模式」：此时即使已有选中也要出待选框，否则看不出下一个点的是谁 */
  const [pickMode, setPickMode] = useState(false);
  /** 键事件侧的 Ctrl/Meta 是否仍按着（指针事件的 ctrlKey 可能在某些场景下缺失） */
  const pickKey = useRef(false);
  const [interacting, setInteracting] = useState(false);
  const [cursorOverride, setCursorOverride] = useState<string | null>(null);
  const drag = useRef<DragState>({ mode: 'none', ids: [], start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, before: new Map(), startBox: null });
  const spaceDown = useRef(false);
  const penAnchors = useRef<{ p: Pt; in?: Pt; out?: Pt }[] | null>(null);
  const penClosed = useRef(false);
  /** 当前钢笔路径的节点 id（独立于 drag 状态，避免被 pointerup 清理） */
  const penNodeId = useRef<string | null>(null);

  const setCursor = useCallback((c: string | null) => {
    setCursorOverride((prev) => (prev === c ? prev : c));
  }, []);

  const doc = store.state.doc;
  const { zoom, panX, panY, tool, selection, showGrid, gridSize, snapEnabled, showRulers, pathEditId, theme } = store.state;
  // 主题只改「画板以外」的画布底色与网格颜色；画板本身（白纸）由 doc.background 决定，图不受影响
  const th = themeOf(theme);

  // 容器尺寸。默认那组 900×600 只是占位值，拿它去做自适应会让画板偏小、百分比也不是 100%。
  const didFit = useRef(false);

  /** 按给定视口尺寸做一次「适应窗口」并记下基准缩放 */
  const fitWith = useCallback((w: number, h: number) => {
    const v = fitView(w, h, store.state.doc);
    store.set({ ...v, fitZoom: v.zoom });
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return; // jsdom 下恒为 0：保持默认尺寸，视口参数才稳定
      setSize({ w, h });
      // 首次自适应必须在这里、用**刚量到的真实尺寸**做：
      // 放到下面的 useEffect 里会拿到还没更新的占位尺寸（900×600），
      // 于是画板只有 0.9 倍、百分比显示 87%，用户一进来就得手点一次「适应」。
      if (!didFit.current) {
        didFit.current = true;
        fitWith(w, h);
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [fitWith]);

  // 视口尺寸或画板尺寸变了，「适应」的基准也要跟着变（缩放百分比以它为 100%）。
  // 如果用户还没手动缩放过（zoom 仍等于基准值），就顺势重新适应，保持铺满；
  // 一旦他自己调过缩放或挪过画布，就只更新基准、不再动他的视图。
  useEffect(() => {
    if (size.w < 10) return;
    const untouched = Math.abs(store.state.zoom - store.state.fitZoom) < 1e-6;
    if (untouched) fitWith(size.w, size.h);
    else store.set({ fitZoom: fitZoomOf(size.w, size.h, store.state.doc) });
  }, [size.w, size.h, doc.width, doc.height, fitWith]);

  const toDoc = useCallback((clientX: number, clientY: number): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const s = store.state;
    return {
      x: (clientX - rect.left - s.panX) / s.zoom,
      y: (clientY - rect.top - s.panY) / s.zoom,
    };
  }, []);

  // 空格平移 & 键盘
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 滚轮缩放（非 passive）
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const s = store.state;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0025);
        const nz = clamp(s.zoom * factor, 0.02, 64);
        const k = nz / s.zoom;
        store.set({ zoom: nz, panX: cx - (cx - s.panX) * k, panY: cy - (cy - s.panY) * k });
      } else if (e.shiftKey) {
        store.set({ panX: s.panX - e.deltaY });
      } else {
        store.set({ panX: s.panX - e.deltaX, panY: s.panY - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** 收集屏幕坐标点下所有可命中的节点 id，按 z 序从最上层到最下层（带容差） */
  const idsAtPoint = useCallback((clientX: number, clientY: number): string[] => {
    const out: string[] = [];
    const doc = store.state.doc;
    // 中心点优先，四周补采 4 点作为容差：细线、细描边、小图形不必精确命中
    const probes: [number, number][] = [
      [clientX, clientY],
      [clientX + HIT_TOLERANCE, clientY],
      [clientX - HIT_TOLERANCE, clientY],
      [clientX, clientY + HIT_TOLERANCE],
      [clientX, clientY - HIT_TOLERANCE],
    ];
    for (const [x, y] of probes) {
      for (const el of document.elementsFromPoint(x, y) as Element[]) {
        if (!el || typeof el.getAttribute !== 'function') continue;
        if (el.getAttribute('data-handle')) continue;        // 跳过缩放/旋转控制柄
        const id = el.closest?.('[data-id]')?.getAttribute('data-id');
        if (!id || out.includes(id)) continue;
        const n = doc.nodes[id];
        if (!n || !n.visible) continue;                      // 跳过隐藏元素
        out.push(id);
      }
    }
    return out;
  }, []);

  /**
   * 找到点击命中的「顶层可选择节点」。
   * Ctrl/Meta 不再在这里归并成组：画布上 Ctrl+点击 = 加/减多选，
   * 整组要到左侧图层面板里点（画布永远选到最小的那个要素）。
   */
  const pickId = useCallback(
    (target: Element | null, clientX?: number, clientY?: number, deep?: boolean): string | null => {
      let id: string | null = null;
      // 传入屏幕坐标时用 z 序候选栈（支持穿透），否则退回原来的 closest 分支
      if (clientX !== undefined && clientY !== undefined) {
        const ids = idsAtPoint(clientX, clientY);
        if (ids.length === 0) return null;
        let idx = 0;
        if (deep) {
          const cur = store.state.selection[0];           // 实时读取当前选中
          const ci = cur ? ids.indexOf(cur) : -1;
          idx = ci >= 0 ? (ci + 1) % ids.length : (ids.length > 1 ? 1 : 0);
        }
        id = ids[idx] ?? null;
      } else {
        const el = target as Element | null;
        if (!el) return null;
        const nodeEl = el.closest?.('[data-id]');
        id = nodeEl?.getAttribute('data-id') ?? null;
      }
      if (!id) return null;
      // 命中的就是最小要素：点大要素的空白处就选大要素，点组内小元素就选小元素
      return id;
    },
    [idsAtPoint],
  );

  const otherBoxes = useCallback((exclude: string[]): Box[] => {
    const d = store.state.doc;
    const out: Box[] = [];
    const walk = (id: string) => {
      const n = d.nodes[id];
      if (!n || !n.visible) return;
      if (id !== d.rootId && !exclude.includes(id) && n.children.length === 0) {
        out.push(nodeBBox(d, id));
      }
      for (const c of n.children) walk(c);
    };
    walk(d.rootId);
    return out;
  }, []);

  // ---------------- 指针事件 ----------------

  const onPointerDown = (e: React.PointerEvent) => {
    const el = e.target as Element;
    const pt = toDoc(e.clientX, e.clientY);
    const s = store.state;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    store.set({ contextMenu: null });
    setInteracting(true);

    if (e.button === 1 || spaceDown.current) {
      drag.current = { ...drag.current, mode: 'pan', start: { x: e.clientX, y: e.clientY }, last: { x: e.clientX, y: e.clientY } };
      return;
    }
    if (e.button !== 0) return;

    const handle = el.getAttribute?.('data-handle');
    if (handle && s.selection.length > 0) {
      const box = selectionBBox(s.doc, s.selection);
      const before = new Map<string, Mat>();
      for (const id of s.selection) before.set(id, { ...s.doc.nodes[id].transform });
      const beforeStroke = new Map<string, string | undefined>();
      for (const id of s.selection) {
        const collect = (nid: string) => {
          const n = s.doc.nodes[nid];
          if (!n) return;
          const sw = n.attrs['stroke-width'];
          const stroke = n.attrs['stroke'];
          if (stroke !== undefined && stroke !== 'none') beforeStroke.set(nid, sw ?? '');
          for (const c of n.children) collect(c);
        };
        collect(id);
      }
      beginTransaction(handle === 'rotate' ? '旋转' : '缩放', s.selection);
      drag.current = {
        ...drag.current,
        mode: handle === 'rotate' ? 'rotate' : 'resize',
        ids: s.selection,
        start: pt,
        last: pt,
        before,
        startBox: box,
        handle,
        beforeStroke,
      };
      setCursor(CURSOR[handle] ?? 'default');
      return;
    }

    const anchorAttr = el.getAttribute?.('data-anchor');
    if (anchorAttr && pathEditId) {
      const [idxStr, which] = anchorAttr.split(':');
      const idx = parseInt(idxStr, 10);
      const node = s.doc.nodes[pathEditId];
      if (node) {
        if (e.altKey) {
          const segs = parsePath(node.attrs['d'] ?? '');
          const next = deleteAnchor(segs, idx);
          beginTransaction('删除锚点', [pathEditId]);
          node.attrs['d'] = serializePath(next);
          commitTransaction();
          return;
        }
        beginTransaction('编辑锚点', [pathEditId]);
        drag.current = {
          ...drag.current,
          mode: 'anchor',
          ids: [pathEditId],
          start: pt,
          last: pt,
          before: new Map(),
          startBox: null,
          anchorIndex: idx,
          anchorWhich: which as 'anchor' | 'in' | 'out',
        };
        return;
      }
    }

    if (tool === 'select' || tool === 'node') {
      // Ctrl/Meta = 加减小选；Alt = 向下一层穿透；什么都不按 = 选中最小要素
      const id = pickId(el, e.clientX, e.clientY, e.altKey);
      if (!id) {
        // 多选状态下，按下点落在「选中整体」的包围盒内就算拖动整体。
        // 否则从元素之间的空隙按下会被当成框选，先把选择清空 —— 多选就永远拖不动。
        if (s.selection.length > 1) {
          const sb = selectionBBox(s.doc, s.selection);
          if (pt.x >= sb.x && pt.x <= sb.x + sb.w && pt.y >= sb.y && pt.y <= sb.y + sb.h) {
            const movable = s.selection.filter((i) => !isLockedChain(s.doc, i));
            if (movable.length > 0) {
              const before = new Map<string, Mat>();
              for (const i of movable) before.set(i, { ...s.doc.nodes[i].transform });
              beginTransaction('移动', movable);
              drag.current = {
                ...drag.current,
                mode: 'move',
                ids: movable,
                start: pt,
                last: pt,
                before,
                startBox: selectionBBox(s.doc, movable),
                additive: false,
              };
              setCursor('move');
              return;
            }
          }
        }
        if (!e.shiftKey) setSelection([]);
        drag.current = { ...drag.current, mode: 'marquee', start: pt, last: pt, additive: e.shiftKey };
        setMarquee({ x: pt.x, y: pt.y, w: 0, h: 0 });
        return;
      }
      let ids = s.selection;
      if (e.ctrlKey || e.metaKey) {
        // 画布 Ctrl+点击 = 多选取反（不是「选整组」——整组在图层面板里点）
        toggleSelection(id);
        ids = store.state.selection;
      } else if (e.shiftKey) {
        toggleSelection(id);
        ids = store.state.selection;
      } else if (ids.length === 0) {
        // 空白状态下才是「点谁选谁」
        selectOnly(id);
        ids = [id];
      } else if (!ids.includes(id) && !ids.some((sid) => ancestorsOf(s.doc, id).includes(sid))) {
        // 关键分界：只有「落在选区范围内」的其它元素才跟着当前选区一起拖。
        // 选区外面的元素，鼠标在那儿时根本拖不动选区（光标也不是 move），待选框也是显示的，
        // 所以按下去就该正常换选它 —— 否则"有框提示可选，按下去却拖走了别人"很莫名其妙。
        if (!boxIntersects(nodeBBox(s.doc, id), selectionBBox(s.doc, ids))) {
          selectOnly(id);
          ids = [id];
        } else {
          // 已经有选中内容（光标是「移动」）：在选区范围内按哪都要能拖着走 ——
          // 元素密集的地方找不到空白可按下，否则就是"想移动却移不动"。
          // 松手时若根本没拖动，才清空选择（等同点空白，回到挑选状态，下一次点才是选它）。
          const movable = ids.filter((i) => !isLockedChain(s.doc, i));
          if (movable.length === 0) return;
          const before = new Map<string, Mat>();
          for (const i of movable) before.set(i, { ...s.doc.nodes[i].transform });
          beginTransaction('移动', movable);
          drag.current = {
            mode: 'move',
            ids: movable,
            start: pt,
            last: pt,
            before,
            startBox: selectionBBox(s.doc, movable),
            moved: false,
            deselectOnClick: true,
          };
          setCursor('move');
          return;
        }
      }
      if (tool === 'node') {
        store.set({ pathEditId: id });
        return;
      }
      const movable = ids.filter((i) => !isLockedChain(s.doc, i));
      if (movable.length === 0) return;
      const before = new Map<string, Mat>();
      for (const i of movable) before.set(i, { ...s.doc.nodes[i].transform });
      beginTransaction('移动', movable);
      drag.current = {
        mode: 'move',
        ids: movable,
        start: pt,
        last: pt,
        before,
        startBox: selectionBBox(s.doc, movable),
        additive: false,
      };
      setCursor('move');
      return;
    }

    if (tool === 'text') {
      const node = createShapeNode('text', {
        x: String(pt.x),
        y: String(pt.y),
        'font-size': '24',
        'font-family': 'sans-serif',
        fill: '#111827',
      });
      node.text = '双击编辑文本';
      addNode(node, s.doc.rootId, '新增文本');
      store.set({ tool: 'select', selection: [node.id], editingTextId: node.id });
      return;
    }

    if (tool === 'pen') {
      handlePenDown(pt, e);
      return;
    }

    if (tool === 'pencil') {
      const node = createShapeNode('path', {
        d: `M ${pt.x} ${pt.y}`,
        stroke: DEFAULT_STROKE,
        'stroke-width': '2',
        fill: 'none',
        'stroke-linecap': 'round',
      });
      insertNode(s.doc, node, s.doc.rootId);
      beginTransaction('铅笔绘制', [node.id]);
      drag.current = {
        mode: 'pencil',
        ids: [node.id],
        start: pt,
        last: pt,
        before: new Map(),
        startBox: null,
        points: [pt],
        node,
      };
      store.set({ selection: [node.id] });
      return;
    }

    // 形状工具
    const type: NodeType | 'star' = tool as NodeType | 'star';
    const node = createShapeNode(
      type === 'star' ? 'polygon' : (type as NodeType),
      { ...styleFor(type) },
    );
    if (type === 'rect') Object.assign(node.attrs, { x: String(pt.x), y: String(pt.y), width: '0', height: '0' });
    if (type === 'ellipse') Object.assign(node.attrs, { cx: String(pt.x), cy: String(pt.y), rx: '0', ry: '0' });
    if (type === 'line') Object.assign(node.attrs, { x1: String(pt.x), y1: String(pt.y), x2: String(pt.x), y2: String(pt.y) });
    if (type === 'polygon' || type === 'star') Object.assign(node.attrs, { points: `${pt.x},${pt.y}` });
    insertNode(s.doc, node, s.doc.rootId);
    drag.current = {
      mode: 'create',
      ids: [node.id],
      start: pt,
      last: pt,
      before: new Map(),
      startBox: null,
      node,
      type,
    };
    store.set({ selection: [node.id] });
  };

  const handlePenDown = (pt: Pt, e: React.PointerEvent) => {
    const s = store.state;
    if (!penAnchors.current) {
      const node = createShapeNode('path', { d: `M ${pt.x} ${pt.y}`, fill: 'none', stroke: DEFAULT_STROKE, 'stroke-width': '2' });
      insertNode(s.doc, node, s.doc.rootId);
      penAnchors.current = [{ p: pt }];
      penClosed.current = false;
      penNodeId.current = node.id;
      store.set({ selection: [node.id], pathEditId: node.id });
      updatePenPath();
      return;
    }
    const anchors = penAnchors.current;
    const first = anchors[0];
    // 吸附半径 12 屏幕像素（dist2 是平方距离）：太小的话用户根本点不中起点，路径闭不上
    const snapR = 12 / s.zoom;
    if (anchors.length > 2 && dist2(pt, first.p) < snapR * snapR) {
      penClosed.current = true;
      finishPen();
      return;
    }
    // 注意：不能用 e.detail === 2 判断双击结束 —— 连续快速点击不同位置时
    // 浏览器同样会报 detail=2，会把刚起头的路径误判为结束。
    // 结束方式改为：点击起点闭合 / 回车 / 右键 / 切换工具。
    anchors.push({ p: pt });
    updatePenPath();
  };

  const updatePenPath = () => {
    const anchors = penAnchors.current;
    const id = penNodeId.current;
    const node = id ? store.state.doc.nodes[id] : undefined;
    if (!anchors || !node) return;
    const segs: Segment[] = [{ cmd: 'M', args: [anchors[0].p.x, anchors[0].p.y] }];
    for (let i = 1; i < anchors.length; i++) {
      const prev = anchors[i - 1];
      const cur = anchors[i];
      const c1 = prev.out ?? prev.p;
      const c2 = cur.in ?? cur.p;
      if (prev.out || cur.in) {
        segs.push({ cmd: 'C', args: [c1.x, c1.y, c2.x, c2.y, cur.p.x, cur.p.y] });
      } else {
        segs.push({ cmd: 'L', args: [cur.p.x, cur.p.y] });
      }
    }
    if (penClosed.current) segs.push({ cmd: 'Z', args: [] });
    node.attrs['d'] = serializePath(segs);
    store.bump();
  };

  const finishPen = (switchTool = true) => {
    const anchors = penAnchors.current;
    const id = penNodeId.current;
    penAnchors.current = null;
    penClosed.current = false;
    penNodeId.current = null;
    if (!id) return;
    const node = store.state.doc.nodes[id];
    if (node) {
      const segs = parsePath(node.attrs['d'] ?? '');
      if (segs.length <= 1) {
        deleteNode(store.state.doc, id);
      } else {
        const snap = snapshotSubtree(store.state.doc, id);
        if (snap) store.history.push(makeAddCommand(store.state.doc, '钢笔绘制', [snap]));
      }
    }
    store.set({
      selection: id && store.state.doc.nodes[id] ? [id] : [],
      ...(switchTool ? { tool: 'select' as ToolId } : {}),
    });
  };

  // 切换工具时结束未完成的钢笔路径
  useEffect(() => {
    if (tool !== 'pen' && penAnchors.current) finishPen(false);
  }, [tool]);

  // 回车结束钢笔路径
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && penAnchors.current) {
        e.preventDefault();
        finishPen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl/Meta 按下期间进入「挑选模式」：已有选中也要出待选框，且按下去是加减选而不是拖动。
  // 两个来源都要看：键事件（先按住 Ctrl 再动鼠标、按住不动）和指针事件的 ctrlKey
  // （某些自动化/远程桌面场景下键事件会丢）。用 ref 记住键是否仍按着，
  // 指针事件只在"键确实松了"的时候才清位，避免鼠标一动就把刚按下的 Ctrl 冲掉。
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Control' && e.key !== 'Meta') return;
      pickKey.current = true;
      setPickMode(true);
      // 光标的 move 是上一次移动留下的覆盖值，按住 Ctrl 后要撤掉，光标才能回到挑选
      setCursorOverride((c) => (c === 'move' ? null : c));
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Control' && e.key !== 'Meta') return;
      pickKey.current = false;
      setPickMode(false);
    };
    const clear = () => {
      pickKey.current = false;
      setPickMode(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    // 切走窗口/失焦时按键抬起收不到，会一直卡在挑选模式
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const s = store.state;
    const pt = toDoc(e.clientX, e.clientY);
    const d = drag.current;

    if (d.mode === 'none') {
      // 钢笔绘制过程中不做悬停判定：正在画的路径处于选中态，否则光标会被设成 move
      if (penAnchors.current) {
        if (hoverId !== null) setHoverId(null);
        setCursor(null);
        return;
      }
      // 悬停在缩放/旋转手柄上时，光标优先按手柄方向走，不能被下方元素的 move 覆盖
      const hoverHandle = (e.target as Element)?.getAttribute?.('data-handle');
      if (hoverHandle) {
        if (hoverId !== null) setHoverId(null);
        setCursor(CURSOR[hoverHandle] ?? 'default');
        return;
      }
      const pick = e.ctrlKey || e.metaKey || pickKey.current;
      if (pick !== pickMode) setPickMode(pick);
      const id = pickId(e.target as Element, e.clientX, e.clientY);
      if (id !== hoverId) setHoverId(id);
      // 只有鼠标落在「选区范围」内才是移动光标：外面按下去本来就拖不动选区，
      // 给个 move 是假提示。按住 Ctrl/Meta 则是临时挑选，一律不算移动。
      const overSel =
        s.selection.length > 0 &&
        !pick &&
        pointInBox(pt, selectionBBox(s.doc, s.selection), HIT_TOLERANCE / s.zoom);
      if (overSel) setCursor('move');
      else if (id) setCursor('pointer');
      else setCursor(null);
      return;
    }

    if (d.mode === 'pan') {
      const dx = e.clientX - d.last.x;
      const dy = e.clientY - d.last.y;
      store.set({ panX: s.panX + dx, panY: s.panY + dy });
      d.last = { x: e.clientX, y: e.clientY };
      return;
    }

    if (d.mode === 'marquee') {
      const box = normalizeBox(d.start, pt);
      setMarquee(box);
      d.last = pt;
      return;
    }

    if (d.mode === 'move') {
      // 位移不到阈值视为纯点击：不动元素（选中状态在 pointerdown 时已设置）
      if (Math.hypot(pt.x - d.start.x, pt.y - d.start.y) * s.zoom < DRAG_THRESHOLD) return;
      d.moved = true;
      let dx = pt.x - d.start.x;
      let dy = pt.y - d.start.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const startBox = d.startBox!;
      let g: SnapGuide[] = [];
      if (snapEnabled && !e.altKey) {
        const moved: Box = { ...startBox, x: startBox.x + dx, y: startBox.y + dy };
        const snap = computeSnap(
          moved,
          otherBoxes(d.ids),
          6 / s.zoom,
          { x: s.doc.viewBox[0], y: s.doc.viewBox[1], w: s.doc.viewBox[2], h: s.doc.viewBox[3] },
        );
        dx += snap.dx;
        dy += snap.dy;
        g = snap.guides;
      } else if (s.showGrid && snapEnabled) {
        dx = Math.round(dx / s.gridSize) * s.gridSize;
        dy = Math.round(dy / s.gridSize) * s.gridSize;
      }
      setGuides(g);
      applyWorld(d.ids, translation(dx, dy), d.before);
      store.bump();
      return;
    }

    if (d.mode === 'resize') {
      const sb = d.startBox!;
      let nx = sb.x;
      let ny = sb.y;
      let nw = sb.w;
      let nh = sb.h;
      const h = d.handle!;
      if (h.includes('e')) nw = pt.x - sb.x;
      if (h.includes('s')) nh = pt.y - sb.y;
      if (h.includes('w')) {
        nw = sb.x + sb.w - pt.x;
        nx = pt.x;
      }
      if (h.includes('n')) {
        nh = sb.y + sb.h - pt.y;
        ny = pt.y;
      }
      // 默认按面板设置保持横纵比；按住 Shift 临时反转（想自由拉伸就按 Shift，或去面板关掉）
      const keepRatio = s.keepAspect ? !e.shiftKey : e.shiftKey;
      if (keepRatio && sb.w > 0 && sb.h > 0) {
        const k = Math.max(Math.abs(nw / sb.w), Math.abs(nh / sb.h));
        nw = sb.w * k;
        nh = sb.h * k;
        if (h.includes('w')) nx = sb.x + sb.w - nw;
        if (h.includes('n')) ny = sb.y + sb.h - nh;
      }
      let sx = sb.w === 0 ? 1 : nw / sb.w;
      let sy = sb.h === 0 ? 1 : nh / sb.h;
      if (h === 'n' || h === 's') sx = 1;
      if (h === 'e' || h === 'w') sy = 1;
      sx = Math.abs(sx) < 1e-4 ? 1e-4 : sx;
      sy = Math.abs(sy) < 1e-4 ? 1e-4 : sy;
      // 固定锚点（对角）
      let ax = sb.x;
      let ay = sb.y;
      if (h.includes('e')) ax = sb.x;
      if (h.includes('w')) ax = sb.x + sb.w;
      if (h.includes('s')) ay = sb.y;
      if (h.includes('n')) ay = sb.y + sb.h;
      if (h === 'n' || h === 's') ay = h === 'n' ? sb.y + sb.h : sb.y;
      if (h === 'e' || h === 'w') ax = h === 'e' ? sb.x : sb.x + sb.w;
      const A = mul(mul(translation(ax, ay), scaling(sx, sy)), translation(-ax, -ay));
      applyWorld(d.ids, A, d.before);
      const k = Math.sqrt(Math.abs(sx * sy));
      if (d.beforeStroke && d.beforeStroke.size > 0) compensateStrokeWidth(d.ids, k, d.beforeStroke);
      store.bump();
      return;
    }

    if (d.mode === 'rotate') {
      const sb = d.startBox!;
      const cx = sb.x + sb.w / 2;
      const cy = sb.y + sb.h / 2;
      const a0 = Math.atan2(d.start.y - cy, d.start.x - cx);
      const a1 = Math.atan2(pt.y - cy, pt.x - cx);
      let deg = ((a1 - a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      // 「一起旋转」：绕选区中心同步旋转，每个节点各自的角度都 +deg（面板直接从节点反解，无需另记）
      applyWorld(d.ids, rotation(deg, cx, cy), d.before);
      store.bump();
      return;
    }

    if (d.mode === 'create' && d.node && d.type) {
      const node = d.node;
      const a = d.start;
      let b = pt;
      if (e.shiftKey) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        b = { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m };
      }
      const box = normalizeBox(a, b);
      if (d.type === 'rect') {
        node.attrs['x'] = String(box.x);
        node.attrs['y'] = String(box.y);
        node.attrs['width'] = String(box.w);
        node.attrs['height'] = String(box.h);
      } else if (d.type === 'ellipse') {
        node.attrs['cx'] = String(box.x + box.w / 2);
        node.attrs['cy'] = String(box.y + box.h / 2);
        node.attrs['rx'] = String(box.w / 2);
        node.attrs['ry'] = String(box.h / 2);
      } else if (d.type === 'line') {
        // 默认吸附到水平/竖直：手抖出来的小倾角直接拉正，想画斜线就明显偏离轴心。
        // Shift = 45° 斜线，Alt = 完全自由角度
        const p = !e.shiftKey && !e.altKey ? snapToAxis(a, b) : b;
        node.attrs['x1'] = String(a.x);
        node.attrs['y1'] = String(a.y);
        node.attrs['x2'] = String(p.x);
        node.attrs['y2'] = String(p.y);
      } else if (d.type === 'polygon' || d.type === 'star') {
        const r = Math.max(box.w, box.h) / 2;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        node.attrs['points'] =
          d.type === 'star' ? starPoints(cx, cy, r) : polygonPoints(cx, cy, r);
      }
      store.bump();
      return;
    }

    if (d.mode === 'pencil' && d.node && d.points) {
      const last = d.points[d.points.length - 1];
      const minDist = 3 / s.zoom;
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > minDist) d.points.push(pt);
      d.node.attrs['d'] = pointsToSmoothPath(d.points);
      store.bump();
      return;
    }

    if (d.mode === 'anchor' && pathEditId) {
      const node = store.state.doc.nodes[pathEditId];
      if (!node) return;
      const segs = parsePath(node.attrs['d'] ?? '');
      const next = moveAnchor(segs, d.anchorIndex!, d.anchorWhich!, pt);
      node.attrs['d'] = serializePath(next);
      store.bump();
      return;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = store.state;
    const d = drag.current;
    const pt = toDoc(e.clientX, e.clientY);
    setInteracting(false);
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);

    if (d.mode === 'marquee') {
      const box = normalizeBox(d.start, pt);
      setMarquee(null);
      if (box.w > 2 / s.zoom || box.h > 2 / s.zoom) {
        const hits: string[] = [];
        const walk = (id: string) => {
          const n = s.doc.nodes[id];
          if (!n || !n.visible || n.locked) return;
          if (id !== s.doc.rootId) {
            const b = nodeBBox(s.doc, id);
            // 组本身不入选：拖选要选中「看见的那些要素本身」，否则旋转会加在组上，
            // 组内子元素自身的角度仍然是 0，用户会以为旋转没生效。
            // 需要选中整组：Ctrl+点击，或在左侧图层面板里点组。
            if (n.children.length === 0 && boxContains(box, b) && b.w + b.h > 0) hits.push(id);
          }
          if (n.children.length > 0) for (const c of n.children) walk(c);
        };
        walk(s.doc.rootId);
        // 只保留最外层命中项
        const top = hits.filter((id) => !hits.some((o) => o !== id && ancestorsOf(s.doc, id).includes(o)));
        setSelection(d.additive ? [...new Set([...s.selection, ...top])] : top);
      }
    } else if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'rotate' || d.mode === 'anchor') {
      commitTransaction();
      setGuides([]);
      // 在别的元素上按下但没拖动 = 一次点击：撤销选择，让光标回到"挑选"状态
      if (d.deselectOnClick && !d.moved) setSelection([]);
    } else if (d.mode === 'create' && d.node) {
      const node = d.node;
      const box = normalizeBox(d.start, pt);
      const tooSmall = box.w < 2 / s.zoom && box.h < 2 / s.zoom;
      if (tooSmall) {
        deleteNode(s.doc, node.id);
        store.set({ selection: [] });
      } else {
        const snap = snapshotSubtree(s.doc, node.id);
        if (snap) store.history.push(makeAddCommand(s.doc, `绘制${node.name}`, [snap]));
        store.set({ selection: [node.id], tool: 'select' });
      }
    } else if (d.mode === 'pencil' && d.node) {
      if ((d.points?.length ?? 0) < 2) {
        deleteNode(s.doc, d.node.id);
      } else {
        commitTransaction();
      }
      store.set({ tool: 'select' });
    } else if (d.mode === 'pan') {
      // nothing
    }

    // 钢笔：拖拽设置控制柄
    if (tool === 'pen' && penAnchors.current && d.mode === 'none') {
      const anchors = penAnchors.current;
      const cur = anchors[anchors.length - 1];
      const moved = Math.hypot(pt.x - cur.p.x, pt.y - cur.p.y);
      if (moved > 3 / s.zoom) {
        cur.out = pt;
        cur.in = { x: 2 * cur.p.x - pt.x, y: 2 * cur.p.y - pt.y };
        updatePenPath();
      }
    }

    drag.current = { mode: 'none', ids: [], start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, before: new Map(), startBox: null };
    setCursor(null);
    store.bump();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // 传坐标走容差分支：否则双击文字的字间空隙会落空
    // precise=false：双击要进入具体元素（文字编辑 / 路径节点），不能归并到组
    const id = pickId(e.target as Element, e.clientX, e.clientY);
    if (!id) return;
    const s = store.state;
    const node = s.doc.nodes[id];
    if (!node) return;
    if (node.type === 'text') {
      store.set({ editingTextId: id, selection: [id] });
      return;
    }
    if (node.type === 'path' || node.type === 'polygon' || node.type === 'polyline') {
      store.set({ pathEditId: id, selection: [id], tool: 'node' });
      return;
    }
    selectOnly(id);
  };

  // ---------------- 渲染辅助 ----------------

  // 钢笔/铅笔正在绘制时不能显示选中框与悬停框：框上的手柄会抢走鼠标，光标变成移动样式，
  // 而且正在画的这条路径本来就被选中，框体会一直跟着抖。
  const drawingPath = !!penAnchors.current || drag.current.mode === 'pencil';
  const selBox = selection.length > 0 && !drawingPath ? selectionBBox(doc, selection) : null;
  // 待选框只在「这一下按下去确实是选中它」的时候画。
  // 落在选区范围内的其它元素不画：那里按下去是拖着当前选区走，画个框等于骗人。
  // 选区外面照常画（那一按就是换选）；按住 Ctrl/Meta 是临时挑选，也一律画
  // （已选中的元素自己有实线框，不再重复画）。
  const hoverB = hoverId && hoverId !== doc.rootId ? nodeBBox(doc, hoverId) : null;
  const hoverBox =
    !drawingPath &&
    hoverId &&
    hoverB &&
    (selection.length === 0 ||
      pickMode ||
      !(selBox && boxIntersects(hoverB, selBox))) &&
    !(pickMode && selection.includes(hoverId))
      ? hoverB
      : null;
  // 多选时逐个框出每个元素：只给一个合并包围盒，用户看不出到底选中了哪几个
  const selBoxes =
    !drawingPath && selection.length > 1 ? selection.map((id) => nodeBBox(doc, id)) : null;
  const multi = selection.length > 1;

  let anchorsView: AnchorView[] | null = null;
  if (pathEditId && doc.nodes[pathEditId]) {
    const node = doc.nodes[pathEditId];
    const segs = parsePath(node.attrs['d'] ?? '');
    const list = anchorsOf(segs);
    const m = parentWorldMatrix(doc, pathEditId);
    anchorsView = list.map((a) => ({
      p: { x: m.a * a.p.x + m.c * a.p.y + m.e, y: m.b * a.p.x + m.d * a.p.y + m.f },
      in: a.in ? { x: m.a * a.in.x + m.c * a.in.y + m.e, y: m.b * a.in.x + m.d * a.in.y + m.f } : undefined,
      out: a.out ? { x: m.a * a.out.x + m.c * a.out.y + m.e, y: m.b * a.out.x + m.d * a.out.y + m.f } : undefined,
    }));
  }

  const gridStep = (() => {
    let step = gridSize;
    let guard = 0;
    while (step * zoom < 8 && guard < 10) {
      step *= 5;
      guard += 1;
    }
    return step;
  })();

  const viewLeft = -panX / zoom;
  const viewTop = -panY / zoom;
  const viewRight = viewLeft + size.w / zoom;
  const viewBottom = viewTop + size.h / zoom;

  const gridLines: JSX.Element[] = [];
  if (showGrid && gridStep * zoom >= 8) {
    const startX = Math.floor(viewLeft / gridStep) * gridStep;
    for (let x = startX; x < viewRight; x += gridStep) {
      gridLines.push(
        <line key={`vx${x}`} x1={x} y1={viewTop} x2={x} y2={viewBottom} stroke={th.grid} strokeWidth={1 / zoom} />,
      );
    }
    const startY = Math.floor(viewTop / gridStep) * gridStep;
    for (let y = startY; y < viewBottom; y += gridStep) {
      gridLines.push(
        <line key={`vy${y}`} x1={viewLeft} y1={y} x2={viewRight} y2={y} stroke={th.grid} strokeWidth={1 / zoom} />,
      );
    }
  }

  const rulerTicks: JSX.Element[] = [];
  if (showRulers) {
    const step = gridStep;
    for (let x = Math.floor(viewLeft / step) * step; x < viewRight; x += step) {
      const sx = x * zoom + panX;
      rulerTicks.push(
        <line key={`rx${x}`} x1={sx} y1={14} x2={sx} y2={20} className="ruler-tick" strokeWidth={1} />,
      );
      if (Math.round(x) % (step * 5) === 0) {
        rulerTicks.push(
          <text key={`rtx${x}`} x={sx + 2} y={11} fontSize={9} className="ruler-text">
            {Math.round(x)}
          </text>,
        );
      }
    }
    for (let y = Math.floor(viewTop / step) * step; y < viewBottom; y += step) {
      const sy = y * zoom + panY;
      rulerTicks.push(
        <line key={`ry${y}`} x1={14} y1={sy} x2={20} y2={sy} className="ruler-tick" strokeWidth={1} />,
      );
    }
  }

  // 轻量模式：元素过多且正在交互时，降级为包围盒代理渲染
  const nodeCount = Object.keys(doc.nodes).length;
  const liteActive = store.state.liteMode && interacting && nodeCount > LITE_THRESHOLD;
  useEffect(() => {
    if (nodeCount > LITE_THRESHOLD && !store.state.liteMode) {
      store.set({ liteMode: true });
      notify(tf('msg_lite_on', currentLang()), 'info');
    }
  }, [nodeCount]);

  const cursor =
    // 有选中内容 → 移动光标（下一步动作就是拖它）；只有当选择被清空（点空白）才是挑选光标
    // 兜底不再是 move：只有鼠标真的落在选区范围内才是 move（由 pointermove 设置覆盖值），
    // 选区外面按下去本来就拖不动，给 move 是假提示。
    cursorOverride ?? (tool !== 'select' && tool !== 'node' ? 'crosshair' : 'default');

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        style={{ cursor, display: 'block', background: th.canvasBg }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          if (penAnchors.current) {
            finishPen();
            return;
          }
          const id = pickId(e.target as Element);
          const rect = (e.currentTarget as Element).getBoundingClientRect();
          store.set({
            contextMenu: { x: e.clientX - rect.left, y: e.clientY - rect.top, id },
            selection: id ? [id] : [],
          });
        }}
      >
        <rect x={0} y={0} width={size.w} height={size.h} fill={th.canvasBg} />

        <g transform={`translate(${panX},${panY}) scale(${zoom})`}>
          {showGrid && <g>{gridLines}</g>}
          <rect
            x={doc.viewBox[0]}
            y={doc.viewBox[1]}
            width={doc.viewBox[2]}
            height={doc.viewBox[3]}
            fill={doc.background}
            className="artboard-frame"
            strokeWidth={1 / zoom}
          />
          <DefsView doc={doc} />
          <g>
            {liteActive
              ? doc.nodes[doc.rootId]?.children.map((id) => <LiteBox key={id} doc={doc} id={id} />)
              : doc.nodes[doc.rootId]?.children.map((id) => <NodeView key={id} doc={doc} id={id} />)}
          </g>
          <Overlay
            box={selBox}
            boxes={selBoxes}
            multi={multi}
            zoom={zoom}
            marquee={marquee}
            guides={guides}
            hoverBox={hoverBox}
            anchors={anchorsView}
            anchorActive={-1}
          />
        </g>

        {showRulers && (
          <g>
            <rect x={0} y={0} width={size.w} height={20} className="ruler-bg" />
            <rect x={0} y={0} width={20} height={size.h} className="ruler-bg" />
            {rulerTicks}
          </g>
        )}
      </svg>
      <TextEditor />
      <ContextMenu />
      <div className="canvas-status">
        <span>{(zoom * 100).toFixed(0)}%</span>
        <span>
          {doc.width} × {doc.height}
        </span>
        <span>{t('status_selected')} {selection.length}</span>
        {store.state.liteMode && <span className="lite-badge">LITE</span>}
      </div>
    </div>
  );
};

/** 轻量模式代理渲染：只画包围盒 */
const LiteBox: React.FC<{ doc: SvgDoc; id: string }> = ({ doc, id }) => {
  const node = doc.nodes[id];
  if (!node || !node.visible) return null;
  const box = nodeBBox(doc, id);
  if (box.w + box.h <= 0) return null;
  return (
    <rect
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      fill={node.attrs['fill'] && node.attrs['fill'] !== 'none' ? node.attrs['fill'] : '#cbd5e1'}
      stroke={node.attrs['stroke'] ?? '#94a3b8'}
      strokeWidth={Number(node.attrs['stroke-width'] ?? 1)}
      opacity={0.9}
    />
  );
};

/** 画布右键菜单 */
const ContextMenu: React.FC = () => {
  useVersion();
  const cm = store.state.contextMenu;
  const lang = currentLang();
  if (!cm) return null;
  const L = (zh: string, en: string) => (lang === 'en' ? en : zh);
  const has = !!cm.id && !!store.state.doc.nodes[cm.id as string];
  const sel = store.state.selection;
  const item = (label: string, fn: () => void, disabled = false) => (
    <button
      key={label}
      className="ctx-item"
      disabled={disabled}
      onClick={() => {
        fn();
        store.set({ contextMenu: null });
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="ctx-menu" style={{ left: cm.x, top: cm.y }} onMouseLeave={() => store.set({ contextMenu: null })}>
      {item(L('复制', 'Duplicate'), () => duplicateSelection(), !has && sel.length === 0)}
      {item(L('编组', 'Group'), () => groupSelection(), sel.length < 2)}
      {item(L('解组', 'Ungroup'), () => ungroupSelection(), !sel.some((id) => store.state.doc.nodes[id]?.type === 'group'))}
      {item(L('置顶', 'Bring to front'), () => reorderSelection('top'), sel.length === 0)}
      {item(L('上移一层', 'Bring forward'), () => reorderSelection('up'), sel.length === 0)}
      {item(L('下移一层', 'Send backward'), () => reorderSelection('down'), sel.length === 0)}
      {item(L('置底', 'Send to back'), () => reorderSelection('bottom'), sel.length === 0)}
      {item(L('编辑节点', 'Edit nodes'), () => {
        if (cm.id) store.set({ tool: 'node', pathEditId: cm.id, selection: [cm.id] });
      }, !has || !['path', 'polygon', 'polyline'].includes(store.state.doc.nodes[cm.id as string]?.type ?? ''))}
      {item(L('删除', 'Delete'), () => deleteSelection(), sel.length === 0)}
    </div>
  );
};

/** 文本就地编辑浮层 */
const TextEditor: React.FC = () => {
  useVersion();
  const { editingTextId, doc, zoom, panX, panY } = store.state;
  if (!editingTextId || !doc.nodes[editingTextId]) return null;
  const node = doc.nodes[editingTextId];
  const box = nodeBBox(doc, editingTextId);
  const left = box.x * zoom + panX;
  const top = box.y * zoom + panY;
  const fs = parseFloat(node.attrs['font-size'] ?? '24') * zoom;
  return (
    <textarea
      className="text-editor"
      autoFocus
      style={{
        left,
        top,
        fontSize: fs,
        minWidth: Math.max(120, box.w * zoom + 40),
        fontFamily: node.attrs['font-family'] ?? 'sans-serif',
        color: node.attrs['fill'] ?? '#000',
      }}
      value={node.text ?? ''}
      onChange={(e) => {
        node.text = e.target.value;
        store.bump();
      }}
      onBlur={() => {
        patchNode(editingTextId, { text: node.text ?? '' }, '编辑文本');
        store.set({ editingTextId: null });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
};
