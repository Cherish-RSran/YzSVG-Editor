import React from 'react';
import { Box } from '../core/types';
import { SnapGuide } from '../core/align';

export interface AnchorView {
  p: { x: number; y: number };
  in?: { x: number; y: number };
  out?: { x: number; y: number };
}

const HANDLES: { id: string; fx: number; fy: number }[] = [
  { id: 'nw', fx: 0, fy: 0 },
  { id: 'n', fx: 0.5, fy: 0 },
  { id: 'ne', fx: 1, fy: 0 },
  { id: 'e', fx: 1, fy: 0.5 },
  { id: 'se', fx: 1, fy: 1 },
  { id: 's', fx: 0.5, fy: 1 },
  { id: 'sw', fx: 0, fy: 1 },
  { id: 'w', fx: 0, fy: 0.5 },
];

export /**
 * 旋转光标：CSS 没有标准的旋转光标（grab 是"手"，语义不对），用内联 SVG 做一个。
 * 每个路径画两遍——先用白色粗描边打底，再用深色细描边，保证深浅背景上都看得清。
 */
const ROTATE_CURSOR =
  'url("data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">' +
      '<path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>' +
      '<path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" stroke="#111827" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M20.5 3.6v5.2h-5.2" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M20.5 3.6v5.2h-5.2" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>',
  ) +
  '") 12 12, grab';

export const CURSOR: Record<string, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  rotate: ROTATE_CURSOR,
};

export interface OverlayProps {
  box: Box | null;
  zoom: number;
  marquee: Box | null;
  guides: SnapGuide[];
  hoverBox: Box | null;
  /** 多选时每个选中元素各自的框（只有整体包围盒时看不出选中了哪几个） */
  boxes?: Box[] | null;
  /** 多选：整体包围盒画成虚线辅助框并向外扩一圈，实框留给每个元素自己 */
  multi?: boolean;
  anchors: AnchorView[] | null;
  anchorActive: number;
}

export const Overlay: React.FC<OverlayProps> = ({
  box,
  zoom,
  marquee,
  guides,
  hoverBox,
  boxes,
  multi,
  anchors,
  anchorActive,
}) => {
  const s = 1 / zoom;
  const hw = 4 * s; // 手柄半宽
  const stroke = 1 * s;
  // 多选时整体框外扩：贴着元素画会盖住每个元素的实线框（6 屏幕像素，缩放后视觉一致）
  const pad = multi ? 6 * s : 0;
  const outer = box
    ? { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
    : null;

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* 悬停框：不能加 !box 条件，否则一旦有选中元素，鼠标移到别的元素上就再也不出现待选框了。
          「悬停的元素已被选中」这种情况由调用方过滤（此时它本来就有选中框）。 */}
      {hoverBox && (
        <rect
          x={hoverBox.x}
          y={hoverBox.y}
          width={hoverBox.w}
          height={hoverBox.h}
          className="ov-stroke"
          strokeWidth={stroke * 1.8}
          strokeDasharray={`${5 * s} ${3 * s}`}
          opacity={0.95}
        />
      )}
      {/* 多选时逐个画出每个元素的框：这是"到底选中了哪几个"的唯一依据，所以要比单选框还明显 */}
      {boxes &&
        boxes.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            className="ov-stroke"
            strokeWidth={stroke * 1.8}
            opacity={1}
          />
        ))}

      {marquee && (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          className="ov-marquee"
          strokeWidth={stroke}
        />
      )}

      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <line
            key={`gx${i}`}
            x1={g.pos}
            y1={g.from}
            x2={g.pos}
            y2={g.to}
            className="ov-guide"
            strokeWidth={stroke}
          />
        ) : (
          <line
            key={`gy${i}`}
            x1={g.from}
            y1={g.pos}
            x2={g.to}
            y2={g.pos}
            className="ov-guide"
            strokeWidth={stroke}
          />
        ),
      )}

      {box && outer && (
        <>
          {/* 多选的整体框是虚线辅助框，并且向外扩一圈：
              正好压在元素边界上会和每个元素的实线框叠在一起，看不出谁是谁。 */}
          <rect
            x={outer.x}
            y={outer.y}
            width={outer.w}
            height={outer.h}
            className="ov-stroke"
            strokeWidth={multi ? stroke * 0.9 : stroke * 1.2}
            strokeDasharray={multi ? `${6 * s} ${4 * s}` : undefined}
            opacity={multi ? 0.7 : 1}
          />
          <line
            x1={outer.x + outer.w / 2}
            y1={outer.y}
            x2={outer.x + outer.w / 2}
            y2={outer.y - 20 * s}
            className="ov-stroke"
            strokeWidth={stroke}
          />
          {HANDLES.map((h) => (
            <rect
              key={h.id}
              data-handle={h.id}
              x={outer.x + outer.w * h.fx - hw}
              y={outer.y + outer.h * h.fy - hw}
              width={hw * 2}
              height={hw * 2}
              className="ov-handle"
              strokeWidth={stroke}
              style={{ pointerEvents: 'all', cursor: CURSOR[h.id] }}
            />
          ))}
          <circle
            data-handle="rotate"
            cx={outer.x + outer.w / 2}
            cy={outer.y - 20 * s}
            r={4.5 * s}
            className="ov-handle"
            strokeWidth={stroke}
            style={{ pointerEvents: 'all', cursor: CURSOR.rotate }}
          />
        </>
      )}

      {anchors &&
        anchors.map((a, i) => (
          <g key={i}>
            {a.out && (
              <>
                <line
                  x1={a.p.x}
                  y1={a.p.y}
                  x2={a.out.x}
                  y2={a.out.y}
                  className="ov-node-stroke"
                  strokeWidth={stroke}
                />
                <rect
                  data-anchor={`${i}:out`}
                  x={a.out.x - hw}
                  y={a.out.y - hw}
                  width={hw * 2}
                  height={hw * 2}
                  className="ov-node-handle"
                  strokeWidth={stroke}
                  style={{ pointerEvents: 'all', cursor: 'move' }}
                />
              </>
            )}
            {a.in && a.in !== a.out && (
              <>
                <line
                  x1={a.p.x}
                  y1={a.p.y}
                  x2={a.in.x}
                  y2={a.in.y}
                  className="ov-node-stroke"
                  strokeWidth={stroke}
                />
                <rect
                  data-anchor={`${i}:in`}
                  x={a.in.x - hw}
                  y={a.in.y - hw}
                  width={hw * 2}
                  height={hw * 2}
                  className="ov-node-handle"
                  strokeWidth={stroke}
                  style={{ pointerEvents: 'all', cursor: 'move' }}
                />
              </>
            )}
            <rect
              data-anchor={`${i}:anchor`}
              x={a.p.x - hw}
              y={a.p.y - hw}
              width={hw * 2}
              height={hw * 2}
              className={i === anchorActive ? 'ov-node-active' : 'ov-node-handle'}
              strokeWidth={stroke}
              style={{ pointerEvents: 'all', cursor: 'move' }}
            />
          </g>
        ))}
    </g>
  );
};
