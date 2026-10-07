import React, { useRef, useState } from 'react';
import { useT } from '../i18n';
import { store, useVersion, notify } from '../state/store';
import {
  beginTransaction,
  commitTransaction,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  patchNode,
  renameNode,
  reorderSelection,
  rotateNodesTo,
  selectionRotation,
  setAttrs,
  setSelectionPos,
  setSelectionSize,
  ungroupSelection,
} from '../state/actions';
import { selectionBBox } from '../core/geometry';
import { DefEntry, SvgNode } from '../core/types';
import { newId } from '../core/model';
import {
  applyFilter,
  applyPattern,
  arrowMarkerRaw,
  ArrowStyle,
  defIdFromUrl,
  DEFAULT_FILTER_PARAMS,
  FilterParams,
  FilterPreset,
  PatternPreset,
} from '../core/effects';

const FONTS = ['sans-serif', 'serif', 'monospace', 'Microsoft YaHei', 'SimSun', 'Arial', 'Helvetica'];

function num(v: string | undefined, fallback = 0): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
}

const NumField: React.FC<{
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
  onBegin?: () => void;
  onEnd?: () => void;
  suffix?: string;
  /** 多选且各元素该属性不一致时传 true：不显示某个元素的数，而是留空显示「混合」 */
  mixed?: boolean;
  /** 悬停说明：这个参数到底控制什么 */
  tip?: string;
}> = ({ label, value, step = 1, onChange, onBegin, onEnd, suffix, mixed, tip }) => {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const shown = Math.round(value * 100) / 100;
  return (
    <label className="field" data-tip={tip}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          step={step}
          value={text ?? (mixed ? '' : shown)}
          placeholder={mixed ? t('mixed') : undefined}
          onFocus={() => {
            onBegin?.();
            setText(mixed ? '' : String(shown));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          onBlur={() => {
            setText(null);
            onEnd?.();
          }}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
    </label>
  );
};

function parseColor(v: string | undefined): { kind: 'none' | 'solid' | 'gradient'; value: string; defId?: string } {
  if (!v || v === 'none') return { kind: 'none', value: '#3b82f6' };
  const m = /url\(['"]?#([^'")\s]+)['"]?\)/.exec(v);
  if (m) return { kind: 'gradient', value: v, defId: m[1] };
  return { kind: 'solid', value: v };
}

const ColorField: React.FC<{
  label: string;
  value: string | undefined;
  allowGradient?: boolean;
  onChange: (v: string) => void;
  /** 悬停说明 */
  tip?: string;
}> = ({ label, value, allowGradient = true, onChange, tip }) => {
  const t = useT();
  const doc = store.state.doc;
  const parsed = parseColor(value);
  const def = parsed.defId ? doc.defs.find((d) => d.id === parsed.defId) : undefined;

  const createGradient = (kind: 'linearGradient' | 'radialGradient') => {
    const id = `grad_${newId('')}`;
    const entry: DefEntry = {
      id,
      kind,
      attrs:
        kind === 'linearGradient'
          ? { x1: '0', y1: '0', x2: '1', y2: '0' }
          : { cx: '0.5', cy: '0.5', r: '0.5' },
      stops: [
        { offset: 0, color: '#3b82f6' },
        { offset: 100, color: '#a855f7' },
      ],
    };
    store.state.doc.defs.push(entry);
    store.bump();
    onChange(`url(#${id})`);
  };

  const updateStop = (i: number, patch: Partial<{ offset: number; color: string }>) => {
    if (!def?.stops) return;
    def.stops[i] = { ...def.stops[i], ...patch };
    store.bump();
  };

  return (
    <div className="field-block" data-tip={tip}>
      <div className="field-row">
        <span className="field-label">{label}</span>
        <select
          className="mini-select"
          value={parsed.kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === 'none') onChange('none');
            else if (k === 'solid') onChange(parsed.kind === 'gradient' ? '#3b82f6' : parsed.value);
            else if (k === 'gradient') {
              if (parsed.kind === 'gradient') return;
              createGradient('linearGradient');
            }
          }}
        >
          <option value="none">{t('none')}</option>
          <option value="solid">{t('solid')}</option>
          {allowGradient && <option value="gradient">{t('gradient')}</option>}
        </select>
      </div>
      {parsed.kind === 'solid' && (
        <div className="field-row">
          <input
            type="color"
            className="color-swatch"
            value={/^#[0-9a-fA-F]{6}$/.test(parsed.value) ? parsed.value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
          />
          <input
            className="hex-input"
            value={parsed.value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
      {parsed.kind === 'gradient' && def && (
        <div className="gradient-editor">
          <div className="field-row">
            <select
              className="mini-select"
              value={def.kind}
              onChange={(e) => {
                def.kind = e.target.value as DefEntry['kind'];
                if (def.kind === 'linearGradient') def.attrs = { x1: '0', y1: '0', x2: '1', y2: '0' };
                if (def.kind === 'radialGradient') def.attrs = { cx: '0.5', cy: '0.5', r: '0.5' };
                store.bump();
              }}
            >
              <option value="linearGradient">{t('gradient_linear')}</option>
              <option value="radialGradient">{t('gradient_radial')}</option>
            </select>
            <button className="mini-btn" onClick={() => onChange('none')}>
              {t('clear')}
            </button>
          </div>
          <div
            className="gradient-preview"
            style={{
              background: `linear-gradient(90deg, ${(def.stops ?? [])
                .map((s) => `${s.color} ${s.offset}%`)
                .join(', ')})`,
            }}
          />
          {def.kind === 'linearGradient' && (
            <NumField
              label={t('gradient_angle')}
              value={angleOf(def)}
              onChange={(deg) => {
                const r = (deg * Math.PI) / 180;
                def.attrs['x1'] = String(0.5 - Math.cos(r) / 2);
                def.attrs['y1'] = String(0.5 - Math.sin(r) / 2);
                def.attrs['x2'] = String(0.5 + Math.cos(r) / 2);
                def.attrs['y2'] = String(0.5 + Math.sin(r) / 2);
                store.bump();
              }}
              suffix="°"
            />
          )}
          <div className="stops">
            {(def.stops ?? []).map((s, i) => (
              <div className="stop-row" key={i}>
                <input
                  type="color"
                  className="color-swatch small"
                  value={/^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#000000'}
                  onChange={(e) => updateStop(i, { color: e.target.value })}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={s.offset}
                  onChange={(e) => updateStop(i, { offset: Number(e.target.value) })}
                />
                <span className="stop-val">{Math.round(s.offset)}%</span>
                <button
                  className="mini-btn"
                  disabled={(def.stops ?? []).length <= 2}
                  onClick={() => {
                    def.stops = (def.stops ?? []).filter((_, idx) => idx !== i);
                    store.bump();
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="mini-btn"
              onClick={() => {
                const stops = def.stops ?? [];
                const last = stops[stops.length - 1];
                stops.push({ offset: 50, color: last?.color ?? '#ffffff' });
                def.stops = [...stops].sort((a, b) => a.offset - b.offset);
                store.bump();
              }}
            >
              {t('add_stop')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function angleOf(def: DefEntry): number {
  const x1 = num(def.attrs['x1'], 0);
  const y1 = num(def.attrs['y1'], 0);
  const x2 = num(def.attrs['x2'], 1);
  const y2 = num(def.attrs['y2'], 0);
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return Math.round(deg);
}

export const Inspector: React.FC<{ onCollapse?: () => void }> = ({ onCollapse }) => {
  useVersion();
  const t = useT();
  const doc = store.state.doc;
  const selection = store.state.selection;
  // 所有 useState 必须在任何提前 return 之前调用，否则会破坏 Hooks 顺序
  const [currentFilter, setCurrentFilter] = useState<FilterPreset>('none');
  const [currentPattern, setCurrentPattern] = useState<PatternPreset | 'none'>('none');
  const [filterParams, setFilterParams] = useState<FilterParams>({ ...DEFAULT_FILTER_PARAMS });
  const [arrowStyle, setArrowStyle] = useState<ArrowStyle>('triangle');

  if (selection.length === 0) {
    return (
      <div className="panel inspector">
        <div className="panel-title">
          {t('artboard')}
          {onCollapse && (
            <button className="mini-btn panel-collapse" data-tip={t('collapse_panel')} onClick={onCollapse}>
              »
            </button>
          )}
        </div>
        <NumField
          label={t('width')}
          value={doc.width}
          tip={t('tip_artboard_w')}
          onChange={(v) => {
            doc.width = v;
            doc.viewBox[2] = v;
            store.bump();
          }}
        />
        <NumField
          label={t('height')}
          value={doc.height}
          tip={t('tip_artboard_h')}
          onChange={(v) => {
            doc.height = v;
            doc.viewBox[3] = v;
            store.bump();
          }}
        />
        <ColorField
          label={t('background')}
          value={doc.background}
          allowGradient={false}
          tip={t('tip_artboard_bg')}
          onChange={(v) => {
            doc.background = v;
            store.bump();
          }}
        />
        <div className="hint">{t('no_selection')}</div>
      </div>
    );
  }

  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean) as SvgNode[];
  const box = selectionBBox(doc, selection);
  // 旋转角一律从每个节点自己的 transform 反解（单选=该元素角度；多选且一致=共同角度；不一致=null=混合）
  const rotDeg = selectionRotation();
  const first = nodes[0];
  // 选中的是组时面板顶部要标出来，否则旋转加在了组上、用户却以为是某个子元素的角度没变
  const groupCount = nodes.filter((n) => n.children.length > 0).length;
  const textNode = nodes.find((n) => n.type === 'text');
  const pathNode = nodes.find((n) => n.type === 'path');

  const apply = (attrs: Record<string, string>, label: string) => {
    beginTransaction(label, selection);
    setAttrs(selection, attrs, label);
    commitTransaction();
  };

  // 换箭头形状：已有箭头的元素就地重生成 marker（沿用同一个 id，元素上的 url(#id) 不用改）
  const restyleArrows = (style: ArrowStyle) => {
    setArrowStyle(style);
    for (const id of selection) {
      const node = doc.nodes[id];
      if (!node) continue;
      const stroke = node.attrs['stroke'];
      const color = stroke && stroke !== 'none' ? stroke : '#000000';
      for (const [attr, which] of [
        ['marker-start', 'start'],
        ['marker-end', 'end'],
      ] as const) {
        const defId = defIdFromUrl(node.attrs[attr]);
        if (!defId) continue;
        const def = doc.defs.find((d) => d.id === defId);
        if (def) def.raw = arrowMarkerRaw(which, defId, color, style);
      }
    }
    store.bump();
  };

  // 线 / 折线 / 路径的起点 / 终点箭头开关：靠 <marker> 实现
  const toggleArrow = (which: 'start' | 'end', on: boolean) => {
    const attr = which === 'start' ? 'marker-start' : 'marker-end';
    beginTransaction('箭头', selection);
    const stroke = first.attrs['stroke'];
    const color = stroke && stroke !== 'none' ? stroke : '#000000';
    if (on) {
      const mid = `arrow_${which}_${newId('')}`;
      // 起点箭头必须左右镜像（见 arrowMarkerRaw 的注释），否则会反着长在起点上
      const markerRaw = arrowMarkerRaw(which, mid, color, arrowStyle);
      const entry: DefEntry = { id: mid, kind: 'marker', attrs: {}, raw: markerRaw };
      doc.defs.push(entry);
      setAttrs(selection, { [attr]: `url(#${mid})` }, '箭头');
    } else {
      const url = first.attrs[attr];
      if (url) {
        const mid = defIdFromUrl(url);
        if (mid) doc.defs = doc.defs.filter((d) => d.id !== mid);
      }
      setAttrs(selection, { [attr]: '' }, '箭头');
    }
    commitTransaction();
  };

  const changeFilter = (kind: FilterPreset) => {
    setCurrentFilter(kind);
    const url = applyFilter(
      store.state.doc,
      kind,
      filterParams,
      defIdFromUrl(first.attrs['filter']) ?? undefined,
    );
    beginTransaction('滤镜', selection);
    setAttrs(selection, { filter: url ?? '' }, '滤镜');
    commitTransaction();
    store.bump();
  };

  const updateFilter = (patch: Partial<FilterParams>) => {
    const next = { ...filterParams, ...patch };
    setFilterParams(next);
    const url = applyFilter(store.state.doc, currentFilter, next, defIdFromUrl(first.attrs['filter']) ?? undefined);
    if (url) {
      beginTransaction('滤镜参数', selection);
      setAttrs(selection, { filter: url }, '滤镜参数');
      commitTransaction();
    }
  };

  const changePattern = (kind: PatternPreset | 'none') => {
    setCurrentPattern(kind);
    if (kind === 'none') {
      apply({ fill: '#3b82f6' }, '填充');
      return;
    }
    const url = applyPattern(store.state.doc, kind, first.attrs['fill'] ?? '#2563eb', 'none', 10);
    apply({ fill: url }, '图案填充');
    store.bump();
  };

  const pickAndInsertImage = async () => {
    const { pickFile, insertImage } = await import('../io');
    const file = await pickFile('image/*');
    if (file) await insertImage(file);
  };

  return (
    <div className="panel inspector">
      <div className="panel-title">
        {selection.length === 1 ? (
          /* key 让切换选中元素时输入框重置；失焦才提交，避免每敲一个字都进一条撤销记录 */
          <input
            className="inline-rename"
            key={first.id}
            data-tip={t('tip_rename')}
            defaultValue={first.name}
            onBlur={(e) => renameNode(first.id, e.target.value || first.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') (e.target as HTMLInputElement).value = first.name;
            }}
          />
        ) : (
          t('selected_count', { n: selection.length })
        )}
        {/* 选中的其实是「组」时明确标出来：旋转/缩放加在组上，组内子元素自身的角度仍然是 0 */}
        {groupCount > 0 && (
          <span className="title-badge" data-tip={t('badge_group_hint')}>
            {selection.length === 1
              ? t('badge_group', { n: first.children.length })
              : t('badge_group_multi', { n: groupCount })}
          </span>
        )}
        {onCollapse && (
          <button className="mini-btn panel-collapse" data-tip={t('collapse_panel')} onClick={onCollapse}>
            »
          </button>
        )}
      </div>

      <div className="section">
        <div className="section-title">{t('notes')}</div>
        <label className="field" data-tip={t('tip_notes')}>
          <textarea
            className="text-input"
            rows={2}
            value={first.notes ?? ''}
            placeholder={t('notes')}
            onChange={(e) => patchNode(first.id, { notes: e.target.value }, '编辑备注')}
          />
        </label>
      </div>

      <div className="section">
        <div className="section-title">{t('transform')}</div>
        <div className="grid2">
          <NumField
            label={t('x')}
            value={box.x}
            tip={t('tip_x')}
            onBegin={() => beginTransaction('移动', selection)}
            onChange={(v) => setSelectionPos(v, box.y)}
            onEnd={() => commitTransaction()}
          />
          <NumField
            label={t('y')}
            value={box.y}
            tip={t('tip_y')}
            onBegin={() => beginTransaction('移动', selection)}
            onChange={(v) => setSelectionPos(box.x, v)}
            onEnd={() => commitTransaction()}
          />
          <NumField
            label={t('width')}
            value={box.w}
            tip={t('tip_w')}
            onBegin={() => beginTransaction('缩放', selection)}
            onChange={(v) => setSelectionSize(Math.max(0.01, v), box.h)}
            onEnd={() => commitTransaction()}
          />
          <NumField
            label={t('height')}
            value={box.h}
            tip={t('tip_h')}
            onBegin={() => beginTransaction('缩放', selection)}
            onChange={(v) => setSelectionSize(box.w, Math.max(0.01, v))}
            onEnd={() => commitTransaction()}
          />
          <NumField
            label={t('rotation')}
            value={rotDeg ?? 0}
            mixed={rotDeg === null}
            tip={t('tip_rotation')}
            suffix="°"
            onBegin={() => beginTransaction(t('rotation'), selection)}
            // 输入的是「绝对角度」：把每个选中元素各自设到这个角度（不是增量），
            // 这样面板里写多少，每个要素的属性就是多少
            onChange={(v) =>
              rotateNodesTo(selection, v, { x: box.x + box.w / 2, y: box.y + box.h / 2 })
            }
            onEnd={() => commitTransaction()}
          />
          {first.type === 'rect' && (
            <NumField
              label={t('corner_radius')}
              value={num(first.attrs['rx'], 0)}
              tip={t('tip_corner')}
              onChange={(v) => apply({ rx: String(v), ry: String(v) }, t('corner_radius'))}
            />
          )}
        </div>
        <label className="field-check" data-tip={t('keep_aspect_hint')}>
          <input
            type="checkbox"
            checked={store.state.keepAspect}
            onChange={(e) => store.set({ keepAspect: e.target.checked })}
          />
          <span>{t('keep_aspect')}</span>
        </label>
      </div>

      <div className="section">
        <div className="section-title">{t('appearance')}</div>
        <ColorField
          label={t('fill')}
          value={first.attrs['fill']}
          tip={t('tip_fill')}
          onChange={(v) => apply({ fill: v }, t('fill'))}
        />
        <ColorField
          label={t('stroke')}
          value={first.attrs['stroke']}
          tip={t('tip_stroke')}
          onChange={(v) => apply({ stroke: v }, t('stroke'))}
        />
        <div className="grid2">
          <NumField
            label={t('stroke_width')}
            value={num(first.attrs['stroke-width'], 1)}
            step={0.5}
            tip={t('tip_stroke_width')}
            onChange={(v) => apply({ 'stroke-width': String(v) }, '描边宽度')}
          />
          <NumField
            label={t('opacity')}
            value={num(first.attrs['opacity'], 1) * 100}
            tip={t('tip_opacity')}
            onChange={(v) => apply({ opacity: String(Math.max(0, Math.min(100, v)) / 100) }, '不透明度')}
            suffix="%"
          />
        </div>
        <label className="field" data-tip={t('tip_dash_sel')}>
          <span className="field-label">{t('dash_style')}</span>
          <select
            className="mini-select"
            value={
              (() => {
                const v = first.attrs['stroke-dasharray'] ?? '';
                if (v === '8 4') return 'dashed';
                if (v === '2 3') return 'dotted';
                if (v === '16 6') return 'longdash';
                return 'solid';
              })()
            }
            onChange={(e) => {
              const map: Record<string, string> = { solid: '', dashed: '8 4', dotted: '2 3', longdash: '16 6' };
              apply({ 'stroke-dasharray': map[e.target.value] }, t('dash'));
            }}
          >
            <option value="solid">{t('dash_solid')}</option>
            <option value="dashed">{t('dash_dashed')}</option>
            <option value="dotted">{t('dash_dotted')}</option>
            <option value="longdash">{t('dash_long')}</option>
          </select>
        </label>
        <label className="field" data-tip={t('tip_dash')}>
          <span className="field-label">{t('dash')}</span>
          <input
            className="text-input"
            placeholder={t('dash_placeholder')}
            value={first.attrs['stroke-dasharray'] ?? ''}
            onChange={(e) => apply({ 'stroke-dasharray': e.target.value }, t('dash'))}
          />
        </label>
        <div className="grid2">
          <label className="field" data-tip={t('cap_hint')}>
            <span className="field-label">{t('cap')}</span>
            <select
              className="mini-select"
              value={first.attrs['stroke-linecap'] ?? 'butt'}
              onChange={(e) => apply({ 'stroke-linecap': e.target.value }, t('cap'))}
            >
              <option value="butt">{t('cap_butt')}</option>
              <option value="round">{t('cap_round')}</option>
              <option value="square">{t('cap_square')}</option>
            </select>
          </label>
          <label className="field" data-tip={t('join_hint')}>
            <span className="field-label">{t('join')}</span>
            <select
              className="mini-select"
              value={first.attrs['stroke-linejoin'] ?? 'miter'}
              onChange={(e) => apply({ 'stroke-linejoin': e.target.value }, t('join'))}
            >
              <option value="miter">{t('join_miter')}</option>
              <option value="round">{t('join_round')}</option>
              <option value="bevel">{t('join_bevel')}</option>
            </select>
          </label>
        </div>
      </div>

      {(first.type === 'line' || first.type === 'polyline' || first.type === 'path') && (
        <div className="section">
          <div className="section-title">{t('line_style')}</div>
          <div className="btn-row">
            <label className="field-check" data-tip={t('tip_arrow_start')}>
              <input
                type="checkbox"
                checked={!!first.attrs['marker-start']}
                onChange={(e) => toggleArrow('start', e.target.checked)}
              />
              <span>{t('arrow_start')}</span>
            </label>
            <label className="field-check" data-tip={t('tip_arrow_end')}>
              <input
                type="checkbox"
                checked={!!first.attrs['marker-end']}
                onChange={(e) => toggleArrow('end', e.target.checked)}
              />
              <span>{t('arrow_end')}</span>
            </label>
          </div>
          <label className="field" data-tip={t('tip_arrow_style')}>
            <span className="field-label">{t('arrow_style')}</span>
            <select
              className="mini-select"
              value={arrowStyle}
              onChange={(e) => restyleArrows(e.target.value as ArrowStyle)}
            >
              <option value="triangle">{t('arrow_triangle')}</option>
              <option value="open">{t('arrow_open')}</option>
              <option value="circle">{t('arrow_circle')}</option>
              <option value="square">{t('arrow_square')}</option>
              <option value="diamond">{t('arrow_diamond')}</option>
            </select>
          </label>
        </div>
      )}

      {textNode && (
        <div className="section">
          <div className="section-title">{t('text_section')}</div>
          <label className="field">
            <span className="field-label">{t('text_content')}</span>
            <textarea
              className="text-input"
              rows={2}
              value={textNode.text ?? ''}
              onChange={(e) => patchNode(textNode.id, { text: e.target.value }, '编辑文本')}
            />
          </label>
          <div className="grid2">
          <NumField
            label={t('font_size')}
            value={num(textNode.attrs['font-size'], 24)}
            tip={t('tip_font_size')}
            onChange={(v) => apply({ 'font-size': String(v) }, t('font_size'))}
          />
          <label className="field" data-tip={t('tip_font_weight')}>
            <span className="field-label">{t('font_weight')}</span>
            <select
              className="mini-select"
              value={textNode.attrs['font-weight'] ?? '400'}
              onChange={(e) => apply({ 'font-weight': e.target.value }, t('font_weight'))}
            >
              <option value="300">{t('weight_light')}</option>
              <option value="400">{t('weight_normal')}</option>
              <option value="600">{t('weight_medium')}</option>
              <option value="700">{t('weight_bold')}</option>
            </select>
          </label>
          </div>
          <label className="field" data-tip={t('tip_font_family')}>
            <span className="field-label">{t('font_family')}</span>
            <select
              className="mini-select"
              value={String(textNode.attrs['font-family'] ?? 'sans-serif').replace(/['"]/g, '')}
              onChange={(e) => apply({ 'font-family': e.target.value }, t('font_family'))}
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="field" data-tip={t('tip_text_align')}>
            <span className="field-label">{t('align')}</span>
            <select
              className="mini-select"
              value={textNode.attrs['text-anchor'] ?? 'start'}
              onChange={(e) => apply({ 'text-anchor': e.target.value }, t('align'))}
            >
              <option value="start">{t('align_start')}</option>
              <option value="middle">{t('align_middle')}</option>
              <option value="end">{t('align_end')}</option>
            </select>
          </label>
        </div>
      )}

      <div className="section">
        <div className="section-title">效果与填充</div>
        <div className="field-row" data-tip={t('tip_filter')}>
          <span className="field-label">滤镜</span>
          <select className="mini-select" value={currentFilter} onChange={(e) => changeFilter(e.target.value as FilterPreset)}>
            <option value="none">无</option>
            <option value="shadow">投影</option>
            <option value="blur">模糊</option>
            <option value="glow">发光</option>
          </select>
        </div>
        {currentFilter !== 'none' && (
          <div className="grid2">
            <NumField label="模糊" value={filterParams.blur} step={0.5} onChange={(v) => updateFilter({ blur: v })} />
            <NumField label="X 偏移" value={filterParams.dx} onChange={(v) => updateFilter({ dx: v })} />
          </div>
        )}
        <div className="field-row" data-tip={t('tip_pattern')}>
          <span className="field-label">图案</span>
          <select className="mini-select" value={currentPattern} onChange={(e) => changePattern(e.target.value as PatternPreset | 'none')}>
            <option value="none">无</option>
            <option value="dots">圆点</option>
            <option value="stripes">条纹</option>
            <option value="grid">网格</option>
            <option value="cross">交叉</option>
          </select>
        </div>
      </div>

      <div className="section">
        <div className="section-title">图片</div>
        <button className="wide-btn" data-tip={t('tip_image')} onClick={() => void pickAndInsertImage()}>
          插入图片（自动内联）
        </button>
      </div>

      {textNode && (
        <div className="section">
          <div className="section-title">路径文本</div>
          <button
            className="wide-btn"
            disabled={!pathNode}
            onClick={() => {
              if (!pathNode) return;
              patchNode(textNode.id, { pathId: pathNode.id }, '沿路径排列');
              notify('文本已沿路径排列', 'success');
            }}
          >
            {textNode.pathId ? '重新沿路径排列' : '沿选中路径排列'}
          </button>
          {textNode.pathId && (
            <button className="wide-btn" onClick={() => patchNode(textNode.id, { pathId: undefined }, '取消路径排列')}>
              取消路径排列
            </button>
          )}
        </div>
      )}

      {pathNode && (
        <div className="section">
          <div className="section-title">{t('path_section')}</div>
          <button
            className="wide-btn"
            onClick={() => {
              store.set({ tool: 'node', pathEditId: pathNode.id });
              notify(t('msg_node_mode'), 'info');
            }}
          >
            {t('edit_nodes')}
          </button>
          <textarea
            className="text-input mono"
            rows={3}
            data-tip={t('tip_path_d')}
            value={pathNode.attrs['d'] ?? ''}
            onChange={(e) => apply({ d: e.target.value }, '路径数据')}
          />
        </div>
      )}

      <div className="section">
        <div className="section-title">{t('arrange')}</div>
        <div className="btn-row">
          <button className="mini-btn" data-tip={t('tip_bring_top')} onClick={() => reorderSelection('top')}>
            {t('bring_top')}
          </button>
          <button className="mini-btn" data-tip={t('tip_bring_up')} onClick={() => reorderSelection('up')}>
            {t('bring_up')}
          </button>
          <button className="mini-btn" data-tip={t('tip_send_down')} onClick={() => reorderSelection('down')}>
            {t('send_down')}
          </button>
          <button className="mini-btn" data-tip={t('tip_send_bottom')} onClick={() => reorderSelection('bottom')}>
            {t('send_bottom')}
          </button>
        </div>
        <div className="btn-row">
          <button className="mini-btn" data-tip={t('tip_group')} onClick={() => groupSelection()}>
            {t('group')}
          </button>
          <button className="mini-btn" data-tip={t('tip_ungroup')} onClick={() => ungroupSelection()}>
            {t('ungroup')}
          </button>
          <button className="mini-btn" data-tip={t('tip_duplicate')} onClick={() => duplicateSelection()}>
            {t('duplicate')}
          </button>
          <button className="mini-btn danger" data-tip={t('tip_delete')} onClick={() => deleteSelection()}>
            {t('delete')}
          </button>
        </div>
      </div>

      <div className="hint">
        {selection.length === 1
          ? t('hint_type', { type: first.type }) + (first.locked ? ' · ' + t('hint_locked') : '')
          : t('hint_bbox', { w: Math.round(box.w), h: Math.round(box.h) })}
      </div>
    </div>
  );
};

export default Inspector;
