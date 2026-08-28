import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RfqEnvironmentBanner from "./RfqEnvironmentBanner";

describe("RfqEnvironmentBanner", () => {
  it("shows the shortened local runtime and explains restart isolation", () => {
    const html = renderToStaticMarkup(
      <RfqEnvironmentBanner
        providerIndex={3}
        runtimeEpoch="0123456789abcdef0123456789abcdef"
      />,
    );
    expect(html).toContain("Runtime 01234567");
    expect(html).toContain("prior-runtime records are intentionally isolated");
    expect(html).toContain("No automatic public fallback");
  });
});
