/** 文档模型的核心类型定义（P1 契约） */

export type NodeType =
  | 'group'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'path'
  | 'text'
  | 'image'
  | 'use'
  | 'unknown';

export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export interface SvgNode {
  id: string;
  type: NodeType;
  name: string;
  parent: string | null;
  children: string[];
  /** SVG 原生属性，全部以字符串保存，保证导入导出无损 */
  attrs: Record<string, string>;
  transform: Mat;
  visible: boolean;
  locked: boolean;
  /** text 节点的文本内容 */
  text?: string;
  /** 路径文本：引用的路径节点 id（渲染为 textPath） */
  pathId?: string;
  /** unknown 节点保留的原始 markup */
  raw?: string;
  /** unknown 节点保留的原始标签名 */
  tag?: string;
  /** 未在白名单中的属性，原样保留并回写 */
  rawAttrs?: Record<string, string>;
  /** 图层备注（编辑器内部元数据，不写入 SVG 输出） */
  notes?: string;
}

export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

export type DefKind =
  | 'linearGradient'
  | 'radialGradient'
  | 'pattern'
  | 'clipPath'
  | 'mask'
  | 'marker'
  | 'other';

export interface DefEntry {
  id: string;
  kind: DefKind;
  attrs: Record<string, string>;
  stops?: GradientStop[];
  /** 无法结构化描述的 defs 内容，保留原始 markup */
  raw?: string;
}

export interface SvgDoc {
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  background: string;
  rootId: string;
  nodes: Record<string, SvgNode>;
  defs: DefEntry[];
  /** svg 根元素上保留的其它属性 */
  rootAttrs: Record<string, string>;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ToolId =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'star'
  | 'pen'
  | 'pencil'
  | 'node'
  | 'text';

export function emptyDoc(width = 800, height = 600): SvgDoc {
  const rootId = 'root';
  return {
    width,
    height,
    viewBox: [0, 0, width, height],
    background: '#ffffff',
    rootId,
    rootAttrs: {},
    defs: [],
    nodes: {
      [rootId]: {
        id: rootId,
        type: 'group',
        name: '画板',
        parent: null,
        children: [],
        attrs: {},
        transform: { ...IDENTITY },
        visible: true,
        locked: false,
      },
    },
  };
}
