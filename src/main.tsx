import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import LandingPage from "@/app/page";
import InboxPage from "@/app/inbox/page";
import PayPage from "@/app/pay/page";
import "@/app/globals.css";

let renderLocalnetTools: (() => ReactNode) | null = null;

function RootLayout() {
  return (
    <>
      {renderLocalnetTools?.()}
      <Outlet />
    </>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LandingPage,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  component: InboxPage,
});

const payRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pay",
  component: PayPage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([landingRoute, inboxRoute, payRoute]),
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
        <aside
          role="alert"
          style={{ background: "#7f1d1d", color: "white", padding: "12px" }}
        >
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
