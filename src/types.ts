import type { IdentifyOptions, IdentifyResult, LoadOptions, ShieldLabsAgent, ShieldLabsError } from '@shieldlabs-ai/js';
import type { App, MaybeRefOrGetter, Ref } from 'vue';

/**
 * State of the agent for this app:
 *
 * - `loading`: not ready yet. Always the value during server-side rendering and in the first render
 *   of every component, so that hydration matches the server HTML. With `autoLoad: false` it stays
 *   `loading` until `load()` is called.
 * - `ready`: the agent is loaded; identifications start right away.
 * - `error`: the last load failed. `error` says why; the next `identify()`, `check()`, `getAgent()`
 *   or `load()` tries again.
 */
export type ShieldLabsStatus = 'loading' | 'ready' | 'error';

/**
 * `checkOnLoad` plugin option. `true` runs one anonymous `check()` when the agent is ready,
 * `{ userId }` runs it for a User HID. Default `false`.
 */
export type CheckOnLoadOption = boolean | { userId?: string | null };

/** Options of `createShieldLabs()`: the `@shieldlabs-ai/js` load options plus the plugin options. */
export interface ShieldLabsOptions extends LoadOptions {
  /**
   * Runs `check()` once when the agent becomes ready, for passive monitoring of the visit. The agent
   * limits it to one per visit every five minutes. Skipped when an `identify()` or `check()` for the
   * same User HID is already in flight at that moment: that call identifies the visit, and the agent
   * runs one identification at a time for a User HID. Default `false`.
   */
  checkOnLoad?: CheckOnLoadOption;
  /**
   * Loads the agent right after the app is mounted (default `true`). With `false` nothing loads until
   * `load()` from `useShieldLabs()` is called, for example once the visitor has given consent. Until
   * then `status` stays `loading` and `getAgent()` waits, while `identify()` and `check()` fail fast
   * instead of waiting: `identify()` rejects with `not_initialized`, `check()` resolves `null`, and
   * the `identify()` of `useIdentify()` resolves `null` with a `not_initialized` error.
   */
  autoLoad?: boolean;
}

/** The Vue plugin returned by {@link createShieldLabs}. Pass it to `app.use()`. */
export interface ShieldLabsPlugin {
  install: (app: App) => void;
}

/** What `useShieldLabs()` returns, and what the plugin provides under `shieldLabsKey`. */
export interface ShieldLabsContext {
  /** `loading`, `ready` or `error`. */
  readonly status: Readonly<Ref<ShieldLabsStatus>>;
  /** Why the last load failed, otherwise `null`. */
  readonly error: Readonly<Ref<ShieldLabsError | null>>;
  /**
   * Fresh identification with a new request ID. Waits for the agent; `timeout` covers the wait and
   * the agent's answer together. Rejects with a `ShieldLabsError` when there is no identification,
   * and with `not_initialized` right away while `autoLoad: false` waits for `load()`.
   */
  identify: (options?: IdentifyOptions) => Promise<IdentifyResult>;
  /**
   * Background check, limited by the agent to one per visit every five minutes. Resolves `null`
   * when the agent skipped it, and right away while `autoLoad: false` waits for `load()`. Waits for
   * the agent like `identify()`.
   */
  check: (options?: IdentifyOptions) => Promise<IdentifyResult | null>;
  /**
   * Starts loading the agent now, unless it is loaded or loading. With `autoLoad: false` nothing
   * loads before this call. After a failed load it loads again. The outcome shows in `status` and
   * `error`. Does nothing during server-side rendering.
   */
  load: () => void;
  /**
   * The agent of `@shieldlabs-ai/js` once it has loaded, for example to identify on the first
   * interaction with a form: `getAgent().then((agent) => agent.identifyOnInteraction(form))`.
   * Loads the agent when needed; with `autoLoad: false` it waits until `load()` is called, with no
   * timeout of its own. Rejects with the `ShieldLabsError` of a failed load, and with
   * `unsupported_environment` during server-side rendering.
   */
  getAgent: () => Promise<ShieldLabsAgent>;
}

/** Return value of `useShieldLabs()`. */
export type UseShieldLabsReturn = ShieldLabsContext;

/** Options of `useIdentify()`. */
export interface UseIdentifyOptions {
  /**
   * User HID computed on your server, read when `identify()` runs. A string, a ref or a getter;
   * `undefined` or `null` for anonymous identifications.
   */
  userId?: MaybeRefOrGetter<string | null | undefined>;
  /**
   * Calls `identify()` once when the component is mounted (after the agent is ready). Each call is
   * a billable identification: use it sparingly. With `autoLoad: false` that identification ends
   * right away with a `not_initialized` error unless `load()` was called before the component
   * mounted, and a later `load()` does not start it again. Default `false`.
   */
  runOnMount?: boolean;
}

/** Return value of `useIdentify()`. */
export interface UseIdentifyReturn {
  /**
   * Runs a fresh identification. Resolves with the result, or `null` when there is no
   * identification (the reason is in `error`); it never rejects. Options override the composable's
   * `userId` for this call, and `timeout` covers the wait for the agent and its answer together.
   * While a call of this helper with the same `userId` and `timeout` is in flight (a double submit),
   * it returns that call instead of starting another identification. A call without `timeout`
   * counts as one with the plugin's `timeout` (10 seconds by default).
   */
  identify: (options?: IdentifyOptions) => Promise<IdentifyResult | null>;
  /** The result of the latest `identify()`, `null` before it resolves or when it failed. */
  readonly result: Readonly<Ref<IdentifyResult | null>>;
  /** `true` while the latest `identify()` runs. */
  readonly isLoading: Readonly<Ref<boolean>>;
  /** Why the latest `identify()` returned `null`, otherwise `null`. */
  readonly error: Readonly<Ref<ShieldLabsError | null>>;
  /**
   * Clears `result`, `error` and `isLoading`. A call still in flight no longer updates them, unless
   * `identify()` is called again with the same `userId` and `timeout` while it runs: that call
   * returns it.
   */
  reset: () => void;
}
