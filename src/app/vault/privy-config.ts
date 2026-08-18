export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;
export const PRIVY_CLIENT_ID = import.meta.env.VITE_PRIVY_CLIENT_ID;

export const privyBrowserConfigured = Boolean(
  PRIVY_APP_ID && PRIVY_CLIENT_ID,
);
