export const POOL_FEE_TIERS = [5, 30, 100] as const;

export type PoolFeeBps = (typeof POOL_FEE_TIERS)[number];

export type PoolCreationDraft = Readonly<{
  tokenA: string;
  tokenB: string;
  feeBps: PoolFeeBps;
  initialPrice: string;
  tokenAInventory: string;
  tokenBInventory: string;
}>;

export type PoolCreationField =
  | "pair"
  | "feeBps"
  | "initialPrice"
  | "tokenAInventory"
  | "tokenBInventory";

export type PoolCreationReview = Readonly<{
  feeBps: PoolFeeBps;
  initialPrice: number;
  tokenAInventory: number;
  tokenBInventory: number;
  totalReferenceValueInTokenB: number;
}>;

export type PoolCreationValidation =
  | Readonly<{
      ok: true;
      review: PoolCreationReview;
      errors: Readonly<Partial<Record<PoolCreationField, string>>>;
    }>
  | Readonly<{
      ok: false;
      errors: Readonly<Partial<Record<PoolCreationField, string>>>;
    }>;

function parsePositiveDecimal(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function validatePoolCreationDraft(
  draft: PoolCreationDraft,
): PoolCreationValidation {
  const errors: Partial<Record<PoolCreationField, string>> = {};
  if (draft.tokenA.toLowerCase() === draft.tokenB.toLowerCase()) {
    errors.pair = "Choose two different tokens.";
  }
  if (!POOL_FEE_TIERS.includes(draft.feeBps)) {
    errors.feeBps = "Choose a supported fee tier.";
  }

  const initialPrice = parsePositiveDecimal(draft.initialPrice);
  const tokenAInventory = parsePositiveDecimal(draft.tokenAInventory);
  const tokenBInventory = parsePositiveDecimal(draft.tokenBInventory);
  if (initialPrice === null) {
    errors.initialPrice = "Enter a positive initial price.";
  }
  if (tokenAInventory === null) {
    errors.tokenAInventory = "Enter positive starting inventory.";
  }
  if (tokenBInventory === null) {
    errors.tokenBInventory = "Enter positive starting inventory.";
  }

  if (
    Object.keys(errors).length > 0 ||
    initialPrice === null ||
    tokenAInventory === null ||
    tokenBInventory === null
  ) {
    return { ok: false, errors };
  }

  const totalReferenceValueInTokenB =
    tokenAInventory * initialPrice + tokenBInventory;
  if (!Number.isFinite(totalReferenceValueInTokenB)) {
    return {
      ok: false,
      errors: { initialPrice: "The configured amounts are too large." },
    };
  }

  return {
    ok: true,
    errors,
    review: {
      feeBps: draft.feeBps,
      initialPrice,
      tokenAInventory,
      tokenBInventory,
      totalReferenceValueInTokenB,
    },
  };
}
