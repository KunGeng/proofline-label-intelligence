# AWS Amplify Hosting Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Proofline deploy reproducibly from `main` to AWS Amplify Hosting while preserving browser-local OCR, validating the deployed static assets, and retaining the existing Sites URL as rollback until explicitly retired.

**Architecture:** Amplify will build the existing static Vite application using the repository's pinned Node/pnpm toolchain and publish `dist/client`. The current Sites Worker output and `.openai/hosting.json` remain untouched during the parallel migration. A post-deploy documentation cutover changes the canonical URL only after the Amplify deployment has passed static-asset and browser-flow checks.

**Tech Stack:** AWS Amplify Hosting, GitHub continuous deployment, Node 22, Corepack, pnpm 11.12.0, React 19, TypeScript, Vite 6, Vitest.

## Global Constraints

- Keep the application static and browser-local: do not add an Amplify backend, database, authentication, analytics SDK, or cloud OCR service.
- Build with Node 22, Corepack, and the repository-pinned `pnpm@11.12.0`.
- Publish only `dist/client`; `dist/server` exists solely for the current Sites rollback deployment.
- Serve `dist/client/ocr/eng.traineddata.gz` from the deployed application's same origin.
- Do not configure a blanket SPA rewrite. The current app has no path-routed views, and a broad rule can return `index.html` for the required `.gz` OCR asset.
- Do not alter, archive, redirect, or delete the existing Sites deployment during this plan.
- Never store AWS credentials, console tokens, account identifiers, or Amplify connection secrets in Git.

## File Structure

- Create: `amplify.yml` — versioned Amplify frontend build and artifact configuration.
- Modify: `src/readme.test.ts` — protects the Amplify build contract and, after production validation, the public-release documentation contract.
- Modify: `README.md` — changes canonical public links and hosting guidance only after a verified Amplify production URL exists.
- Preserve: `.openai/hosting.json`, `worker/static-site.js`, and `scripts/prepare-sites-worker.mjs` — they keep the current Sites deployment usable as rollback.

---

### Task 1: Add a versioned Amplify static-host build contract

**Files:**
- Create: `amplify.yml`
- Modify: `src/readme.test.ts:1-121`
- Verify: `package.json:6-18`, `scripts/prepare-sites-worker.mjs:5-22`, `.github/workflows/ci.yml:14-33`

**Interfaces:**
- Consumes: `package.json`'s `packageManager: "pnpm@11.12.0"` and `build: "tsc --noEmit && vite build && node scripts/prepare-sites-worker.mjs"`.
- Produces: an Amplify build that installs locked dependencies, runs `pnpm build`, and exposes `dist/client` as the public artifact root.

- [ ] **Step 1: Write the failing deployment-contract test**

  Add this test inside the existing `describe('submission documentation', ...)` block in `src/readme.test.ts`:

  ```ts
  it('defines reproducible AWS Amplify static-host settings', async () => {
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
    expect(amplify).toMatch(/nvm use 22/);
    expect(amplify).toMatch(/corepack enable/);
    expect(amplify).toMatch(/pnpm install --frozen-lockfile/);
    expect(amplify).toMatch(/pnpm build/);
    expect(amplify).toMatch(/baseDirectory:\s*dist\/client/);
    expect(amplify).toMatch(/files:\s*\n\s*- '\*\*\/\*'/);
  });
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `pnpm test:run src/readme.test.ts`

  Expected: FAIL because `amplify.yml` does not yet exist.

- [ ] **Step 3: Add the minimal Amplify build configuration**

  Create `amplify.yml` with exactly this content:

  ```yaml
  version: 1
  frontend:
    phases:
      preBuild:
        commands:
          - nvm use 22
          - corepack enable
          - pnpm install --frozen-lockfile
      build:
        commands:
          - pnpm build
    artifacts:
      baseDirectory: dist/client
      files:
        - '**/*'
    cache:
      paths:
        - node_modules/**/*
  ```

  Do not add a rewrite, backend declaration, environment variable, custom header file, or CloudFormation resource.

- [ ] **Step 4: Verify the config and actual static artifacts**

  Run:

  ```bash
  pnpm test:run src/readme.test.ts
  pnpm build
  test -s dist/client/index.html
  test -s dist/client/ocr/eng.traineddata.gz
  git diff --check
  ```

  Expected: the focused suite passes, the build succeeds, and both static files are non-empty.

- [ ] **Step 5: Commit the self-contained configuration change**

  ```bash
  git add amplify.yml src/readme.test.ts
  git commit -m "chore: add Amplify hosting configuration"
  ```

### Task 2: Create the parallel Amplify release through the AWS Console

**Files:**
- No repository files change in this task.
- External configuration: AWS Amplify Hosting console in the AWS account owner's selected region.

**Interfaces:**
- Consumes: the `main` branch after Task 1 and the committed `amplify.yml`.
- Produces: one Amplify production deployment URL for `main`, associated with the exact Git commit displayed in the Amplify deployment details.

- [ ] **Step 1: Establish authenticated owner access**

  The AWS account owner signs in to the AWS Console in the region selected for their billing and data-governance needs. Do not install an AWS CLI, create access keys, or place credentials in the repository for this task.

- [ ] **Step 2: Connect the repository without provisioning an Amplify backend**

  In AWS Amplify, choose **New app** → **Host web app** → **GitHub**. Authorize the region-specific Amplify GitHub App for only `KunGeng/proofline-label-intelligence`, select the `main` branch, and keep the app frontend-only. Do not add an Amplify backend, environment variables, authentication, data store, or analytics SDK.

- [ ] **Step 3: Confirm the exact build settings before deployment**

  In the Amplify build-settings screen, confirm that the checked-in `amplify.yml` is used unchanged:

  ```text
  Node: 22
  Install: pnpm install --frozen-lockfile
  Build: pnpm build
  Artifact base directory: dist/client
  ```

  Do not add a catch-all rewrite rule. The present application navigation is in memory, and the local Tesseract language file is `ocr/eng.traineddata.gz`.

- [ ] **Step 4: Validate the finished Amplify deployment before any cutover**

  After Amplify reports the `main` deployment as successful, record its exact public URL and deployment commit. From a normal browser context, verify:

  ```text
  GET /                         -> 200 and the Proofline landing page
  GET /ocr/eng.traineddata.gz   -> the binary OCR asset, not index.html
  Landing -> New review         -> intake fields render
  Landing -> Review a batch     -> batch entry renders
  Landing -> Open guided demo   -> fixture result renders
  ```

  Run the local sample OCR benchmark or a real sample-label review and confirm that the app still performs local recognition with no app-origin request carrying the image or application fields.

- [ ] **Step 5: Preserve rollback and record the verified release evidence**

  Leave `https://proofline-label-intelligence.kungeng0803.chatgpt.site` live and unchanged. Do not create a redirect, archive the Sites project, or remove `.openai/hosting.json`. Proceed to Task 3 only after the Amplify deployment, static asset check, and review-flow smoke test all pass.

### Task 3: Make the verified Amplify URL canonical in project documentation

**Files:**
- Modify: `README.md:5,25,203-222`
- Modify: `src/readme.test.ts:62-69`

**Interfaces:**
- Consumes: the exact successful `main` production URL returned by Amplify in Task 2.
- Produces: documentation that identifies that URL as the primary deployment and the existing Sites URL as an explicit rollback deployment.

- [ ] **Step 1: Write the failing release-documentation test**

  Replace the test named `distinguishes the existing public prototype from a source revision awaiting release` with this test:

  ```ts
  it('documents a verified Amplify release and preserves the rollback deployment', async () => {
    const readme = await readFile('README.md', 'utf8');

    expect(readme).toMatch(/https:\/\/main\.[a-z0-9-]+\.amplifyapp\.com/);
    expect(readme).toContain('AWS Amplify Hosting');
    expect(readme).toContain('Rollback deployment');
    expect(readme).toContain('https://proofline-label-intelligence.kungeng0803.chatgpt.site');
    expect(readme).not.toContain('The current source revision awaits final verification and deployment.');
  });
  ```

- [ ] **Step 2: Run the focused documentation test to verify it fails**

  Run: `pnpm test:run src/readme.test.ts`

  Expected: FAIL because the README still identifies the Sites URL as the existing public prototype and does not yet contain the verified Amplify URL.

- [ ] **Step 3: Update only the public-hosting documentation after the URL is verified**

  Copy the exact `main` production URL displayed by the successful Amplify deployment into the README; never infer or fabricate the Amplify app identifier. Make these content changes:

  1. Replace the top `Existing public prototype` link with `Primary public deployment` pointing to the exact Amplify URL.
  2. Retain the existing `chatgpt.site` link as `Rollback deployment`.
  3. Change the `Try it in 60 seconds` public link to the exact Amplify URL.
  4. Replace the stale release-status paragraph with wording that the app is deployed through AWS Amplify Hosting, is static/browser-local, and keeps the rollback deployment available during the migration.
  5. Add an Amplify-specific deployment note: build from `amplify.yml`, publish `dist/client`, retain same-origin `ocr/` assets, and do not configure a blanket rewrite while views remain in-memory.
  6. Preserve the existing generic static-host and privacy guidance.

- [ ] **Step 4: Run full release verification after the documentation change**

  Run:

  ```bash
  pnpm test:run
  pnpm typecheck
  pnpm build
  test -s dist/client/index.html
  test -s dist/client/ocr/eng.traineddata.gz
  git diff --check
  ```

  Expected: all tests pass, TypeScript is clean, the production bundle and local OCR asset are present, and the diff has no whitespace errors.

- [ ] **Step 5: Commit and publish the verified public-link update**

  ```bash
  git add README.md src/readme.test.ts
  git commit -m "docs: publish Amplify deployment"
  git push origin main
  ```

  Reconfirm that the pushed commit corresponds to the already-verified Amplify deployment. If the README commit triggers a new Amplify deployment, wait for that deployment to succeed and repeat the Task 2 static-asset and browser-flow checks before calling the migration complete.

## Plan Self-Review

- **Spec coverage:** Task 1 covers pinned configuration and artifact path; Task 2 covers owner-authenticated GitHub deployment, same-origin OCR, no rewrite, smoke checks, and rollback; Task 3 covers canonical-link cutover and re-verification. The plan intentionally excludes backend, analytics, custom-domain, and Sites-retirement work.
- **Placeholder scan:** No speculative app URL, AWS account ID, region, or credential is embedded. The exact Amplify URL is copied only from a successful deployment and is protected by a URL-shape test.
- **Type consistency:** The plan uses the existing `pnpm build` script, `dist/client` artifact layout, `main` branch, and `ocr/eng.traineddata.gz` path consistently across configuration, console, test, and documentation steps.
