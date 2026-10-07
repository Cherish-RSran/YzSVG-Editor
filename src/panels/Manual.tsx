import React, { useState } from 'react';
import { store } from '../state/store';

type L = { zh: string; en: string };
type Item = { h: L; p: L };
type Section = { title: L; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: { zh: '🚀 快速上手', en: '🚀 Quick start' },
    items: [
      {
        h: { zh: '画第一个图形', en: 'Draw your first shape' },
        p: {
          zh: '在左侧工具栏点 **「矩形」**，然后在画布上按住左键拖出一个框，松手即完成。默认样式是无填充 + 2px 深色描边。',
          en: 'Pick Rectangle in the toolbar, drag on the canvas and release. Default style is no fill + 2px dark stroke.',
        },
      },
      {
        h: { zh: '选中并移动', en: 'Select and move' },
        p: {
          zh: '切回 **「选择」** 工具，点一下图形即选中（出现实线框和 8 个手柄）。鼠标落在**选区范围内**时光标变成移动符号，按住拖动即可移动。想推倒重来就点右上角 **🧹 清空画布**。',
          en: 'Switch back to Select, click a shape. When the cursor is inside the selection the cursor becomes "move"; drag to move it.',
        },
      },
      {
        h: { zh: '改样式', en: 'Restyle' },
        p: {
          zh: '右侧「属性」面板可以改填充、描边、圆角、透明度、位置尺寸、旋转角度等，改完立即生效。',
          en: 'The Inspector on the right edits fill, stroke, corner radius, opacity, position/size, rotation — all live.',
        },
      },
      {
        h: { zh: '导出', en: 'Export' },
        p: {
          zh: '顶栏「导出」可导出 SVG / PNG / JPG / WebP / PDF，也能生成 React JSX、Vue 组件、DataURI、Base64、CSS 背景和 HTML 片段。',
          en: 'Use Export for SVG / PNG / JPG / WebP / PDF, or generate React JSX, Vue SFC, DataURI, Base64, CSS background and HTML snippets.',
        },
      },
    ],
  },
  {
    title: { zh: '🖥️ 界面布局', en: '🖥️ Layout' },
    items: [
      {
        h: { zh: '顶栏', en: 'Toolbar' },
        p: {
          zh: '工具、对齐分布、层级、布尔运算、撤销重做、网格与吸附、缩放、源码、导出、说明书与清空画布、主题与语言。右上角是 **📖 说明书**（全部功能的用法）和 **🧹 清空画布**（一键删光所有元素与分组，并自动适应窗口，Ctrl+Z 可撤销）。',
          en: 'Tools, align/distribute, z-order, boolean ops, undo/redo, grid & snap, zoom, source, export, manual & clear canvas, theme and language. Top-right: Manual (how everything works) and Clear canvas (removes all elements and groups, then refits — undo with Ctrl+Z).',
        },
      },
      {
        h: { zh: '左侧：图层与快照', en: 'Left: layers & snapshots' },
        p: {
          zh: '图层树按「上层在前」倒序排列，可直接改名字、显示/隐藏、锁定、编组解组。下面是历史快照，可随时保存与回滚。',
          en: 'The layer tree is in reverse z-order; rename, show/hide, lock, group/ungroup inline. Below are history snapshots.',
        },
      },
      {
        h: { zh: '中间：画布', en: 'Center: canvas' },
        p: {
          zh: '白色区域是画板（导出的范围）。滚轮缩放，空格或中键拖拽平移，Shift+1 适应窗口，Ctrl+0 回到 100%。',
          en: 'The white board is the export area. Wheel to zoom, space or middle-drag to pan, Shift+1 to fit, Ctrl+0 for 100%.',
        },
      },
      {
        h: { zh: '右侧：属性面板', en: 'Right: inspector' },
        p: {
          zh: '选中元素后显示其全部参数；每个参数都有悬停说明。顶部可直接重命名，选中组时会有「组」徽标。',
          en: 'Shows every parameter of the selection with hover hints. Rename at the top; groups show a badge.',
        },
      },
      {
        h: { zh: '源码面板', en: 'Source panel' },
        p: {
          zh: '顶栏「源码」打开。打开时会自动收起左右两栏（画布约 2/3、源码约 1/3），可切换停靠右侧或底部。',
          en: 'Toggle via Source. It collapses the side panels (canvas ~2/3, source ~1/3) and can dock right or bottom.',
        },
      },
    ],
  },
  {
    title: { zh: '✏️ 绘图工具', en: '✏️ Drawing tools' },
    items: [
      {
        h: { zh: '矩形 / 椭圆', en: 'Rectangle / ellipse' },
        p: {
          zh: '按住左键拖拽绘制。矩形可在属性面板调圆角。',
          en: 'Drag to draw. Rectangles support corner radius in the inspector.',
        },
      },
      {
        h: { zh: '直线', en: 'Line' },
        p: {
          zh: '默认吸附到水平/竖直（偏离 7° 内自动拉正）；Shift 画 45° 斜线，Alt 关闭吸附画任意角度。可设置起终点箭头。',
          en: 'Snaps to horizontal/vertical within 7°. Shift = 45°, Alt = free angle. Start/end arrows are configurable.',
        },
      },
      {
        h: { zh: '多边形 / 星形', en: 'Polygon / star' },
        p: { zh: '拖拽决定外接半径，属性面板可改边数/角数。', en: 'Drag sets the radius; adjust points in the inspector.' },
      },
      {
        h: { zh: '钢笔', en: 'Pen' },
        p: {
          zh: '点击加点，按住拖动出曲线，点回起点或按回车结束；右键也可结束。线段上可继续拖动控制柄微调。',
          en: 'Click to add points, drag for curves, click the start point or press Enter to finish; right-click also finishes.',
        },
      },
      {
        h: { zh: '铅笔', en: 'Pencil' },
        p: { zh: '按住自由涂画，松手后自动平滑成路径。', en: 'Freehand drawing; smoothing is applied on release.' },
      },
      {
        h: { zh: '文本', en: 'Text' },
        p: {
          zh: '点击放置后可直接输入，双击已有文本再次编辑。导入的 SVG 文字同样可编辑（内联 style 与 <style> 规则会被展开成属性）。',
          en: 'Click to place and type; double-click to edit again. Imported SVG text is editable (inline styles are expanded).',
        },
      },
      {
        h: { zh: '节点编辑', en: 'Node editing' },
        p: {
          zh: '选中路径后按 **A** 或双击进入节点模式：拖动方块调曲线，Alt+点击删除锚点。',
          en: 'Select a path and press A (or double-click) to edit anchors: drag handles, Alt+click to delete.',
        },
      },
    ],
  },
  {
    title: { zh: '🎯 选择与变换', en: '🎯 Select & transform' },
    items: [
      {
        h: { zh: '点选与穿透', en: 'Picking' },
        p: {
          zh: '直接点选中最上面的**「最小要素」**。重叠时按住 **Alt+点击** 可循环穿透到下一层。',
          en: 'Clicking picks the topmost leaf element. Hold Alt and click to cycle through stacked elements.',
        },
      },
      {
        h: { zh: '多选', en: 'Multi-select' },
        p: {
          zh: '**Ctrl/Cmd + 点击** ＝ 加选 ➕ / 减选 ➖；框选（拖一个框完全包围）可选中一批要素。在图层面板里 Shift+点击可连选两行之间的所有图层。整组请在图层面板点组本身。',
          en: 'Ctrl/Cmd+click toggles; marquee selects fully enclosed shapes. In layers, Shift+click selects a range. Select a whole group from the layer tree.',
        },
      },
      {
        h: { zh: '移动 / 缩放 / 旋转', en: 'Move / scale / rotate' },
        p: {
          zh: '拖动 **8 个手柄** 缩放（默认保持横纵比，Shift 临时反转 🔀），拖上方圆点 **旋转**（Shift 每 15° 吸附）。方向键微调 1px，Shift+方向键 10px。',
          en: 'Drag the 8 handles to scale (aspect locked by default, Shift to invert), drag the round handle to rotate (Shift snaps to 15°). Arrow keys nudge.',
        },
      },
      {
        h: { zh: '吸附与参考线', en: 'Snapping' },
        p: {
          zh: '开启「吸附」后拖动会与画板边界、其它元素边缘/中线对齐并显示参考线；按住 Alt 临时关闭吸附。',
          en: 'With Snap on, dragging aligns to the artboard and other elements with guides. Hold Alt to disable temporarily.',
        },
      },
      {
        h: { zh: '选中后的光标含义', en: 'Cursor semantics' },
        p: {
          zh: '鼠标落在选区范围内时是移动符号（按下即拖动当前选区）；移到选区外面会恢复正常，此时点别的元素就是换选它。按住 Ctrl 时随时可加选/减选。',
          en: 'Inside the selection the cursor is "move" (drag moves the selection); outside it is normal picking. Hold Ctrl to toggle selection anytime.',
        },
      },
    ],
  },
  {
    title: { zh: '🗂️ 图层与属性', en: '🗂️ Layers & inspector' },
    items: [
      {
        h: { zh: '图层操作', en: 'Layer operations' },
        p: {
          zh: '眼睛图标显示/隐藏，锁图标锁定（锁定后不会被误选和误改），可就地改名、加备注、拖入组/移出组。Ctrl+点击加减选，Shift+点击连选区间。',
          en: 'Eye = visibility, lock = protect from selection/editing. Rename inline, add notes, regroup by dragging. Ctrl+click toggles, Shift+click selects a range.',
        },
      },
      {
        h: { zh: '对齐与分布', en: 'Align & distribute' },
        p: {
          zh: '选中 2 个以上元素后，顶栏对齐按钮按「选区包围盒」对齐；分布需要 3 个以上。',
          en: 'With 2+ selected, align buttons work on the selection bbox; distribute needs 3+.',
        },
      },
      {
        h: { zh: '布尔运算', en: 'Boolean ops' },
        p: {
          zh: '选中同层级的多个元素后可用「并集 / 交集 / 差集 / 排除」合并成一条路径。',
          en: 'With several elements on the same level, use Union / Intersect / Subtract / Exclude to merge into one path.',
        },
      },
      {
        h: { zh: '快照', en: 'Snapshots' },
        p: {
          zh: '左下快照区可给当前状态存一份（带时间命名，可改名），之后随时回滚对比。',
          en: 'The snapshot area stores named versions (auto-named with time, renameable) that you can restore later.',
        },
      },
    ],
  },
  {
    title: { zh: '💻 源码面板', en: '💻 Source panel' },
    items: [
      {
        h: { zh: '双向同步', en: 'Two-way sync' },
        p: {
          zh: '画布改动会 **实时写进源码**；在源码里改代码（防抖 400ms）也会 **回灌到画布** 🔁。选中元素时，源码里对应标签会高亮；点代码也会选中画布上的元素。',
          en: 'Canvas edits stream into the source; source edits (400ms debounce) flow back. Selecting an element highlights its tag, and clicking code selects the element.',
        },
      },
      {
        h: { zh: '改错了怎么办', en: 'Made a mistake?' },
        p: {
          zh: '源码非法时 **不会破坏画布** 🛡️，面板顶部会出现红色提示条，点 **「撤销这次编辑」** 即可回退到上一个正确版本。',
          en: 'Invalid source never corrupts the canvas: a red bar appears with "Undo this edit" to roll back to the last good version.',
        },
      },
    ],
  },
  {
    title: { zh: '📤 导入与导出', en: '📤 Import & export' },
    items: [
      {
        h: { zh: '导入', en: 'Import' },
        p: {
          zh: '三种方式：点 **「导入」** 选文件 📂；把 .svg 文件直接**拖进窗口** 🖱️；在页面里 **Ctrl+V** 粘贴 SVG 源码 📋。粘贴图片会作为内嵌图插入。仓库里的 **examples/drawing.svg** 是一张三轴云台示意图，可以先导入它试手。',
          en: 'Three ways: the Import button, drag a .svg file into the window, or paste SVG source with Ctrl+V. Pasting an image embeds it. Try examples/drawing.svg (a gimbal drawing) to get started.',
        },
      },
      {
        h: { zh: '导出', en: 'Export' },
        p: {
          zh: '「导出」里可选位图（1–4×、可透明底）、SVG（可选 SVGO 优化并显示压缩率）、PDF，以及 JSX / Vue / DataURI / Base64 / CSS / HTML 代码片段。',
          en: 'Export offers raster (1–4×, transparent option), SVG (optional SVGO with savings report), PDF, plus JSX / Vue / DataURI / Base64 / CSS / HTML snippets.',
        },
      },
      {
        h: { zh: '自动保存与历史记录', en: 'Autosave & history' },
        p: {
          zh: '内容每 8 秒（以及关闭页面时）**自动保存** 💾 到本机浏览器的 **IndexedDB**（数据库 `svg-editor` → 表 `docs` → 键 `autosave`），localStorage 仅作兜底。下次打开会询问是否继续上次编辑；选「不打开」即清空重来。**没有改动就不会写入**，所以随手打开又关掉不会留下记录。三种"历史"各不相同：**Ctrl+Z 撤销栈**只存在内存里（刷新即清空）；**自动保存**只有一份；左侧 **历史快照** 才是自己命名、可随时回滚的多个版本。',
          en: 'Work is autosaved every 8s (and on close) into this browser\'s IndexedDB (`svg-editor` → `docs` → `autosave`), with localStorage as a fallback. Next launch asks whether to reopen it; Discard clears it. Nothing is written when nothing changed. Three different histories: the Ctrl+Z undo stack is memory-only (lost on reload); autosave keeps one copy; the Snapshots panel holds named versions you can roll back to.',
        },
      },
    ],
  },
  {
    title: { zh: '⌨️ 快捷键要点', en: '⌨️ Shortcuts' },
    items: [
      {
        h: { zh: '最常用', en: 'Most used' },
        p: {
          zh: '**V** 选择 · **R** 矩形 · **O** 椭圆 · **L** 直线 · **P** 钢笔 · **T** 文本；Ctrl+Z / Ctrl+Shift+Z 撤销重做；Ctrl+G 编组；Ctrl+D 复制；Delete 删除；Shift+1 适应窗口；Ctrl+/ 看全部快捷键。',
          en: 'V select, R rect, O ellipse, L line, P pen, T text; Ctrl+Z / Ctrl+Shift+Z undo/redo; Ctrl+G group; Ctrl+D duplicate; Delete; Shift+1 fit; Ctrl+/ for all shortcuts.',
        },
      },
      {
        h: { zh: '看全量', en: 'Full list' },
        p: {
          zh: '顶栏「快捷键」按钮（或 Ctrl+/）打开完整列表。',
          en: 'Open the full list from the Shortcuts button (or Ctrl+/).',
        },
      },
    ],
  },
  {
    title: { zh: 'ℹ️ 关于', en: 'ℹ️ About' },
    items: [
      {
        h: { zh: 'YzSVG Editor', en: 'YzSVG Editor' },
        p: {
          zh: 'YzSVG Editor 2.0.1 —— 纯前端 SVG 矢量编辑器，构建产物是单个 HTML + 一份 JS，双击即可离线运行，不依赖任何后端。',
          en: 'YzSVG Editor 2.0.1 — a pure front-end SVG editor. The build is a single HTML plus one JS file: double-click to run offline, no backend.',
        },
      },
      {
        h: { zh: '作者', en: 'Author' },
        p: { zh: 'Cherish-RSran　邮箱：rs.cherishran@gmail.com', en: 'Cherish-RSran　Email: rs.cherishran@gmail.com' },
      },
    ],
  },
];

/** 把 **加粗** 渲染成主色加粗，让说明书里的关键词一眼能看到 */
const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith('**') && p.endsWith('**') ? (
        <b key={i} className="manual-b">{p.slice(2, -2)}</b>
      ) : (
        <React.Fragment key={i}>{p}</React.Fragment>
      ),
    )}
  </>
);

export const Manual: React.FC = () => {
  const zh = store.state.lang !== 'en';
  const [cur, setCur] = useState(0);
  const close = () => store.set({ showManual: false });
  const L = (v: L) => (zh ? v.zh : v.en);
  const s = SECTIONS[cur];

  return (
    <div className="modal-mask" onClick={close}>
      <div className="modal manual" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            {zh ? '说明书 · YzSVG Editor 2.0.1' : 'Manual · YzSVG Editor 2.0.1'}
          </div>
          <button className="modal-close" onClick={close}>
            ×
          </button>
        </div>
        <div className="manual-wrap">
          <div className="manual-nav">
            {SECTIONS.map((sec, i) => (
              <button
                key={i}
                className={i === cur ? 'active' : ''}
                onClick={() => {
                  setCur(i);
                  const el = document.getElementById('manual-body');
                  if (el) el.scrollTop = 0;
                }}
              >
                {L(sec.title)}
              </button>
            ))}
          </div>
          <div className="manual-body" id="manual-body">
            <div className="manual-section-title">{L(s.title)}</div>
            {s.items.map((it, i) => (
              <div className="manual-item" key={i}>
                <div className="manual-h">{L(it.h)}</div>
                <div className="manual-p">
                  <Rich text={L(it.p)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
