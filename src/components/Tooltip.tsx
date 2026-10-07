import React, { useEffect, useState } from 'react';

/**
 * 全局悬停提示层：任何带 `data-tip` 的元素都会显示提示。
 *
 * 为什么不用原生 title：它要悬停 1 秒以上才出现、样式不可控、还不能换行。
 * 这里 110ms 就弹出，支持「标题 \n 说明」两行，并自动避开视口右/下边缘。
 * 提示层挂在 body 级（position: fixed），不会被面板的 overflow 裁掉。
 */
const SHOW_DELAY = 110;
const MAX_W = 240;
const LINE_H = 16;

export const TooltipLayer: React.FC = () => {
  const [tip, setTip] = useState<{ title: string; desc: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let timer = 0;
    const hide = () => {
      window.clearTimeout(timer);
      setTip(null);
    };

    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!el) return;
      const raw = el.getAttribute('data-tip') ?? '';
      if (!raw) return;
      const [title, ...rest] = raw.split('\n');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const h = (1 + rest.length) * LINE_H + 12;
        const below = r.bottom + 6;
        const y = below + h > window.innerHeight ? Math.max(4, r.top - h - 6) : below;
        const x = Math.max(6, Math.min(r.left, window.innerWidth - MAX_W - 6));
        setTip({ title, desc: rest.join('\n'), x, y });
      }, SHOW_DELAY);
    };

    // 在同一个按钮内部移动（比如移到它的 svg 图标上）不要闪烁
    const onOut = (e: MouseEvent) => {
      const from = (e.target as Element | null)?.closest?.('[data-tip]');
      const to = (e.relatedTarget as Element | null)?.closest?.('[data-tip]');
      if (from && to && from === to) return;
      hide();
    };

    window.addEventListener('mouseover', onOver);
    window.addEventListener('mouseout', onOut);
    window.addEventListener('mousedown', hide); // 一按下就收起，别挡着操作
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', hide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mouseover', onOver);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('mousedown', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div className="tip-box" style={{ left: tip.x, top: tip.y, maxWidth: MAX_W }}>
      <div className="tip-title">{tip.title}</div>
      {tip.desc && <div className="tip-desc">{tip.desc}</div>}
    </div>
  );
};
