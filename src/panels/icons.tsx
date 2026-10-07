import React from 'react';

/** 工具与操作图标：20x20，stroke 使用 currentColor，随按钮状态变化 */

const S: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconSelect = () => (
  <S>
    <path d="M5 3 L5 15 L8 12 L10.4 17 L12.6 16 L10.2 11 L14.4 11 Z" />
  </S>
);

export const IconRect = () => (
  <S>
    <rect x="4" y="4" width="12" height="12" rx="1.5" />
  </S>
);

export const IconEllipse = () => (
  <S>
    <ellipse cx="10" cy="10" rx="6.5" ry="5.5" />
  </S>
);

export const IconLine = () => (
  <S>
    <path d="M4 16 L16 4" />
  </S>
);

export const IconPolygon = () => (
  <S>
    <path d="M10 3 L16 6.5 L16 13.5 L10 17 L4 13.5 L4 6.5 Z" />
  </S>
);

export const IconStar = () => (
  <S>
    <path d="M10 3 L12.2 7.6 L17 8.3 L13.5 11.9 L14.4 16.7 L10 14.3 L5.6 16.7 L6.5 11.9 L3 8.3 L7.8 7.6 Z" />
  </S>
);

export const IconPen = () => (
  <S>
    <path d="M4 16 L4 12.5 L12.5 4 L16 7.5 L7.5 16 Z" />
    <path d="M12.5 4 L15 6.5" />
  </S>
);

export const IconPencil = () => (
  <S>
    <path d="M3 17 L4.5 12.5 L13 4 A1.8 1.8 0 0 1 15.5 6.5 L7 15 Z" />
    <path d="M12 5 L14.5 7.5" />
  </S>
);

export const IconNode = () => (
  <S>
    <path d="M6.5 12 Q10 4 13.5 12" />
    <rect x="4" y="10" width="4" height="4" />
    <rect x="12" y="10" width="4" height="4" />
  </S>
);

export const IconText = () => (
  <S>
    <path d="M5 5 L15 5" />
    <path d="M10 5 L10 16" />
  </S>
);

export const IconGroup = () => (
  <S>
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <rect x="9" y="9" width="8" height="8" rx="1" />
  </S>
);

export const IconUngroup = () => (
  <S>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="10" y="10" width="7" height="7" rx="1" />
    <path d="M7 10 L13 16" strokeDasharray="2 2" />
  </S>
);

export const IconCopy = () => (
  <S>
    <rect x="7" y="7" width="9" height="9" rx="1.5" />
    <path d="M13 7 L13 4 L4 4 L4 13 L7 13" />
  </S>
);

export const IconTrash = () => (
  <S>
    <path d="M4 6 L16 6" />
    <path d="M6 6 L6 16 L14 16 L14 6" />
    <path d="M8 3 L12 3" />
  </S>
);

export const IconUndo = () => (
  <S>
    <path d="M7 7 L4 10 L7 13" />
    <path d="M4 10 L12 10 A4 4 0 1 1 9 16" />
  </S>
);

export const IconRedo = () => (
  <S>
    <path d="M13 7 L16 10 L13 13" />
    <path d="M16 10 L8 10 A4 4 0 1 0 11 16" />
  </S>
);

// ---------- 对齐：两条长短不同的「条」贴向同一侧，方向和位置就是对齐方式 ----------

export const IconAlignLeft = () => (
  <S>
    <rect x="3" y="5" width="14" height="3.4" rx="1" />
    <rect x="3" y="11.6" width="9" height="3.4" rx="1" />
  </S>
);

export const IconAlignHCenter = () => (
  <S>
    <rect x="3" y="5" width="14" height="3.4" rx="1" />
    <rect x="5.5" y="11.6" width="9" height="3.4" rx="1" />
  </S>
);

export const IconAlignRight = () => (
  <S>
    <rect x="3" y="5" width="14" height="3.4" rx="1" />
    <rect x="8" y="11.6" width="9" height="3.4" rx="1" />
  </S>
);

export const IconAlignTop = () => (
  <S>
    <rect x="4" y="3" width="3.4" height="14" rx="1" />
    <rect x="12" y="3" width="3.4" height="9" rx="1" />
  </S>
);

export const IconAlignVCenter = () => (
  <S>
    <rect x="4" y="3" width="3.4" height="14" rx="1" />
    <rect x="12" y="5.5" width="3.4" height="9" rx="1" />
  </S>
);

export const IconAlignBottom = () => (
  <S>
    <rect x="4" y="3" width="3.4" height="14" rx="1" />
    <rect x="12" y="8" width="3.4" height="9" rx="1" />
  </S>
);

// ---------- 分布：三根等间距的条，一眼看出「间距被拉均匀」 ----------

export const IconDistributeH = () => (
  <S>
    <rect x="2.6" y="4" width="3.2" height="12" rx="1" />
    <rect x="8.4" y="4" width="3.2" height="12" rx="1" />
    <rect x="14.2" y="4" width="3.2" height="12" rx="1" />
  </S>
);

export const IconDistributeV = () => (
  <S>
    <rect x="4" y="2.6" width="12" height="3.2" rx="1" />
    <rect x="4" y="8.4" width="12" height="3.2" rx="1" />
    <rect x="4" y="14.2" width="12" height="3.2" rx="1" />
  </S>
);

// ---------- 层级：箭头 = 往哪挪，横条 = 被移动的那个面 ----------

/** 置顶：挪到最前面（箭头在上，面在下面） */
export const IconToFront = () => (
  <S>
    <path d="M10 3 L10 11.5" />
    <path d="M6.4 6.4 L10 3 L13.6 6.4" />
    <rect x="4" y="12.5" width="12" height="4" rx="1" />
  </S>
);

/** 上移一层 */
export const IconForward = () => (
  <S>
    <path d="M10 4 L10 16" />
    <path d="M6.4 7.4 L10 4 L13.6 7.4" />
  </S>
);

/** 下移一层 */
export const IconBackward = () => (
  <S>
    <path d="M10 4 L10 16" />
    <path d="M6.4 12.6 L10 16 L13.6 12.6" />
  </S>
);

/** 置底：挪到最后面 */
export const IconToBack = () => (
  <S>
    <rect x="4" y="3.5" width="12" height="4" rx="1" />
    <path d="M10 8.5 L10 17" />
    <path d="M6.4 13.6 L10 17 L13.6 13.6" />
  </S>
);

// ---------- 视图：放大镜 + 加减号 ----------

export const IconZoomOut = () => (
  <S>
    <circle cx="9" cy="9" r="5.6" />
    <path d="M13.2 13.2 L17 17" />
    <path d="M6.4 9 L11.6 9" />
  </S>
);

export const IconZoomIn = () => (
  <S>
    <circle cx="9" cy="9" r="5.6" />
    <path d="M13.2 13.2 L17 17" />
    <path d="M6.4 9 L11.6 9" />
    <path d="M9 6.4 L9 11.6" />
  </S>
);

/**
 * 上锁：锁梁闭合扣在锁体上（两端都接到锁体），锁体实心，警示红。
 * 与 IconLockOpen 的差别不仅靠颜色——形状上「闭合 vs 张开」是主区分，色弱也能分辨。
 */
export const IconLockClosed = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="5" y="9" width="10" height="7" rx="1.5" fill="#dc2626" stroke="#dc2626" strokeWidth="1.2" />
    <path
      d="M7 9 L7 7 A3 3 0 0 1 13 7 L13 9"
      fill="none"
      stroke="#dc2626"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * 解锁：锁梁明显向上抬起并向右偏转（张开），右端离开锁体；锁体空心轮廓，中性灰。
 */
export const IconLockOpen = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="5" y="9" width="10" height="7" rx="1.5" fill="none" stroke="#6b7280" strokeWidth="1.7" />
    <path
      d="M7.5 9 L7.5 7 A3 3 0 0 1 12.5 5.2"
      fill="none"
      stroke="#6b7280"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);
