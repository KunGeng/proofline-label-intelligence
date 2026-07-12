import { useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import type { ApplicationData } from '../domain/types';
import { ScopeNotice, SectionCard } from './ui';

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const requiredApplicationFields = [
  ['brandName', 'Brand name'],
  ['classType', 'Class/type'],
  ['abv', 'Alcohol by volume'],
  ['netContents', 'Net contents'],
  ['producerAddress', 'Producer address'],
] as const;

const emptyApplication: ApplicationData = {
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

const validateImage = (file: File): string | undefined => {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return 'Upload a JPEG, PNG, or WebP image.';
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return 'Images must be 10 MB or smaller.';
  }

  return undefined;
};

export function IntakeForm({ onCancel, onSubmit }: IntakeFormProps) {
  const [application, setApplication] = useState<ApplicationData>(emptyApplication);
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  const updateField = (field: keyof ApplicationData, value: string | boolean): void => {
    setApplication((current) => ({ ...current, [field]: value }));
    setFormError(undefined);
  };

  const chooseFile = (candidate: File | undefined): void => {
    if (!candidate) {
      return;
    }

    const error = validateImage(candidate);
    setFileError(error);
    setFile(error ? undefined : candidate);
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
      .filter(([field]) => !application[field].trim())
      .map(([, label]) => label);

    if (missingFields.length > 0) {
      setFormError(`Complete the required application facts: ${missingFields.join(', ')}.`);
      return;
    }

    if (!file) {
      setFileError('Choose a JPEG, PNG, or WebP label image to begin review.');
      return;
    }

    if (application.isImported && !application.countryOfOrigin?.trim()) {
      setFormError('Country of origin is required for an imported product.');
      return;
    }

    setFormError(undefined);
    void onSubmit(
      {
        ...application,
        proof: application.proof?.trim() || undefined,
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
          <div className="field-grid">
            <label>
              Brand name
              <input
                value={application.brandName}
                onChange={(event) => updateField('brandName', event.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <label>
              Class/type
              <input
                value={application.classType}
                onChange={(event) => updateField('classType', event.target.value)}
                required
                autoComplete="off"
                placeholder="e.g. Straight Bourbon Whiskey"
              />
            </label>
            <label>
              Alcohol by volume
              <input
                value={application.abv}
                onChange={(event) => updateField('abv', event.target.value)}
                required
                autoComplete="off"
                placeholder="e.g. 45%"
              />
            </label>
            <label>
              Proof <span className="optional">Optional</span>
              <input
                value={application.proof ?? ''}
                onChange={(event) => updateField('proof', event.target.value)}
                autoComplete="off"
                placeholder="e.g. 90 Proof"
              />
            </label>
            <label>
              Net contents
              <input
                value={application.netContents}
                onChange={(event) => updateField('netContents', event.target.value)}
                required
                autoComplete="off"
                placeholder="e.g. 750 mL"
              />
            </label>
            <label>
              Producer address
              <input
                value={application.producerAddress}
                onChange={(event) => updateField('producerAddress', event.target.value)}
                required
                autoComplete="street-address"
                placeholder="e.g. Distillery, City, State"
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
                Country of origin
                <input
                  value={application.countryOfOrigin ?? ''}
                  onChange={(event) => updateField('countryOfOrigin', event.target.value)}
                  required
                  autoComplete="country-name"
                />
              </label>
            ) : null}
          </div>
          {formError ? <p className="inline-error" role="alert">{formError}</p> : null}
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
            <p><strong>Drop one label image here</strong> or choose it from your device.</p>
            <p className="muted">JPEG, PNG, or WebP · 10 MB maximum · processed in this browser</p>
            <label className="button button--secondary file-control">
              Choose label image
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onFileChange}
                aria-describedby={fileError ? 'file-error' : undefined}
                aria-invalid={fileError ? true : undefined}
              />
            </label>
            {file ? <p className="selected-file">Ready: <strong>{file.name}</strong></p> : null}
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
