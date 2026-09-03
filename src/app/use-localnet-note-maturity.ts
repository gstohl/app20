"use client";

import {
  noteMaturityStatus,
  readAccountDeposits,
  type NoteMaturityStatus,
  type PoolEventsProvider,
} from "@/lib/note-maturity";
import {
  LOCALNET_PROVIDER_INDEX,
  myFrontendProviders,
  strk20PoolLocalnet,
} from "@/utils/constants";
import { useCallback, useEffect, useRef, useState } from "react";

export type LocalnetNoteMaturityState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready"; status: NoteMaturityStatus }>
  | Readonly<{ kind: "error"; message: string }>;

const DEFAULT_ERROR = "The public deposit-event read failed.";
const IDLE_MATURITY: LocalnetNoteMaturityState = Object.freeze({
  kind: "idle",
});

export function useLocalnetNoteMaturity(input: {
  enabled: boolean;
  address: string | undefined;
}): {
  maturity: LocalnetNoteMaturityState;
  refresh: () => Promise<LocalnetNoteMaturityState>;
} {
  const { enabled, address } = input;
  const scope = `${enabled ? "enabled" : "disabled"}:${address ?? ""}`;
  const scopeRef = useRef(scope);
  const mountedRef = useRef(false);
  const [maturity, setMaturity] =
    useState<LocalnetNoteMaturityState>(IDLE_MATURITY);
  scopeRef.current = scope;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<LocalnetNoteMaturityState> => {
    const remainsCurrent = () =>
      mountedRef.current && scopeRef.current === scope;
    const publish = (next: LocalnetNoteMaturityState) => {
      if (remainsCurrent()) setMaturity(next);
      return remainsCurrent() ? next : IDLE_MATURITY;
    };

    if (!enabled || !address) return publish(IDLE_MATURITY);
    if (remainsCurrent()) {
      setMaturity((current) =>
        current.kind === "ready" ? current : { kind: "loading" },
      );
    }
    try {
      // SAFETY: Starknet's selected localnet provider implements the same
      // getBlockNumber/getEvents RPC subset required by PoolEventsProvider.
      const provider = myFrontendProviders[
        LOCALNET_PROVIDER_INDEX
      ] as unknown as PoolEventsProvider;
      const deposits = await readAccountDeposits({
        provider,
        poolAddress: strk20PoolLocalnet,
        account: address,
      });
      const head = await provider.getBlockNumber();
      return publish({
        kind: "ready",
        status: noteMaturityStatus(deposits, head),
      });
    } catch (error) {
      return publish({
        kind: "error",
        message:
          error instanceof Error && error.message.trim()
            ? error.message
            : DEFAULT_ERROR,
      });
    }
  }, [address, enabled, scope]);

  useEffect(() => {
    if (!enabled || !address) {
      setMaturity(IDLE_MATURITY);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [address, enabled, refresh]);

  return { maturity, refresh };
}
