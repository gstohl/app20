import {
        rfqAuthorityPresentation,
        type RfqAuthorityPresentation,
} from "./rfq-authority";
import type { RfqLifecycleRecord } from "./rfq-lifecycle";
import styles from "./rfq.module.css";

export function AuthorityStrip({
        presentation,
        headingLevel = "h4",
}: {
        presentation: RfqAuthorityPresentation;
        headingLevel?: "h3" | "h4";
}) {
        const Heading = headingLevel;
        const critical =
                presentation.tone === "critical" ||
                presentation.tone === "warning";
        return (
                <div
                        className={styles.authorityStrip}
                        data-tone={presentation.tone}
                        role={critical ? "alert" : "status"}
                        aria-label={`Settlement authority: ${presentation.label}`}
                >
                        <Heading className={styles.authorityStripLabel}>
                                {presentation.label}
                        </Heading>
                        <p>{presentation.detail}</p>
                        <small>
                                Authority revision {presentation.revision} ·
                                answered{" "}
                                {presentation.observedAt
                                        ? new Date(
                                                  presentation.observedAt *
                                                          1_000,
                                          ).toISOString()
                                        : "never"}
                                {presentation.needsReconciliation
                                        ? " · value actions are blocked until this is reconciled"
                                        : ""}
                        </small>
                </div>
        );
}

export default function RfqAuthorityStrip({
        record,
        headingLevel,
}: {
        record: RfqLifecycleRecord;
        headingLevel?: "h3" | "h4";
}) {
        return (
                <AuthorityStrip
                        presentation={rfqAuthorityPresentation(record)}
                        headingLevel={headingLevel}
                />
        );
}
