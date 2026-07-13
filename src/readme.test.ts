import { readFile } from 'node:fs/promises';

describe('submission documentation', () => {
  it('documents setup, limits, warning sources, and deployment', async () => {
    const readme = await readFile('README.md', 'utf8');

    expect(readme).toMatch(/pnpm install/);
    expect(readme).toMatch(/300/i);
    expect(readme).toMatch(/27 CFR Part 16/);
    expect(readme).toMatch(/deployment/i);

    for (const heading of [
      'What it does',
      'Try it in 60 seconds',
      'Quick start',
      'Guided demo',
      'Batch CSV',
      'Architecture',
      'Performance',
      'Validation behavior',
      'Privacy',
      'Limitations',
      'Key trade-offs',
      'Testing',
      'Deployment',
      'Future Azure path',
    ]) {
      expect(readme).toContain(`## ${heading}`);
    }

    expect(readme).toMatch(/two (?:OCR )?workers/i);
    expect(readme).toMatch(/visual typography confirmation/i);
    expect(readme).toContain('https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16');
    expect(readme).toContain('https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16/subpart-C/section-16.21');
    expect(readme).toContain('https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16/subpart-C/section-16.22');
    expect(readme).toContain('https://github.com/KunGeng/proofline-label-intelligence');
  });

  it('ships a usable CSV intake template that references the sample JPEG label', async () => {
    const template = await readFile('public/batch-template.csv', 'utf8');

    expect(template).toBe(
      'filename,brandName,classType,abv,proof,netContents,producerAddress,isImported,countryOfOrigin\n' +
        'old-tom-bourbon.jpg,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,45%,90,750 mL,"Old Tom Distillery, Louisville, KY",false,\n',
    );

    const sampleLabel = await readFile('public/demo/old-tom-bourbon.jpg');
    expect(sampleLabel.length).toBeGreaterThan(0);
    // JPEG magic number: the referenced sample must be a real intake-accepted format.
    expect(sampleLabel[0]).toBe(0xff);
    expect(sampleLabel[1]).toBe(0xd8);
  });

  it('includes a local command for inspecting the production build', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.preview).toContain('vite preview');
  });
});
