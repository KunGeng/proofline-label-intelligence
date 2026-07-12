import type { ReactNode } from 'react';

export type AppView = 'landing' | 'intake' | 'review';

interface AppShellProps {
  activeView: AppView;
  children: ReactNode;
  onHome: () => void;
  onReviewLabel: () => void;
}

export function AppShell({
  activeView,
  children,
  onHome,
  onReviewLabel,
}: AppShellProps) {
  return (
    <div className="app-frame">
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
        </nav>
        <p className="session-note"><span aria-hidden="true">●</span> Browser session only</p>
      </header>
      <main id="main-content">{children}</main>
    </div>
  );
}
