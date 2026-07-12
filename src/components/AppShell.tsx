import type { ReactNode } from 'react';

export type AppView = 'landing' | 'intake' | 'batch' | 'review';

interface AppShellProps {
  activeView: AppView;
  children: ReactNode;
  onHome: () => void;
  onReviewLabel: () => void;
  onReviewBatch: () => void;
}

export function AppShell({
  activeView,
  children,
  onHome,
  onReviewLabel,
  onReviewBatch,
}: AppShellProps) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to review
      </a>
      <header className="topbar">
        <button className="brand" type="button" onClick={onHome} aria-label="Go to Proofline home">
          <span className="brand__mark" aria-hidden="true">P</span>
          <span>
            <strong>Proofline</strong>
            <small>label intelligence</small>
          </span>
        </button>
        <nav aria-label="Primary navigation" className="topbar__nav">
          <button
            className={activeView === 'landing' ? 'nav-link nav-link--active' : 'nav-link'}
            type="button"
            onClick={onHome}
            aria-current={activeView === 'landing' ? 'page' : undefined}
          >
            Overview
          </button>
          <button
            className={activeView === 'intake' ? 'nav-link nav-link--active' : 'nav-link'}
            type="button"
            onClick={onReviewLabel}
            aria-current={activeView === 'intake' ? 'page' : undefined}
          >
            New review
          </button>
          <button
            className={activeView === 'batch' ? 'nav-link nav-link--active' : 'nav-link'}
            type="button"
            onClick={onReviewBatch}
            aria-current={activeView === 'batch' ? 'page' : undefined}
          >
            Batch review
          </button>
        </nav>
        <p className="session-note"><span aria-hidden="true">●</span> Browser session only</p>
      </header>
      <main id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
