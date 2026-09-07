// Browser entrypoint: no filesystem journal or Node-only imports.
export * from './confidential.js';
export { createBrowserConfidentialJournal, createBrowserConfidentialSecretStore } from '../../../src/lib/confidential-browser-journal';
export type { ConfidentialBrowserSecretStore } from '../../../src/lib/confidential-browser-journal';
