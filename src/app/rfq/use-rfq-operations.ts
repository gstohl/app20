import { useEffect, useState } from "react";
import { readLocalnetRfqOperationsStatus } from "./localnet-private-intents";
import {
  operationsAvailability,
  shouldPublishOperationsClock,
  type OperationsAvailability,
  type RfqOperationsStatus,
} from "./rfq-operations";

export function useRfqOperations(): OperationsAvailability {
  const [status, setStatus] = useState<RfqOperationsStatus | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));

  useEffect(() => {
    let active = true;
    let refreshing = false;
    let currentStatus: RfqOperationsStatus | null = null;
    let currentNow = Math.floor(Date.now() / 1_000);
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await readLocalnetRfqOperationsStatus();
        if (!active) return;
        currentStatus = next;
        setStatus(next);
      } catch {
        if (!active) return;
        currentStatus = null;
        setStatus(null);
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 10_000);
    const clockTimer = window.setInterval(() => {
      const nextNow = Math.floor(Date.now() / 1_000);
      if (!shouldPublishOperationsClock(currentStatus, currentNow, nextNow))
        return;
      currentNow = nextNow;
      setNow(nextNow);
    }, 1_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  return operationsAvailability(status, now);
}
