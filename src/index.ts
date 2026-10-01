export { createShieldLabs } from './plugin';
export { useIdentify, useShieldLabs } from './composables';
export { shieldLabsKey } from './context';
export { VERSION } from './version';
export type {
  CheckOnLoadOption,
  ShieldLabsContext,
  ShieldLabsOptions,
  ShieldLabsPlugin,
  ShieldLabsStatus,
  UseIdentifyOptions,
  UseIdentifyReturn,
  UseShieldLabsReturn,
} from './types';

// Re-exported from @shieldlabs-ai/js so that apps can import everything from @shieldlabs-ai/vue.
export { ShieldLabsError } from '@shieldlabs-ai/js';
export type {
  IdentifyOptions,
  IdentifyResult,
  InteractionIdentifier,
  LoadOptions,
  ShieldLabsAgent,
  ShieldLabsErrorCode,
} from '@shieldlabs-ai/js';
