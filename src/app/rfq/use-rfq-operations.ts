import { useEffect, useState } from "react";
import { readLocalnetRfqOperationsStatus } from "./localnet-private-intents";
import {
  operationsAvailability,
  type OperationsAvailability,
  type RfqOperationsStatus,
} from "./rfq-operations";

export function useRfqOperations(): OperationsAvailability {
  const [status, setStatus] = useState<RfqOperationsStatus | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await readLocalnetRfqOperationsStatus();
        if (active) setStatus(next);
      } catch {
        if (active) setStatus(null);
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 10_000);
    const clockTimer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1_000)),
      1_000,
    );
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  return operationsAvailability(status, now);
}
