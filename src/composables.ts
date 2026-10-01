import type { IdentifyOptions, IdentifyResult, ShieldLabsError } from '@shieldlabs-ai/js';
import { computed, getCurrentInstance, onMounted, shallowReadonly, shallowRef, toValue } from 'vue';
import { defaultTimeoutOf, injectContext, isBrowser, startContext, toShieldLabsError } from './context';
import type { UseIdentifyOptions, UseIdentifyReturn, UseShieldLabsReturn } from './types';

/**
 * The agent state of the app (`status`, `error`), its `identify()` and `check()`, `load()` to start
 * loading (with `autoLoad: false`, for example after consent) and `getAgent()` for the agent itself.
 *
 * Inside a component, `status` is `loading` and `error` is `null` until the component is mounted,
 * as during server-side rendering, so hydration always matches the server HTML. Nothing loads or
 * identifies during server-side rendering.
 */
export function useShieldLabs(): UseShieldLabsReturn {
  const context = injectContext('useShieldLabs');
  if (!getCurrentInstance()) return context;

  const mounted = shallowRef(false);
  onMounted(() => {
    mounted.value = true;
    startContext(context);
  });
  return {
    status: computed(() => (mounted.value ? context.status.value : 'loading')),
    error: computed(() => (mounted.value ? context.error.value : null)),
    identify: context.identify,
    check: context.check,
    load: context.load,
    getAgent: context.getAgent,
  };
}

function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

/**
 * The timeout that bounds a call: its own `timeout`, else `fallback`. As in `@shieldlabs-ai/js`, only an
 * omitted timeout takes the fallback; any other value stays, so an invalid one is still reported.
 */
function boundOf(timeout: unknown, fallback: number): unknown {
  return timeout === undefined ? fallback : timeout;
}

/** An `identify()` whose identification is still in flight. */
interface RunningCall {
  readonly id: number;
  readonly userId: string | undefined;
  /** The timeout that bounds the call: its own `timeout`, else the plugin's default. */
  readonly timeout: unknown;
  readonly promise: Promise<IdentifyResult | null>;
}

/**
 * An identify helper with `result`, `isLoading` and `error` refs. `identify()` never rejects: it
 * resolves `null` when there is no identification, so the protected action can go ahead as
 * unverified. `userId` is read when `identify()` runs; changing it never starts an identification.
 *
 * @example
 * const { identify, isLoading } = useIdentify({ userId: () => user.value?.hid });
 * async function onSubmit() {
 *   const result = await identify();
 *   await fetch('/api/signup', { method: 'POST', body: JSON.stringify({ requestId: result?.requestId ?? null }) });
 * }
 */
export function useIdentify(options: UseIdentifyOptions = {}): UseIdentifyReturn {
  const context = injectContext('useIdentify');
  const defaultTimeout = defaultTimeoutOf(context);
  const result = shallowRef<IdentifyResult | null>(null);
  const isLoading = shallowRef(false);
  const error = shallowRef<ShieldLabsError | null>(null);
  /**
   * Calls in flight of this helper, shared with an identical call (a double submit) instead of a
   * second identification.
   */
  const running = new Set<RunningCall>();
  let lastId = 0;
  /** The call whose outcome the refs show. `reset()` sets it to 0, which is no call. */
  let owner = 0;

  const own = (id: number): void => {
    owner = id;
    result.value = null;
    error.value = null;
    isLoading.value = true;
  };

  const identify = (overrides?: IdentifyOptions): Promise<IdentifyResult | null> => {
    const given: unknown = overrides ?? {};
    // Anything but an options object goes to @shieldlabs-ai/js as it is, which reports invalid_options.
    let callOptions: unknown = given;
    let key: Pick<RunningCall, 'userId' | 'timeout'> | undefined;
    if (typeof given === 'object' && given !== null) {
      // Reads only the two known keys, so a DOM event passed by a template handler is harmless.
      const picked = given as IdentifyOptions;
      const userId = 'userId' in picked ? orUndefined(picked.userId) : orUndefined(toValue(options.userId));
      const timeout = picked.timeout;
      // A call without a timeout is bounded by the default one: it is the same call as one that sets it.
      const bound = boundOf(timeout, defaultTimeout);
      for (const call of running) {
        if (call.userId === userId && Object.is(call.timeout, bound)) {
          // The refs follow the call this one returns.
          if (owner !== call.id) own(call.id);
          return call.promise;
        }
      }
      key = { userId, timeout: bound };
      const built: IdentifyOptions = {};
      if (userId !== undefined) built.userId = userId;
      if (timeout !== undefined) built.timeout = timeout;
      callOptions = built;
    }

    const id = ++lastId;
    own(id);
    const promise = new Promise<IdentifyResult>((resolve) => {
      resolve(context.identify(callOptions as IdentifyOptions));
    }).then(
      (value) => {
        if (owner === id) {
          result.value = value;
          isLoading.value = false;
        }
        return value;
      },
      (reason: unknown) => {
        const failure = toShieldLabsError(reason, 'not_initialized', 'The identification did not start.');
        if (owner === id) {
          error.value = failure;
          isLoading.value = false;
        }
        return null;
      },
    );
    if (key !== undefined) {
      const entry: RunningCall = { id, ...key, promise };
      running.add(entry);
      void promise.then(() => {
        running.delete(entry);
      });
    }
    return promise;
  };

  const reset = (): void => {
    owner = 0;
    result.value = null;
    error.value = null;
    isLoading.value = false;
  };

  if (getCurrentInstance()) {
    onMounted(() => {
      startContext(context);
      if (options.runOnMount === true) void identify();
    });
  } else if (options.runOnMount === true && isBrowser()) {
    // Outside a component (for example in app.runWithContext()) there is no mount to wait for.
    void identify();
  }

  // shallowReadonly(): `.value` is the result or error object itself, not a read-only proxy of it,
  // so it can go to postMessage(), BroadcastChannel or IndexedDB as it is.
  return {
    identify,
    result: shallowReadonly(result),
    isLoading: shallowReadonly(isLoading),
    error: shallowReadonly(error),
    reset,
  };
}
