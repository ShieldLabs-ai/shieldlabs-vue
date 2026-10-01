// Type-level checks: `npm run typecheck` compiles them, and they also run as tests.
import type { IdentifyOptions, IdentifyResult, LoadOptions, ShieldLabsAgent } from '@shieldlabs-ai/js';
import { describe, expectTypeOf, it } from 'vitest';
import type { InjectionKey, MaybeRefOrGetter, Plugin, Ref } from 'vue';
import {
  createShieldLabs,
  shieldLabsKey,
  useIdentify,
  useShieldLabs,
  type CheckOnLoadOption,
  type InteractionIdentifier,
  type ShieldLabsContext,
  type ShieldLabsError,
  type ShieldLabsOptions,
  type ShieldLabsStatus,
  type UseIdentifyOptions,
  type UseIdentifyReturn,
  type UseShieldLabsReturn,
} from '../src/index';

describe('public types', () => {
  it('give the browser only the request ID and the User HID', () => {
    expectTypeOf<IdentifyResult>().toEqualTypeOf<{ requestId: string; userId: string | null }>();
    expectTypeOf<UseIdentifyReturn['result']>().toEqualTypeOf<Readonly<Ref<IdentifyResult | null>>>();
  });

  it('describe the plugin', () => {
    expectTypeOf(createShieldLabs).parameter(0).toEqualTypeOf<ShieldLabsOptions>();
    expectTypeOf<ShieldLabsOptions>().toExtend<LoadOptions>();
    expectTypeOf<ShieldLabsOptions['checkOnLoad']>().toEqualTypeOf<CheckOnLoadOption | undefined>();
    expectTypeOf<ShieldLabsOptions['autoLoad']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf(createShieldLabs({ publicKey: '0123456789abcdef0123456789abcdef' })).toExtend<Plugin>();
    expectTypeOf(shieldLabsKey).toEqualTypeOf<InjectionKey<ShieldLabsContext>>();
  });

  it('describe useShieldLabs()', () => {
    expectTypeOf(useShieldLabs).returns.toEqualTypeOf<UseShieldLabsReturn>();
    expectTypeOf<ShieldLabsStatus>().toEqualTypeOf<'loading' | 'ready' | 'error'>();
    expectTypeOf<UseShieldLabsReturn['status']>().toEqualTypeOf<Readonly<Ref<ShieldLabsStatus>>>();
    expectTypeOf<UseShieldLabsReturn['error']>().toEqualTypeOf<Readonly<Ref<ShieldLabsError | null>>>();
    expectTypeOf<UseShieldLabsReturn['identify']>().toEqualTypeOf<(options?: IdentifyOptions) => Promise<IdentifyResult>>();
    expectTypeOf<UseShieldLabsReturn['check']>().toEqualTypeOf<(options?: IdentifyOptions) => Promise<IdentifyResult | null>>();
    expectTypeOf<UseShieldLabsReturn['load']>().toEqualTypeOf<() => void>();
    expectTypeOf<UseShieldLabsReturn['getAgent']>().toEqualTypeOf<() => Promise<ShieldLabsAgent>>();
    expectTypeOf<ReturnType<ShieldLabsAgent['identifyOnInteraction']>>().toEqualTypeOf<InteractionIdentifier>();
  });

  it('describe useIdentify()', () => {
    expectTypeOf(useIdentify).parameter(0).toEqualTypeOf<UseIdentifyOptions | undefined>();
    expectTypeOf<UseIdentifyOptions['userId']>().toEqualTypeOf<MaybeRefOrGetter<string | null | undefined> | undefined>();
    expectTypeOf<UseIdentifyOptions['runOnMount']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<UseIdentifyReturn['identify']>().toEqualTypeOf<(options?: IdentifyOptions) => Promise<IdentifyResult | null>>();
    expectTypeOf<UseIdentifyReturn['isLoading']>().toEqualTypeOf<Readonly<Ref<boolean>>>();
    expectTypeOf<UseIdentifyReturn['error']>().toEqualTypeOf<Readonly<Ref<ShieldLabsError | null>>>();
    expectTypeOf<UseIdentifyReturn['reset']>().toEqualTypeOf<() => void>();
  });
});
