import { createRoot } from "react-dom/client";
import { lazy, Suspense, type ReactNode } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import AppShell from "@/app/components/AppShell";
import ReadyRailGate from "@/app/components/ReadyRailGate";
import AppProviders from "@/app/providers";
import ChatPage from "@/app/chat/page";
import PayPage from "@/app/pay/page";
import ContactsPage from "@/app/contacts/page";
import RfqPage from "@/app/rfq/page";
import OperationsDashboard from "@/app/rfq/OperationsDashboard";
import FundingPage from "@/app/funding/page";
import SendPage from "@/app/send/page";
import PrivyRecoveryPage from "@/app/recovery/privy/page";
import { CANONICAL_ROUTES, legacyRouteRedirect } from "@/app/routes";
import "@/app/globals.css";
import "@/app/design-system.css";

// The proposal-only market view and the dry cross-chain review are secondary,
// read-only tools. Deferring them keeps the eagerly loaded shell inside its
// recorded byte budget now that Chat carries the whole correspondence desk.
const MarketProposalPage = lazy(
  () => import("@/app/rfq/markets/proposal/page"),
);
const CrossChainReviewPage = lazy(
  () => import("@/app/cross-chain-review/page"),
);

let renderLocalnetTools: (() => ReactNode) | null = null;

function RootLayout() {
  return (
    <AppProviders>
      <AppShell renderLocalnetTools={renderLocalnetTools} />
    </AppProviders>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

function redirectLegacyRoute(pathname: string, locationHash: string): never {
  const target = legacyRouteRedirect(pathname, locationHash);
  if (!target) throw new Error(`Unknown legacy route: ${pathname}`);
  throw redirect({ ...target, replace: true });
}

function ReadyChatPage() {
  return (
    <ReadyRailGate moduleName="Chat">
      <ChatPage />
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

function RouteLoading({ name }: { name: string }) {
  return (
    <p className="route-loading" role="status">
      Opening {name}…
    </p>
  );
}

function RoutedMarketProposalPage() {
  const { tokenA, tokenB } = useParams({ strict: false });
  return (
    <Suspense fallback={<RouteLoading name="market proposal" />}>
      <MarketProposalPage tokenA={String(tokenA)} tokenB={String(tokenB)} />
    </Suspense>
  );
}

function RoutedCrossChainReviewPage() {
  return (
    <Suspense fallback={<RouteLoading name="cross-chain review" />}>
      <CrossChainReviewPage />
    </Suspense>
  );
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: CANONICAL_ROUTES.rfq, replace: true });
  },
});

const marketProposalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rfq/markets/$tokenA/$tokenB/proposal",
  component: RoutedMarketProposalPage,
});

const legacyPoolCreationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pools/create/$tokenA/$tokenB",
  beforeLoad: ({ params, location }) => {
    const hash = location.hash.replace(/^#/, "");
    throw redirect({
      to: "/rfq/markets/$tokenA/$tokenB/proposal",
      params: { tokenA: params.tokenA, tokenB: params.tokenB },
      ...(hash ? { hash } : {}),
      replace: true,
    });
  },
});

const rfqRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rfq",
  component: RfqPage,
});

const rfqOperationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rfq/operations",
  component: OperationsDashboard,
});

const legacyVaultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vault",
  beforeLoad: ({ location }) => redirectLegacyRoute("/vault", location.hash),
});

const mailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mail",
  beforeLoad: ({ location }) => redirectLegacyRoute("/mail", location.hash),
});

const legacyInboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  beforeLoad: ({ location }) => redirectLegacyRoute("/inbox", location.hash),
});

/* The Mailbox surface retired into Chat; its bookmarks land on the desk that
   now holds the same records. */
const mailboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mail/inbox",
  beforeLoad: ({ location }) =>
    redirectLegacyRoute("/mail/inbox", location.hash),
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ReadyChatPage,
});

const intentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/intents",
  beforeLoad: ({ location }) => redirectLegacyRoute("/intents", location.hash),
});

const contactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/contacts",
  component: ContactsPage,
});

const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows",
  beforeLoad: ({ location }) =>
    redirectLegacyRoute("/workflows", location.hash),
});

const payRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pay",
  component: ReadyPaymentPage,
});

const fundingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/funding",
  component: FundingPage,
});
const sendRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/send",
  component: SendPage,
});
const recoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recovery/privy",
  component: PrivyRecoveryPage,
});
const crossChainReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cross-chain-review",
  component: RoutedCrossChainReviewPage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    marketProposalRoute,
    legacyPoolCreationRoute,
    rfqRoute,
    rfqOperationsRoute,
    legacyVaultRoute,
    mailRoute,
    legacyInboxRoute,
    mailboxRoute,
    chatRoute,
    intentsRoute,
    contactsRoute,
    workflowsRoute,
    payRoute,
    fundingRoute,
    sendRoute,
    recoveryRoute,
    crossChainReviewRoute,
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
        <localnet.LocalnetDevTools wallet={wallet} variant="banner" />
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Localnet wallet failed to start.";
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
