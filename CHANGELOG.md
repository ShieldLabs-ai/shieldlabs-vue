# Changelog

All notable changes to `@shieldlabs-ai/vue` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Contributor and example setup uses published ShieldLabs peers from npm. Local tarballs remain
  optional for testing changes; a checkout of another SDK is no longer required.

## [1.0.0] - 2026-09-30

### Added

- `createShieldLabs(options)`: a Vue plugin for `app.use()` that loads the ShieldLabs agent once per
  app with `@shieldlabs-ai/js`, after the app is mounted in the browser. It takes the `@shieldlabs-ai/js`
  load options (`publicKey`, `environment`, `scriptUrl`, `timeout`) plus `checkOnLoad` (one
  `check()` when the agent becomes ready, anonymous or for a User HID, skipped when an `identify()`
  or `check()` for the same User HID is already in flight) and `autoLoad` (default `true`; with
  `false` nothing loads until `load()` is called, for example after consent, and until then
  `identify()` and `check()` fail fast instead of waiting: `identify()` rejects with
  `not_initialized`, `check()` resolves `null` and the `identify()` of `useIdentify()` resolves `null`
  with a `not_initialized` error). A second plugin on the same app is ignored with a warning.
- `useShieldLabs()`: `status` (`loading`, `ready` or `error`) and `error` refs, `identify()` and
  `check()` that wait for the agent, `load()` that starts loading it, and `getAgent()` that resolves
  the `@shieldlabs-ai/js` agent once it has loaded (for example for `identifyOnInteraction()` on a
  form; with `autoLoad: false` it waits for `load()`, with no timeout of its own). A failed load is
  retried by the next `identify()`, `check()`, `getAgent()` or `load()`.
- One timeout per call: the `timeout` of `identify()` and `check()` (else the plugin's `timeout`,
  10 seconds by default) covers the wait for the agent to load and the agent's answer together. A
  call whose timeout ends before the agent is ready fails with `timeout` and never reaches the
  agent.
- `useIdentify({ userId, runOnMount })`: an identify helper with read-only `result`, `isLoading`
  and `error` refs (holding the objects from `@shieldlabs-ai/js` as they are) and `reset()`.
  `identify()` never rejects (it resolves `null` and puts the reason in `error`), reads `userId`
  from a string, ref or getter when it runs, and returns a call of the same helper already in flight
  with the same `userId` and `timeout` (a call without `timeout` counts as one with the plugin's
  `timeout`) instead of starting another identification, so a double submit costs one
  identification. `runOnMount` identifies once after mount; with `autoLoad: false` before `load()`
  it resolves `null` with a `not_initialized` error, like `identify()`, and does not run again after
  `load()`.
- Server-side rendering: nothing touches browser globals during setup or render and nothing loads
  on the server. `status` is `loading` during server rendering and in the first render of every
  component, so hydration matches the server HTML. The composables also render during server
  rendering without the plugin (a client-only Nuxt plugin).
- `shieldLabsKey` (injection key), `VERSION`, the `ShieldLabsError` class and the types of
  `@shieldlabs-ai/js` (including `InteractionIdentifier`), and the types `ShieldLabsOptions`,
  `CheckOnLoadOption`, `ShieldLabsPlugin`, `ShieldLabsContext`, `ShieldLabsStatus`,
  `UseShieldLabsReturn`, `UseIdentifyOptions` and `UseIdentifyReturn`.
- ESM and CommonJS builds with TypeScript declarations. `vue` (`^3.3.0`) and `@shieldlabs-ai/js`
  (`^1.0.0`) are peer dependencies; no runtime dependencies.
- `examples/vite`: a Vue signup form. README guides for Vue and Nuxt 3.

### Removed

- The `0.0.0` placeholder `useShieldLabs({ apiKey })`. The browser receives a request ID; results
  are read on your server.

[Unreleased]: https://github.com/ShieldLabs-ai/shieldlabs-vue/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ShieldLabs-ai/shieldlabs-vue/releases/tag/v1.0.0
