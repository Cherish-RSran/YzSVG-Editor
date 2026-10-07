import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './panels/Toolbar';
import LayersPanel from './panels/LayersPanel';
import Inspector from './panels/Inspector';
import { SourcePanel, Dock } from './panels/SourcePanel';
import { ExportDialog } from './panels/ExportDialog';
import { ShortcutsHelp } from './panels/ShortcutsHelp';
import { Manual } from './panels/Manual';
import { SnapshotPanel } from './panels/SnapshotPanel';
import { store, useVersion, notify } from './state/store';
import { clearCanvas, fitToViewport } from './state/actions';
import { useShortcuts } from './shortcuts';
import {
  installPasteImport,
  installUnloadGuard,
  loadAutosave,
  saveAutosave,
  clearAutosave,
  hasAutosave,
  syncAutosaveBaseline,
} from './io';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Resizer } from './components/Resizer';
import { TooltipLayer } from './components/Tooltip';
import { tf, currentLang, useT } from './i18n';

/** 侧栏宽度上下限：太窄字段挤成一团，太宽又挤占画布 */
const MIN_LEFT = 180;
const MAX_LEFT = 520;
const MIN_RIGHT = 190;
const MAX_RIGHT = 560;
const MIN_SRC = 220;
const MAX_SRC = 760;
const MIN_SRC_H = 140;
const MAX_SRC_H = 520;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const App: React.FC = () => {
  useVersion();
  useShortcuts();
  const t = useT();
  const { message, showSource, showExport, showShortcuts, showManual, theme, lang } = store.state;

  // 左右侧栏：可拖动宽度、可整栏收起（收起后画布铺满）
  const [leftW, setLeftW] = useState(260);
  const [rightW, setRightW] = useState(280);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  // 源码面板默认不占地方，打开时停靠在画布右侧（可拖宽），也可改停靠底部
  const [srcDock, setSrcDock] = useState<Dock>('right');
  const [srcW, setSrcW] = useState(320);
  const [srcH, setSrcH] = useState(240);

  // 打开源码 = 进入"看代码"模式：左右两栏默认让位，画布 2/3 + 源码 1/3。
  // 只在 false→true 这一次跳变时布局，之后用户自己拖宽/拉回侧栏都不再干预。
  // 关掉源码时把侧栏恢复成打开源码之前的样子，避免"看一眼代码，面板就没了"。
  const prevSource = useRef(showSource);
  const restore = useRef<{ left: boolean; right: boolean } | null>(null);
  useEffect(() => {
    if (showSource && !prevSource.current) {
      restore.current = { left: leftOpen, right: rightOpen };
      setLeftOpen(false);
      setRightOpen(false);
      // 中间区域 ≈ 窗口宽减去两条收起边栏；取三分之一给源码，剩下约三分之二留给画布
      setSrcW(Math.round(clamp((window.innerWidth - 40) / 3, MIN_SRC, MAX_SRC)));
      setSrcH(Math.round(clamp(window.innerHeight / 3, MIN_SRC_H, MAX_SRC_H)));
    } else if (!showSource && prevSource.current && restore.current) {
      setLeftOpen(restore.current.left);
      setRightOpen(restore.current.right);
      restore.current = null;
    }
    prevSource.current = showSource;
    // 只在开关源码时跑：leftOpen/rightOpen 的变化不该触发重新布局
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSource]);

  // 打开源码、以及切换停靠（右侧 ↔ 底部）都会改变画布可用区域，
  // 画板必须重新适应成 100%，否则要么被挤出去一截、要么缩在一角。
  // 要等布局真正落地后再 fit：同一帧里 .canvas-wrap 还是旧尺寸。
  useEffect(() => {
    if (!showSource) return;
    const timer = window.setTimeout(() => fitToViewport(), 60);
    return () => window.clearTimeout(timer);
  }, [showSource, srcDock]);

  // 自动保存 / 恢复：**不再擅自恢复**——先探测有没有上次没打开的内容，有就弹出来问用户。
  // 在用户做出选择之前不能启动自动保存：否则当前空白画布会在 8 秒后把那份自动保存覆盖掉，
  // 等于用户还没选，东西就没了。
  const [askRestore, setAskRestore] = useState(false);
  const autosaveTimer = useRef<number | null>(null);
  const savedVersion = useRef(-1);
  const startAutosave = useCallback(() => {
    if (autosaveTimer.current !== null) return;
    autosaveTimer.current = window.setInterval(() => {
      // 没动过就别写：序列化整份文档不算便宜，空转 8 秒一次纯属浪费
      const v = store.state.version;
      if (v === savedVersion.current) return;
      savedVersion.current = v;
      void saveAutosave(store.state.doc);
    }, 8000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hasAutosave().then((has) => {
      if (cancelled) return;
      if (has) {
        // 有上次内容：弹窗等用户决定。在用户选择之前**不启动自动保存**，
        // 同时把当前这份空白画布记为基线——否则用户一直不点、直接关掉页面时，
        // 卸载保护会把空白画布写进去，把还没打开的那份内容覆盖掉。
        setAskRestore(true);
        syncAutosaveBaseline();
      } else {
        // 本来就没有上次内容：把当前空白文档记为基线，
        // 否则"打开看了一眼就关掉"也会被存成一条自动保存，下次启动又来弹窗。
        syncAutosaveBaseline();
        startAutosave();
      }
    });
    return () => {
      cancelled = true;
      if (autosaveTimer.current !== null) {
        window.clearInterval(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [startAutosave]);

  const openLastSession = async () => {
    setAskRestore(false);
    const ok = await loadAutosave();
    // 以读进来的文档为准重新定基线：源码排版可能和存档文本不完全一致，
    // 不重新取一次的话"什么都没改"也会被判成有改动而再存一份。
    syncAutosaveBaseline();
    if (ok) notify(tf('msg_restored', currentLang()), 'info');
    startAutosave();
  };
  const discardLastSession = () => {
    setAskRestore(false);
    clearAutosave(); // 用户选择不打开 → 清掉，从空白画布开始
    syncAutosaveBaseline(); // 清完之后当前空白画布就是基线：没改动就别再存一份
    startAutosave();
  };

  useEffect(() => installPasteImport(), []);
  useEffect(() => installUnloadGuard(), []);

  // 主题与语言：主题走 data-theme，配色由 CSS 变量统一接管（见 styles.css 顶部）
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  }, [theme, lang]);

  // 拖拽导入
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) {
        if (/svg/i.test(file.type + file.name)) void importDropped(file);
        else if (/^image\//.test(file.type)) void dropImage(file);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        {/* 说明书 / 清空画布固定在顶栏最右上角：塞在工具栏里会在窄窗口换行，
            一带换行就会把第二行按钮整体挤到右边，位置不再稳定 */}
        <div className="header-top">
          <div className="brand" data-tip="YzSVG Editor 2.0.1 · Cherish-RSran">
            YzSVG<span className="brand-em">Editor</span>
            <span className="brand-ver">2.0.1</span>
          </div>
          <div className="header-actions">
            <button
              className="tb-manual"
              data-tip={t('tip_manual')}
              onClick={() => store.set({ showManual: true })}
            >
              <span className="tb-manual-ico">📖</span>
              {t('manual')}
            </button>
            <button className="tb-clear" data-tip={t('tip_clear_canvas')} onClick={() => clearCanvas()}>
              <span className="tb-clear-ico">🧹</span>
              {t('clear_canvas')}
            </button>
          </div>
        </div>
        <Toolbar />
      </header>
      <div className="app-body">
        {leftOpen ? (
          <>
            <aside className={`app-left ${leftW < 220 ? 'narrow' : ''}`} style={{ width: leftW }}>
              <LayersPanel onCollapse={() => setLeftOpen(false)} />
              <SnapshotPanel />
            </aside>
            <Resizer
              side="left"
              tip={t('drag_resize')}
              onResize={(dx) => setLeftW((w) => clamp(w + dx, MIN_LEFT, MAX_LEFT))}
              onCollapse={() => setLeftOpen(false)}
            />
          </>
        ) : (
          <button className="rail-btn" data-tip={t('expand_panel')} onClick={() => setLeftOpen(true)}>
            »
          </button>
        )}

        {/* 源码停靠底部时中间区域改成纵向排布，否则它会挤到画布右边而不是下面 */}
        <main className={`app-center ${showSource ? `src-${srcDock}` : ''}`}>
          <ErrorBoundary>
            <Canvas />
          </ErrorBoundary>
          {showSource && srcDock === 'right' && (
            <Resizer
              side="right"
              tip={t('drag_resize')}
              onResize={(dx) => setSrcW((w) => clamp(w - dx, MIN_SRC, MAX_SRC))}
              onCollapse={() => store.set({ showSource: false })}
            />
          )}
          {showSource && (
            <SourcePanel
              dock={srcDock}
              width={srcW}
              height={srcH}
              onHeight={(h) => setSrcH(clamp(h, MIN_SRC_H, MAX_SRC_H))}
              onDock={setSrcDock}
            />
          )}
        </main>

        {rightOpen ? (
          <>
            <Resizer
              side="right"
              tip={t('drag_resize')}
              onResize={(dx) => setRightW((w) => clamp(w - dx, MIN_RIGHT, MAX_RIGHT))}
              onCollapse={() => setRightOpen(false)}
            />
            <aside className={`app-right ${rightW < 230 ? 'narrow' : ''}`} style={{ width: rightW }}>
              <Inspector onCollapse={() => setRightOpen(false)} />
            </aside>
          </>
        ) : (
          <button className="rail-btn" data-tip={t('expand_panel')} onClick={() => setRightOpen(true)}>
            «
          </button>
        )}
      </div>
      {message && <div className={`toast toast-${message.kind}`}>{message.text}</div>}
      {askRestore && (
        <div className="modal-mask">
          <div className="modal narrow">
            <div className="modal-head">
              <div className="modal-title">{t('ask_restore_title')}</div>
            </div>
            <div className="modal-body">
              <p className="ask-desc">{t('ask_restore_desc')}</p>
              <div className="btn-row">
                <button className="wide-btn" onClick={() => void openLastSession()}>
                  {t('ask_restore_open')}
                </button>
                <button className="mini-btn" onClick={discardLastSession}>
                  {t('ask_restore_discard')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showExport && <ExportDialog onClose={() => store.set({ showExport: false })} />}
      {showManual && <Manual />}
      {showShortcuts && <ShortcutsHelp />}
      <TooltipLayer />
    </div>
  );
};

async function importDropped(file: File): Promise<void> {
  const { importFromFile } = await import('./io');
  await importFromFile(file);
}

async function dropImage(file: File): Promise<void> {
  const { insertImage } = await import('./io');
  await insertImage(file);
}

export default App;
