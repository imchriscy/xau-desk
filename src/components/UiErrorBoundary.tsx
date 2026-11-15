import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 防止单组件抛错导致整页黑屏 */
export default class UiErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[XauDesk]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: "#d1d4dc", background: "#131722", fontFamily: "system-ui" }}>
          <h2>界面渲染异常</h2>
          <p style={{ color: "#ef5350" }}>{this.state.error.message}</p>
          <button
            type="button"
            style={{ marginTop: 12, padding: "8px 16px" }}
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
