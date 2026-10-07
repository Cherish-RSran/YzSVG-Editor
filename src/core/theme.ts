/**
 * 界面主题：全部是浅色系（含浅色渐变）。
 * 为什么没有暗色：暗色主题会把界面颜色带进面板里的取色/预览，让人误以为图形本身变了，
 * 而画板（白色）又和四周形成强烈反差。所以统一走浅色，只让**画布底色与网格**随主题变化，
 * 画板（图形所在的白纸）恒为白色，图本身不受影响。
 */

export type ThemeId = 'classic' | 'mint' | 'rose' | 'sand' | 'sky';

export interface Theme {
  id: ThemeId;
  /** 页面底色（面板 / 顶栏后面的那一层，支持渐变）。名字走 i18n 的 `theme_<id>` */
  appBg: string;
  /** 画布底色：画板以外的区域 */
  canvasBg: string;
  /** 网格线颜色（画在画布底色上，需要比它略深一点才看得见） */
  grid: string;
  /** 强调色：按钮选中态、选中框等 */
  accent: string;
}

export const THEMES: Theme[] = [
  {
    id: 'classic',
    appBg: 'linear-gradient(160deg, #f9fafb 0%, #eef1f6 100%)',
    canvasBg: '#f1f3f7',
    grid: '#dfe3ea',
    accent: '#2563eb',
  },
  {
    id: 'mint',
    appBg: 'linear-gradient(160deg, #f2fdfa 0%, #e6fbf1 100%)',
    canvasBg: '#ecfaf4',
    grid: '#bfe6d5',
    accent: '#0d9488',
  },
  {
    id: 'rose',
    appBg: 'linear-gradient(160deg, #fff5f6 0%, #fdeef3 100%)',
    canvasBg: '#fdf1f3',
    grid: '#f4ccd6',
    accent: '#e11d48',
  },
  {
    id: 'sand',
    appBg: 'linear-gradient(160deg, #fffcf3 0%, #fdf4e3 100%)',
    canvasBg: '#fbf5e9',
    grid: '#ecd8ae',
    accent: '#b45309',
  },
  {
    id: 'sky',
    appBg: 'linear-gradient(160deg, #f4fbff 0%, #e4f2fd 100%)',
    canvasBg: '#eef7fd',
    grid: '#c2dcf1',
    accent: '#0284c7',
  },
];

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export function themeOf(id: ThemeId): Theme {
  return BY_ID.get(id) ?? THEMES[0];
}
