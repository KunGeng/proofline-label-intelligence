import { parseBatchCsv } from './csv';
import { unsupportedBeverageMessage } from '../../domain/scope';

const file = (name: string, type = 'image/png') =>
  new File(['label'], name, { type });

const applicationCsv = (row: string): string =>
  [
    'filename,brandName,classType,abv,proof,netContents,producerAddress,isImported,countryOfOrigin',
    row,
  ].join('\n');

describe('parseBatchCsv', () => {
  it('matches filename rows case-insensitively and trims whitespace', () => {
    const result = parseBatchCsv(
      'filename\n OLD-TOM.PNG ',
      [file('old-tom.png')],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.matched[0]?.application).toBeUndefined();
  });

  it('matches lowercased basenames rather than path prefixes', () => {
    const result = parseBatchCsv(
      'filename\nexports\\OLD-TOM.PNG',
      [file('uploads/old-tom.png')],
    );

    expect(result.matched).toHaveLength(1);
  });

  it('trims whitespace after extracting a path basename', () => {
    const result = parseBatchCsv(
      'filename\nexports/ OLD-TOM.PNG ',
      [file('old-tom.png')],
    );

    expect(result.errors).toEqual([]);
    expect(result.matched).toHaveLength(1);
  });

  it('accepts a filename-only CSV so the queue can triage it without application data', () => {
    const result = parseBatchCsv('filename\nold-tom.png', [file('old-tom.png')]);

    expect(result.errors).toEqual([]);
    expect(result.matched[0]?.application).toBeUndefined();
  });

  it('parses a complete application row with quoted CSV cells', () => {
    const result = parseBatchCsv(
      applicationCsv(
        'old-tom.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750 mL,"123 Main St, Austin, TX",false,',
      ),
      [file('old-tom.png')],
    );

    expect(result.errors).toEqual([]);
    expect(result.matched[0]).toMatchObject({
      application: {
        brandName: 'OLD TOM',
        classType: 'Bourbon Whiskey',
        abv: '45%',
        proof: '90 Proof',
        netContents: '750 mL',
        producerAddress: '123 Main St, Austin, TX',
        isImported: false,
      },
    });
  });

  it('rejects explicitly out-of-scope beverage rows before creating a queue job', () => {
    const result = parseBatchCsv(
      applicationCsv(
        'old-tom.png,OLD TOM,wine,45%,90 Proof,750 mL,Example KY,false,',
      ),
      [file('old-tom.png')],
    );

    expect(result.errors).toContain(`Row 2: ${unsupportedBeverageMessage}`);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedFiles.map((item) => item.name)).toEqual(['old-tom.png']);
  });

  it('associates each application with its normalized filename rather than selection order', () => {
    const result = parseBatchCsv(
      [
        'filename,brandName,classType,abv,proof,netContents,producerAddress,isImported,countryOfOrigin',
        'second.png,SECOND,Bourbon Whiskey,45%,90 Proof,750 mL,Second KY,false,',
        'FIRST.PNG,FIRST,Bourbon Whiskey,40%,80 Proof,1 L,First KY,false,',
      ].join('\n'),
      [file('first.png'), file('second.png')],
    );

    expect(result.errors).toEqual([]);
    expect(result.matched.map((job) => job.file.name)).toEqual([
      'second.png',
      'first.png',
    ]);
    expect(result.matched.map((job) => job.application?.brandName)).toEqual([
      'SECOND',
      'FIRST',
    ]);
  });

  it('rejects every record in a duplicate normalized CSV association', () => {
    const result = parseBatchCsv(
      'filename\n A.PNG \ndir/a.png',
      [file('a.png'), file('b.png')],
    );

    expect(result.errors).toContainEqual(expect.stringMatching(/duplicate/i));
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedFiles.map((item) => item.name)).toEqual([
      'a.png',
      'b.png',
    ]);
  });

  it('reports CSV rows that do not refer to a selected image', () => {
    const result = parseBatchCsv('filename\nmissing.png', [file('a.png')]);

    expect(result.errors).toContainEqual(
      expect.stringMatching(/missing\.png.*selected image/i),
    );
  });

  it('requires the exact filename header and rejects unknown headers', () => {
    const missingFilename = parseBatchCsv('brandName\nOLD TOM', [file('a.png')]);
    const unknownHeader = parseBatchCsv(
      'filename,brand\na.png,OLD TOM',
      [file('a.png')],
    );

    expect(missingFilename.errors).toContainEqual(
      expect.stringMatching(/filename.*required/i),
    );
    expect(unknownHeader.errors).toContainEqual(
      expect.stringMatching(/brand.*not a supported CSV header/i),
    );
  });

  it('rejects characters after a closed quoted CSV cell', () => {
    const result = parseBatchCsv(
      applicationCsv(
        'old-tom.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750 mL,"Example KY"x,false,',
      ),
      [file('old-tom.png')],
    );

    expect(result.errors).toContainEqual(
      expect.stringMatching(/unexpected character after a closing quote/i),
    );
    expect(result.matched).toHaveLength(0);
  });

  it('reports malformed application cells instead of coercing them', () => {
    const invalidBoolean = parseBatchCsv(
      applicationCsv(
        'old-tom.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750 mL,Example KY,yes,',
      ),
      [file('old-tom.png')],
    );
    const missingRequiredValue = parseBatchCsv(
      applicationCsv(
        'old-tom.png,,Bourbon Whiskey,45%,90 Proof,750 mL,Example KY,false,',
      ),
      [file('old-tom.png')],
    );

    expect(invalidBoolean.errors).toContainEqual(
      expect.stringMatching(/isImported.*true.*false/i),
    );
    expect(missingRequiredValue.errors).toContainEqual(
      expect.stringMatching(/brandName.*required/i),
    );
    expect(invalidBoolean.matched).toHaveLength(0);
    expect(invalidBoolean.unmatchedFiles[0]?.name).toBe('old-tom.png');
  });

  it.each([
    {
      field: 'abv',
      row: 'old-tom.png,OLD TOM,Bourbon Whiskey,101%,90 Proof,750 mL,Example KY,false,',
    },
    {
      field: 'proof',
      row: 'old-tom.png,OLD TOM,Bourbon Whiskey,45%,not proof,750 mL,Example KY,false,',
    },
    {
      field: 'netContents',
      row: 'old-tom.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750,Example KY,false,',
    },
  ])('rejects malformed $field application data before creating a queue job', ({ field, row }) => {
    const result = parseBatchCsv(applicationCsv(row), [file('old-tom.png')]);

    expect(result.errors).toContainEqual(
      expect.stringMatching(new RegExp(`${field}.*format`, 'i')),
    );
    expect(result.matched).toHaveLength(0);
  });

  it('rejects incomplete application schemas without downgrading them to triage', () => {
    const validBoolean = parseBatchCsv(
      'filename,isImported,countryOfOrigin\nold-tom.png,true,Scotland',
      [file('old-tom.png')],
    );
    const invalidBoolean = parseBatchCsv(
      'filename,isImported,countryOfOrigin\nold-tom.png,yes,Scotland',
      [file('old-tom.png')],
    );

    for (const result of [validBoolean, invalidBoolean]) {
      expect(result.errors).toContainEqual(
        expect.stringMatching(/incomplete application.*header/i),
      );
      expect(result.matched).toHaveLength(0);
      expect(result.unmatchedFiles[0]?.name).toBe('old-tom.png');
    }
  });

  it.each([
    'brandName',
    'classType',
    'abv',
    'netContents',
    'producerAddress',
    'isImported',
  ] as const)('requires the %s application cell', (missingField) => {
    const cells = {
      filename: 'old-tom.png',
      brandName: 'OLD TOM',
      classType: 'Bourbon Whiskey',
      abv: '45%',
      proof: '90 Proof',
      netContents: '750 mL',
      producerAddress: 'Example KY',
      isImported: 'false',
      countryOfOrigin: '',
      [missingField]: '',
    };
    const result = parseBatchCsv(
      applicationCsv(
        [
          cells.filename,
          cells.brandName,
          cells.classType,
          cells.abv,
          cells.proof,
          cells.netContents,
          cells.producerAddress,
          cells.isImported,
          cells.countryOfOrigin,
        ].join(','),
      ),
      [file('old-tom.png')],
    );

    expect(result.errors).toContainEqual(
      expect.stringMatching(new RegExp(`${missingField}.*required`, 'i')),
    );
    expect(result.matched).toHaveLength(0);
  });

  it('treats empty cells under application headers as an import error', () => {
    const result = parseBatchCsv(
      applicationCsv(
        ['old-tom.png', '', '', '', '', '', '', '', ''].join(','),
      ),
      [file('old-tom.png')],
    );

    expect(result.errors).toContainEqual(
      expect.stringMatching(/brandName.*required/i),
    );
  });

  it('requires a country of origin for imported application data', () => {
    const result = parseBatchCsv(
      applicationCsv(
        'old-tom.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750 mL,Example KY,true,',
      ),
      [file('old-tom.png')],
    );

    expect(result.errors).toContainEqual(
      expect.stringMatching(/countryOfOrigin.*required.*imported/i),
    );
  });

  it('retains a valid imported country of origin', () => {
    const result = parseBatchCsv(
      applicationCsv(
        'old-tom.png,OLD TOM,Bourbon Whiskey,45%,90 Proof,750 mL,Example KY,true,Scotland',
      ),
      [file('old-tom.png')],
    );

    expect(result.errors).toEqual([]);
    expect(result.matched[0]?.application).toMatchObject({
      isImported: true,
      countryOfOrigin: 'Scotland',
    });
  });
});
