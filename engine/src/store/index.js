import { config } from '../config.js';
import { createMemoryStore } from './memory.js';
import { log } from '../log.js';

let store;
if (config.store === 'firestore') {
  const { createFirestoreStore } = await import('./firestore.js');
  store = createFirestoreStore();
} else {
  store = createMemoryStore();
}
log.info('store.ready', { store: store.name });

export const getStore = () => store;
