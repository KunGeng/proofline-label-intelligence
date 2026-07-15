import type {
  AlcoholContentExpectation,
  BeverageType,
} from './beverageProfiles';

export type FieldKey =
  | 'brandName'
  | 'classType'
  | 'abv'
  | 'alcoholContentRequirement'
  | 'proof'
  | 'abvProofConsistency'
  | 'netContents'
  | 'producerAddress'
  | 'countryOfOrigin'
  | 'warningText'
  | 'warningHeading'
  | 'warningUppercase'
  | 'warningBold'
  | 'warningLegibility';

export type ReviewState = 'match' | 'mismatch' | 'needs_review' | 'unreadable';

export type CandidateSource = 'ocr' | 'fixture' | 'agent';

export interface Candidate {
  value: string;
  rawText: string;
  confidence: number;
  source: CandidateSource;
}

export interface ApplicationData {
  beverageType: BeverageType;
  alcoholContentExpectation: AlcoholContentExpectation;
  brandName: string;
  classType: string;
  abv?: string;
  proof?: string;
  netContents: string;
  producerAddress: string;
  isImported: boolean;
  countryOfOrigin?: string;
}

export interface LabelExtraction {
  brandName?: Candidate;
  classType?: Candidate;
  abv?: Candidate;
  proof?: Candidate;
  netContents?: Candidate;
  producerAddress?: Candidate;
  countryOfOrigin?: Candidate;
  warningText?: Candidate;
  warningHeading?: Candidate;
}

export interface ReviewFlags {
  warningUppercaseConfirmed: boolean;
  warningBoldConfirmed: boolean;
  warningLegibilityConfirmed: boolean;
}

export interface ValidationInput {
  application: ApplicationData;
  extraction: LabelExtraction;
  flags: ReviewFlags;
  hasVisualEvidence: boolean;
}

export interface FieldResult {
  field: FieldKey;
  state: ReviewState;
  expected: string;
  observed: string;
  confidence?: number;
  reason: string;
}

export interface VerificationResult {
  fields: FieldResult[];
  overallState: ReviewState;
}
