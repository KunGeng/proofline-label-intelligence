import { useEffect, useRef, useState, type ReactNode } from 'react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

interface EvidenceImageViewerProps {
  src?: string;
  alt: string;
  imageClassName?: string;
  fixture?: ReactNode;
}

export function EvidenceImageViewer({
  src,
  alt,
  imageClassName,
  fixture,
}: EvidenceImageViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const openerRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);

  useEffect(() => {
    if (!expanded && shouldRestoreFocusRef.current) {
      openerRef.current?.focus();
      shouldRestoreFocusRef.current = false;
    }
  }, [expanded]);

  const closeExpandedEvidence = (): void => {
    shouldRestoreFocusRef.current = true;
    setZoom(MIN_ZOOM);
    setExpanded(false);
  };

  const compactEvidence = src ? (
    <img className={imageClassName} src={src} alt={alt} />
  ) : fixture;
  const fullSizeEvidence = src ? (
    <img
      className={imageClassName}
      src={src}
      alt={alt}
      style={{ transform: 'scale(' + zoom + ')' }}
    />
  ) : (
    <div style={{ transform: 'scale(' + zoom + ')' }}>{fixture}</div>
  );

  if (!compactEvidence) {
    return null;
  }

  if (expanded) {
    return (
      <section className="evidence-image-viewer__expanded" aria-label={`Full-size ${alt}`}>
        <div className="evidence-image-viewer__controls">
          <button type="button" className="text-button" onClick={closeExpandedEvidence}>
            Close full-size label evidence
          </button>
          <div className="evidence-image-viewer__zoom-controls" aria-label="Evidence zoom controls">
            <button
              type="button"
              className="text-button"
              onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM}
            >
              Zoom out
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
            >
              Zoom in
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setZoom(MIN_ZOOM)}
              disabled={zoom === MIN_ZOOM}
            >
              Reset zoom
            </button>
          </div>
        </div>
        <p className="evidence-image-viewer__zoom-level">Zoom: {zoom.toFixed(2)}×</p>
        <div className="evidence-image-viewer__full-size">{fullSizeEvidence}</div>
      </section>
    );
  }

  return (
    <figure className="label-preview evidence-image-viewer">
      {compactEvidence}
      <figcaption>
        Evidence stays attached to this review for the current browser session.
        <button
          ref={openerRef}
          type="button"
          className="text-button evidence-image-viewer__open"
          onClick={() => setExpanded(true)}
        >
          Open full-size label evidence
        </button>
      </figcaption>
    </figure>
  );
}
