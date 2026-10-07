import React, { useRef } from 'react';

/**
 * 可拖动的分隔条：拖动改宽度，双击把这一侧收起。
 * 用 pointer capture + 增量位移，省掉 window 上的全局监听（jsdom 里也能安全调用）。
 */
export const Resizer: React.FC<{
  side: 'left' | 'right';
  /** 悬停提示文案（走全局 tooltip 层，比原生 title 快） */
  tip: string;
  /** 增量位移（像素） */
  onResize: (dx: number) => void;
  onCollapse: () => void;
}> = ({ side, tip, onResize, onCollapse }) => {
  const dragging = useRef(false);
  const last = useRef(0);

  return (
    <div
      className={`col-resizer ${side}`}
      data-tip={tip}
      data-resizer={side}
      onPointerDown={(e) => {
        dragging.current = true;
        last.current = e.clientX;
        const el = e.currentTarget;
        if (typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const dx = e.clientX - last.current;
        last.current = e.clientX;
        if (dx !== 0) onResize(dx);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        const el = e.currentTarget;
        if (typeof el.releasePointerCapture === 'function' && el.hasPointerCapture?.(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      }}
      onDoubleClick={onCollapse}
    />
  );
};
