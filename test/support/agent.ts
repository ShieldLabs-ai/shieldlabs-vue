import {
  ShieldLabsError,
  type IdentifyOptions,
  type IdentifyResult,
  type InteractionIdentifier,
  type ShieldLabsAgent,
} from '@shieldlabs-ai/js';
import { vi } from 'vitest';

/** A fake 32-hex Public Key, the shape issued today. */
export const PUBLIC_KEY = '0123456789abcdef0123456789abcdef';

/** A User HID as the ShieldLabs server SDKs compute it (64 hex characters). */
export const USER_HID = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';

let counter = 0;

/** Deterministic UUIDv4-shaped request IDs. */
export function nextRequestId(): string {
  counter += 1;
  return '8d7f3c2a-1b4e-4f6a-9c3d-' + counter.toString(16).padStart(12, '0');
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function answer(options?: IdentifyOptions): IdentifyResult {
  return { requestId: nextRequestId(), userId: options?.userId ?? null };
}

/** A stand-in for the handle of `identifyOnInteraction()`. */
function createInteractionIdentifier() {
  const take = vi.fn((): Promise<IdentifyResult> => Promise.resolve(answer()));
  const dispose = vi.fn();
  const identifier: InteractionIdentifier = { take, dispose };
  return { identifier, take, dispose };
}

/**
 * A stand-in for the agent that `load()` from `@shieldlabs-ai/js` resolves. `identify()` and `check()`
 * answer with a new request ID unless a test replaces their implementation; `identifyOnInteraction()`
 * returns `interaction.identifier`.
 */
export function createAgent() {
  const identify = vi.fn((options?: IdentifyOptions): Promise<IdentifyResult> => Promise.resolve(answer(options)));
  const check = vi.fn((options?: IdentifyOptions): Promise<IdentifyResult | null> => Promise.resolve(answer(options)));
  const interaction = createInteractionIdentifier();
  const identifyOnInteraction = vi.fn((): InteractionIdentifier => interaction.identifier);
  const agent: ShieldLabsAgent = { identify, check, identifyOnInteraction };
  return { agent, identify, check, identifyOnInteraction, interaction };
}

/**
 * A stand-in that answers overlapping calls like the agent: it runs one identification at a time
 * for a User HID. Another call for that User HID gets `not_initialized` (`check()` resolves `null`)
 * until `finish()` ends the running identifications. `calls` lists "identify:<user>" and
 * "check:<user>" in the order the agent received them.
 */
export function createBusyAgent() {
  const calls: string[] = [];
  const running = new Set<string>();
  const start = (kind: 'identify' | 'check', options?: IdentifyOptions): boolean => {
    const user = options?.userId ?? 'anonymous';
    calls.push(kind + ':' + user);
    if (running.has(user)) return false;
    running.add(user);
    return true;
  };
  const identify = vi.fn(
    (options?: IdentifyOptions): Promise<IdentifyResult> =>
      start('identify', options)
        ? Promise.resolve(answer(options))
        : Promise.reject(new ShieldLabsError('not_initialized', 'The agent did not start an identification.')),
  );
  const check = vi.fn(
    (options?: IdentifyOptions): Promise<IdentifyResult | null> =>
      Promise.resolve(start('check', options) ? answer(options) : null),
  );
  const identifyOnInteraction = vi.fn((): InteractionIdentifier => createInteractionIdentifier().identifier);
  const agent: ShieldLabsAgent = { identify, check, identifyOnInteraction };
  const finish = (): void => {
    running.clear();
  };
  return { agent, identify, check, calls, finish };
}
