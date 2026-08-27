import { config } from '../config.js';
import { createMockProvider } from './mock.js';
import { log } from '../log.js';

/**
 * The Gemini provider is imported lazily so a mock-mode run never needs credentials —
 * or the SDK's client construction — to boot.
 */
const provider =
  config.provider === 'mock'
    ? createMockProvider()
    : (await import('./gemini.js')).createGeminiProvider();

log.info('provider.ready', {
  provider: provider.name,
  models: provider.name === 'mock' ? null : config.models,
});

export const getProvider = () => provider;
