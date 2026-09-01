import { rfqAuthorityPresentation } from "../rfq-authority";
import type { RfqLifecycleRecord } from "../rfq-lifecycle";
import { useRfqPresentationClock } from "./rfq-presentation-clock";

/**
 * Recomputes displayed authority on each whole second only while a live
 * authoritative mark can still expire. Other rows do not subscribe.
 */
export function useRfqAuthorityPresentation(record: RfqLifecycleRecord) {
 const presentation = rfqAuthorityPresentation(record);
 useRfqPresentationClock(presentation.status === "authoritative");
 return presentation;
}
