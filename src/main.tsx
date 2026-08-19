import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import AppShell from "@/app/components/AppShell";
import ReadyRailGate from "@/app/components/ReadyRailGate";
import AppProviders from "@/app/providers";
import InboxPage from "@/app/inbox/page";
import PayPage from "@/app/pay/page";
import VaultPage from "@/app/vault/page";
import WorkflowsPage from "@/app/workflows/page";
import { CANONICAL_ROUTES } from "@/app/routes";
import "@/app/globals.css";

let renderLocalnetTools: (() => ReactNode) | null = null;

function RootLayout() {
  return (
    <AppProviders>
      <AppShell renderLocalnetTools={renderLocalnetTools} />
    </AppProviders>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

function ReadyMailPage() {
  return (
    <ReadyRailGate moduleName="Mail">
      <InboxPage />
    </ReadyRailGate>
  );
}

function ReadyPaymentPage() {
  return (
    <ReadyRailGate moduleName="Payment Request">
      <PayPage />
    </ReadyRailGate>
  );
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: CANONICAL_ROUTES.vault, replace: true });
  },
});

const vaultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vault",
  component: VaultPage,
});

const mailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mail",
  beforeLoad: () => {
    throw redirect({ to: CANONICAL_ROUTES.mail, replace: true });
  },
});

const legacyInboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  beforeLoad: () => {
    throw redirect({ to: CANONICAL_ROUTES.mail, replace: true });
  },
});

const mailboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mail/inbox",
  component: ReadyMailPage,
});

const intentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/intents",
  beforeLoad: () => {
    throw redirect({ to: CANONICAL_ROUTES.vault, hash: "intents", replace: true });
  },
});

const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows",
  component: WorkflowsPage,
});

const payRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pay",
  component: ReadyPaymentPage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    vaultRoute,
    mailRoute,
    legacyInboxRoute,
    mailboxRoute,
    intentsRoute,
    workflowsRoute,
    payRoute,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

async function start() {
  // This branch must remain a dynamic import behind the build-time boolean.
  // vite.config.ts defines false by default so Rollup drops both the branch and
  // the complete localnet wallet module from production output.
  if (import.meta.env.VITE_E2E_WALLET === true) {
    try {
      const localnet = await import("@/dev/localnet-wallet");
      const wallet = await localnet.initializeLocalnetDevWallet();
      renderLocalnetTools = () => (
        <localnet.LocalnetDevTools wallet={wallet} />
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Localnet wallet failed to start.";
      renderLocalnetTools = () => (
        <aside role="alert" className="localnet-startup-error">
          Localnet wallet startup failed: {message}
        </aside>
      );
    }
  }

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Missing root element.");
  createRoot(rootElement).render(<RouterProvider router={router} />);
}

void start();
