import React, { useEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { Decoration, EditorView } from '@codemirror/view';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { xml } from '@codemirror/lang-xml';
import { store, useVersion } from '../state/store';
import { parseSvg } from '../core/parse';
import { serializeDoc } from '../core/serialize';
import { notify } from '../state/store';
import { selectOnly } from '../state/actions';
import { rangeOfId, idAtCursor, sourceIdOf, nodeIdOf } from '../core/source-map';
import { SvgDoc } from '../core/types';
import { useT, tf, currentLang } from '../i18n';

export type Dock = 'bottom' | 'right';

/**
 * 「当前选中元素在源码里的那一段」的高亮。
 *
 * 两个坑，都踩过：
 * 1. 必须用 decoration 而不是设置编辑器选区：CodeMirror 只在**编辑器获得焦点时**才绘制选区背景，
 *    从画布点选元素时编辑器通常是失焦的 —— 那样用户就会以为代码根本没高亮。
 * 2. 装饰的**字符位置必须每次重算**，不能靠 Decoration.map 从旧位置搬运：
 *    画布一改（拖动、改属性）就把整份 doc 重新序列化写进编辑器（全量替换）,
 *    map 会认为那段文本已被删除，把高亮直接扔掉。于是「刚选中还有框，动一下就没了」。
 *    所以这里只记 id，位置由 decorations.compute 在每个 doc 版本上重算。
 */
export const setActiveNode = StateEffect.define<string | null>();
const activeMark = Decoration.mark({ class: 'cm-node-active' });

/** 只记「选中了哪个 id」，不记位置 */
const activeIdField = StateField.define<string | null>({
  create: () => null,
  update(id, tr) {
    for (const e of tr.effects) if (e.is(setActiveNode)) return e.value;
    return id;
  },
});

/**
 * decoration 的 compute 只能拿到 EditorState，拿不到 store 的 doc，
 * 所以由组件每次渲染时把当前 doc 同步进来，供「源码 id ≠ 内部 id」时兜底反查。
 */
let activeDoc: SvgDoc | null = null;

const activeDecorations = EditorView.decorations.compute([activeIdField, 'doc'], (state) => {
  const id = state.field(activeIdField);
  if (!id) return Decoration.none;
  const text = state.doc.toString();
  const r = rangeOfId(text, id) ?? (activeDoc ? rangeOfId(text, sourceIdOf(activeDoc, id)) : null);
  return r ? Decoration.set([activeMark.range(r.from, r.to)]) : Decoration.none;
});

/**
 * 源码面板：画布 ↔ SVG 源码 双向实时同步
 * - 画布改动 → 序列化后写入编辑器（用户正在输入时不打断）
 * - 源码改动 → 防抖 400ms 后解析回灌（失败保留源码并提供回滚）
 * - 光标落在哪个元素上 → 画布 / 图层同步选中（反之亦然）
 * 停靠方式与右侧宽度由 App 托管：它要同时决定中间区域的排布方向。
 */
export const SourcePanel: React.FC<{
  dock: Dock;
  width: number;
  /** 底部停靠时的高度（和宽度一样由 App 托管，打开时统一按 1/3 布局） */
  height: number;
  onHeight: (h: number) => void;
  onDock: (d: Dock) => void;
}> = ({ dock, width, height, onHeight, onDock }) => {
  useVersion();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const internal = useRef(false);
  /** 我们自己在往编辑器里写（画布 → 源码） */
  const programmatic = useRef(false);
  const timer = useRef<number | null>(null);
  const lastGood = useRef<string>('');
  const t = useT();
  activeDoc = store.state.doc; // 给 decoration 的兜底反查用（见 activeDecorations）
  const [error, setError] = useState<string | null>(null);

  /** 源码里某个字符位置 → 画布选中该位置所属的元素。幂等，避免两边来回抖动 */
  const syncAt = (pos: number, text: string) => {
    const sid = idAtCursor(text, pos);
    if (!sid) return;
    // 源码里的 id 未必等于内部 id（导入件的元素自带 id），先反查成内部 id
    const id = nodeIdOf(store.state.doc, sid);
    if (!id || !store.state.doc.nodes[id]) return;
    const cur = store.state.selection;
    if (cur.length === 1 && cur[0] === id) return;
    selectOnly(id);
  };

  // 初始化编辑器
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const initial = serializeDoc(store.state.doc);
    lastGood.current = initial;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          xml(),
          EditorView.lineWrapping,
          activeIdField,
          activeDecorations,
          EditorView.updateListener.of((update) => {
            // 画布回写进来的改动不算用户输入：不能把它当成「正在打字」，
            // 否则 internal 会一直挂着，后面点代码选中元素就被跳过了。
            if (programmatic.current) return;
            if (update.docChanged) {
              internal.current = true;
              const text = update.state.doc.toString();
              if (timer.current) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => applySource(text), 400);
            }
            // 光标在源码里移动 → 同步选中对应元素（图层行、画布选框都会跟着高亮）
            if (update.selectionSet) {
              syncAt(update.state.selection.main.head, update.state.doc.toString());
            }
          }),
          // 兜底：直接用点击坐标换算字符位置。只靠上面的 selectionSet 不够稳
          // （点在同一位置、编辑器还没聚焦等情况下它可能不触发），而「点代码选中要素」
          // 是用户最常用的操作，必须每条路径都能走到。
          EditorView.domEventHandlers({
            mousedown(event, view) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false; // jsdom / 没有布局信息时忽略
              syncAt(pos, view.state.doc.toString());
              return false; // 不拦截：CodeMirror 自己还要处理光标与聚焦
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  const applySource = (text: string) => {
    try {
      const { doc } = parseSvg(text);
      const prevSelection = store.state.selection;
      store.state.doc = doc;
      const stillThere = prevSelection.filter((id) => doc.nodes[id]);
      store.set({ selection: stillThere, pathEditId: null });
      lastGood.current = text;
      setError(null);
    } catch (e) {
      setError((e as Error).message || (currentLang() === 'en' ? 'SVG parse failed' : 'SVG 解析失败'));
    } finally {
      internal.current = false;
    }
  };

  // 画布变化 → 同步到编辑器
  const version = store.state.version;
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (internal.current) return;
    const next = serializeDoc(store.state.doc);
    const current = view.state.doc.toString();
    if (next === current) return;
    lastGood.current = next;
    programmatic.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
    programmatic.current = false;
  }, [version]);

  // 选中元素 → 在源码里整段高亮并滚进视野（整段比整行更准：一行可能挤了多个元素）
  // 只画 decoration、不动编辑器选区：一来失焦时也看得见，二来不抢用户正在编辑的光标。
  const selection = store.state.selection;
  const selKey = selection.join(',');
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const id = selection.length === 0 ? null : selection[0];
    // 位置交给 activeDecorations 按当前文本算：这里只负责滚动到可见处
    const r = id ? rangeOfId(view.state.doc.toString(), sourceIdOf(store.state.doc, id)) : null;
    programmatic.current = true;
    view.dispatch({
      effects: [
        setActiveNode.of(id),
        ...(r ? [EditorView.scrollIntoView(r.from, { y: 'center' })] : []),
      ],
    });
    programmatic.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  const rollback = () => {
    const view = viewRef.current;
    if (!view) return;
    programmatic.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: lastGood.current } });
    programmatic.current = false;
    setError(null);
    notify(tf('msg_rollback', currentLang()), 'info');
  };

  return (
    <div className={`source-panel dock-${dock}`} style={dock === 'bottom' ? { height } : { width }}>
      <div className="source-head">
        <span className="source-title">{t('source_title')}</span>
        <span className="source-hint">{t('source_hint')}</span>
        <div className="source-actions">
          {error && (
            <button className="mini-btn danger" onClick={rollback}>
              {t('undo_edit')}
            </button>
          )}
          <button className="mini-btn" onClick={() => onDock(dock === 'bottom' ? 'right' : 'bottom')}>
            {dock === 'bottom' ? t('dock_right') : t('dock_bottom')}
          </button>
          {/* 停靠右侧时宽度靠拖分隔条，这里只留底部停靠用的高度按钮 */}
          {dock === 'bottom' && (
            <>
              <button className="mini-btn" onClick={() => onHeight(height - 60)}>
                −
              </button>
              <button className="mini-btn" onClick={() => onHeight(height + 60)}>
                ＋
              </button>
            </>
          )}
          <button className="mini-btn" onClick={() => store.set({ showSource: false })}>
            {t('close')}
          </button>
        </div>
      </div>
      {error && <div className="source-error">{tf('source_error', currentLang(), { msg: error })}</div>}
      <div className="source-host" ref={hostRef} />
    </div>
  );
};
