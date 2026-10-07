import { parseSvg, readFileText } from '../core/parse';
import { serializeDoc, minifySvg } from '../core/serialize';
import { SvgDoc } from '../core/types';
import { notify, store } from '../state/store';
import { tf, currentLang } from '../i18n';
import { fitToViewport, replaceDoc } from '../state/actions';
import {
  toBase64Uri,
  toCssBackground,
  toDataUri,
  toHtmlSnippet,
  toReactComponent,
  toVueComponent,
  toBase64,
} from './codegen';
import {
  idbGet,
  idbSet,
  idbDelete,
  listSnapshots,
  pushSnapshot,
  deleteSnapshot,
  setSnapshotName,
  Snapshot,
} from './idb';

const AUTOSAVE_KEY = 'svg-editor:autosave';
const IDB_AUTOSAVE = 'autosave';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

export function pickFile(accept = '.svg,image/svg+xml'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function importFromFile(file: File): Promise<void> {
  try {
    const text = await readFileText(file);
    importFromText(text, file.name.replace(/\.svg$/i, ''));
  } catch (e) {
    notify(tf('msg_import_fail', currentLang(), { msg: (e as Error).message }), 'error');
  }
}

export function importFromText(text: string, title = '导入的 SVG'): void {
  try {
    const { doc, warnings, sanitize } = parseSvg(text);
    replaceDoc(doc);
    fitToViewport(); // 导入的画板尺寸往往和当前不一样，铺满视口再看
    const removed = new Set(sanitize.removedElements);
    const msg: string[] = [];
    if (removed.size > 0) msg.push(tf('msg_removed_unsafe', currentLang(), { list: [...removed].slice(0, 4).join('、') }));
    if (warnings.length > 0) msg.push(warnings.slice(0, 2).join('；'));
    if (msg.length > 0) notify(`${title}：${msg.join('；')}`, 'info');
    else notify(tf('msg_import_ok', currentLang(), { name: title }), 'success');
  } catch (e) {
    notify(tf('msg_import_fail', currentLang(), { msg: (e as Error).message }), 'error');
  }
}

/** 图片文件转 data URI（保证导出后不丢） */
export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

export function isImageFile(file: File): boolean {
  return /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

/** 监听粘贴 SVG 源码与图片 */
export function installPasteImport(): () => void {
  const onPaste = async (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    // 图片优先
    const files = Array.from(e.clipboardData?.files ?? []);
    const img = files.find(isImageFile);
    if (img && !/svg$/i.test(img.name)) {
      e.preventDefault();
      await insertImage(img);
      return;
    }
    if (img && /svg$/i.test(img.name)) {
      e.preventDefault();
      await importFromFile(img);
      return;
    }
    const text = e.clipboardData?.getData('text') ?? '';
    if (text && /<svg[\s>]/i.test(text)) {
      e.preventDefault();
      importFromText(text, '粘贴的 SVG');
    }
  };
  window.addEventListener('paste', onPaste);
  return () => window.removeEventListener('paste', onPaste);
}

/** 插入图片（自动转 data URI，导出后不丢） */
export async function insertImage(file: File): Promise<void> {
  try {
    const dataUri = await fileToDataUri(file);
    const { addNode } = await import('../state/actions');
    const { createNode } = await import('../core/model');
    const { nodeBBox } = await import('../core/geometry');
    const doc = store.state.doc;
    const node = createNode('image', {
      x: '40',
      y: '40',
      width: '200',
      height: '200',
      href: dataUri,
      preserveAspectRatio: 'xMidYMid meet',
    });
    node.name = file.name.replace(/\.[^.]+$/, '') || '图片';
    addNode(node, doc.rootId, '插入图片');
    // 自适应尺寸：读取图片原始宽高后按比例缩放
    const img = new Image();
    img.onload = () => {
      const max = Math.min(doc.width, doc.height) * 0.5;
      const k = max / Math.max(img.width, img.height);
      if (Number.isFinite(k) && k > 0) {
        node.attrs['width'] = String(Math.round(img.width * k));
        node.attrs['height'] = String(Math.round(img.height * k));
        store.bump();
      }
    };
    img.src = dataUri;
    void nodeBBox;
    notify('图片已插入（已内联为 data URI，导出不会丢失）', 'success');
  } catch (e) {
    notify(`图片插入失败：${(e as Error).message}`, 'error');
  }
}

export function svgToString(doc: SvgDoc, minify = false): string {
  const svg = serializeDoc(doc);
  return minify ? minifySvg(svg) : svg;
}

/** 使用 SVGO 优化（失败时降级到内置压缩规则） */
export async function optimizeSvg(
  svg: string,
  opts: { removeComments?: boolean; removeMetadata?: boolean; minifyStyles?: boolean; precision?: number } = {},
): Promise<{ data: string; before: number; after: number; engine: 'svgo' | 'builtin' }> {
  const before = new Blob([svg]).size;
  try {
    const mod = (await import('svgo/browser')) as unknown as {
      optimize?: (input: string, config?: unknown) => { data: string };
      default?: { optimize?: (input: string, config?: unknown) => { data: string } };
    };
    const optimize = mod.optimize ?? mod.default?.optimize;
    if (!optimize) throw new Error('svgo 未提供 optimize');
    const result = optimize(svg, {
      path: 'input.svg',
      multipass: true,
      js2svg: { pretty: false, indent: 0 },
      plugins: [
        {
          name: 'preset-default',
          params: {
            overrides: {
              removeViewBox: false,
              cleanupIds: false,
              convertPathData: { floatPrecision: opts.precision ?? 2 },
            },
          },
        },
      ],
    });
    const data = typeof result === 'string' ? result : result.data;
    if (!data) throw new Error('svgo 返回空结果');
    return { data, before, after: new Blob([data]).size, engine: 'svgo' };
  } catch {
    const data = minifySvg(svg);
    return { data, before, after: new Blob([data]).size, engine: 'builtin' };
  }
}

export function exportSvg(doc: SvgDoc, filename = 'drawing.svg', minify = false): void {
  downloadText(svgToString(doc, minify), filename, 'image/svg+xml');
}

export type RasterFormat = 'png' | 'jpeg' | 'webp';

export async function exportRaster(
  doc: SvgDoc,
  format: RasterFormat = 'png',
  scale = 2,
  transparent = false,
): Promise<void> {
  const svg = serializeDoc(doc);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 渲染失败，可能包含浏览器不支持的内容'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(doc.width * scale));
    canvas.height = Math.max(1, Math.round(doc.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布上下文');
    if (!transparent || format === 'jpeg') {
      ctx.fillStyle = doc.background || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, `image/${format}`, format === 'png' ? undefined : 0.92),
    );
    if (out) {
      const ext = format === 'jpeg' ? 'jpg' : format;
      downloadBlob(out, `drawing-${scale}x.${ext}`);
      notify(`${ext.toUpperCase()} ${scale}× ${currentLang() === 'en' ? 'exported' : '已导出'}`, 'success');
    } else {
      throw new Error('画布导出失败');
    }
  } catch (e) {
    notify(tf('msg_export_fail', currentLang(), { msg: (e as Error).message }), 'error');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** PDF 导出：矢量输出，不栅格化 */
export async function exportPdf(doc: SvgDoc, filename = 'drawing.pdf'): Promise<void> {
  try {
    const svgEl = buildSvgElement(doc);
    const [{ jsPDF }, svg2pdf] = await Promise.all([
      import('jspdf'),
      import('svg2pdf.js'),
    ]);
    const pdf = new jsPDF({
      orientation: doc.width >= doc.height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [doc.width, doc.height],
    });
    const mod = svg2pdf as unknown as { default?: unknown };
    const fn = (typeof (svg2pdf as unknown as { svg2pdf: unknown }).svg2pdf === 'function'
      ? (svg2pdf as unknown as { svg2pdf: (...a: unknown[]) => Promise<void> }).svg2pdf
      : (mod.default as (...a: unknown[]) => Promise<void>)) as unknown as (
      el: SVGElement,
      pdf: unknown,
      opts: unknown,
    ) => Promise<void>;
    // svg2pdf.js 以原型扩展方式挂载到 jsPDF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (pdf as unknown as { svg?: (el: SVGElement, o?: unknown) => Promise<void> }).svg?.(svgEl, {
      x: 0,
      y: 0,
      width: doc.width,
      height: doc.height,
    });
    void fn;
    pdf.save(filename);
    notify('已导出 PDF（矢量）', 'success');
  } catch (e) {
    notify(`PDF 导出失败：${(e as Error).message}`, 'error');
  }
}

/** 用文档模型构建真实 SVG 元素（供 PDF / 光栅化复用） */
export function buildSvgElement(doc: SvgDoc): SVGElement {
  const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  wrapper.setAttribute('width', String(doc.width));
  wrapper.setAttribute('height', String(doc.height));
  wrapper.setAttribute('viewBox', doc.viewBox.join(' '));
  wrapper.innerHTML = serializeDoc(doc).replace(/<svg[^>]*>|<\/svg>/g, '');
  return wrapper;
}

/** 导出为代码 / DataURI 等 */
export function exportCode(doc: SvgDoc, kind: 'jsx' | 'vue' | 'datauri' | 'base64' | 'css' | 'html'): void {
  const svg = serializeDoc(doc);
  switch (kind) {
    case 'jsx':
      downloadText(toReactComponent(svg), 'Icon.tsx', 'text/plain');
      break;
    case 'vue':
      downloadText(toVueComponent(svg), 'Icon.vue', 'text/plain');
      break;
    case 'datauri':
      downloadText(toDataUri(svg), 'icon-datauri.txt', 'text/plain');
      break;
    case 'base64':
      downloadText(toBase64Uri(svg), 'icon-base64.txt', 'text/plain');
      break;
    case 'css':
      downloadText(toCssBackground(svg), 'icon.css', 'text/css');
      break;
    case 'html':
      downloadText(toHtmlSnippet(svg), 'icon.html', 'text/html');
      break;
  }
  notify(tf('msg_exported', currentLang()), 'success');
}

export function codePreview(doc: SvgDoc, kind: 'jsx' | 'vue' | 'datauri' | 'base64' | 'css' | 'html'): string {
  const svg = serializeDoc(doc);
  switch (kind) {
    case 'jsx':
      return toReactComponent(svg);
    case 'vue':
      return toVueComponent(svg);
    case 'datauri':
      return toDataUri(svg);
    case 'base64':
      return toBase64(svg);
    case 'css':
      return toCssBackground(svg);
    case 'html':
      return toHtmlSnippet(svg);
  }
}

// ---------- 持久化 ----------

/**
 * 最近一次真正落盘的自动保存文本。
 * 用途：页面关闭（beforeunload）时无条件再写一次会把「打开看了一眼、什么都没改」也存下来，
 * 于是下次启动永远弹「是否打开上次内容」。内容没变就不写，这个弹窗才只在真的有改动时出现。
 */
let lastAutosaved: string | null = null;

/** 把当前文档记为「已保存」基线：之后只要没改动，就不会再产生自动保存 */
export function syncAutosaveBaseline(): void {
  lastAutosaved = serializeDoc(store.state.doc);
}

export async function saveAutosave(doc: SvgDoc): Promise<void> {
  const svg = serializeDoc(doc);
  if (svg === lastAutosaved) return; // 没变就别写，否则每次关闭都会留下一条"上次内容"
  lastAutosaved = svg;
  await idbSet(IDB_AUTOSAVE, svg);
  try {
    localStorage.setItem(AUTOSAVE_KEY, svg);
  } catch {
    /* 忽略配额错误 */
  }
}

/** 只探测「有没有上次没打开的内容」，不读进画布 —— 恢复与否交给用户决定 */
export async function hasAutosave(): Promise<boolean> {
  const text = (await idbGet<string>(IDB_AUTOSAVE)) || localStorage.getItem(AUTOSAVE_KEY);
  return !!text;
}

/** 把自动保存的内容读回画布。只在用户明确选择「打开」时才调用 */
export async function loadAutosave(): Promise<boolean> {
  let text = await idbGet<string>(IDB_AUTOSAVE);
  if (!text) text = localStorage.getItem(AUTOSAVE_KEY);
  if (!text) return false;
  try {
    const { doc } = parseSvg(text);
    lastAutosaved = text; // 读进来的这份就是新基线
    replaceDoc(doc);
    fitToViewport(); // 打开就铺满：缩放比例以此刻的「适应」为 100%
    return true;
  } catch {
    return false;
  }
}

export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
  void idbDelete(IDB_AUTOSAVE);
  lastAutosaved = null;
}

/** 默认快照名带上时间，不然几次快照都叫「手动快照」根本分不清 */
function defaultSnapshotName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return currentLang() === 'en'
    ? `Snapshot ${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
    : `快照 ${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

export async function saveSnapshot(name?: string): Promise<void> {
  await pushSnapshot(serializeDoc(store.state.doc), name?.trim() || defaultSnapshotName());
  notify(tf('msg_snapshot_saved', currentLang()), 'success');
}

export async function getSnapshots(): Promise<Snapshot[]> {
  return listSnapshots();
}

export type { Snapshot };

export async function restoreSnapshot(id: string): Promise<void> {
  const list = await listSnapshots();
  const snap = list.find((s) => s.id === id);
  if (!snap) return;
  try {
    const { doc } = parseSvg(snap.svg);
    replaceDoc(doc);
    notify(currentLang() === 'en' ? 'Snapshot restored' : '已恢复到该快照', 'success');
  } catch (e) {
    notify(tf('msg_import_fail', currentLang(), { msg: (e as Error).message }), 'error');
  }
}

export async function removeSnapshot(id: string): Promise<void> {
  await deleteSnapshot(id);
}

/** 快照改名：用户可以自己写「改了什么」 */
export async function renameSnapshot(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await setSnapshotName(id, trimmed);
  notify(tf('msg_snapshot_renamed', currentLang()), 'success');
}

/** 页面刷新前保存 */
export function installUnloadGuard(): void {
  window.addEventListener('beforeunload', () => {
    void saveAutosave(store.state.doc);
  });
}
