# AWS Amplify hosting migration design

## Goal

Move Proofline's primary public deployment to AWS Amplify Hosting without
changing its browser-local review workflow, sending label data to a backend, or
interrupting the currently working Sites deployment before the Amplify release
has passed acceptance checks.

## Chosen approach

Use Amplify Hosting's GitHub continuous-deployment flow:

1. An AWS account owner connects the existing GitHub repository to Amplify.
2. The `main` branch is the production branch.
3. An in-repository `amplify.yml` makes the build environment reproducible.
4. Amplify deploys a default `*.amplifyapp.com` URL first.
5. The team validates that URL, then changes project links to make it the
   canonical public URL.

The existing Sites deployment remains available as the rollback target until
the owner explicitly requests its retirement. The existing `chatgpt.site` URL
cannot be transferred to Amplify; a custom domain can be attached later if the
owner wants a durable branded URL.

This is preferred to a local AWS CLI deployment because the repository is
already on GitHub, requires no application backend, and this computer has no
configured AWS CLI or authenticated AWS identity.

## Architecture and hosting boundary

Proofline remains a static React + TypeScript + Vite application. Amplify serves
the static build only; it does not receive uploaded label images, OCR text,
review corrections, or application facts from the app.

```text
GitHub main
  -> Amplify build (Node 22 + pnpm 11.12.0)
  -> pnpm build
  -> dist/client static files
  -> Amplify CDN / public Amplify URL
  -> browser-local OCR, parsing, and review state
```

The existing `dist/server` Worker and `.openai/hosting.json` remain in the
repository only to preserve the live Sites release during the transition.
Amplify ignores them and publishes `dist/client`.

## Build configuration

Add this repository-root `amplify.yml`:

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

The build intentionally uses the repository's pinned `pnpm@11.12.0` through
its `packageManager` field. `pnpm build` must remain the single production
build command because it type-checks, creates the Vite bundle, and prepares the
current static output layout.

The `public/ocr` directory must be present at `dist/client/ocr` and served from
the same origin. In particular, `ocr/eng.traineddata.gz` is a required local
OCR asset.

## Routing and error behavior

The current product uses in-memory views rather than path-based client routing,
so Amplify will not receive a catch-all SPA rewrite rule during this migration.
This is deliberate: a broad rewrite can accidentally return `index.html` for
the `.gz` OCR language file and break local OCR.

If future product work introduces client URL routes, add and test an Amplify
200 rewrite that excludes static assets including `.gz`, then verify both a
deep link and `ocr/eng.traineddata.gz` on the deployed domain.

Build failure, failed deployment, or failed smoke test leaves the existing
Sites URL as the public fallback. No automatic redirect, archive, or deletion
of the existing deployment is in scope.

## Release procedure

1. Commit the versioned Amplify build configuration and push `main`.
2. The AWS account owner opens Amplify Hosting in the chosen AWS region,
   authorizes the region-specific Amplify GitHub App for this repository, and
   selects `main` as the production branch.
3. Confirm Amplify detects `amplify.yml` and produces the default public URL.
4. Validate the exact deployment:
   - automated tests, type-check, and production build are green for the
     deployed commit;
   - the landing page, review intake, guided scenarios, and batch entry point
     render at the Amplify URL;
   - `ocr/eng.traineddata.gz` returns the shipped asset rather than HTML; and
   - a live local-OCR sample and recovery path work without an external OCR
     request.
5. Update the README's canonical public URL only after those checks pass.
6. Keep the Sites URL available for rollback. Retire it only in a separate,
   explicit owner-approved action after the Amplify URL has been stable.

## Security and privacy constraints

- Do not add an Amplify backend, authentication, database, analytics SDK, or
  cloud OCR service as part of this migration.
- Keep label processing and review state browser-local as described in the
  product README.
- Do not store AWS credentials, connection tokens, or account identifiers in
  the repository.
- The AWS account owner should review Amplify's provider-level request logging,
  caching, and optional analytics settings separately from this static-app
  migration.

## Acceptance criteria

- `amplify.yml` installs the pinned dependencies, builds successfully, and
  publishes `dist/client`.
- A push to `main` produces a working Amplify deployment without manual bundle
  uploads.
- The production Amplify URL serves the app and same-origin OCR assets.
- Browser-local OCR remains functional and no label data is sent by the app to
  an AWS application backend.
- The current Sites deployment remains untouched until explicit retirement
  approval.

## References

- [Connect an AWS Amplify app to GitHub](https://docs.aws.amazon.com/amplify/latest/userguide/setting-up-GitHub-access.html)
- [Amplify build settings](https://docs.aws.amazon.com/amplify/latest/userguide/build-settings.html)
- [Amplify build specification syntax](https://docs.aws.amazon.com/amplify/latest/userguide/yml-specification-syntax.html)
- [Amplify redirect and rewrite examples](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html)
- [Amplify custom domains](https://docs.aws.amazon.com/amplify/latest/userguide/custom-domains.html)
