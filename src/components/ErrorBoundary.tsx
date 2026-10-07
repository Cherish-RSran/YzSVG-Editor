import React from 'react';

interface State {
  error: Error | null;
}

/** 画布错误边界：渲染异常时兜底，避免整页白屏 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[svg-editor] 渲染错误：', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-fallback">
          <div className="error-title">画布渲染出错</div>
          <div className="error-msg">{this.state.error.message}</div>
          <button className="primary-btn" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
