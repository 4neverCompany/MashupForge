/**
 * Barrel export for `lib/providers/`. The Director (lib/agent-tools)
 * imports from `@/lib/providers` only — never reaches into a
 * sub-file. This keeps the public surface narrow and gives us a
 * single chokepoint to gate the "which providers are exposed"
 * decision.
 */

export * from './interface';
export * from './cli-utils';
export * from './registry';

export { HiggsfieldCliAdapter, higgsfieldAdapter } from './higgsfield/cli-adapter';
export {
  LeonardoHttpAdapter,
  leonardoAdapter,
  extractLeonardoErrorMessage,
  type LeonardoHttpAdapterOptions,
} from './leonardo/http-adapter';
export { MinimaxTextAdapter, minimaxTextAdapter, type MinimaxTextAdapterOptions } from './minimax/text-adapter';
export { MinimaxVideoAdapter, minimaxVideoAdapter, type MinimaxVideoAdapterOptions } from './minimax/video-adapter';
