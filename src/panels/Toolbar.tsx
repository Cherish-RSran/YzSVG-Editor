import React from 'react';
import { store, useVersion, notify } from '../state/store';
import { useT } from '../i18n';
import {
  alignSelection,
  distributeSelection,
  newDocument,
  redo,
  reorderSelection,
  setTool,
  undo,
  groupSelection,
  ungroupSelection,
  deleteSelection,
  duplicateSelection,
  applyBoolean,
  applyClip,
  fitToViewport,
} from '../state/actions';
import { AlignMode } from '../core/align';
import { BoolOp } from '../core/boolean';
import { THEMES, ThemeId } from '../core/theme';
import { ToolId } from '../core/types';
import { exportRaster, exportSvg, importFromFile, pickFile } from '../io';
import {
  IconSelect,
  IconRect,
  IconEllipse,
  IconLine,
  IconPolygon,
  IconStar,
  IconPen,
  IconPencil,
  IconNode,
  IconText,
  IconGroup,
  IconUngroup,
  IconCopy,
  IconTrash,
  IconUndo,
  IconRedo,
  IconAlignLeft,
  IconAlignHCenter,
  IconAlignRight,
  IconAlignTop,
  IconAlignVCenter,
  IconAlignBottom,
  IconDistributeH,
  IconDistributeV,
  IconToFront,
  IconForward,
  IconBackward,
  IconToBack,
  IconZoomIn,
  IconZoomOut,
} from './icons';

const TOOLS: { id: ToolId; label: string; labelKey: string; key: string; tipKey: string; Icon: () => JSX.Element }[] = [
  { id: 'select', label: '选择', labelKey: 'tool_select', key: 'V', tipKey: 'tip_select', Icon: IconSelect },
  { id: 'rect', label: '矩形', labelKey: 'tool_rect', key: 'R', tipKey: 'tip_rect', Icon: IconRect },
  { id: 'ellipse', label: '椭圆', labelKey: 'tool_ellipse', key: 'O', tipKey: 'tip_ellipse', Icon: IconEllipse },
  { id: 'line', label: '直线', labelKey: 'tool_line', key: 'L', tipKey: 'tip_line', Icon: IconLine },
  { id: 'polygon', label: '多边形', labelKey: 'tool_polygon', key: 'G', tipKey: 'tip_polygon', Icon: IconPolygon },
  { id: 'star', label: '星形', labelKey: 'tool_star', key: 'S', tipKey: 'tip_star', Icon: IconStar },
  { id: 'pen', label: '钢笔', labelKey: 'tool_pen', key: 'P', tipKey: 'tip_pen', Icon: IconPen },
  { id: 'pencil', label: '铅笔', labelKey: 'tool_pencil', key: 'B', tipKey: 'tip_pencil', Icon: IconPencil },
  { id: 'node', label: '节点', labelKey: 'tool_node', key: 'A', tipKey: 'tip_node', Icon: IconNode },
  { id: 'text', label: '文本', labelKey: 'tool_text', key: 'T', tipKey: 'tip_text', Icon: IconText },
];

/** 对齐按钮：图标直接画出「往哪贴」，不用再去猜 ⇤⇥ 是什么 */
const ALIGN_BUTTONS: { mode: AlignMode; titleKey: string; tipKey: string; Icon: () => JSX.Element }[] = [
  { mode: 'left', titleKey: 'align_left', tipKey: 'tip_align_left', Icon: IconAlignLeft },
  { mode: 'hcenter', titleKey: 'align_hcenter', tipKey: 'tip_align_hcenter', Icon: IconAlignHCenter },
  { mode: 'right', titleKey: 'align_right', tipKey: 'tip_align_right', Icon: IconAlignRight },
  { mode: 'top', titleKey: 'align_top', tipKey: 'tip_align_top', Icon: IconAlignTop },
  { mode: 'vcenter', titleKey: 'align_vcenter', tipKey: 'tip_align_vcenter', Icon: IconAlignVCenter },
  { mode: 'bottom', titleKey: 'align_bottom', tipKey: 'tip_align_bottom', Icon: IconAlignBottom },
];

/** 层级按钮：箭头指方向，横条是被挪动的那一层 */
const ORDER_BUTTONS: {
  mode: 'top' | 'up' | 'down' | 'bottom';
  titleKey: string;
  tipKey: string;
  Icon: () => JSX.Element;
}[] = [
  { mode: 'top', titleKey: 'bring_top', tipKey: 'tip_bring_top', Icon: IconToFront },
  { mode: 'up', titleKey: 'bring_up', tipKey: 'tip_bring_up', Icon: IconForward },
  { mode: 'down', titleKey: 'send_down', tipKey: 'tip_send_down', Icon: IconBackward },
  { mode: 'bottom', titleKey: 'send_bottom', tipKey: 'tip_send_bottom', Icon: IconToBack },
];

export const Toolbar: React.FC = () => {
  useVersion();
  const t = useT();
  const { tool, zoom, fitZoom, showGrid, snapEnabled, selection, showSource, theme, lang } =
    store.state;
  void showSource;

  const setZoom = (z: number) => store.set({ zoom: Math.max(0.02, Math.min(64, z)) });
  /** 悬停提示：第一行名称（带快捷键），第二行讲清楚是干嘛的 */
  const tip = (title: string, descKey: string, key?: string) => ({
    'data-tip': `${title}${key ? `（${key}）` : ''}\n${t(descKey)}`,
  });

  return (
    <div className="toolbar">
      <div className="tb-group">
        <button className="tb-btn" {...tip(t('new'), 'tip_new')} onClick={() => newDocument()}>
          {t('new')}
        </button>
        <button
          className="tb-btn"
          {...tip(t('import'), 'tip_import')}
          onClick={async () => {
            const f = await pickFile();
            if (f) importFromFile(f);
          }}
        >
          {t('import')}
        </button>
        <button
          className="tb-btn"
          {...tip(t('export_svg'), 'tip_export_svg')}
          onClick={() => exportSvg(store.state.doc, 'drawing.svg')}
        >
          {t('export_svg')}
        </button>
        <button
          className="tb-btn"
          {...tip(t('export_png'), 'tip_export_png')}
          onClick={() => exportRaster(store.state.doc, 'png', 2)}
        >
          {t('export_png')}
        </button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        {TOOLS.map((tl) => (
          <button
            key={tl.id}
            className={`tb-tool ${tool === tl.id ? 'active' : ''}`}
            {...tip(t(tl.labelKey), tl.tipKey, tl.key)}
            aria-label={t(tl.labelKey)}
            onClick={() => setTool(tl.id)}
          >
            <tl.Icon />
          </button>
        ))}
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <select
          className="mini-select"
          style={{ width: 78 }}
          defaultValue=""
          {...tip('布尔运算', 'tip_boolean')}
          onChange={(e) => {
            const v = e.target.value as BoolOp | 'clip' | '';
            if (!v) return;
            if (v === 'clip') applyClip();
            else applyBoolean(v);
            e.target.value = '';
          }}
        >
          <option value="">布尔…</option>
          <option value="union">并集</option>
          <option value="subtract">差集</option>
          <option value="intersect">交集</option>
          <option value="exclude">排除</option>
          <option value="clip">剪切蒙版</option>
        </select>
      </div>

      <div className="tb-sep" />

      <div className="tb-group" data-tip={t('tip_arrange')}>
        <button
          className="tb-icon"
          disabled={selection.length === 0}
          {...tip(t('group'), 'tip_group', 'Ctrl+G')}
          onClick={() => groupSelection()}
        >
          <IconGroup />
        </button>
        <button
          className="tb-icon"
          disabled={selection.length === 0}
          {...tip(t('ungroup'), 'tip_ungroup', 'Ctrl+Shift+G')}
          onClick={() => ungroupSelection()}
        >
          <IconUngroup />
        </button>
        <button
          className="tb-icon"
          disabled={selection.length === 0}
          {...tip(t('duplicate'), 'tip_duplicate', 'Ctrl+D')}
          onClick={() => duplicateSelection()}
        >
          <IconCopy />
        </button>
        <button
          className="tb-icon"
          disabled={selection.length === 0}
          {...tip(t('delete'), 'tip_delete', 'Delete')}
          onClick={() => deleteSelection()}
        >
          <IconTrash />
        </button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        {ALIGN_BUTTONS.map((b) => (
          <button
            key={b.mode}
            className="tb-icon"
            {...tip(t(b.titleKey), b.tipKey)}
            disabled={selection.length === 0}
            onClick={() => alignSelection(b.mode)}
          >
            <b.Icon />
          </button>
        ))}
        <button
          className="tb-icon"
          {...tip(t('distribute_h'), 'tip_distribute_h')}
          disabled={selection.length < 3}
          onClick={() => distributeSelection('h')}
        >
          <IconDistributeH />
        </button>
        <button
          className="tb-icon"
          {...tip(t('distribute_v'), 'tip_distribute_v')}
          disabled={selection.length < 3}
          onClick={() => distributeSelection('v')}
        >
          <IconDistributeV />
        </button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        {ORDER_BUTTONS.map((b) => (
          <button
            key={b.mode}
            className="tb-icon"
            {...tip(t(b.titleKey), b.tipKey)}
            disabled={selection.length === 0}
            onClick={() => reorderSelection(b.mode)}
          >
            <b.Icon />
          </button>
        ))}
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <button
          className={`tb-btn ${showSource ? 'active' : ''}`}
          {...tip(t('source_panel'), 'tip_source')}
          onClick={() => store.set({ showSource: !showSource })}
        >
          {t('source_panel')}
        </button>
        <button
          className="tb-btn"
          {...tip(t('export_more'), 'tip_export_more')}
          onClick={() => store.set({ showExport: true })}
        >
          {t('export_more')}
        </button>
        <button
          className="tb-btn"
          {...tip(t('help'), 'tip_help', 'Ctrl+/')}
          onClick={() => store.set({ showShortcuts: true })}
        >
          {t('help')}
        </button>
        {/* 主题一律是浅色系：只换画布底色与网格，画板永远是白纸，不会影响图本身 */}
        <select
          className="mini-select"
          style={{ width: 72 }}
          value={theme}
          {...tip(t('theme'), 'tip_theme')}
          onChange={(e) => store.set({ theme: e.target.value as ThemeId })}
          aria-label={t('theme')}
        >
          {THEMES.map((th) => (
            <option key={th.id} value={th.id}>
              {t(`theme_${th.id}`)}
            </option>
          ))}
        </select>
        <button
          className="tb-btn"
          {...tip('Language', 'tip_lang')}
          onClick={() => store.set({ lang: lang === 'zh' ? 'en' : 'zh' })}
        >
          {lang === 'zh' ? t('lang_en') : t('lang_zh')}
        </button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button className="tb-icon" {...tip(t('undo'), 'tip_undo', 'Ctrl+Z')} onClick={() => undo()}>
          <IconUndo />
        </button>
        <button className="tb-icon" {...tip(t('redo'), 'tip_redo', 'Ctrl+Shift+Z')} onClick={() => redo()}>
          <IconRedo />
        </button>
        <label className="tb-check" {...tip(t('grid'), 'tip_grid')}>
          <input type="checkbox" checked={showGrid} onChange={(e) => store.set({ showGrid: e.target.checked })} />
          {t('grid')}
        </label>
        <label className="tb-check" {...tip(t('snap'), 'tip_snap')}>
          <input type="checkbox" checked={snapEnabled} onChange={(e) => store.set({ snapEnabled: e.target.checked })} />
          {t('snap')}
        </label>
        <button className="tb-icon" {...tip(t('zoom_out'), 'tip_zoom_out')} onClick={() => setZoom(zoom / 1.2)}>
          <IconZoomOut />
        </button>
        {/* 百分比以「适应视口」为 100% 基准：刚打开 / 点了适应就是 100% */}
        <span className="tb-zoom" {...tip(`${Math.round((zoom / (fitZoom || 1)) * 100)}%`, 'zoom_hint')}>
          {Math.round((zoom / (fitZoom || 1)) * 100)}%
        </span>
        <button className="tb-icon" {...tip(t('zoom_in'), 'tip_zoom_in')} onClick={() => setZoom(zoom * 1.2)}>
          <IconZoomIn />
        </button>
        <button
          className="tb-btn"
          {...tip(t('fit'), 'tip_fit', 'Shift+1')}
          onClick={() => fitToViewport()}
        >
          {t('fit')}
        </button>
      </div>
    </div>
  );
};

export { notify };
