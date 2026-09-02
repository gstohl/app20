import { useEffect, useState } from "react";
import { readLocalnetRfqOperationsStatus } from "./localnet-private-intents";
import {
  operationsAvailability,
  shouldPublishOperationsClock,
  synchronizeOperationsRefresh,
  type OperationsAvailability,
  type RfqOperationsStatus,
} from "./rfq-operations";

export function useRfqOperations(): OperationsAvailability {
  const [snapshot, setSnapshot] = useState(() =>
    synchronizeOperationsRefresh(null, Math.floor(Date.now() / 1_000)),
  );

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
        const observedNow = Math.floor(Date.now() / 1_000);
        currentStatus = next;
        currentNow = observedNow;
        setSnapshot(synchronizeOperationsRefresh(next, observedNow));
      } catch {
        if (!active) return;
        currentStatus = null;
        setSnapshot((current) =>
          synchronizeOperationsRefresh(null, current.now),
        );
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
      setSnapshot(synchronizeOperationsRefresh(currentStatus, nextNow));
    }, 1_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  return operationsAvailability(snapshot.status, snapshot.now);
}
