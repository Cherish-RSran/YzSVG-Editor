import React, { useEffect, useState } from 'react';
import { store } from '../state/store';
import {
  getSnapshots,
  removeSnapshot,
  renameSnapshot,
  restoreSnapshot,
  saveSnapshot,
  Snapshot,
} from '../io';

/** 本地历史快照面板（P10）。名字可以直接点着改，方便自己备注「这版改了什么」 */
export const SnapshotPanel: React.FC = () => {
  const [list, setList] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setList(await getSnapshots());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const lang = store.state.lang;
  const L = (zh: string, en: string) => (lang === 'en' ? en : zh);

  return (
    <div className="panel snapshots">
      <div className="panel-title">{L('历史快照', 'Snapshots')}</div>
      <button
        className="wide-btn"
        data-tip={L('把当前画板存一份到本地，之后可以随时恢复', 'Save the current artboard locally to restore later')}
        onClick={async () => {
          await saveSnapshot();
          void refresh();
        }}
      >
        {L('保存当前状态', 'Save current state')}
      </button>
      <div className="snap-list">
        {loading && <div className="empty-hint">…</div>}
        {!loading && list.length === 0 && (
          <div className="empty-hint">{L('还没有快照', 'No snapshots yet')}</div>
        )}
        {list.map((s) => (
          <div className="snap-row" key={s.id}>
            <div className="snap-meta">
              {editing === s.id ? (
                <input
                  className="snap-rename"
                  autoFocus
                  defaultValue={s.name}
                  onBlur={async (e) => {
                    const v = e.target.value.trim();
                    setEditing(null);
                    if (v && v !== s.name) {
                      await renameSnapshot(s.id, v);
                      void refresh();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <div
                  className="snap-name"
                  data-tip={L('点击名字就能改名，方便备注这次改了什么', 'Click the name to rename it')}
                  onClick={() => setEditing(s.id)}
                >
                  {s.name}
                </div>
              )}
              <div className="snap-time">{new Date(s.createdAt).toLocaleString()}</div>
            </div>
            <button
              className="mini-btn"
              data-tip={L('把画板恢复到这个快照的样子', 'Restore the artboard to this snapshot')}
              onClick={async () => {
                await restoreSnapshot(s.id);
              }}
            >
              {L('恢复', 'Restore')}
            </button>
            <button
              className="mini-btn danger"
              data-tip={L('删除这个快照', 'Delete this snapshot')}
              onClick={async () => {
                await removeSnapshot(s.id);
                void refresh();
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
