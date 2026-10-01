# Contributing to @shieldlabs-ai/vue

Thank you for improving the ShieldLabs Vue bindings.

## Set up

You need Node.js 20 or later. `@shieldlabs-ai/js`, a peer dependency, is not on npm yet, so build it
from a checkout of [shieldlabs-js](https://github.com/ShieldLabs-ai/shieldlabs-js) next to this
repository and install the tarball without saving it:

```bash
# in ../shieldlabs-js
npm ci && npm run build && npm pack

# in this repository
npm ci
npm install --no-save ../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz
```

Repeat the second command after every `npm ci`, which removes it. Never commit a `file:` or
tarball reference to `package.json` or `package-lock.json`.

### Why there is an `.npmrc`

Until `@shieldlabs-ai/js` 1.0.0 is published, npm cannot resolve the peer dependency from the
registry, and `npm install` / `npm ci` would fail while trying to install it. The committed
`.npmrc` therefore sets:

- `legacy-peer-deps=true`: npm does not try to install peer dependencies (`vue` is a dev
  dependency, so it is installed anyway).
- `save-dev=true`: `npm install --no-save <tarball>` places the tarball in `node_modules`. With
  `legacy-peer-deps` alone npm keeps a package that is listed as a peer dependency out of the
  install. It also means that `npm install <package>` adds a dev dependency by default, which fits
  a package without runtime dependencies.

Remove `.npmrc`, regenerate `package-lock.json` and drop the tarball steps (here and in
`.github/workflows/ci.yml`) once `@shieldlabs-ai/js` is on npm.

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
`npm install --no-save vue@~3.3.0 ../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz`, run the tests, then
`npm ci` and install the tarball again.

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
