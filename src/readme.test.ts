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

  it('pins the exact frontend-only AWS Amplify static-host configuration', async () => {
    const [amplify, packageText] = await Promise.all([
      readFile('amplify.yml', 'utf8'),
      readFile('package.json', 'utf8'),
    ]);
    const packageJson = JSON.parse(packageText) as {
      packageManager?: string;
      scripts?: Record<string, string>;
    };

    expect(packageJson.packageManager).toBe('pnpm@11.12.0');
    expect(packageJson.scripts?.build).toContain('scripts/prepare-sites-worker.mjs');
    expect(amplify).toBe(
      [
        'version: 1',
        'frontend:',
        '  phases:',
        '    preBuild:',
        '      commands:',
        '        - nvm use 22',
        '        - corepack enable',
        '        - pnpm install --frozen-lockfile',
        '    build:',
        '      commands:',
        '        - pnpm build',
        '  artifacts:',
        '    baseDirectory: dist/client',
        '    files:',
        "      - '**/*'",
        '  cache:',
        '    paths:',
        '      - node_modules/**/*',
        '',
      ].join('\n'),
    );
  });

  it('documents the exact verified Amplify release, link roles, and static-host contract', async () => {
    const readme = await readFile('README.md', 'utf8');
    const primaryUrl = 'https://main.d4qb8x5x7ay8t.amplifyapp.com/';
    const rollbackUrl = 'https://proofline-label-intelligence.kungeng0803.chatgpt.site';
    const releaseMasthead = [
      `**Primary public deployment:** [main.d4qb8x5x7ay8t.amplifyapp.com](${primaryUrl})`,
      '',
      `**Rollback deployment:** [proofline-label-intelligence.kungeng0803.chatgpt.site](${rollbackUrl})`,
    ].join('\n');

    expect(readme).toContain(releaseMasthead);
    expect(readme.indexOf(releaseMasthead)).toBeLessThan(readme.indexOf('## What it does'));
    expect(readme).toContain(
      `## Try it in 60 seconds\n\nOn a local build or the [primary public deployment](${primaryUrl}):`,
    );
    expect(readme).toContain(
      `**Release status:** The app is deployed through **AWS Amplify Hosting** at [main.d4qb8x5x7ay8t.amplifyapp.com](${primaryUrl}). It remains a static, browser-local application; the host serves assets but does not receive label images or application facts from the app. The existing [Sites deployment](${rollbackUrl}) remains available as the **Rollback deployment** during the migration.`,
    );
    expect(readme).toContain(
      '**AWS Amplify Hosting:** Build from [`amplify.yml`](amplify.yml) and publish `dist/client`. Retain same-origin `ocr/` assets in the published bundle, and do not configure a blanket rewrite while views remain in-memory.',
    );
    expect(readme).not.toContain('The current source revision awaits final verification and deployment.');
  });

  it('aligns the documented local-review contract with package metadata and CI', async () => {
    const [readme, design, packageText, workflow] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('docs/DESIGN.md', 'utf8'),
      readFile('package.json', 'utf8'),
      readFile('.github/workflows/ci.yml', 'utf8'),
    ]);
    const packageJson = JSON.parse(packageText) as {
      packageManager?: string;
      engines?: Record<string, string>;
    };

    expect(packageJson.packageManager).toBe('pnpm@11.12.0');
    expect(packageJson.engines).toMatchObject({ node: '>=20', pnpm: '11.12.0' });
    expect(readme).toContain('Node.js 20+ with Corepack and pnpm 11.12.0');
    expect(design).toContain('Node.js 20+ with Corepack and pnpm 11.12.0');
    expect(workflow).toMatch(
      /uses:\s*pnpm\/action-setup@v4\s*\n\s*with:\s*\n\s*version:\s*11\.12\.0/,
    );
    expect(workflow).toMatch(/node-version:\s*22/);
    expect(workflow).toContain('pnpm install --frozen-lockfile');

    expect(readme).toContain('After a reviewer intentionally enters a single or batch intake, at most one local OCR worker may prewarm; no OCR work runs on page load.');
    expect(readme).toContain('matched OCR words or lines');
    expect(readme).toContain('conservatively falls below the readable threshold');
    expect(readme).toContain('After five seconds, a reviewer may keep waiting or review manually.');
    expect(readme).toContain('At fifteen seconds, a reviewer may stop OCR and review manually.');
    expect(readme).toContain('CSV application facts can open a full review without rerunning OCR.');
    expect(readme).toContain('Filename-only rows remain OCR triage.');
    expect(readme).toContain('First sample run');
    expect(readme).toContain('Second warm-worker run');
    expect(readme).toContain('not a universal speed guarantee or a network-cold measurement');
    expect(readme).toContain('Warning legibility is a manual reviewer confirmation.');
    expect(readme).toContain('Exact printed type size remains a final regulatory review responsibility.');
    expect(readme).toContain('CSS-only visual degradation');

    expect(design).toContain('After a reviewer intentionally enters a single or batch intake, at most one local OCR worker may prewarm; no OCR work runs on page load.');
    expect(design).toContain('matched OCR words or lines');
    expect(design).toContain('conservatively falls below the readable threshold');
    expect(design).toContain('After five seconds, a reviewer may keep waiting or review manually.');
    expect(design).toContain('At fifteen seconds, a reviewer may stop OCR and review manually.');
    expect(design).toContain('CSV application facts can open a full review without rerunning OCR.');
    expect(design).toContain('Filename-only rows remain OCR triage.');
    expect(design).toContain('First sample run');
    expect(design).toContain('Second warm-worker run');
    expect(design).toContain('not a universal speed guarantee or a network-cold measurement');
    expect(design).toContain('Warning legibility is a manual reviewer confirmation.');
    expect(design).toContain('Exact printed type size remains a final regulatory review responsibility.');
    expect(design).toContain('CSS-only visual degradation');
  });
});
