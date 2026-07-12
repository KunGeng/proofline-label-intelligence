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
        Proofline currently supports U.S. distilled-spirit labels. Other beverage
        classes and physical-label/typography requirements remain outside automated
        validation.
      </p>
    </aside>
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
