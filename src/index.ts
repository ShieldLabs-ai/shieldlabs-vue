/**
 * @shieldlabs/vue — thin Vue wrapper over @shieldlabs/js.
 * No signal-collection logic lives here.
 *
 * Status: pre-launch scaffold. Composable surface is a placeholder.
 */
import type { IdentificationResult, ShieldLabsOptions } from "@shieldlabs/js";

export type { IdentificationResult, ShieldLabsOptions };

/** Placeholder composable. Not implemented yet. */
export function useShieldLabs(_options: ShieldLabsOptions) {
  return { data: undefined, error: new Error("@shieldlabs/vue is not published yet."), isLoading: false };
}
