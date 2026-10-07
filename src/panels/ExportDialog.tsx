import React, { useEffect, useState } from 'react';
import { store, useVersion } from '../state/store';
import { useT, tf, currentLang } from '../i18n';
import { exportRaster, exportSvg, exportCode, codePreview, optimizeSvg, svgToString, exportPdf, RasterFormat } from '../io';

type Tab = 'raster' | 'svg' | 'code';

export const ExportDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useVersion();
  const doc = store.state.doc;
  const t = useT();
  const [tab, setTab] = useState<Tab>('raster');
  const [format, setFormat] = useState<RasterFormat>('png');
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [minify, setMinify] = useState(true);
  const [useSvgo, setUseSvgo] = useState(true);
  const [opt, setOpt] = useState<{ data: string; before: number; after: number; engine: string } | null>(null);
  const [codeKind, setCodeKind] = useState<'jsx' | 'vue' | 'datauri' | 'base64' | 'css' | 'html'>('jsx');
  const [copied, setCopied] = useState(false);

  const runOptimize = async () => {
    const raw = svgToString(doc, false);
    if (!useSvgo) {
      const data = svgToString(doc, true);
      setOpt({ data, before: raw.length, after: data.length, engine: '内置压缩' });
      return;
    }
    const r = await optimizeSvg(raw);
    setOpt({ data: r.data, before: r.before, after: r.after, engine: r.engine === 'svgo' ? 'SVGO' : '内置压缩' });
  };

  useEffect(() => {
    if (tab === 'svg') void runOptimize();
  }, [tab, useSvgo, minify]);

  const code = codePreview(doc, codeKind);
  const saved = opt ? Math.max(0, Math.round((1 - opt.after / Math.max(1, opt.before)) * 100)) : 0;

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{t('export_title')}</div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-tabs">
          <button className={tab === 'raster' ? 'active' : ''} onClick={() => setTab('raster')}>
            {t('tab_raster')}
          </button>
          <button className={tab === 'svg' ? 'active' : ''} onClick={() => setTab('svg')}>
            {t('tab_svg')}
          </button>
          <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>
            {t('tab_code')}
          </button>
        </div>

        <div className="modal-body">
          {tab === 'raster' && (
            <>
              <div className="field-row">
                <span className="field-label">{t('format')}</span>
                <select className="mini-select" value={format} onChange={(e) => setFormat(e.target.value as RasterFormat)}>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPG</option>
                  <option value="webp">WebP</option>
                </select>
              </div>
              <div className="field-row">
                <span className="field-label">{t('scale')}</span>
                {[1, 2, 3, 4].map((s) => (
                  <button key={s} className={`chip ${scale === s ? 'active' : ''}`} onClick={() => setScale(s)}>
                    {s}×
                  </button>
                ))}
              </div>
              <label className="field-row">
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
                <span>{t('transparent_bg')}</span>
              </label>
              <div className="hint">{tf('output_size', currentLang(), { w: Math.round(doc.width * scale), h: Math.round(doc.height * scale) })}</div>
              <button className="primary-btn" onClick={() => void exportRaster(doc, format, scale, transparent)}>
                导出 {format.toUpperCase()}（{scale}×）
              </button>
              <button className="primary-btn" style={{ background: '#475569', borderColor: '#475569' }} onClick={() => void exportPdf(doc)}>
                导出 PDF（矢量，不栅格化）
              </button>
            </>
          )}

          {tab === 'svg' && (
            <>
              <label className="field-row">
                <input type="checkbox" checked={useSvgo} onChange={(e) => setUseSvgo(e.target.checked)} />
                <span>{t('use_svgo')}</span>
              </label>
              <label className="field-row">
                <input type="checkbox" checked={minify} onChange={(e) => setMinify(e.target.checked)} />
                <span>{t('minify_ws')}</span>
              </label>
              {opt && (
                <div className="compare">
                  <div>
                    {t('before_opt')} <b>{opt.before}</b> {t('bytes')}
                  </div>
                  <div>
                    {t('after_opt')} <b>{opt.after}</b> {t('bytes')}（{opt.engine}）
                  </div>
                  <div className={saved > 0 ? 'saved' : ''}>{tf('reduced', currentLang(), { n: saved })}</div>
                </div>
              )}
              <div className="btn-row">
                <button className="mini-btn" onClick={() => void runOptimize()}>
                  {t('recalc')}
                </button>
                <button className="mini-btn" onClick={() => navigator.clipboard?.writeText(opt?.data ?? svgToString(doc, minify))}>
                  {t('copy_source')}
                </button>
              </div>
              <textarea className="text-input mono" rows={8} readOnly value={opt?.data ?? svgToString(doc, minify)} />
              <button className="primary-btn" onClick={() => exportSvg(doc, 'drawing.svg', minify)}>
                {t('export_svg')}
              </button>
            </>
          )}

          {tab === 'code' && (
            <>
              <div className="field-row">
                <span className="field-label">{t('code_kind')}</span>
                <select className="mini-select" value={codeKind} onChange={(e) => setCodeKind(e.target.value as typeof codeKind)}>
                  <option value="jsx">{t('code_jsx')}</option>
                  <option value="vue">{t('code_vue')}</option>
                  <option value="datauri">{t('code_datauri')}</option>
                  <option value="base64">{t('code_base64')}</option>
                  <option value="css">{t('code_css')}</option>
                  <option value="html">{t('code_html')}</option>
                </select>
              </div>
              <textarea className="text-input mono" rows={12} readOnly value={code} />
              <div className="btn-row">
                <button
                  className="mini-btn"
                  onClick={() => {
                    void navigator.clipboard?.writeText(code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? t('copied') : t('copy_code')}
                </button>
                <button className="mini-btn" onClick={() => exportCode(doc, codeKind)}>
                  {t('download')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
