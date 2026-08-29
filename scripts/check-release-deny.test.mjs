import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { checkReleaseDeny } from "./check-release-deny.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const validFiles = {
  "src/utils/constants.ts": `
    export const mailHelperSepolia = "0x0";
    export const mailHelperMainnet = "0x0";
    export const escrowHelperSepolia = "0x0";
    export const escrowHelperMainnet = "0x0";
  `,
  "workers/relay/src/index.ts":
    "export const RFQ_TRANSPORT_ENABLED = false as const;\n",
  "wrangler.jsonc": `{ // comments are permitted\n "vars": { "RFQ_TRANSPORT_ENABLED": "false" }\n}`,
  "src/app/rfq/production-private-intents.ts": `
    export const PRODUCTION_RFQ_TRANSPORT_ENABLED = false as const;
    export const PRODUCTION_RFQ_CAN_AUTHORIZE_VALUE = false as const;
    export const PRODUCTION_RFQ_PUBLIC_FALLBACK = false as const;
  `,
  "src/lib/settlement-receipt-chain.ts": `
    export async function executeConfiguredChainVerifier(): Promise<number> {
      throw new Error("Configured-chain receipt authority is unavailable until the runtime-provenanced server verifier is composed.");
    }
  `,
  "src/lib/sepolia-rfq-manifest.ts":
    "export function validateSepoliaRfqManifest(): boolean { return false; }\n",
  "src/lib/escrow-vnext.ts": `
    export const LOCALNET_ESCROW_V2_IS_VNEXT = false as const;
    export const ESCROW_VNEXT_ABI_EXPECTATION = {
      entrypoints: { privacyInvoke: { selector: null } },
      events: {
        Funded: { selector: null },
        Filled: { selector: null },
        Claimed: { selector: null },
        TimedOut: { selector: null },
      },
    };
  `,
  "src/lib/escrow-vnext-actions.ts": `
    function acceptedGeneratedOperation(_operation: unknown): readonly string[] {
      throw new Error("An accepted generated EscrowOperationV1 encoder is not configured.");
    }
  `,
  "src/lib/escrow-vnext-recovery.ts": `
    function assertConfiguredRecoveryAuthority(_authority: unknown): void {
      throw new Error("Configured VNext recovery authority is unavailable until trusted attempt, clock, and quorum-verifier adapters are composed.");
    }
  `,
  "deployments/sepolia/deployment-manifest.template.json": JSON.stringify({
    releaseReady: false,
    contracts: {},
  }),
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "app20-release-deny-"));
  roots.push(root);
  await mkdir(join(root, "scripts"), { recursive: true });
  for (const [path, contents] of Object.entries(validFiles)) {
    const destination = join(root, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents);
  }
  return root;
}

async function overwrite(root, path, contents) {
  await writeFile(join(root, path), contents);
}

test("accepts the exact structurally disabled policy fixture", async () => {
  assert.deepEqual(await checkReleaseDeny(await fixture()), []);
});

test("AST checks reject comment/string decoys for every TypeScript release gate", async () => {
  const mutations = [
    [
      "src/utils/constants.ts",
      `
      // export const mailHelperSepolia = "0x0";
      export const mailHelperSepolia = "0x1";
      export const mailHelperMainnet = "0x0";
      export const escrowHelperSepolia = "0x0";
      export const escrowHelperMainnet = "0x0";
    `,
      "mailHelperSepolia",
    ],
    [
      "workers/relay/src/index.ts",
      `
      const decoy = "export const RFQ_TRANSPORT_ENABLED = false as const;";
      export const RFQ_TRANSPORT_ENABLED = true as const;
    `,
      "RFQ_TRANSPORT_ENABLED",
    ],
    [
      "src/app/rfq/production-private-intents.ts",
      `
      // export const PRODUCTION_RFQ_TRANSPORT_ENABLED = false as const;
      export const PRODUCTION_RFQ_TRANSPORT_ENABLED = true as const;
    `,
      "PRODUCTION_RFQ_TRANSPORT_ENABLED",
    ],
    [
      "src/app/rfq/production-private-intents.ts",
      validFiles["src/app/rfq/production-private-intents.ts"].replace(
        "PRODUCTION_RFQ_CAN_AUTHORIZE_VALUE = false",
        "PRODUCTION_RFQ_CAN_AUTHORIZE_VALUE = true",
      ),
      "PRODUCTION_RFQ_CAN_AUTHORIZE_VALUE",
    ],
    [
      "src/app/rfq/production-private-intents.ts",
      validFiles["src/app/rfq/production-private-intents.ts"].replace(
        "PRODUCTION_RFQ_PUBLIC_FALLBACK = false",
        "PRODUCTION_RFQ_PUBLIC_FALLBACK = true",
      ),
      "PRODUCTION_RFQ_PUBLIC_FALLBACK",
    ],
    [
      "src/lib/settlement-receipt-chain.ts",
      `export async function executeConfiguredChainVerifier(): Promise<number> { return 1; }`,
      "executeConfiguredChainVerifier",
    ],
    [
      "src/lib/settlement-receipt-chain.ts",
      `${validFiles["src/lib/settlement-receipt-chain.ts"]}\nexport function createConfiguredChainVerifier() { return {}; }`,
      "constructor, composer, registration API",
    ],
    [
      "src/lib/sepolia-rfq-manifest.ts",
      `
      export function validateSepoliaRfqManifest(): boolean {
        const decoy = "return false;";
        return true;
      }
    `,
      "unconditional return false",
    ],
  ];
  for (const [path, contents, expected] of mutations) {
    const root = await fixture();
    await overwrite(root, path, contents);
    assert.match(
      (await checkReleaseDeny(root)).join("\n"),
      new RegExp(expected),
    );
  }
});

test("structural VNext checks reject activation of every fail-closed seam", async () => {
  const mutations = [
    [
      "src/lib/escrow-vnext.ts",
      validFiles["src/lib/escrow-vnext.ts"].replace(
        "LOCALNET_ESCROW_V2_IS_VNEXT = false",
        "LOCALNET_ESCROW_V2_IS_VNEXT = true",
      ),
      /LOCALNET_ESCROW_V2_IS_VNEXT/,
    ],
    [
      "src/lib/escrow-vnext.ts",
      validFiles["src/lib/escrow-vnext.ts"].replace(
        "Funded: { selector: null }",
        'Funded: { selector: "0x123" }',
      ),
      /selectors explicitly null/,
    ],
    [
      "src/lib/escrow-vnext-actions.ts",
      `function acceptedGeneratedOperation(): readonly string[] { return ["0x1"]; }`,
      /acceptedGeneratedOperation/,
    ],
    [
      "src/lib/escrow-vnext-recovery.ts",
      `function assertConfiguredRecoveryAuthority(): void { return; }`,
      /assertConfiguredRecoveryAuthority/,
    ],
  ];
  for (const [path, contents, expected] of mutations) {
    const root = await fixture();
    await overwrite(root, path, contents);
    assert.match((await checkReleaseDeny(root)).join("\n"), expected);
  }
});

test("structural JSONC checks reject effective enablement despite lexical false decoys", async () => {
  const root = await fixture();
  await overwrite(
    root,
    "wrangler.jsonc",
    `{
    // "RFQ_TRANSPORT_ENABLED": "false"
    "vars": { "RFQ_TRANSPORT_ENABLED": "true" },
    "decoy": { "RFQ_TRANSPORT_ENABLED": "false" }
  }`,
  );
  assert.match(
    (await checkReleaseDeny(root)).join("\n"),
    /every effective RFQ_TRANSPORT_ENABLED/,
  );
});

test("deployment template checks independently reject release readiness and mock references", async () => {
  const readyRoot = await fixture();
  await overwrite(
    readyRoot,
    "deployments/sepolia/deployment-manifest.template.json",
    JSON.stringify({ releaseReady: true }),
  );
  assert.match((await checkReleaseDeny(readyRoot)).join("\n"), /releaseReady/);

  const mockRoot = await fixture();
  await overwrite(
    mockRoot,
    "deployments/sepolia/deployment-manifest.template.json",
    JSON.stringify({ releaseReady: false, contract: "MockErc20" }),
  );
  assert.match((await checkReleaseDeny(mockRoot)).join("\n"), /MockErc20/);
});

test("lstat rejects present, dangling, and checked-source symlinks", async () => {
  const presentRoot = await fixture();
  await writeFile(
    join(presentRoot, "scripts/deploy-mail-mainnet.sh"),
    "exit 0\n",
  );
  assert.match(
    (await checkReleaseDeny(presentRoot)).join("\n"),
    /must remain absent/,
  );

  const danglingRoot = await fixture();
  await symlink(
    "missing-target",
    join(danglingRoot, "scripts/deploy-mail-mainnet.sh"),
  );
  assert.match(
    (await checkReleaseDeny(danglingRoot)).join("\n"),
    /must remain absent/,
  );

  const sourceRoot = await fixture();
  const relayPath = join(sourceRoot, "workers/relay/src/index.ts");
  await rm(relayPath);
  await symlink(join(sourceRoot, "src/utils/constants.ts"), relayPath);
  assert.match(
    (await checkReleaseDeny(sourceRoot)).join("\n"),
    /must not be a symbolic link/,
  );
});
