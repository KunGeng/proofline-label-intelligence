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
    expect(readme).toMatch(/distilled spirits, beer, and wine/i);
    expect(readme).toMatch(/beverage_type/i);
    expect(readme).toMatch(/alcohol_content_expectation/i);
    expect(readme).toMatch(/no usable OCR evidence/i);
    expect(readme).toMatch(/never auto-pass.*bold/i);
    expect(readme).toContain('https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16');
    expect(readme).toContain('https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16/subpart-C/section-16.21');
    expect(readme).toContain('https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16/subpart-C/section-16.22');
    expect(readme).toContain('https://github.com/KunGeng/proofline-label-intelligence');
  });

  it('documents the local photo-readiness advisory without implying visual proof', async () => {
    const [readme, design] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('docs/DESIGN.md', 'utf8'),
    ]);

    for (const document of [readme, design]) {
      expect(document).toMatch(/browser-local photo-readiness advisory/i);
      expect(document).toMatch(/1,000\s*px longest edge/i);
      expect(document).toMatch(/dimensions cannot be read/i);
      expect(document).toMatch(/straight-on, evenly lit, glare-free retake/i);
      expect(document).toMatch(/does not detect or prove glare/i);
    }
  });

  it('ships a usable CSV intake template that references the sample JPEG label', async () => {
    const template = await readFile('public/batch-template.csv', 'utf8');

    expect(template).toBe(
      'filename,brandName,classType,beverage_type,alcohol_content_expectation,abv,proof,netContents,producerAddress,isImported,countryOfOrigin\n' +
        'old-tom-bourbon.jpg,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,distilled_spirits,declared,45%,90,750 mL,"Old Tom Distillery, Louisville, KY",false,\n',
    );

    const sampleLabel = await readFile('public/demo/old-tom-bourbon.jpg');
    expect(sampleLabel.length).toBeGreaterThan(0);
    // JPEG magic number: the referenced sample must be a real intake-accepted format.
    expect(sampleLabel[0]).toBe(0xff);
    expect(sampleLabel[1]).toBe(0xd8);
  });

  it('documents the required manual-review abv header and cell rules', async () => {
    const readme = await readFile('README.md', 'utf8');

    expect(readme).toMatch(/`abv` header remains required/i);
    expect(readme).toMatch(/abv.*may be blank.*manual_review/i);
    expect(readme).toMatch(/nonblank `abv` cell.*format/i);
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
    const [readme, design, deadlineDesign, hardeningDesign, packageText, workflow] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('docs/DESIGN.md', 'utf8'),
      readFile('docs/superpowers/specs/2026-07-13-five-second-review-deadline-design.md', 'utf8'),
      readFile('docs/superpowers/specs/2026-07-13-evidence-hardening-design.md', 'utf8'),
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

    const deadlineParagraphs = [
      [
        'After five seconds of automated OCR, Proofline opens manual evidence review.',
        'The deadline starts when active extraction begins and includes image preparation, worker acquisition, initialization, and recognition.',
        'The original label and submitted facts remain available; reviewers may enter evidence immediately or explicitly retry OCR.',
      ].join(' '),
      [
        'Batch items that reach the deadline are marked Manual review required while the queue continues.',
        'They retain their original file and any available evidence, including when no application row was supplied.',
      ].join(' '),
      [
        'The local benchmark explicitly disables the five-second OCR deadline.',
        'It does so to ensure its first and warm-worker timings remain an honest measurement of the current device.',
        'The deadline is an automated-wait target under normal responsive browser scheduling, not an absolute real-time guarantee while a browser event loop is blocked.',
      ].join(' '),
    ];
    const successfulOcrTiming =
      'For a real review, Proofline shows measured extraction time only when OCR completes successfully; a deadline result or retry that ends in an OCR error does not display a completed-OCR duration. Batch progress includes a running average with a remaining-time estimate.';
    const automaticDeadlineTransition =
      'If the deadline fires first, the active OCR work is aborted and the review automatically changes from processing to a manual-evidence workspace.';
    const historicalHardeningStatus =
      '**Status:** Historical design. The OCR deadline/recovery proposal is superseded by [Five-second review-ready deadline design](2026-07-13-five-second-review-deadline-design.md). This file is retained as the original evidence-hardening proposal, not as current deadline behavior.';

    for (const document of [readme, design]) {
      const normalizedDocument = document.replace(/\s+/g, ' ').trim();
      for (const paragraph of deadlineParagraphs) {
        expect(normalizedDocument).toContain(paragraph);
      }
      expect(normalizedDocument).toContain(successfulOcrTiming);
      expect(normalizedDocument).not.toMatch(
        /\b(?:fifteen|15)[-\s]*seconds?\b[^.]*\b(?:stop|recovery|manual)\b/i,
      );
    }

    for (const liveDocument of [readme, design, deadlineDesign]) {
      expect(liveDocument).not.toMatch(/\bKeep waiting\b/i);
      expect(liveDocument).not.toMatch(/\bReview manually now\b/i);
      expect(liveDocument).not.toMatch(/\b(?:fifteen|15)[-\s]*seconds?\b/i);
    }

    expect(hardeningDesign).toContain(historicalHardeningStatus);
    expect(deadlineDesign.replace(/\s+/g, ' ').trim()).toContain(automaticDeadlineTransition);
  });
});
