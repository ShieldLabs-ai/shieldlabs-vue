import {
  load,
  ShieldLabsError,
  type IdentifyOptions,
  type LoadOptions,
  type ShieldLabsAgent,
  type ShieldLabsErrorCode,
} from '@shieldlabs-ai/js';
import { hasInjectionContext, inject, shallowReadonly, shallowRef, type InjectionKey } from 'vue';
import type { CheckOnLoadOption, ShieldLabsContext, ShieldLabsStatus } from './types';

/**
 * Injection key under which the plugin provides the {@link ShieldLabsContext} of an app. Use it
 * with `provide()` to give components a stand-in context in tests.
 */
export const shieldLabsKey: InjectionKey<ShieldLabsContext> = Symbol('shieldlabs');

/** Milliseconds a call may take when neither the call nor the plugin sets `timeout`, as in `@shieldlabs-ai/js`. */
const DEFAULT_TIMEOUT = 10000;

/** The largest timeout `@shieldlabs-ai/js` accepts: the largest delay of `setTimeout()`. */
const MAX_TIMEOUT = 2147483647;

/** What the plugin keeps about a context it created, out of the public context. */
interface Internals {
  /** Starts loading the agent after the app is mounted, unless a load has already started. */
  readonly start: () => void;
  /** The timeout of a call that sets none: the plugin's `timeout`, else 10 seconds. */
  readonly defaultTimeout: number;
}

const internals = new WeakMap<ShieldLabsContext, Internals>();

/** Stand-in context for server-side rendering when the plugin is installed on the client only. */
let serverContext: ShieldLabsContext | undefined;

/**
 * A browser page has both `window` and `document`, as `@shieldlabs-ai/js` requires. Some server
 * runtimes define a `window` global without a `document`: they count as servers, so nothing loads.
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** Keeps a `ShieldLabsError` as it is and wraps anything else, so `error` refs have one type. */
export function toShieldLabsError(reason: unknown, code: ShieldLabsErrorCode, message: string): ShieldLabsError {
  return reason instanceof ShieldLabsError ? reason : new ShieldLabsError(code, message, reason);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTimeout(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && value <= MAX_TIMEOUT;
}

function ignore(): void {
  // The outcome is reported through `status` and `error`.
}

/** The User HID of a call, `undefined` for an anonymous one. */
function userOf(options: unknown): string | undefined {
  return isObject(options) && typeof options.userId === 'string' ? options.userId : undefined;
}

/**
 * The options for an agent call that waited for the agent: the time left becomes its timeout, so
 * the wait and the agent's answer fit in one timeout. Options that `@shieldlabs-ai/js` rejects (not an
 * object, or an invalid `timeout`) go to the agent as they are, so that it reports them.
 */
function withTimeLeft(options: IdentifyOptions | undefined, left: number, total: number): IdentifyOptions | undefined {
  const raw: unknown = options;
  if (left >= total) return options;
  if (raw === undefined || raw === null) return { timeout: left };
  if (!isObject(raw) || (raw.timeout !== undefined && !isTimeout(raw.timeout))) return options;
  return { ...options, timeout: left };
}

/**
 * The state of one app: one agent load at a time (the `@shieldlabs-ai/js` `load()` is also memoized
 * per agent URL and Public Key, so two apps on one page share one import), `status` and `error`
 * refs, `identify()` and `check()` that wait for the agent within their timeout (with `autoLoad:
 * false` they fail fast until `load()` is called), `load()` and `getAgent()`.
 */
export function createContext(
  loadOptions: LoadOptions,
  checkOnLoad: CheckOnLoadOption,
  autoLoad: boolean,
): ShieldLabsContext {
  const status = shallowRef<ShieldLabsStatus>('loading');
  const error = shallowRef<ShieldLabsError | null>(null);
  /** The running or finished load. Unset before the first load and after a failed one. */
  let loading: Promise<ShieldLabsAgent> | undefined;
  /** The agent, once it has loaded. */
  let agent: ShieldLabsAgent | undefined;
  /** Whether calls may load the agent: with `autoLoad`, or once `load()` has been called. */
  let loadAllowed = autoLoad;
  /** Whether a load has started. The plugin starts one after mount only when none has. */
  let started = false;
  let checked = false;
  /** The User HID of every `identify()` and `check()` in flight, `undefined` for anonymous ones. */
  const inFlight: (string | undefined)[] = [];
  /** Settles like the load that the first `load()` starts. `getAgent()` calls made before it wait for it. */
  let allow: (first: Promise<ShieldLabsAgent>) => void = ignore;
  const allowed = new Promise<ShieldLabsAgent>((resolve) => {
    allow = resolve;
  });
  allowed.catch(ignore);
  const defaultTimeout = isTimeout(loadOptions.timeout) ? loadOptions.timeout : DEFAULT_TIMEOUT;

  const runCheckOnLoad = (ready: ShieldLabsAgent): void => {
    if (checkOnLoad === false || checked) return;
    checked = true;
    const userId = checkOnLoad === true ? undefined : (checkOnLoad.userId ?? undefined);
    // A call for the same User HID already identifies the visit. The agent runs one identification
    // at a time for a User HID, so a check sent ahead of it would make the agent refuse that call.
    if (inFlight.includes(userId)) return;
    const options: IdentifyOptions | undefined = userId === undefined ? undefined : { userId };
    // Passive monitoring: the page does not need this request ID. Only report a misconfiguration.
    new Promise<unknown>((resolve) => {
      resolve(ready.check(options));
    }).catch((reason: unknown) => {
      if (reason instanceof ShieldLabsError && reason.code === 'invalid_options') {
        console.warn('[ShieldLabs] checkOnLoad: ' + reason.message);
      }
    });
  };

  const startLoad = (): Promise<ShieldLabsAgent> => {
    if (loading) return loading;
    started = true;
    const next = new Promise<ShieldLabsAgent>((resolve) => {
      resolve(load(loadOptions));
    }).catch((reason: unknown) => {
      throw toShieldLabsError(reason, 'load_failed', 'Could not load the ShieldLabs agent.');
    });
    loading = next;
    status.value = 'loading';
    error.value = null;
    next.then(
      (ready) => {
        agent = ready;
        status.value = 'ready';
        runCheckOnLoad(ready);
      },
      (reason: unknown) => {
        // A failed load is not kept: the next identify(), check(), getAgent() or load() loads again.
        loading = undefined;
        const failure = toShieldLabsError(reason, 'load_failed', 'Could not load the ShieldLabs agent.');
        if (failure.code === 'invalid_options') console.warn('[ShieldLabs] ' + failure.message);
        error.value = failure;
        status.value = 'error';
      },
    );
    return next;
  };

  const getAgent = (): Promise<ShieldLabsAgent> => {
    // On the server load() rejects with unsupported_environment; the state stays as rendered.
    if (!isBrowser()) return load(loadOptions);
    // Before load() (autoLoad: false) it waits for the load that load() starts, with no timeout of its own.
    return loadAllowed ? startLoad() : allowed;
  };

  const loadNow = (): void => {
    if (!isBrowser()) return;
    const first = !loadAllowed;
    loadAllowed = true;
    const next = startLoad();
    if (first) allow(next);
  };

  /**
   * With `autoLoad: false`, in the browser, until `load()` is called: `identify()` and `check()` fail
   * fast instead of waiting for a load that may never start. On the server they keep reporting
   * `unsupported_environment`.
   */
  const beforeLoad = (): boolean => !loadAllowed && isBrowser();

  const notLoaded = (): ShieldLabsError =>
    new ShieldLabsError('not_initialized', 'The ShieldLabs agent is not loaded. With autoLoad: false it loads once load() is called.');

  const timedOut = (total: number): ShieldLabsError =>
    new ShieldLabsError('timeout', 'The ShieldLabs agent did not load within ' + String(total) + ' ms.');

  /**
   * Runs an agent call within one timeout: the call's `timeout`, else the plugin's, else 10 seconds,
   * covers the wait for the agent and the agent's answer together. A call whose timeout ends before
   * the agent is ready never reaches the agent.
   */
  const withAgent = <T>(
    options: IdentifyOptions | undefined,
    call: (ready: ShieldLabsAgent, agentOptions: IdentifyOptions | undefined) => Promise<T>,
  ): Promise<T> => {
    const user = userOf(options);
    inFlight.push(user);
    const outcome = new Promise<T>((resolve, reject) => {
      if (agent) {
        // Nothing to wait for: the agent applies the timeout to its answer.
        resolve(call(agent, options));
        return;
      }
      const raw: unknown = options;
      const own = isObject(raw) ? raw.timeout : undefined;
      const total = isTimeout(own) ? own : defaultTimeout;
      const startedAt = Date.now();
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(timedOut(total));
      }, total);
      getAgent().then(
        (ready) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const left = total - (Date.now() - startedAt);
          if (left < 1) reject(timedOut(total));
          else resolve(call(ready, withTimeLeft(options, left, total)));
        },
        (reason: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(toShieldLabsError(reason, 'load_failed', 'Could not load the ShieldLabs agent.'));
        },
      );
    });
    const finish = (): void => {
      inFlight.splice(inFlight.indexOf(user), 1);
    };
    outcome.then(finish, finish);
    return outcome;
  };

  // shallowReadonly(): `.value` is always the object itself, never a read-only proxy of it.
  const context: ShieldLabsContext = {
    status: shallowReadonly(status),
    error: shallowReadonly(error),
    // Like the agent: identify() rejects with not_initialized, check() resolves null.
    identify: (options) =>
      beforeLoad() ? Promise.reject(notLoaded()) : withAgent(options, (ready, agentOptions) => ready.identify(agentOptions)),
    check: (options) =>
      beforeLoad() ? Promise.resolve(null) : withAgent(options, (ready, agentOptions) => ready.check(agentOptions)),
    load: loadNow,
    getAgent,
  };

  internals.set(context, {
    // With autoLoad the plugin starts loading once the app is mounted, unless a load has already
    // started. After a failed load only identify(), check(), getAgent() and load() load again.
    start: () => {
      if (started || !autoLoad || !isBrowser()) return;
      void startLoad();
    },
    defaultTimeout,
  });

  return context;
}

/** Starts loading the agent of `context` (in the browser, once). No-op for stand-in contexts. */
export function startContext(context: ShieldLabsContext): void {
  internals.get(context)?.start();
}

/**
 * The timeout that bounds a call to `context` without its own `timeout`: the plugin's `timeout`,
 * else 10 seconds, the default of `@shieldlabs-ai/js` (also for stand-in contexts).
 */
export function defaultTimeoutOf(context: ShieldLabsContext): number {
  return internals.get(context)?.defaultTimeout ?? DEFAULT_TIMEOUT;
}

function createServerContext(): ShieldLabsContext {
  const unsupported = (): Promise<never> =>
    Promise.reject(
      new ShieldLabsError('unsupported_environment', 'ShieldLabs identifies in the browser, not during server-side rendering.'),
    );
  return {
    status: shallowReadonly(shallowRef<ShieldLabsStatus>('loading')),
    error: shallowReadonly(shallowRef<ShieldLabsError | null>(null)),
    identify: unsupported,
    check: unsupported,
    load: ignore,
    getAgent: unsupported,
  };
}

/**
 * The context provided by the plugin. During server-side rendering without the plugin (a
 * client-only plugin such as `plugins/shieldlabs.client.ts` in Nuxt) it returns an inert stand-in.
 * In the browser a missing plugin is a setup error.
 */
export function injectContext(caller: string): ShieldLabsContext {
  const inContext = hasInjectionContext();
  const context = inContext ? inject(shieldLabsKey, null) : null;
  if (context) return context;
  if (!isBrowser()) return (serverContext ??= createServerContext());
  if (!inContext) {
    throw new Error('[ShieldLabs] ' + caller + '() must be called inside setup() of a component or in app.runWithContext().');
  }
  throw new Error(
    '[ShieldLabs] ' +
      caller +
      '() found no ShieldLabs plugin. Install it before mounting the app: app.use(createShieldLabs({ publicKey })). ' +
      'In Nuxt, add the client plugin plugins/shieldlabs.client.ts.',
  );
}
