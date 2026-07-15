import type { ReactNode } from 'react';
import type { CandidateSource, ReviewState } from '../domain/types';

const statusLabels: Record<ReviewState, string> = {
  match: 'Match',
  mismatch: 'Mismatch',
  needs_review: 'Needs review',
  unreadable: 'Unreadable',
};

const sourceLabels: Record<CandidateSource, string> = {
  ocr: 'OCR candidate',
  fixture: 'Fixture evidence',
  agent: 'Agent-entered',
};

export const statusLabel = (state: ReviewState): string => statusLabels[state];

export function StatusBadge({ state }: { state: ReviewState }) {
  return (
    <span className={`status-badge status-badge--${state}`}>
      {statusLabels[state]}
    </span>
  );
}

export function SourceChip({ source }: { source: CandidateSource }) {
  return <span className="source-chip">{sourceLabels[source]}</span>;
}

export function ScopeNotice() {
  return (
    <aside className="scope-notice" role="note" aria-label="Prototype scope">
      <strong>Prototype scope</strong>
      <p>
        Proofline supports distilled spirits, beer, and wine. Alcohol-content exceptions
        and physical-label/typography requirements remain in human review.
      </p>
    </aside>
  );
}

export function QueueEmptyIllustration() {
  return (
    <svg
      className="empty-state-illustration"
      viewBox="0 0 176 112"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M26 83h124" className="empty-state-illustration__ground" />
      <rect x="48" y="29" width="80" height="48" rx="4" className="empty-state-illustration__card" />
      <path d="M65 45h47M65 56h32M65 67h23" className="empty-state-illustration__line" />
      <circle cx="132" cy="33" r="18" className="empty-state-illustration__seal" />
      <path d="m124 33 5 5 10-12" className="empty-state-illustration__check" />
    </svg>
  );
}

export function SectionCard({
  title,
  eyebrow,
  children,
  className = '',
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-card ${className}`.trim()} aria-labelledby={titleToId(title)}>
      <div className="section-card__heading">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={titleToId(title)}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

const titleToId = (title: string): string =>
  `section-${title.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
