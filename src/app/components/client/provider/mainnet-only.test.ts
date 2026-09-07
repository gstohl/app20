import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
it('production ignores a persisted Sepolia selection and cannot switch away from mainnet', async () => {
  vi.stubEnv('PROD', true);
  vi.stubGlobal('localStorage', { getItem: () => '2', setItem: vi.fn() });
  vi.resetModules();
  const { useFrontendProvider } = await import('./providerContext');
  expect(useFrontendProvider.getState().currentFrontendProviderIndex).toBe(0);
  useFrontendProvider.getState().setCurrentFrontendProviderIndex(2);
  expect(useFrontendProvider.getState().currentFrontendProviderIndex).toBe(0);
  useFrontendProvider.getState().setCurrentFrontendProviderIndex(3);
  expect(useFrontendProvider.getState().currentFrontendProviderIndex).toBe(0);
});
