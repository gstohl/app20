import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type { WalletAccountV6 } from "starknet";
import { afterEach, describe, expect, it } from "vitest";
import type { Strk20Capability } from "@/lib/strk20";
import { useStoreWallet } from "./walletContext";

const capability: Strk20Capability = {
  supported: true,
  versionSupported: true,
  walletName: "Ready",
  walletApiVersions: ["0.10"],
  specVersions: ["0.10"],
  accountMethods: {
    strk20InvokeTransaction: true,
    strk20Balances: true,
  },
  missingMethods: [],
  declarationErrors: {},
};

const wallet = { name: "Ready" } as unknown as WalletWithStarknetFeatures;
const walletAccount = { address: "0xabc" } as unknown as WalletAccountV6;

afterEach(() => {
  useStoreWallet.getState().disconnect();
});

function countNotifications(run: () => void): number {
  let notifications = 0;
  const stop = useStoreWallet.subscribe(() => {
    notifications += 1;
  });
  run();
  stop();
  return notifications;
}

describe("wallet session store updates", () => {
  it("notifies once per field when the sequential connect setters run", () => {
    const notifications = countNotifications(() => {
      const state = useStoreWallet.getState();
      state.setMyStarknetWalletObject(wallet);
      state.setMyWalletAccount(walletAccount);
      state.setAddressAccount("0xabc");
      state.setChain("SN_SEPOLIA");
      state.setWalletApiList(["0.10"]);
      state.setStrk20Capability(capability);
      state.setStrk20Capable(true);
      state.setConnectionNotice("");
      state.setConnected(true);
    });
    expect(notifications).toBe(9);
  });

  it("applies a connected wallet snapshot in one notification", () => {
    const notifications = countNotifications(() => {
      useStoreWallet.getState().applyConnectedWallet({
        wallet,
        walletAccount,
        address: "0xabc",
        chain: "SN_SEPOLIA",
        capability,
      });
    });
    expect(notifications).toBe(1);
    expect(useStoreWallet.getState()).toMatchObject({
      StarknetWalletObject: wallet,
      myWalletAccount: walletAccount,
      address: "0xabc",
      chain: "SN_SEPOLIA",
      walletApiList: ["0.10"],
      strk20Capability: capability,
      isStrk20Capable: true,
      connectionNotice: "",
      isConnected: true,
    });
  });

  it("does not notify for an account switch that repeats address and chain", () => {
    useStoreWallet.getState().applyConnectedWallet({
      wallet,
      walletAccount,
      address: "0xabc",
      chain: "SN_SEPOLIA",
      capability,
    });
    const notifications = countNotifications(() => {
      useStoreWallet.getState().applyAccountSwitch({
        address: "0xabc",
        chain: "SN_SEPOLIA",
      });
    });
    expect(notifications).toBe(0);
  });

  it("notifies once when switching account and once when disconnecting with a notice", () => {
    useStoreWallet.getState().applyConnectedWallet({
      wallet,
      walletAccount,
      address: "0xabc",
      chain: "SN_SEPOLIA",
      capability,
    });
    const switchNotifications = countNotifications(() => {
      useStoreWallet.getState().applyAccountSwitch({
        address: "0xdef",
        chain: "SN_MAIN",
      });
    });
    expect(switchNotifications).toBe(1);
    expect(useStoreWallet.getState()).toMatchObject({
      address: "0xdef",
      chain: "SN_MAIN",
      isConnected: true,
    });

    const disconnectNotifications = countNotifications(() => {
      useStoreWallet
        .getState()
        .disconnect(
          "The wallet removed account access. Connect again to reopen this mailbox.",
        );
    });
    expect(disconnectNotifications).toBe(1);
    expect(useStoreWallet.getState()).toMatchObject({
      address: "",
      chain: "",
      isConnected: false,
      connectionNotice:
        "The wallet removed account access. Connect again to reopen this mailbox.",
      StarknetWalletObject: undefined,
    });
  });
});
