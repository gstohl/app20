import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope } from "@/lib/envelope";
import ContactSnapshotCard from "./ContactSnapshotCard";
import { ChainRecordPanel } from "./ChainRecordPanel";
import type { LocalMailMessage } from "./message";

const message: LocalMailMessage = {
  id: "incoming:1",
  index: "1",
  plaintext: "Readable message body",
  envelope: decodeEnvelope(
    encodeEnvelope("text", { body: "Readable message body" }),
  ),
  record: {
    ephemeralPub: ["0x1", "0x2"],
    viewTag: 3,
    nonce: ["0x4", "0x5"],
    ciphertextFelts: ["0x6"],
  },
  transactionHash: "0x7",
  direction: "incoming",
};

describe("versioned backup cards", () => {
  it("renders RFQ pointer restore copy without changing legacy contact defaults", () => {
    const rfq = renderToStaticMarkup(
      <ContactSnapshotCard
        kind="rfq-resume"
        pointer
        onMerge={() => undefined}
      />,
    );
    expect(rfq).toContain("RFQ HISTORY BACKUP");
    expect(rfq).toContain("CID-verified");
    expect(rfq).toContain("Merge verified RFQ history");

    const legacy = renderToStaticMarkup(<ContactSnapshotCard />);
    expect(legacy).toContain("CONTACT BACKUP");
    expect(legacy).toContain("Unlock the mailbox");
  });
});

describe("mail chain evidence", () => {
  it("is collapsed by default", () => {
    const markup = renderToStaticMarkup(<ChainRecordPanel message={message} />);
    expect(markup).toContain("<details");
    expect(markup).not.toMatch(/<details[^>]* open/);
  });
});
