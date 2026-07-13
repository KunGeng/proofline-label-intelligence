import type { ApplicationData } from '../../domain/types';
import { parseAbv, parseMilliliters, parseProof } from '../../domain/normalize';
import {
  isExplicitlyOutOfScopeBeverage,
  unsupportedBeverageMessage,
} from '../../domain/scope';
import type { QueueJob } from './queue';

const CSV_HEADERS = [
  'filename',
  'brandName',
  'classType',
  'abv',
  'proof',
  'netContents',
  'producerAddress',
  'isImported',
  'countryOfOrigin',
] as const;

type CsvHeader = (typeof CSV_HEADERS)[number];
type ApplicationHeader = Exclude<CsvHeader, 'filename'>;

const REQUIRED_APPLICATION_HEADERS = [
  'brandName',
  'classType',
  'abv',
  'netContents',
  'producerAddress',
  'isImported',
] as const satisfies readonly ApplicationHeader[];

export interface CsvImportResult {
  matched: QueueJob[];
  unmatchedFiles: File[];
  errors: string[];
}

interface ParsedRow {
  cells: string[];
  line: number;
}

interface IndexedFile {
  file: File;
  index: number;
}

const isCsvHeader = (value: string): value is CsvHeader =>
  (CSV_HEADERS as readonly string[]).includes(value);

const isBlankRow = (row: ParsedRow): boolean =>
  row.cells.every((cell) => !cell.trim());

const trimCell = (value: string | undefined): string => value?.trim() ?? '';

export const normalizeFilename = (value: string): string => {
  const trimmed = value.trim();
  const basename = (trimmed.split(/[\\/]/).pop() ?? '').trim();

  return basename.toLowerCase();
};

const parseCsvRows = (csvText: string): { rows: ParsedRow[]; error?: string } => {
  const rows: ParsedRow[] = [];
  let row: string[] = [];
  let cell = '';
  let line = 1;
  let rowLine = 1;
  let quoted = false;
  let afterClosingQuote = false;

  const finishRow = (): void => {
    row.push(cell);
    rows.push({ cells: row, line: rowLine });
    row = [];
    cell = '';
    rowLine = line;
    afterClosingQuote = false;
  };

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index]!;

    if (quoted) {
      if (character === '"') {
        if (csvText[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          afterClosingQuote = true;
        }
      } else if (character === '\r' && csvText[index + 1] === '\n') {
        cell += '\n';
        line += 1;
        index += 1;
      } else {
        cell += character;
        if (character === '\n' || character === '\r') {
          line += 1;
        }
      }

      continue;
    }

    if (afterClosingQuote) {
      if (character === ',') {
        row.push(cell);
        cell = '';
        afterClosingQuote = false;
        continue;
      }

      if (character === '\n' || character === '\r') {
        if (character === '\r' && csvText[index + 1] === '\n') {
          index += 1;
        }
        line += 1;
        finishRow();
        continue;
      }

      return {
        rows,
        error: `CSV row ${rowLine} has an unexpected character after a closing quote.`,
      };
    }

    if (character === '"' && !cell) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && csvText[index + 1] === '\n') {
        index += 1;
      }
      line += 1;
      finishRow();
    } else {
      cell += character;
    }
  }

  if (quoted) {
    return { rows, error: `CSV has an unterminated quoted field starting on row ${rowLine}.` };
  }

  if (row.length > 0 || cell || csvText.length > 0) {
    row.push(cell);
    rows.push({ cells: row, line: rowLine });
  }

  return { rows };
};

const applicationForRow = (
  values: Partial<Record<CsvHeader, string>>,
  line: number,
  errors: string[],
  includesCompleteApplicationSchema: boolean,
): ApplicationData | undefined => {
  if (!includesCompleteApplicationSchema) {
    return undefined;
  }

  const errorCountBeforeValidation = errors.length;

  for (const header of REQUIRED_APPLICATION_HEADERS) {
    if (!values[header]) {
      errors.push(
        `Row ${line}: ${header} is required when application data is supplied.`,
      );
    }
  }

  const importedValue = values.isImported;
  if (importedValue && importedValue !== 'true' && importedValue !== 'false') {
    errors.push(`Row ${line}: isImported must be true or false.`);
  }

  const isImported = importedValue === 'true';
  if (isImported && !values.countryOfOrigin) {
    errors.push(
      `Row ${line}: countryOfOrigin is required for an imported product.`,
    );
  }

  if (values.abv && parseAbv(values.abv) === undefined) {
    errors.push(`Row ${line}: abv is not in the required format.`);
  }

  if (values.proof && parseProof(values.proof) === undefined) {
    errors.push(`Row ${line}: proof is not in the required format.`);
  }

  if (values.netContents && parseMilliliters(values.netContents) === undefined) {
    errors.push(`Row ${line}: netContents is not in the required format.`);
  }

  if (errors.length > errorCountBeforeValidation) {
    return undefined;
  }

  return {
    brandName: values.brandName!,
    classType: values.classType!,
    abv: values.abv!,
    ...(values.proof ? { proof: values.proof } : {}),
    netContents: values.netContents!,
    producerAddress: values.producerAddress!,
    isImported,
    ...(values.countryOfOrigin
      ? { countryOfOrigin: values.countryOfOrigin }
      : {}),
  };
};

const selectedFilesByName = (
  files: File[],
  errors: string[],
): {
  filesByName: Map<string, IndexedFile>;
  ambiguousNames: Set<string>;
} => {
  const filesByName = new Map<string, IndexedFile>();
  const ambiguousNames = new Set<string>();

  files.forEach((file, index) => {
    const normalizedName = normalizeFilename(file.name);

    if (!normalizedName) {
      errors.push(`Selected image ${index + 1} has no filename.`);
      return;
    }

    if (filesByName.has(normalizedName) || ambiguousNames.has(normalizedName)) {
      filesByName.delete(normalizedName);
      ambiguousNames.add(normalizedName);
      errors.push(
        `Selected image filename "${normalizedName}" is duplicated and cannot be matched safely.`,
      );
      return;
    }

    filesByName.set(normalizedName, { file, index });
  });

  return { filesByName, ambiguousNames };
};

export const parseBatchCsv = (csvText: string, files: File[]): CsvImportResult => {
  const errors: string[] = [];
  const { filesByName, ambiguousNames } = selectedFilesByName(files, errors);
  const parsed = parseCsvRows(csvText.replace(/^\uFEFF/, ''));

  if (parsed.error) {
    errors.push(parsed.error);
    return { matched: [], unmatchedFiles: [...files], errors };
  }

  const rows = parsed.rows.filter((row) => !isBlankRow(row));
  const headerRow = rows.shift();

  if (!headerRow) {
    errors.push('The filename CSV header is required.');
    return { matched: [], unmatchedFiles: [...files], errors };
  }

  const headers = headerRow.cells.map((cell) => trimCell(cell));
  const uniqueHeaders = new Set<string>();
  for (const header of headers) {
    if (!isCsvHeader(header)) {
      errors.push(`"${header}" is not a supported CSV header.`);
    }
    if (uniqueHeaders.has(header)) {
      errors.push(`CSV header "${header}" is duplicated.`);
    }
    uniqueHeaders.add(header);
  }

  if (!uniqueHeaders.has('filename')) {
    errors.push('The filename CSV header is required.');
  }

  const includesApplicationHeaders = headers.some(
    (header) => header !== 'filename',
  );
  const missingRequiredApplicationHeaders = REQUIRED_APPLICATION_HEADERS.filter(
    (header) => !headers.includes(header),
  );
  if (
    includesApplicationHeaders &&
    missingRequiredApplicationHeaders.length > 0
  ) {
    errors.push(
      `CSV has an incomplete application schema; missing required headers: ${missingRequiredApplicationHeaders.join(', ')}.`,
    );
  }

  if (errors.length > 0) {
    return { matched: [], unmatchedFiles: [...files], errors };
  }

  const matchedByName = new Map<string, QueueJob>();
  const matchedFiles = new Set<File>();
  const csvNames = new Set<string>();
  const includesCompleteApplicationSchema = includesApplicationHeaders;

  for (const row of rows) {
    if (row.cells.length > headers.length) {
      errors.push(`Row ${row.line}: contains more cells than the CSV header.`);
      continue;
    }

    const values: Partial<Record<CsvHeader, string>> = {};
    headers.forEach((header, index) => {
      values[header as CsvHeader] = trimCell(row.cells[index]);
    });

    const filename = values.filename ?? '';
    const normalizedName = normalizeFilename(filename);
    if (!normalizedName) {
      errors.push(`Row ${row.line}: filename is required.`);
      continue;
    }

    if (csvNames.has(normalizedName)) {
      errors.push(`Row ${row.line}: duplicate filename "${filename}".`);
      const previouslyMatched = matchedByName.get(normalizedName);
      if (previouslyMatched) {
        matchedByName.delete(normalizedName);
        matchedFiles.delete(previouslyMatched.file);
      }
      continue;
    }
    csvNames.add(normalizedName);

    if (ambiguousNames.has(normalizedName)) {
      errors.push(
        `Row ${row.line}: filename "${filename}" matches more than one selected image.`,
      );
      continue;
    }

    const indexedFile = filesByName.get(normalizedName);
    if (!indexedFile) {
      errors.push(
        `Row ${row.line}: filename "${filename}" does not match a selected image.`,
      );
      continue;
    }

    if (isExplicitlyOutOfScopeBeverage(values.classType ?? '')) {
      errors.push(`Row ${row.line}: ${unsupportedBeverageMessage}`);
      continue;
    }

    const application = applicationForRow(
      values,
      row.line,
      errors,
      includesCompleteApplicationSchema,
    );
    if (includesCompleteApplicationSchema && !application) {
      continue;
    }

    matchedFiles.add(indexedFile.file);
    matchedByName.set(normalizedName, {
      id: `csv-${indexedFile.index}-${normalizedName}`,
      file: indexedFile.file,
      ...(application ? { application } : {}),
    });
  }

  return {
    matched: [...matchedByName.values()],
    unmatchedFiles: files.filter((file) => !matchedFiles.has(file)),
    errors,
  };
};
