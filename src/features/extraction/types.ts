import type { ApplicationData, LabelExtraction } from '../../domain/types';

export interface ExtractionProgress {
  phase: 'preparing' | 'reading' | 'validating';
  value: number;
}

export interface ExtractionJobResult {
  extraction: LabelExtraction;
  rawText: string;
  thumbnailUrl?: string;
  error?: string;
  source: 'ocr' | 'fixture';
  durationMs?: number;
  timings?: ExtractionTimings;
}

export interface ExtractionTimings {
  preparationMs: number;
  workerWaitMs: number;
  recognitionMs: number;
  totalMs: number;
}

export interface ExtractionOptions {
  signal?: AbortSignal;
  /** `undefined` uses the product deadline; `null` intentionally runs uncapped. */
  deadlineMs?: number | null;
}

export type ProgressListener = (event: ExtractionProgress) => void;

export type ExtractFromImage = (
  file: File,
  onProgress: ProgressListener,
  options?: ExtractionOptions,
) => Promise<ExtractionJobResult>;

export type DemoCaseId =
  | 'clear'
  | 'mismatch'
  | 'foreign-origin'
  | 'warning-heading'
  | 'degraded';

export type DemoFixtureVariant = 'foreign-origin' | 'warning-heading';

export type DemoVisual =
  | { kind: 'image'; src: string; className?: string }
  | { kind: 'fixture'; variant: DemoFixtureVariant };

export interface DemoCase {
  id: DemoCaseId;
  title: string;
  outcome: string;
  disclosure: string;
  application: ApplicationData;
  extraction: LabelExtraction;
  rawText: string;
  visual: DemoVisual;
}
