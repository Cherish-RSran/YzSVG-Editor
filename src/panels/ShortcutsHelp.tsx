import React from 'react';
import { store } from '../state/store';

const GROUPS: { titleKey: string; items: [string, string][] }[] = [
  {
    titleKey: 'shortcut_tools',
    items: [
      ['V', 'tool_select'],
      ['R', 'tool_rect'],
      ['O', 'tool_ellipse'],
      ['L', 'tool_line'],
      ['G', 'tool_polygon'],
      ['S', 'tool_star'],
      ['P', 'tool_pen'],
      ['B', 'tool_pencil'],
      ['A', 'tool_node'],
      ['T', 'tool_text'],
    ],
  },
  {
    titleKey: 'shortcut_edit',
    items: [
      ['Ctrl + Z', 'undo'],
      ['Ctrl + Shift + Z', 'redo'],
      ['Ctrl + G', 'group'],
      ['Ctrl + Shift + G', 'ungroup'],
      ['Ctrl + D', 'duplicate'],
      ['Ctrl + A', 'tool_select'],
      ['Delete', 'delete'],
      ['↑ ↓ ← →', 'tip_select'],
      ['Shift + 方向键', 'tip_select'],
      ['Enter', 'tip_pen'],
      ['Alt + 点击锚点', 'tip_node'],
      ['Alt + 拖拽', 'tip_no_snap'],
      ['Ctrl + 点击画布', 'tip_ctrl_pick'],
      ['点空白处', 'tip_clear_pick'],
      ['Ctrl / Shift + 点图层', 'tip_layer_pick'],
    ],
  },
  {
    titleKey: 'shortcut_view',
    items: [
      ['Ctrl + 滚轮', 'zoom_in'],
      ['空格 + 拖拽', 'tip_select'],
      ['中键拖拽', 'tip_select'],
      ['Shift + 1', 'fit'],
      ['Ctrl + 0', 'zoom_in'],
      ['Ctrl + /', 'help'],
      ['Esc', 'cancel'],
    ],
  },
  {
    titleKey: 'shortcut_file',
    items: [
      ['Ctrl + S', 'export_svg'],
      ['Ctrl + V', 'import'],
    ],
  },
];

export const ShortcutsHelp: React.FC = () => {
  const lang = store.state.lang;
  const label = (key: string) => {
    const map: Record<string, string> = {
      shortcut_tools: lang === 'en' ? 'Tools' : '工具',
      shortcut_edit: lang === 'en' ? 'Editing' : '编辑',
      shortcut_view: lang === 'en' ? 'View' : '视图',
      shortcut_file: lang === 'en' ? 'File' : '文件',
      tool_select: lang === 'en' ? 'Select' : '选择',
      tool_rect: lang === 'en' ? 'Rectangle' : '矩形',
      tool_ellipse: lang === 'en' ? 'Ellipse' : '椭圆',
      tool_line: lang === 'en' ? 'Line' : '直线',
      tool_polygon: lang === 'en' ? 'Polygon' : '多边形',
      tool_star: lang === 'en' ? 'Star' : '星形',
      tool_pen: lang === 'en' ? 'Finish pen path' : '结束钢笔路径',
      tool_pencil: lang === 'en' ? 'Pencil' : '铅笔',
      tool_node: lang === 'en' ? 'Delete anchor' : '删除锚点',
      tool_text: lang === 'en' ? 'Text' : '文本',
      tip_select: lang === 'en' ? 'Move / pan / nudge' : '移动 / 平移 / 微调',
      undo: lang === 'en' ? 'Undo' : '撤销',
      redo: lang === 'en' ? 'Redo' : '重做',
      group: lang === 'en' ? 'Group' : '编组',
      ungroup: lang === 'en' ? 'Ungroup' : '解组',
      duplicate: lang === 'en' ? 'Duplicate' : '复制',
      delete: lang === 'en' ? 'Delete' : '删除',
      zoom_in: lang === 'en' ? 'Zoom / 100%' : '缩放 / 100%',
      fit: lang === 'en' ? 'Fit to screen' : '适应窗口',
      help: lang === 'en' ? 'This panel' : '打开本面板',
      cancel: lang === 'en' ? 'Back to select / deselect' : '回到选择 / 取消选择',
      export_svg: lang === 'en' ? 'Export SVG' : '导出 SVG',
      import: lang === 'en' ? 'Paste SVG source' : '粘贴 SVG 源码',
      tip_pen: lang === 'en' ? 'Finish pen path' : '结束钢笔路径',
      tip_node: lang === 'en' ? 'Delete anchor' : '删除锚点',
      tip_no_snap: lang === 'en' ? 'Disable snapping while dragging' : '拖拽时关闭吸附（含直线的水平/竖直吸附）',
      tip_ctrl_pick: lang === 'en' ? 'Add to / remove from selection' : '加选 / 减选（多选）',
      tip_clear_pick: lang === 'en' ? 'Deselect, back to picking' : '取消选择，光标回到挑选状态',
      tip_layer_pick: lang === 'en' ? 'Multi-select layers' : '图层多选 / 连选中间所有图层',
    };
    return map[key] ?? key;
  };

  return (
    <div className="modal-mask" onClick={() => store.set({ showShortcuts: false })}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{lang === 'en' ? 'Keyboard shortcuts' : '快捷键'}</div>
          <button className="modal-close" onClick={() => store.set({ showShortcuts: false })}>
            ×
          </button>
        </div>
        <div className="modal-body shortcuts-grid">
          {GROUPS.map((g) => (
            <div key={g.titleKey} className="shortcut-group">
              <div className="shortcut-group-title">{label(g.titleKey)}</div>
              {g.items.map(([k, v], i) => (
                <div className="shortcut-row" key={i}>
                  <kbd>{k}</kbd>
                  <span>{label(v)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
