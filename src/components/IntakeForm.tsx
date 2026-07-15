import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import type { ApplicationData } from '../domain/types';
import { parseAbv, parseMilliliters, parseProof } from '../domain/normalize';
import {
  BEVERAGE_TYPES,
  getBeverageProfile,
  type BeverageType,
} from '../domain/beverageProfiles';
import {
  ACCEPTED_IMAGE_ACCEPT,
  MIN_RECOMMENDED_LONGEST_EDGE,
  RETAKE_GUIDANCE,
  classifyImageReadiness,
  inspectImageReadiness,
  type ImageReadiness,
} from '../features/extraction/imageReadiness';
import { ScopeNotice, SectionCard } from './ui';

const applicationFieldDefinitions = [
  ['brandName', 'Brand name'],
  ['classType', 'Class/type'],
  ['abv', 'Alcohol by volume'],
  ['netContents', 'Net contents'],
  ['producerAddress', 'Producer address'],
] as const;

type RequiredApplicationFieldKey = (typeof applicationFieldDefinitions)[number][0];
type RequiredFieldKey =
  | RequiredApplicationFieldKey
  | 'proof'
  | 'countryOfOrigin'
  | 'labelImage';

// The same formats the CSV intake accepts, so both entry paths agree.
const numericFormatChecks = [
  ['abv', (value: string) => parseAbv(value) !== undefined,
    'Alcohol by volume must be a number or percentage, like 45%.'],
  ['proof', (value: string) => !value.trim() || parseProof(value) !== undefined,
    'Proof must be a number, like 90.'],
  ['netContents', (value: string) => parseMilliliters(value) !== undefined,
    'Net contents must be an amount with a supported unit, like 750 mL.'],
] as const;

const emptyApplication: ApplicationData = {
  beverageType: 'distilled_spirits',
  alcoholContentExpectation: 'declared',
  brandName: '',
  classType: '',
  abv: '',
  proof: '',
  netContents: '',
  producerAddress: '',
  isImported: false,
  countryOfOrigin: '',
};

interface IntakeFormProps {
  onCancel: () => void;
  onSubmit: (application: ApplicationData, file: File) => void | Promise<void>;
}

const readinessAdvisoryText = (readiness: ImageReadiness): string | undefined => {
  if (readiness.advisory === 'insufficient-pixels' && readiness.dimensions) {
    const { width, height } = readiness.dimensions;
    return `This ${width} × ${height} px image is below the recommended ${MIN_RECOMMENDED_LONGEST_EDGE} px longest edge. ${RETAKE_GUIDANCE}`;
  }

  if (readiness.advisory === 'decode-failed') {
    return `We could not read this image's dimensions locally. ${RETAKE_GUIDANCE}`;
  }

  return undefined;
};

export function IntakeForm({ onCancel, onSubmit }: IntakeFormProps) {
  const [application, setApplication] = useState<ApplicationData>(emptyApplication);
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [fileReadiness, setFileReadiness] = useState<ImageReadiness>();
  const [invalidFields, setInvalidFields] = useState<RequiredFieldKey[]>([]);
  const [formatErrors, setFormatErrors] = useState<string[]>([]);
  const [focusRequest, setFocusRequest] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fieldRefs = useRef<Partial<Record<RequiredFieldKey, HTMLInputElement | null>>>({});
  const focusAfterSubmit = useRef(false);
  const imageReadinessRequestRef = useRef(0);
  const beverageProfile = getBeverageProfile(application.beverageType);
  const requiredApplicationFields = applicationFieldDefinitions.filter(
    ([field]) =>
      field !== 'abv' || application.alcoholContentExpectation === 'declared',
  );
  const firstInvalidField = invalidFields[0];
  const invalidRequiredFields = requiredApplicationFields.filter(([field]) =>
    invalidFields.includes(field),
  );
  const formError = formatErrors.length > 0
    ? formatErrors.join(' ')
    : invalidRequiredFields.length > 0
      ? `Complete the required application facts: ${invalidRequiredFields
        .map(([, label]) => label)
        .join(', ')}.`
      : application.isImported && invalidFields.includes('countryOfOrigin')
        ? 'Country of origin is required for an imported product.'
        : undefined;

  useEffect(() => {
    if (!focusAfterSubmit.current || !firstInvalidField) {
      return;
    }

    fieldRefs.current[firstInvalidField]?.focus();
    focusAfterSubmit.current = false;
  }, [firstInvalidField, focusRequest]);

  useEffect(
    () => () => {
      imageReadinessRequestRef.current += 1;
    },
    [],
  );

  const reportInvalidFields = (fields: RequiredFieldKey[]): void => {
    focusAfterSubmit.current = true;
    setInvalidFields(fields);
    setFocusRequest((current) => current + 1);
  };

  const updateField = (field: keyof ApplicationData, value: string | boolean): void => {
    setApplication((current) => ({ ...current, [field]: value }));
    setInvalidFields((current) =>
      current.filter((invalidField) => invalidField !== field),
    );
    setFormatErrors([]);
  };

  const updateBeverageType = (beverageType: BeverageType): void => {
    const profile = getBeverageProfile(beverageType);
    setApplication((current) => ({
      ...current,
      beverageType,
      proof: profile.supportsProof ? current.proof : undefined,
      alcoholContentExpectation: profile.supportsProof
        ? 'declared'
        : current.alcoholContentExpectation,
    }));
    setFormatErrors([]);
  };

  const chooseFile = (candidate: File | undefined): void => {
    const request = imageReadinessRequestRef.current + 1;
    imageReadinessRequestRef.current = request;
    setFileReadiness(undefined);

    if (!candidate) {
      return;
    }

    const { blockingError: error } = classifyImageReadiness(candidate);
    setFileError(error);
    setFile(error ? undefined : candidate);
    setInvalidFields((current) =>
      current.filter((invalidField) => invalidField !== 'labelImage'),
    );

    if (error) {
      return;
    }

    void inspectImageReadiness(candidate).then((readiness) => {
      if (imageReadinessRequestRef.current !== request) {
        return;
      }

      setFileReadiness(readiness);
    });
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    chooseFile(event.target.files?.[0]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const missingFields = requiredApplicationFields
      .filter(([field]) => !application[field]?.trim())
      .map(([field]) => field);

    if (missingFields.length > 0) {
      setFormatErrors([]);
      reportInvalidFields(missingFields);
      return;
    }

    const failedFormatChecks = numericFormatChecks.filter(
      ([field, isValid]) =>
        (field !== 'abv' || application.alcoholContentExpectation === 'declared') &&
        (field !== 'proof' || beverageProfile.supportsProof) &&
        !isValid(application[field] ?? ''),
    );

    if (failedFormatChecks.length > 0) {
      setFormatErrors(failedFormatChecks.map(([, , message]) => message));
      reportInvalidFields(failedFormatChecks.map(([field]) => field));
      return;
    }

    if (!file) {
      setFileError('Choose a JPEG, PNG, or WebP label image to begin review.');
      reportInvalidFields(['labelImage']);
      return;
    }

    if (application.isImported && !application.countryOfOrigin?.trim()) {
      reportInvalidFields(['countryOfOrigin']);
      return;
    }

    setInvalidFields([]);
    void onSubmit(
      {
        ...application,
        abv: application.alcoholContentExpectation === 'declared'
          ? application.abv?.trim()
          : undefined,
        proof: beverageProfile.supportsProof ? application.proof?.trim() || undefined : undefined,
        countryOfOrigin: application.isImported
          ? application.countryOfOrigin?.trim()
          : undefined,
      },
      file,
    );
  };

  return (
    <section className="intake" aria-labelledby="intake-heading">
      <div className="page-intro">
        <p className="eyebrow">New single-label review</p>
        <h1 id="intake-heading">Start with the facts submitted for review.</h1>
        <p>
          We compare your application against what the label says. Images and OCR stay
          in this browser session.
        </p>
      </div>

      <ScopeNotice />

      <form className="intake-form" onSubmit={submit} noValidate>
        <SectionCard title="Application facts" eyebrow="01 / Declared information">
          <p className="required-note">Required fields are marked Required.</p>
          <div className="field-grid">
            <label>
              <span className="field-label">
                Beverage type <span className="required-indicator" aria-hidden="true">Required</span>
              </span>
              <select
                value={application.beverageType}
                onChange={(event) => updateBeverageType(event.target.value as BeverageType)}
              >
                {BEVERAGE_TYPES.map((beverageType) => (
                  <option key={beverageType} value={beverageType}>
                    {getBeverageProfile(beverageType).label}
                  </option>
                ))}
              </select>
            </label>
            {!beverageProfile.supportsProof ? (
              <label>
                <span className="field-label">
                  Alcohol content expectation{' '}
                  <span className="required-indicator" aria-hidden="true">Required</span>
                </span>
                <select
                  value={application.alcoholContentExpectation}
                  onChange={(event) =>
                    updateField('alcoholContentExpectation', event.target.value)
                  }
                >
                  {beverageProfile.allowedAlcoholContentExpectations.map((expectation) => (
                    <option key={expectation} value={expectation}>
                      {expectation === 'declared' ? 'Declared ABV' : 'Manual review'}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              <span className="field-label">
                Brand name <span className="required-indicator" aria-hidden="true">Required</span>
              </span>
              <input
                ref={(element) => {
                  fieldRefs.current.brandName = element;
                }}
                value={application.brandName}
                onChange={(event) => updateField('brandName', event.target.value)}
                required
                autoComplete="off"
                aria-invalid={invalidFields.includes('brandName') || undefined}
                aria-describedby={
                  invalidFields.includes('brandName') ? 'application-facts-error' : undefined
                }
              />
            </label>
            <label>
              <span className="field-label">
                Class/type <span className="required-indicator" aria-hidden="true">Required</span>
              </span>
              <input
                ref={(element) => {
                  fieldRefs.current.classType = element;
                }}
                value={application.classType}
                onChange={(event) => updateField('classType', event.target.value)}
                required
                autoComplete="off"
                placeholder="e.g. Straight Bourbon Whiskey"
                aria-invalid={invalidFields.includes('classType') || undefined}
                aria-describedby={
                  invalidFields.includes('classType') ? 'application-facts-error' : undefined
                }
              />
            </label>
            {application.alcoholContentExpectation === 'declared' ? (
              <label>
                <span className="field-label">
                  Alcohol by volume{' '}
                  <span className="required-indicator" aria-hidden="true">Required</span>
                </span>
                <input
                  ref={(element) => {
                    fieldRefs.current.abv = element;
                  }}
                  value={application.abv ?? ''}
                  onChange={(event) => updateField('abv', event.target.value)}
                  required
                  autoComplete="off"
                  placeholder="e.g. 45%"
                  aria-invalid={invalidFields.includes('abv') || undefined}
                  aria-describedby={
                    invalidFields.includes('abv') ? 'application-facts-error' : undefined
                  }
                />
              </label>
            ) : null}
            {beverageProfile.supportsProof ? (
              <label>
                <span className="field-label">Proof <span className="optional">Optional</span></span>
                <input
                  ref={(element) => {
                    fieldRefs.current.proof = element;
                  }}
                  value={application.proof ?? ''}
                  onChange={(event) => updateField('proof', event.target.value)}
                  autoComplete="off"
                  placeholder="e.g. 90 Proof"
                  aria-invalid={invalidFields.includes('proof') || undefined}
                  aria-describedby={
                    invalidFields.includes('proof') ? 'application-facts-error' : undefined
                  }
                />
              </label>
            ) : null}
            <label>
              <span className="field-label">
                Net contents <span className="required-indicator" aria-hidden="true">Required</span>
              </span>
              <input
                ref={(element) => {
                  fieldRefs.current.netContents = element;
                }}
                value={application.netContents}
                onChange={(event) => updateField('netContents', event.target.value)}
                required
                autoComplete="off"
                placeholder="e.g. 750 mL"
                aria-invalid={invalidFields.includes('netContents') || undefined}
                aria-describedby={
                  invalidFields.includes('netContents') ? 'application-facts-error' : undefined
                }
              />
            </label>
            <label>
              <span className="field-label">
                Producer address{' '}
                <span className="required-indicator" aria-hidden="true">Required</span>
              </span>
              <input
                ref={(element) => {
                  fieldRefs.current.producerAddress = element;
                }}
                value={application.producerAddress}
                onChange={(event) => updateField('producerAddress', event.target.value)}
                required
                autoComplete="street-address"
                placeholder="e.g. Distillery, City, State"
                aria-invalid={invalidFields.includes('producerAddress') || undefined}
                aria-describedby={
                  invalidFields.includes('producerAddress') ? 'application-facts-error' : undefined
                }
              />
            </label>
          </div>

          <div className="import-fields">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={application.isImported}
                onChange={(event) => updateField('isImported', event.target.checked)}
              />
              <span>
                <strong>Imported product</strong>
                <small>Ask for country of origin when this product is imported.</small>
              </span>
            </label>
            {application.isImported ? (
              <label>
                <span className="field-label">
                  Country of origin{' '}
                  <span className="required-indicator" aria-hidden="true">Required</span>
                </span>
                <input
                  ref={(element) => {
                    fieldRefs.current.countryOfOrigin = element;
                  }}
                  value={application.countryOfOrigin ?? ''}
                  onChange={(event) => updateField('countryOfOrigin', event.target.value)}
                  required
                  autoComplete="country-name"
                  aria-invalid={invalidFields.includes('countryOfOrigin') || undefined}
                  aria-describedby={
                    invalidFields.includes('countryOfOrigin')
                      ? 'application-facts-error'
                      : undefined
                  }
                />
              </label>
            ) : null}
          </div>
          {formError ? (
            <p className="inline-error" id="application-facts-error" role="alert">
              {formError}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title="Label image" eyebrow="02 / Evidence">
          <div
            className={`dropzone${dragging ? ' dropzone--dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <p className="dropzone__icon" aria-hidden="true">↥</p>
            <p>
              <strong>Drop one label image here</strong>{' '}
              <span className="required-indicator">Required</span> or choose it from your device.
            </p>
            <p className="muted">JPEG, PNG, or WebP · 10 MB maximum · processed in this browser</p>
            <label className="button button--secondary file-control">
              Choose label image
              <input
                ref={(element) => {
                  fieldRefs.current.labelImage = element;
                }}
                type="file"
                accept={ACCEPTED_IMAGE_ACCEPT}
                onChange={onFileChange}
                required
                aria-describedby={
                  fileError
                    ? 'file-error'
                    : fileReadiness?.advisory
                      ? 'file-readiness-advisory'
                      : undefined
                }
                aria-invalid={fileError ? true : invalidFields.includes('labelImage') || undefined}
              />
            </label>
            {file ? <p className="selected-file">Ready: <strong>{file.name}</strong></p> : null}
            {fileReadiness?.advisory ? (
              <p className="image-readiness-advisory" id="file-readiness-advisory" role="status">
                {readinessAdvisoryText(fileReadiness)}
              </p>
            ) : null}
            <p className="muted">
              No label handy?{' '}
              <a href="/demo/old-tom-bourbon.jpg" download>
                Download the Old Tom sample label
              </a>{' '}
              and use the facts printed on it.
            </p>
          </div>
          {fileError ? <p className="inline-error" id="file-error" role="alert">{fileError}</p> : null}
        </SectionCard>

        <div className="intake-form__actions">
          <button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="button button--primary">Start evidence review</button>
        </div>
      </form>
    </section>
  );
}
