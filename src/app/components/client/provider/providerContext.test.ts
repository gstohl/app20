import { afterEach, describe, expect, it } from "vitest";
import { useFrontendProvider } from "./providerContext";

const originalIndex =
  useFrontendProvider.getState().currentFrontendProviderIndex;

afterEach(() => {
  useFrontendProvider.setState({
    currentFrontendProviderIndex: originalIndex,
  });
});

describe("frontend provider index updates", () => {
  it("does not notify or persist when the selected index is unchanged", () => {
    const current = useFrontendProvider.getState().currentFrontendProviderIndex;
    let notifications = 0;
    const stop = useFrontendProvider.subscribe(() => {
      notifications += 1;
    });
    useFrontendProvider.getState().setCurrentFrontendProviderIndex(current);
    stop();
    expect(notifications).toBe(0);
  });

  it("notifies once when the selected index changes", () => {
    const current = useFrontendProvider.getState().currentFrontendProviderIndex;
    const next = current === 2 ? 0 : 2;
    let notifications = 0;
    const stop = useFrontendProvider.subscribe(() => {
      notifications += 1;
    });
    useFrontendProvider.getState().setCurrentFrontendProviderIndex(next);
    stop();
    expect(notifications).toBe(1);
    expect(useFrontendProvider.getState().currentFrontendProviderIndex).toBe(
      next,
    );
  });
});
