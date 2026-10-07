import { useCallback, useRef, useSyncExternalStore } from 'react';
import { SvgDoc, ToolId, emptyDoc } from '../core/types';
import { History } from '../core/history';
import { ThemeId } from '../core/theme';

export interface EditorState {
  doc: SvgDoc;
  selection: string[];
  tool: ToolId;
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  gridSize: number;
  snapEnabled: boolean;
  showRulers: boolean;
  version: number;
  editingTextId: string | null;
  hoverId: string | null;
  message: { text: string; kind: 'info' | 'error' | 'success' } | null;
  /** 当前正在编辑路径的节点（节点工具） */
  pathEditId: string | null;
  /** 源码面板是否显示 */
  showSource: boolean;
  /** 界面主题（全是浅色系：只换画布底色与网格，画板恒为白色） */
  theme: ThemeId;
  /** 语言 */
  lang: 'zh' | 'en';
  /** 快捷键帮助面板 */
  showShortcuts: boolean;
  /** 说明书（功能介绍与使用指南） */
  showManual: boolean;
  /** 性能轻量模式（元素过多时降级） */
  liteMode: boolean;
  /** 缩放时保持横纵比（默认开）；按住 Shift 可临时反转 */
  keepAspect: boolean;
  /** 「适应视口」对应的缩放比例：缩放百分比以它为 100% 基准（打开/适应后就是 100%） */
  fitZoom: number;
  /** 导出对话框 */
  showExport: boolean;
  /** 右键菜单（屏幕坐标 + 命中的节点） */
  contextMenu: { x: number; y: number; id: string | null } | null;
}

type Listener = () => void;

const initialDoc = emptyDoc(800, 600);

class EditorStore {
  state: EditorState = {
    doc: initialDoc,
    selection: [],
    tool: 'select',
    zoom: 1,
    panX: 0,
    panY: 0,
    showGrid: true,
    gridSize: 10,
    snapEnabled: true,
    showRulers: true,
    version: 0,
    editingTextId: null,
    hoverId: null,
    message: null,
    pathEditId: null,
    showSource: false,
    theme: 'classic',
    lang: 'zh',
    showShortcuts: false,
    showManual: false,
    liteMode: false,
    keepAspect: true,
    fitZoom: 1,
    showExport: false,
    contextMenu: null,
  };

  history = new History(100);
  private listeners = new Set<Listener>();

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  set(patch: Partial<EditorState>, bump = true): void {
    this.state = { ...this.state, ...patch };
    if (bump) this.state = { ...this.state, version: this.state.version + 1 };
    this.emit();
  }

  /** 文档被修改后调用：只增加版本号触发重渲染 */
  bump(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
    this.emit();
  }

  private emit(): void {
    for (const l of Array.from(this.listeners)) l();
  }
}

export const store = new EditorStore();

export function getState(): EditorState {
  return store.state;
}

/** 订阅式选择器 hook */
export function useEditor<T>(
  selector: (s: EditorState) => T,
  equals: (a: T, b: T) => boolean = Object.is,
): T {
  const ref = useRef<{ value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const next = selector(store.state);
    if (!ref.current || !equals(ref.current.value, next)) {
      ref.current = { value: next };
    }
    return ref.current.value;
  }, [selector, equals]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useVersion(): number {
  return useEditor((s) => s.version);
}

export function notify(text: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  store.set({ message: { text, kind } });
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (store.state.message?.text === text) store.set({ message: null });
    }, 2600);
  }
}
