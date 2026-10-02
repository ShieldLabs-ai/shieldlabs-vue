# Contributing to @shieldlabs-ai/vue

Thank you for improving the ShieldLabs Vue bindings.

## Set up

You need Node.js 20 or later. Install the development tools and the published `@shieldlabs-ai/js`
peer dependency from this repository's root. You do not need a checkout of another SDK.

```bash
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
```

Repeat the second command after every `npm ci`, which removes the separately installed peer.
`--no-save` leaves `package.json` and `package-lock.json` unchanged.

### Why there is an `.npmrc`

The lockfile was created with `legacy-peer-deps=true`; the repository keeps that setting for
`npm ci`. The separate install uses `--legacy-peer-deps=false` to resolve the published peer.
`save-dev=true` makes saved installs development dependencies by default; `--no-save` above avoids
saving anything. These settings apply only to this checkout: npm does not publish `.npmrc`.

CI still builds the loader from its `main` branch and tests the packed copy. The commands above
instead test the published 1.x loader. To test a loader change, build and pack it in its own
checkout, then replace the package name in the second command with the path to that tarball.
Never commit a `file:` dependency or a tarball.

## Checks

Run these before you open a pull request. CI runs the same steps on Node.js 20, 22 and 24, and once
with Vue 3.3, the lowest supported version.

```bash
npm run typecheck
npm run lint
npm test -- --coverage   # builds first; coverage must stay at 90 % or more
npm run build
```

To try the lowest supported Vue version locally:
`npm install --no-save --legacy-peer-deps=false vue@~3.3.0 '@shieldlabs-ai/js@^1.0.0'`, run the tests,
then repeat the setup commands to restore the lockfile's Vue version.

## Guidelines

- The package stays a thin binding over `@shieldlabs-ai/js`: it loads the agent only through `load()`
  and never touches `window` or `document` during setup or render.
- Nothing identifies on its own except `runOnMount` and `checkOnLoad`. Never identify on re-render,
  on route changes or when a ref changes: every identification is billed.
- Browser types carry only the request ID and the User HID; scores and flags are read on servers.
- Every change comes with tests (`test/`, vitest with `@vue/test-utils` and happy-dom). Keep
  `src/version.ts` equal to the version in `package.json` (a test checks it).
- Use conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`) and add a
  line to `CHANGELOG.md` under "Unreleased".
- Documentation style: plain technical English, say "risk signals", and use the three risk bands
  trusted 0-29, suspicious 30-59 and dangerous 60-100.

## Releasing

Publish `@shieldlabs-ai/js` first. Then update the version in `package.json` and `src/version.ts`,
move the "Unreleased" changelog entries under the new version, and push a tag such as `v1.0.1`. The
release workflow installs the published `@shieldlabs-ai/js`, runs all checks and packs the package in
a job without write permissions. A second job, in the `npm` environment, publishes that tarball to
npm with provenance, using the `NPM_TOKEN` repository secret. Add required reviewers to the `npm`
environment to approve each release. Re-running the workflow is safe: a version that is already on
npm is skipped.

## Security

Please report security issues privately to <contact@shieldlabs.ai> rather than in a public issue.
