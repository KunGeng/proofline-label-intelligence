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
}

export type ProgressListener = (event: ExtractionProgress) => void;

export type ExtractFromImage = (
  file: File,
  onProgress: ProgressListener,
) => Promise<ExtractionJobResult>;

export interface DemoCase {
  id: string;
  title: string;
  imageUrl: string;
  disclosure: string;
  application: ApplicationData;
  extraction: LabelExtraction;
}
