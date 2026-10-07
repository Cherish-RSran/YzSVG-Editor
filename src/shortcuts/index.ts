import { useEffect } from 'react';
import { store, notify } from '../state/store';
import {
  beginTransaction,
  commitTransaction,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  redo,
  selectAll,
  setSelection,
  setTool,
  translateNodes,
  ungroupSelection,
  undo,
  fitToViewport,
} from '../state/actions';
import { exportSvg } from '../io';
import { tf } from '../i18n';
import { ToolId } from '../core/types';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  g: 'polygon',
  s: 'star',
  p: 'pen',
  b: 'pencil',
  a: 'node',
  t: 'text',
};

function isTypingTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = e.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || e.isContentEditable;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const meta = e.ctrlKey || e.metaKey;
      const s = store.state;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportSvg(s.doc, 'drawing.svg');
        notify(tf('msg_exported_svg', s.lang), 'success');
        return;
      }
      if (meta && e.key === '0') {
        // 100% = 「适应」的比例（缩放百分比以它为基准），顺带把画板拉回视口中央
        e.preventDefault();
        fitToViewport();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        store.set({ contextMenu: null, showExport: false, showShortcuts: false, showManual: false });
        if (s.tool !== 'select') setTool('select');
        else setSelection([]);
        store.set({ editingTextId: null, pathEditId: null });
        return;
      }
      if (e.key === '/' && meta) {
        e.preventDefault();
        store.set({ showShortcuts: !s.showShortcuts });
        return;
      }
      if (e.key.startsWith('Arrow') && s.selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        beginTransaction('微调', s.selection);
        translateNodes(s.selection, dx, dy);
        commitTransaction();
        return;
      }
      if (e.key === 'Shift' && e.location === 0 && false) return;
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool && !meta && !e.altKey) {
        setTool(tool);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
