import { Component, type ReactNode } from "react";
import { exportJSON, getState } from "../data/store";
import { backupFileName, download } from "./download";

/** A crash in one screen shows a recovery page instead of a blank app. Data in IndexedDB is unaffected. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Tally crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const canBackUp = getState().ready;
    return (
      <div className="lock">
        <div className="col gap16" style={{ alignItems: "center", maxWidth: 420 }}>
          <h2>Tally hit a problem</h2>
          <p className="t-muted" style={{ margin: 0 }}>
            Your expenses are still saved on this device. Reload to try again.
            {canBackUp && " If it keeps happening, download a backup first."}
          </p>
          <div className="row gap8 wrap" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={() => location.reload()}>Reload</button>
            {canBackUp && (
              <button className="btn" onClick={() => download(backupFileName(), exportJSON(), "application/json")}>Download backup</button>
            )}
          </div>
          <code className="inline t-muted">{this.state.error.message}</code>
        </div>
      </div>
    );
  }
}
