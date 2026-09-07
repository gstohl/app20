#!/usr/bin/env node
import { createRequire as app20CreateRequire } from 'node:module'; const require = app20CreateRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// scripts/starknet-maker.mjs
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, mkdirSync, fsyncSync } from "node:fs";
import { resolve, dirname } from "node:path";

// node_modules/@starknet-io/starknet-types-09/dist/esm/index.js
var esm_exports = {};
__export(esm_exports, {
  ABI_TYPE_CONSTRUCTOR: () => ABI_TYPE_CONSTRUCTOR,
  ABI_TYPE_ENUM: () => ABI_TYPE_ENUM,
  ABI_TYPE_FUNCTION: () => ABI_TYPE_FUNCTION,
  ABI_TYPE_L1_HANDLER: () => ABI_TYPE_L1_HANDLER,
  API: () => api_exports,
  CALL_TYPE: () => CALL_TYPE,
  CONTRACT: () => contract_exports,
  EBlockStatus: () => EBlockStatus,
  EBlockTag: () => EBlockTag,
  EDAMode: () => EDAMode,
  EDataAvailabilityMode: () => EDataAvailabilityMode,
  ESimulationFlag: () => ESimulationFlag,
  ETransactionExecutionStatus: () => ETransactionExecutionStatus,
  ETransactionFinalityStatus: () => ETransactionFinalityStatus,
  ETransactionStatus: () => ETransactionStatus,
  ETransactionType: () => ETransactionType,
  ETransactionVersion: () => ETransactionVersion,
  ETransactionVersion2: () => ETransactionVersion2,
  ETransactionVersion3: () => ETransactionVersion3,
  EVENT_ABI_TYPE: () => EVENT_ABI_TYPE,
  L1_DA_MODE: () => L1_DA_MODE,
  PAYMASTER_API: () => snip_29_exports,
  PRICE_UNIT_FRI: () => PRICE_UNIT_FRI,
  PRICE_UNIT_WEI: () => PRICE_UNIT_WEI,
  Permission: () => Permission,
  STATE_MUTABILITY_EXTERNAL: () => STATE_MUTABILITY_EXTERNAL,
  STATE_MUTABILITY_VIEW: () => STATE_MUTABILITY_VIEW,
  STATUS_ACCEPTED_ON_L1: () => STATUS_ACCEPTED_ON_L1,
  STATUS_ACCEPTED_ON_L2: () => STATUS_ACCEPTED_ON_L2,
  STATUS_CANDIDATE: () => STATUS_CANDIDATE,
  STATUS_PRE_CONFIRMED: () => STATUS_PRE_CONFIRMED,
  STATUS_PRE_CONFIRMED_LOWERCASE: () => STATUS_PRE_CONFIRMED_LOWERCASE,
  STATUS_RECEIVED: () => STATUS_RECEIVED,
  STATUS_REVERTED: () => STATUS_REVERTED,
  STATUS_SUCCEEDED: () => STATUS_SUCCEEDED,
  STRUCT_ABI_TYPE: () => STRUCT_ABI_TYPE,
  TXN_TYPE_DECLARE: () => TXN_TYPE_DECLARE,
  TXN_TYPE_DEPLOY: () => TXN_TYPE_DEPLOY,
  TXN_TYPE_DEPLOY_ACCOUNT: () => TXN_TYPE_DEPLOY_ACCOUNT,
  TXN_TYPE_INVOKE: () => TXN_TYPE_INVOKE,
  TXN_TYPE_L1_HANDLER: () => TXN_TYPE_L1_HANDLER,
  TypedDataRevision: () => TypedDataRevision,
  WALLET_API: () => wallet_api_exports
});

// node_modules/@starknet-io/starknet-types-09/dist/esm/api/index.js
var api_exports = {};
__export(api_exports, {
  ABI_TYPE_CONSTRUCTOR: () => ABI_TYPE_CONSTRUCTOR,
  ABI_TYPE_ENUM: () => ABI_TYPE_ENUM,
  ABI_TYPE_FUNCTION: () => ABI_TYPE_FUNCTION,
  ABI_TYPE_L1_HANDLER: () => ABI_TYPE_L1_HANDLER,
  CALL_TYPE: () => CALL_TYPE,
  CONTRACT: () => contract_exports,
  EBlockStatus: () => EBlockStatus,
  EBlockTag: () => EBlockTag,
  EDAMode: () => EDAMode,
  EDataAvailabilityMode: () => EDataAvailabilityMode,
  ESimulationFlag: () => ESimulationFlag,
  ETransactionExecutionStatus: () => ETransactionExecutionStatus,
  ETransactionFinalityStatus: () => ETransactionFinalityStatus,
  ETransactionStatus: () => ETransactionStatus,
  ETransactionType: () => ETransactionType,
  ETransactionVersion: () => ETransactionVersion,
  ETransactionVersion2: () => ETransactionVersion2,
  ETransactionVersion3: () => ETransactionVersion3,
  EVENT_ABI_TYPE: () => EVENT_ABI_TYPE,
  L1_DA_MODE: () => L1_DA_MODE,
  PRICE_UNIT_FRI: () => PRICE_UNIT_FRI,
  PRICE_UNIT_WEI: () => PRICE_UNIT_WEI,
  STATE_MUTABILITY_EXTERNAL: () => STATE_MUTABILITY_EXTERNAL,
  STATE_MUTABILITY_VIEW: () => STATE_MUTABILITY_VIEW,
  STATUS_ACCEPTED_ON_L1: () => STATUS_ACCEPTED_ON_L1,
  STATUS_ACCEPTED_ON_L2: () => STATUS_ACCEPTED_ON_L2,
  STATUS_CANDIDATE: () => STATUS_CANDIDATE,
  STATUS_PRE_CONFIRMED: () => STATUS_PRE_CONFIRMED,
  STATUS_PRE_CONFIRMED_LOWERCASE: () => STATUS_PRE_CONFIRMED_LOWERCASE,
  STATUS_RECEIVED: () => STATUS_RECEIVED,
  STATUS_REVERTED: () => STATUS_REVERTED,
  STATUS_SUCCEEDED: () => STATUS_SUCCEEDED,
  STRUCT_ABI_TYPE: () => STRUCT_ABI_TYPE,
  TXN_TYPE_DECLARE: () => TXN_TYPE_DECLARE,
  TXN_TYPE_DEPLOY: () => TXN_TYPE_DEPLOY,
  TXN_TYPE_DEPLOY_ACCOUNT: () => TXN_TYPE_DEPLOY_ACCOUNT,
  TXN_TYPE_INVOKE: () => TXN_TYPE_INVOKE,
  TXN_TYPE_L1_HANDLER: () => TXN_TYPE_L1_HANDLER
});

// node_modules/@starknet-io/starknet-types-09/dist/esm/api/contract.js
var contract_exports = {};

// node_modules/@starknet-io/starknet-types-09/dist/esm/api/constants.js
var STATUS_ACCEPTED_ON_L2 = "ACCEPTED_ON_L2";
var STATUS_ACCEPTED_ON_L1 = "ACCEPTED_ON_L1";
var STATUS_SUCCEEDED = "SUCCEEDED";
var STATUS_REVERTED = "REVERTED";
var STATUS_RECEIVED = "RECEIVED";
var STATUS_CANDIDATE = "CANDIDATE";
var STATUS_PRE_CONFIRMED = "PRE_CONFIRMED";
var STATUS_PRE_CONFIRMED_LOWERCASE = STATUS_PRE_CONFIRMED.toLowerCase();
var TXN_TYPE_DECLARE = "DECLARE";
var TXN_TYPE_DEPLOY = "DEPLOY";
var TXN_TYPE_DEPLOY_ACCOUNT = "DEPLOY_ACCOUNT";
var TXN_TYPE_INVOKE = "INVOKE";
var TXN_TYPE_L1_HANDLER = "L1_HANDLER";
var STRUCT_ABI_TYPE = "struct";
var EVENT_ABI_TYPE = "event";
var ABI_TYPE_FUNCTION = "function";
var ABI_TYPE_CONSTRUCTOR = "constructor";
var ABI_TYPE_L1_HANDLER = "l1_handler";
var ABI_TYPE_ENUM = "enum";
var STATE_MUTABILITY_VIEW = "view";
var STATE_MUTABILITY_EXTERNAL = "external";
var PRICE_UNIT_WEI = "WEI";
var PRICE_UNIT_FRI = "FRI";
var L1_DA_MODE = {
  BLOB: "BLOB",
  CALLDATA: "CALLDATA"
};
var CALL_TYPE = {
  DELEGATE: "DELEGATE",
  LIBRARY_CALL: "LIBRARY_CALL",
  CALL: "CALL"
};
var ETransactionType = {
  DECLARE: TXN_TYPE_DECLARE,
  DEPLOY: TXN_TYPE_DEPLOY,
  DEPLOY_ACCOUNT: TXN_TYPE_DEPLOY_ACCOUNT,
  INVOKE: TXN_TYPE_INVOKE,
  L1_HANDLER: TXN_TYPE_L1_HANDLER
};
var ESimulationFlag = {
  SKIP_VALIDATE: "SKIP_VALIDATE",
  SKIP_FEE_CHARGE: "SKIP_FEE_CHARGE"
};
var ETransactionStatus = {
  RECEIVED: STATUS_RECEIVED,
  CANDIDATE: STATUS_CANDIDATE,
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED,
  ACCEPTED_ON_L2: STATUS_ACCEPTED_ON_L2,
  ACCEPTED_ON_L1: STATUS_ACCEPTED_ON_L1
};
var ETransactionFinalityStatus = {
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED,
  ACCEPTED_ON_L2: STATUS_ACCEPTED_ON_L2,
  ACCEPTED_ON_L1: STATUS_ACCEPTED_ON_L1
};
var ETransactionExecutionStatus = {
  SUCCEEDED: STATUS_SUCCEEDED,
  REVERTED: STATUS_REVERTED
};
var EBlockTag = {
  /**
   * Tag `latest` refers to the latest Starknet block finalized by the consensus on L2.
   */
  LATEST: "latest",
  /**
   * Tag `pre_confirmed` refers to the block which is currently being built by the block proposer in height `latest` + 1.
   */
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED_LOWERCASE,
  /**
   * Tag `l1_accepted` refers to the latest Starknet block which was included in a state update on L1 and finalized by the consensus on L1.
   */
  L1_ACCEPTED: "l1_accepted"
};
var EBlockStatus = {
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED,
  ACCEPTED_ON_L2: STATUS_ACCEPTED_ON_L2,
  ACCEPTED_ON_L1: STATUS_ACCEPTED_ON_L1
};
var EDataAvailabilityMode = {
  L1: "L1",
  L2: "L2"
};
var EDAMode = {
  L1: 0,
  L2: 1
};
var ETransactionVersion = {
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V0: "0x0",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V1: "0x1",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V2: "0x2",
  V3: "0x3",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F0: "0x100000000000000000000000000000000",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F1: "0x100000000000000000000000000000001",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F2: "0x100000000000000000000000000000002",
  F3: "0x100000000000000000000000000000003"
};
var ETransactionVersion2 = {
  V0: ETransactionVersion.V0,
  V1: ETransactionVersion.V1,
  V2: ETransactionVersion.V2,
  F0: ETransactionVersion.F0,
  F1: ETransactionVersion.F1,
  F2: ETransactionVersion.F2
};
var ETransactionVersion3 = {
  V3: ETransactionVersion.V3,
  F3: ETransactionVersion.F3
};

// node_modules/@starknet-io/starknet-types-09/dist/esm/wallet-api/index.js
var wallet_api_exports = {};
__export(wallet_api_exports, {
  Permission: () => Permission,
  TypedDataRevision: () => TypedDataRevision
});

// node_modules/@starknet-io/starknet-types-09/dist/esm/wallet-api/constants.js
var Permission = {
  ACCOUNTS: "accounts"
};

// node_modules/@starknet-io/starknet-types-09/dist/esm/wallet-api/typedData.js
var TypedDataRevision = {
  ACTIVE: "1",
  LEGACY: "0"
};

// node_modules/@starknet-io/starknet-types-09/dist/esm/snip-29/index.js
var snip_29_exports = {};

// node_modules/@starknet-io/starknet-types-0103/dist/esm/index.js
var esm_exports2 = {};
__export(esm_exports2, {
  ABI_TYPE_CONSTRUCTOR: () => ABI_TYPE_CONSTRUCTOR2,
  ABI_TYPE_ENUM: () => ABI_TYPE_ENUM2,
  ABI_TYPE_FUNCTION: () => ABI_TYPE_FUNCTION2,
  ABI_TYPE_L1_HANDLER: () => ABI_TYPE_L1_HANDLER2,
  API: () => api_exports2,
  CALL_TYPE: () => CALL_TYPE2,
  CONTRACT: () => contract_exports2,
  EBlockStatus: () => EBlockStatus2,
  EBlockTag: () => EBlockTag2,
  EDAMode: () => EDAMode2,
  EDataAvailabilityMode: () => EDataAvailabilityMode2,
  ESimulationFlag: () => ESimulationFlag2,
  EStorageResponseFlag: () => EStorageResponseFlag,
  ESubscriptionTag: () => ESubscriptionTag,
  ETraceFlag: () => ETraceFlag,
  ETransactionExecutionStatus: () => ETransactionExecutionStatus2,
  ETransactionFinalityStatus: () => ETransactionFinalityStatus2,
  ETransactionStatus: () => ETransactionStatus2,
  ETransactionType: () => ETransactionType2,
  ETransactionVersion: () => ETransactionVersion4,
  ETransactionVersion2: () => ETransactionVersion22,
  ETransactionVersion3: () => ETransactionVersion32,
  ETxnResponseFlag: () => ETxnResponseFlag,
  EVENT_ABI_TYPE: () => EVENT_ABI_TYPE2,
  L1_DA_MODE: () => L1_DA_MODE2,
  PAYMASTER_API: () => snip_29_exports2,
  PRICE_UNIT_FRI: () => PRICE_UNIT_FRI2,
  PRICE_UNIT_WEI: () => PRICE_UNIT_WEI2,
  PROVING_API: () => proving_api_exports,
  Permission: () => Permission2,
  STATE_MUTABILITY_EXTERNAL: () => STATE_MUTABILITY_EXTERNAL2,
  STATE_MUTABILITY_VIEW: () => STATE_MUTABILITY_VIEW2,
  STATUS_ACCEPTED_ON_L1: () => STATUS_ACCEPTED_ON_L12,
  STATUS_ACCEPTED_ON_L2: () => STATUS_ACCEPTED_ON_L22,
  STATUS_CANDIDATE: () => STATUS_CANDIDATE2,
  STATUS_PRE_CONFIRMED: () => STATUS_PRE_CONFIRMED2,
  STATUS_PRE_CONFIRMED_LOWERCASE: () => STATUS_PRE_CONFIRMED_LOWERCASE2,
  STATUS_RECEIVED: () => STATUS_RECEIVED2,
  STATUS_REVERTED: () => STATUS_REVERTED2,
  STATUS_SUCCEEDED: () => STATUS_SUCCEEDED2,
  STRUCT_ABI_TYPE: () => STRUCT_ABI_TYPE2,
  TXN_TYPE_DECLARE: () => TXN_TYPE_DECLARE2,
  TXN_TYPE_DEPLOY: () => TXN_TYPE_DEPLOY2,
  TXN_TYPE_DEPLOY_ACCOUNT: () => TXN_TYPE_DEPLOY_ACCOUNT2,
  TXN_TYPE_INVOKE: () => TXN_TYPE_INVOKE2,
  TXN_TYPE_L1_HANDLER: () => TXN_TYPE_L1_HANDLER2,
  TypedDataRevision: () => TypedDataRevision2,
  WALLET_API: () => wallet_api_exports2
});

// node_modules/@starknet-io/starknet-types-0103/dist/esm/api/index.js
var api_exports2 = {};
__export(api_exports2, {
  ABI_TYPE_CONSTRUCTOR: () => ABI_TYPE_CONSTRUCTOR2,
  ABI_TYPE_ENUM: () => ABI_TYPE_ENUM2,
  ABI_TYPE_FUNCTION: () => ABI_TYPE_FUNCTION2,
  ABI_TYPE_L1_HANDLER: () => ABI_TYPE_L1_HANDLER2,
  CALL_TYPE: () => CALL_TYPE2,
  CONTRACT: () => contract_exports2,
  EBlockStatus: () => EBlockStatus2,
  EBlockTag: () => EBlockTag2,
  EDAMode: () => EDAMode2,
  EDataAvailabilityMode: () => EDataAvailabilityMode2,
  ESimulationFlag: () => ESimulationFlag2,
  EStorageResponseFlag: () => EStorageResponseFlag,
  ESubscriptionTag: () => ESubscriptionTag,
  ETraceFlag: () => ETraceFlag,
  ETransactionExecutionStatus: () => ETransactionExecutionStatus2,
  ETransactionFinalityStatus: () => ETransactionFinalityStatus2,
  ETransactionStatus: () => ETransactionStatus2,
  ETransactionType: () => ETransactionType2,
  ETransactionVersion: () => ETransactionVersion4,
  ETransactionVersion2: () => ETransactionVersion22,
  ETransactionVersion3: () => ETransactionVersion32,
  ETxnResponseFlag: () => ETxnResponseFlag,
  EVENT_ABI_TYPE: () => EVENT_ABI_TYPE2,
  L1_DA_MODE: () => L1_DA_MODE2,
  PRICE_UNIT_FRI: () => PRICE_UNIT_FRI2,
  PRICE_UNIT_WEI: () => PRICE_UNIT_WEI2,
  STATE_MUTABILITY_EXTERNAL: () => STATE_MUTABILITY_EXTERNAL2,
  STATE_MUTABILITY_VIEW: () => STATE_MUTABILITY_VIEW2,
  STATUS_ACCEPTED_ON_L1: () => STATUS_ACCEPTED_ON_L12,
  STATUS_ACCEPTED_ON_L2: () => STATUS_ACCEPTED_ON_L22,
  STATUS_CANDIDATE: () => STATUS_CANDIDATE2,
  STATUS_PRE_CONFIRMED: () => STATUS_PRE_CONFIRMED2,
  STATUS_PRE_CONFIRMED_LOWERCASE: () => STATUS_PRE_CONFIRMED_LOWERCASE2,
  STATUS_RECEIVED: () => STATUS_RECEIVED2,
  STATUS_REVERTED: () => STATUS_REVERTED2,
  STATUS_SUCCEEDED: () => STATUS_SUCCEEDED2,
  STRUCT_ABI_TYPE: () => STRUCT_ABI_TYPE2,
  TXN_TYPE_DECLARE: () => TXN_TYPE_DECLARE2,
  TXN_TYPE_DEPLOY: () => TXN_TYPE_DEPLOY2,
  TXN_TYPE_DEPLOY_ACCOUNT: () => TXN_TYPE_DEPLOY_ACCOUNT2,
  TXN_TYPE_INVOKE: () => TXN_TYPE_INVOKE2,
  TXN_TYPE_L1_HANDLER: () => TXN_TYPE_L1_HANDLER2
});

// node_modules/@starknet-io/starknet-types-0103/dist/esm/api/constants.js
var STATUS_ACCEPTED_ON_L22 = "ACCEPTED_ON_L2";
var STATUS_ACCEPTED_ON_L12 = "ACCEPTED_ON_L1";
var STATUS_SUCCEEDED2 = "SUCCEEDED";
var STATUS_REVERTED2 = "REVERTED";
var STATUS_RECEIVED2 = "RECEIVED";
var STATUS_CANDIDATE2 = "CANDIDATE";
var STATUS_PRE_CONFIRMED2 = "PRE_CONFIRMED";
var STATUS_PRE_CONFIRMED_LOWERCASE2 = STATUS_PRE_CONFIRMED2.toLowerCase();
var TXN_TYPE_DECLARE2 = "DECLARE";
var TXN_TYPE_DEPLOY2 = "DEPLOY";
var TXN_TYPE_DEPLOY_ACCOUNT2 = "DEPLOY_ACCOUNT";
var TXN_TYPE_INVOKE2 = "INVOKE";
var TXN_TYPE_L1_HANDLER2 = "L1_HANDLER";
var STRUCT_ABI_TYPE2 = "struct";
var EVENT_ABI_TYPE2 = "event";
var ABI_TYPE_FUNCTION2 = "function";
var ABI_TYPE_CONSTRUCTOR2 = "constructor";
var ABI_TYPE_L1_HANDLER2 = "l1_handler";
var ABI_TYPE_ENUM2 = "enum";
var STATE_MUTABILITY_VIEW2 = "view";
var STATE_MUTABILITY_EXTERNAL2 = "external";
var PRICE_UNIT_WEI2 = "WEI";
var PRICE_UNIT_FRI2 = "FRI";
var L1_DA_MODE2 = {
  BLOB: "BLOB",
  CALLDATA: "CALLDATA"
};
var CALL_TYPE2 = {
  DELEGATE: "DELEGATE",
  LIBRARY_CALL: "LIBRARY_CALL",
  CALL: "CALL"
};
var ETransactionType2 = {
  DECLARE: TXN_TYPE_DECLARE2,
  DEPLOY: TXN_TYPE_DEPLOY2,
  DEPLOY_ACCOUNT: TXN_TYPE_DEPLOY_ACCOUNT2,
  INVOKE: TXN_TYPE_INVOKE2,
  L1_HANDLER: TXN_TYPE_L1_HANDLER2
};
var ESimulationFlag2 = {
  SKIP_VALIDATE: "SKIP_VALIDATE",
  SKIP_FEE_CHARGE: "SKIP_FEE_CHARGE",
  RETURN_INITIAL_READS: "RETURN_INITIAL_READS"
};
var ETxnResponseFlag = {
  INCLUDE_PROOF_FACTS: "INCLUDE_PROOF_FACTS"
};
var ETraceFlag = {
  RETURN_INITIAL_READS: "RETURN_INITIAL_READS"
};
var EStorageResponseFlag = {
  INCLUDE_LAST_UPDATE_BLOCK: "INCLUDE_LAST_UPDATE_BLOCK"
};
var ESubscriptionTag = {
  INCLUDE_PROOF_FACTS: "INCLUDE_PROOF_FACTS"
};
var ETransactionStatus2 = {
  RECEIVED: STATUS_RECEIVED2,
  CANDIDATE: STATUS_CANDIDATE2,
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED2,
  ACCEPTED_ON_L2: STATUS_ACCEPTED_ON_L22,
  ACCEPTED_ON_L1: STATUS_ACCEPTED_ON_L12
};
var ETransactionFinalityStatus2 = {
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED2,
  ACCEPTED_ON_L2: STATUS_ACCEPTED_ON_L22,
  ACCEPTED_ON_L1: STATUS_ACCEPTED_ON_L12
};
var ETransactionExecutionStatus2 = {
  SUCCEEDED: STATUS_SUCCEEDED2,
  REVERTED: STATUS_REVERTED2
};
var EBlockTag2 = {
  /**
   * Tag `latest` refers to the latest Starknet block finalized by the consensus on L2.
   */
  LATEST: "latest",
  /**
   * Tag `pre_confirmed` refers to the block which is currently being built by the block proposer in height `latest` + 1.
   */
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED_LOWERCASE2,
  /**
   * Tag `l1_accepted` refers to the latest Starknet block which was included in a state update on L1 and finalized by the consensus on L1.
   */
  L1_ACCEPTED: "l1_accepted"
};
var EBlockStatus2 = {
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED2,
  ACCEPTED_ON_L2: STATUS_ACCEPTED_ON_L22,
  ACCEPTED_ON_L1: STATUS_ACCEPTED_ON_L12
};
var EDataAvailabilityMode2 = {
  L1: "L1",
  L2: "L2"
};
var EDAMode2 = {
  L1: 0,
  L2: 1
};
var ETransactionVersion4 = {
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V0: "0x0",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V1: "0x1",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V2: "0x2",
  V3: "0x3",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F0: "0x100000000000000000000000000000000",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F1: "0x100000000000000000000000000000001",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F2: "0x100000000000000000000000000000002",
  F3: "0x100000000000000000000000000000003"
};
var ETransactionVersion22 = {
  V0: ETransactionVersion4.V0,
  V1: ETransactionVersion4.V1,
  V2: ETransactionVersion4.V2,
  F0: ETransactionVersion4.F0,
  F1: ETransactionVersion4.F1,
  F2: ETransactionVersion4.F2
};
var ETransactionVersion32 = {
  V3: ETransactionVersion4.V3,
  F3: ETransactionVersion4.F3
};

// node_modules/@starknet-io/starknet-types-0103/dist/esm/api/contract.js
var contract_exports2 = {};

// node_modules/@starknet-io/starknet-types-0103/dist/esm/snip-29/index.js
var snip_29_exports2 = {};

// node_modules/@starknet-io/starknet-types-0103/dist/esm/proving-api/index.js
var proving_api_exports = {};

// node_modules/@starknet-io/starknet-types-0103/dist/esm/wallet-api/index.js
var wallet_api_exports2 = {};
__export(wallet_api_exports2, {
  Permission: () => Permission2,
  TypedDataRevision: () => TypedDataRevision2
});

// node_modules/@starknet-io/starknet-types-0103/dist/esm/wallet-api/constants.js
var Permission2 = {
  ACCOUNTS: "accounts"
};

// node_modules/@starknet-io/starknet-types-0103/dist/esm/wallet-api/typedData.js
var TypedDataRevision2 = {
  ACTIVE: "1",
  LEGACY: "0"
};

// node_modules/@scure/base/lib/esm/index.js
/*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function isArrayOf(isString2, arr) {
  if (!Array.isArray(arr))
    return false;
  if (arr.length === 0)
    return true;
  if (isString2) {
    return arr.every((item) => typeof item === "string");
  } else {
    return arr.every((item) => Number.isSafeInteger(item));
  }
}
function astr(label, input) {
  if (typeof input !== "string")
    throw new Error(`${label}: string expected`);
  return true;
}
function anumber(n) {
  if (!Number.isSafeInteger(n))
    throw new Error(`invalid integer: ${n}`);
}
function aArr(input) {
  if (!Array.isArray(input))
    throw new Error("array expected");
}
function astrArr(label, input) {
  if (!isArrayOf(true, input))
    throw new Error(`${label}: array of strings expected`);
}
function anumArr(label, input) {
  if (!isArrayOf(false, input))
    throw new Error(`${label}: array of numbers expected`);
}
// @__NO_SIDE_EFFECTS__
function chain(...args) {
  const id = (a) => a;
  const wrap = (a, b) => (c) => a(b(c));
  const encode = args.map((x) => x.encode).reduceRight(wrap, id);
  const decode = args.map((x) => x.decode).reduce(wrap, id);
  return { encode, decode };
}
// @__NO_SIDE_EFFECTS__
function alphabet(letters) {
  const lettersA = typeof letters === "string" ? letters.split("") : letters;
  const len = lettersA.length;
  astrArr("alphabet", lettersA);
  const indexes = new Map(lettersA.map((l, i) => [l, i]));
  return {
    encode: (digits) => {
      aArr(digits);
      return digits.map((i) => {
        if (!Number.isSafeInteger(i) || i < 0 || i >= len)
          throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${letters}`);
        return lettersA[i];
      });
    },
    decode: (input) => {
      aArr(input);
      return input.map((letter) => {
        astr("alphabet.decode", letter);
        const i = indexes.get(letter);
        if (i === void 0)
          throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
        return i;
      });
    }
  };
}
// @__NO_SIDE_EFFECTS__
function join(separator = "") {
  astr("join", separator);
  return {
    encode: (from) => {
      astrArr("join.decode", from);
      return from.join(separator);
    },
    decode: (to) => {
      astr("join.decode", to);
      return to.split(separator);
    }
  };
}
// @__NO_SIDE_EFFECTS__
function padding(bits, chr = "=") {
  anumber(bits);
  astr("padding", chr);
  return {
    encode(data) {
      astrArr("padding.encode", data);
      while (data.length * bits % 8)
        data.push(chr);
      return data;
    },
    decode(input) {
      astrArr("padding.decode", input);
      let end = input.length;
      if (end * bits % 8)
        throw new Error("padding: invalid, string should have whole number of bytes");
      for (; end > 0 && input[end - 1] === chr; end--) {
        const last = end - 1;
        const byte = last * bits;
        if (byte % 8 === 0)
          throw new Error("padding: invalid, string has too much padding");
      }
      return input.slice(0, end);
    }
  };
}
var gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
var radix2carry = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd(from, to));
var powers = /* @__PURE__ */ (() => {
  let res = [];
  for (let i = 0; i < 40; i++)
    res.push(2 ** i);
  return res;
})();
function convertRadix2(data, from, to, padding2) {
  aArr(data);
  if (from <= 0 || from > 32)
    throw new Error(`convertRadix2: wrong from=${from}`);
  if (to <= 0 || to > 32)
    throw new Error(`convertRadix2: wrong to=${to}`);
  if (/* @__PURE__ */ radix2carry(from, to) > 32) {
    throw new Error(`convertRadix2: carry overflow from=${from} to=${to} carryBits=${/* @__PURE__ */ radix2carry(from, to)}`);
  }
  let carry = 0;
  let pos = 0;
  const max = powers[from];
  const mask = powers[to] - 1;
  const res = [];
  for (const n of data) {
    anumber(n);
    if (n >= max)
      throw new Error(`convertRadix2: invalid data word=${n} from=${from}`);
    carry = carry << from | n;
    if (pos + from > 32)
      throw new Error(`convertRadix2: carry overflow pos=${pos} from=${from}`);
    pos += from;
    for (; pos >= to; pos -= to)
      res.push((carry >> pos - to & mask) >>> 0);
    const pow3 = powers[pos];
    if (pow3 === void 0)
      throw new Error("invalid carry");
    carry &= pow3 - 1;
  }
  carry = carry << to - pos & mask;
  if (!padding2 && pos >= from)
    throw new Error("Excess padding");
  if (!padding2 && carry > 0)
    throw new Error(`Non-zero padding: ${carry}`);
  if (padding2 && pos > 0)
    res.push(carry >>> 0);
  return res;
}
// @__NO_SIDE_EFFECTS__
function radix2(bits, revPadding = false) {
  anumber(bits);
  if (bits <= 0 || bits > 32)
    throw new Error("radix2: bits should be in (0..32]");
  if (/* @__PURE__ */ radix2carry(8, bits) > 32 || /* @__PURE__ */ radix2carry(bits, 8) > 32)
    throw new Error("radix2: carry overflow");
  return {
    encode: (bytes) => {
      if (!isBytes(bytes))
        throw new Error("radix2.encode input should be Uint8Array");
      return convertRadix2(Array.from(bytes), 8, bits, !revPadding);
    },
    decode: (digits) => {
      anumArr("radix2.decode", digits);
      return Uint8Array.from(convertRadix2(digits, bits, 8, revPadding));
    }
  };
}
var hasBase64Builtin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toBase64 === "function" && typeof Uint8Array.fromBase64 === "function")();
var decodeBase64Builtin = (s, isUrl) => {
  astr("base64", s);
  const re = isUrl ? /^[A-Za-z0-9=_-]+$/ : /^[A-Za-z0-9=+/]+$/;
  const alphabet2 = isUrl ? "base64url" : "base64";
  if (s.length > 0 && !re.test(s))
    throw new Error("invalid base64");
  return Uint8Array.fromBase64(s, { alphabet: alphabet2, lastChunkHandling: "strict" });
};
var base64 = hasBase64Builtin ? {
  encode(b) {
    abytes(b);
    return b.toBase64();
  },
  decode(s) {
    return decodeBase64Builtin(s, false);
  }
} : /* @__PURE__ */ chain(/* @__PURE__ */ radix2(6), /* @__PURE__ */ alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), /* @__PURE__ */ padding(6), /* @__PURE__ */ join(""));

// node_modules/lossless-json/lib/esm/utils.js
function isInteger(value) {
  return INTEGER_REGEX.test(value);
}
var INTEGER_REGEX = /^-?[0-9]+$/;
function isNumber(value) {
  return NUMBER_REGEX.test(value);
}
var NUMBER_REGEX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
function isSafeNumber(value, config4) {
  if (isInteger(value)) {
    return Number.isSafeInteger(Number.parseInt(value, 10));
  }
  const num = Number.parseFloat(value);
  const parsed = String(num);
  if (value === parsed) {
    return true;
  }
  const valueDigits = extractSignificantDigits(value);
  const parsedDigits = extractSignificantDigits(parsed);
  if (valueDigits === parsedDigits) {
    return true;
  }
  if (config4?.approx === true) {
    const requiredDigits = 14;
    if (!isInteger(value) && parsedDigits.length >= requiredDigits && valueDigits.startsWith(parsedDigits.substring(0, requiredDigits))) {
      return true;
    }
  }
  return false;
}
var UnsafeNumberReason = /* @__PURE__ */ (function(UnsafeNumberReason2) {
  UnsafeNumberReason2["underflow"] = "underflow";
  UnsafeNumberReason2["overflow"] = "overflow";
  UnsafeNumberReason2["truncate_integer"] = "truncate_integer";
  UnsafeNumberReason2["truncate_float"] = "truncate_float";
  return UnsafeNumberReason2;
})({});
function getUnsafeNumberReason(value) {
  if (isSafeNumber(value, {
    approx: false
  })) {
    return void 0;
  }
  if (isInteger(value)) {
    return UnsafeNumberReason.truncate_integer;
  }
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) {
    return UnsafeNumberReason.overflow;
  }
  if (num === 0) {
    return UnsafeNumberReason.underflow;
  }
  return UnsafeNumberReason.truncate_float;
}
function extractSignificantDigits(value) {
  const {
    start,
    end
  } = getSignificantDigitRange(value);
  const digits = value.substring(start, end);
  const dot = digits.indexOf(".");
  if (dot === -1) {
    return digits;
  }
  return digits.substring(0, dot) + digits.substring(dot + 1);
}
function getSignificantDigitRange(value) {
  let start = 0;
  if (value[0] === "-") {
    start++;
  }
  while (value[start] === "0" || value[start] === ".") {
    start++;
  }
  let end = value.lastIndexOf("e");
  if (end === -1) {
    end = value.lastIndexOf("E");
  }
  if (end === -1) {
    end = value.length;
  }
  while ((value[end - 1] === "0" || value[end - 1] === ".") && end > start) {
    end--;
  }
  return {
    start,
    end
  };
}

// node_modules/lossless-json/lib/esm/LosslessNumber.js
var LosslessNumber = class {
  // numeric value as string
  // type information
  isLosslessNumber = true;
  constructor(value) {
    if (!isNumber(value)) {
      throw new Error(`Invalid number (value: "${value}")`);
    }
    this.value = value;
  }
  /**
   * Get the value of the LosslessNumber as number or bigint.
   *
   * - a number is returned for safe numbers and decimal values that only lose some insignificant digits
   * - a bigint is returned for big integer numbers
   * - an Error is thrown for values that will overflow or underflow
   *
   * Note that you can implement your own strategy for conversion by just getting the value as string
   * via .toString(), and using util functions like isInteger, isSafeNumber, getUnsafeNumberReason,
   * and toSafeNumberOrThrow to convert it to a numeric value.
   */
  valueOf() {
    const unsafeReason = getUnsafeNumberReason(this.value);
    if (unsafeReason === void 0 || unsafeReason === UnsafeNumberReason.truncate_float) {
      return Number.parseFloat(this.value);
    }
    if (isInteger(this.value)) {
      return BigInt(this.value);
    }
    throw new Error(`Cannot safely convert to number: the value '${this.value}' would ${unsafeReason} and become ${Number.parseFloat(this.value)}`);
  }
  /**
   * Get the value of the LosslessNumber as string.
   */
  toString() {
    return this.value;
  }
  // Note: we do NOT implement a .toJSON() method, and you should not implement
  // or use that, it cannot safely turn the numeric value in the string into
  // stringified JSON since it has to be parsed into a number first.
};
function isLosslessNumber(value) {
  return value && typeof value === "object" && value.isLosslessNumber || false;
}

// node_modules/lossless-json/lib/esm/numberParsers.js
function parseLosslessNumber(value) {
  return new LosslessNumber(value);
}
function parseNumberAndBigInt(value) {
  return isInteger(value) ? BigInt(value) : Number.parseFloat(value);
}

// node_modules/lossless-json/lib/esm/revive.js
function revive(json, reviver) {
  return reviveValue({
    "": json
  }, "", json, reviver);
}
function reviveValue(context, key, value, reviver) {
  if (Array.isArray(value)) {
    return reviver.call(context, key, reviveArray(value, reviver));
  }
  if (value && typeof value === "object" && !isLosslessNumber(value)) {
    return reviver.call(context, key, reviveObject(value, reviver));
  }
  return reviver.call(context, key, value);
}
function reviveObject(object, reviver) {
  for (const key of Object.keys(object)) {
    const value = reviveValue(object, key, object[key], reviver);
    if (value !== void 0) {
      object[key] = value;
    } else {
      delete object[key];
    }
  }
  return object;
}
function reviveArray(array, reviver) {
  for (let i = 0; i < array.length; i++) {
    array[i] = reviveValue(array, String(i), array[i], reviver);
  }
  return array;
}

// node_modules/lossless-json/lib/esm/parse.js
function parse(text, reviver, options) {
  const optionsObj = typeof options === "function" ? {
    parseNumber: options
  } : options;
  const parseNumber = optionsObj?.parseNumber ?? parseLosslessNumber;
  const onDuplicateKey = optionsObj?.onDuplicateKey ?? throwDuplicateKey;
  let i = 0;
  const value = parseValue();
  expectValue(value);
  expectEndOfInput();
  return reviver ? revive(value, reviver) : value;
  function parseObject() {
    if (text.charCodeAt(i) === codeOpeningBrace) {
      i++;
      skipWhitespace();
      const object = {};
      let initial = true;
      while (i < text.length && text.charCodeAt(i) !== codeClosingBrace) {
        if (!initial) {
          eatComma();
          skipWhitespace();
        } else {
          initial = false;
        }
        const start = i;
        const key = parseString();
        if (key === void 0) {
          throwObjectKeyExpected();
          return;
        }
        skipWhitespace();
        eatColon();
        const value2 = parseValue();
        if (value2 === void 0) {
          throwObjectValueExpected();
          return;
        }
        if (Object.prototype.hasOwnProperty.call(object, key) && !isDeepEqual(value2, object[key])) {
          const returnedValue = onDuplicateKey({
            key,
            position: start + 1,
            oldValue: object[key],
            newValue: value2
          });
          if (returnedValue !== void 0) {
            object[key] = returnedValue;
          }
        } else {
          object[key] = value2;
        }
      }
      if (text.charCodeAt(i) !== codeClosingBrace) {
        throwObjectKeyOrEndExpected();
      }
      i++;
      return object;
    }
  }
  function parseArray() {
    if (text.charCodeAt(i) === codeOpeningBracket) {
      i++;
      skipWhitespace();
      const array = [];
      let initial = true;
      while (i < text.length && text.charCodeAt(i) !== codeClosingBracket) {
        if (!initial) {
          eatComma();
        } else {
          initial = false;
        }
        const value2 = parseValue();
        expectArrayItem(value2);
        array.push(value2);
      }
      if (text.charCodeAt(i) !== codeClosingBracket) {
        throwArrayItemOrEndExpected();
      }
      i++;
      return array;
    }
  }
  function parseValue() {
    skipWhitespace();
    const value2 = parseString() ?? parseNumeric() ?? parseObject() ?? parseArray() ?? parseKeyword("true", true) ?? parseKeyword("false", false) ?? parseKeyword("null", null);
    skipWhitespace();
    return value2;
  }
  function parseKeyword(name, value2) {
    if (text.slice(i, i + name.length) === name) {
      i += name.length;
      return value2;
    }
  }
  function skipWhitespace() {
    while (isWhitespace(text.charCodeAt(i))) {
      i++;
    }
  }
  function parseString() {
    if (text.charCodeAt(i) === codeDoubleQuote) {
      i++;
      let result = "";
      while (i < text.length && text.charCodeAt(i) !== codeDoubleQuote) {
        if (text.charCodeAt(i) === codeBackslash) {
          const char = text[i + 1];
          const escapeChar = escapeCharacters[char];
          if (escapeChar !== void 0) {
            result += escapeChar;
            i++;
          } else if (char === "u") {
            if (isHex(text.charCodeAt(i + 2)) && isHex(text.charCodeAt(i + 3)) && isHex(text.charCodeAt(i + 4)) && isHex(text.charCodeAt(i + 5))) {
              result += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16));
              i += 5;
            } else {
              throwInvalidUnicodeCharacter(i);
            }
          } else {
            throwInvalidEscapeCharacter(i);
          }
        } else {
          if (isValidStringCharacter(text.charCodeAt(i))) {
            result += text[i];
          } else {
            throwInvalidCharacter(text[i]);
          }
        }
        i++;
      }
      expectEndOfString();
      i++;
      return result;
    }
  }
  function parseNumeric() {
    const start = i;
    if (text.charCodeAt(i) === codeMinus) {
      i++;
      expectDigit(start);
    }
    if (text.charCodeAt(i) === codeZero) {
      i++;
    } else if (isNonZeroDigit(text.charCodeAt(i))) {
      i++;
      while (isDigit(text.charCodeAt(i))) {
        i++;
      }
    }
    if (text.charCodeAt(i) === codeDot) {
      i++;
      expectDigit(start);
      while (isDigit(text.charCodeAt(i))) {
        i++;
      }
    }
    if (text.charCodeAt(i) === codeLowercaseE || text.charCodeAt(i) === codeUppercaseE) {
      i++;
      if (text.charCodeAt(i) === codeMinus || text.charCodeAt(i) === codePlus) {
        i++;
      }
      expectDigit(start);
      while (isDigit(text.charCodeAt(i))) {
        i++;
      }
    }
    if (i > start) {
      return parseNumber(text.slice(start, i));
    }
  }
  function eatComma() {
    if (text.charCodeAt(i) !== codeComma) {
      throw new SyntaxError(`Comma ',' expected after value ${gotAt()}`);
    }
    i++;
  }
  function eatColon() {
    if (text.charCodeAt(i) !== codeColon) {
      throw new SyntaxError(`Colon ':' expected after property name ${gotAt()}`);
    }
    i++;
  }
  function expectValue(value2) {
    if (value2 === void 0) {
      throw new SyntaxError(`JSON value expected ${gotAt()}`);
    }
  }
  function expectArrayItem(value2) {
    if (value2 === void 0) {
      throw new SyntaxError(`Array item expected ${gotAt()}`);
    }
  }
  function expectEndOfInput() {
    if (i < text.length) {
      throw new SyntaxError(`Expected end of input ${gotAt()}`);
    }
  }
  function expectDigit(start) {
    if (!isDigit(text.charCodeAt(i))) {
      const numSoFar = text.slice(start, i);
      throw new SyntaxError(`Invalid number '${numSoFar}', expecting a digit ${gotAt()}`);
    }
  }
  function expectEndOfString() {
    if (text.charCodeAt(i) !== codeDoubleQuote) {
      throw new SyntaxError(`End of string '"' expected ${gotAt()}`);
    }
  }
  function throwObjectKeyExpected() {
    throw new SyntaxError(`Quoted object key expected ${gotAt()}`);
  }
  function throwDuplicateKey(_ref) {
    let {
      key,
      position
    } = _ref;
    throw new SyntaxError(`Duplicate key '${key}' encountered at position ${position}`);
  }
  function throwObjectKeyOrEndExpected() {
    throw new SyntaxError(`Quoted object key or end of object '}' expected ${gotAt()}`);
  }
  function throwArrayItemOrEndExpected() {
    throw new SyntaxError(`Array item or end of array ']' expected ${gotAt()}`);
  }
  function throwInvalidCharacter(char) {
    throw new SyntaxError(`Invalid character '${char}' ${pos()}`);
  }
  function throwInvalidEscapeCharacter(start) {
    const chars = text.slice(start, start + 2);
    throw new SyntaxError(`Invalid escape character '${chars}' ${pos()}`);
  }
  function throwObjectValueExpected() {
    throw new SyntaxError(`Object value expected after ':' ${pos()}`);
  }
  function throwInvalidUnicodeCharacter(start) {
    const chars = text.slice(start, start + 6);
    throw new SyntaxError(`Invalid unicode character '${chars}' ${pos()}`);
  }
  function pos() {
    return `at position ${i}`;
  }
  function got() {
    return i < text.length ? `but got '${text[i]}'` : "but reached end of input";
  }
  function gotAt() {
    return `${got()} ${pos()}`;
  }
}
function isWhitespace(code) {
  return code === codeSpace || code === codeNewline || code === codeTab || code === codeReturn;
}
function isHex(code) {
  return code >= codeZero && code <= codeNine || code >= codeUppercaseA && code <= codeUppercaseF || code >= codeLowercaseA && code <= codeLowercaseF;
}
function isDigit(code) {
  return code >= codeZero && code <= codeNine;
}
function isNonZeroDigit(code) {
  return code >= codeOne && code <= codeNine;
}
function isValidStringCharacter(code) {
  return code >= 32 && code <= 1114111;
}
function isDeepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isDeepEqual(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = [.../* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.every((key) => isDeepEqual(a[key], b[key]));
  }
  return false;
}
function isObject(value) {
  return typeof value === "object" && value !== null;
}
var escapeCharacters = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
  // note that \u is handled separately in parseString()
};
var codeBackslash = 92;
var codeOpeningBrace = 123;
var codeClosingBrace = 125;
var codeOpeningBracket = 91;
var codeClosingBracket = 93;
var codeSpace = 32;
var codeNewline = 10;
var codeTab = 9;
var codeReturn = 13;
var codeDoubleQuote = 34;
var codePlus = 43;
var codeMinus = 45;
var codeZero = 48;
var codeOne = 49;
var codeNine = 57;
var codeComma = 44;
var codeDot = 46;
var codeColon = 58;
var codeUppercaseA = 65;
var codeLowercaseA = 97;
var codeUppercaseE = 69;
var codeLowercaseE = 101;
var codeUppercaseF = 70;
var codeLowercaseF = 102;

// node_modules/lossless-json/lib/esm/stringify.js
function stringify(value, replacer, space, numberStringifiers) {
  const resolvedSpace = resolveSpace(space);
  const replacedValue = typeof replacer === "function" ? replacer.call({
    "": value
  }, "", value) : value;
  return stringifyValue(replacedValue, "");
  function stringifyValue(value2, indent) {
    if (Array.isArray(numberStringifiers)) {
      const stringifier = numberStringifiers.find((item) => item.test(value2));
      if (stringifier) {
        const str = stringifier.stringify(value2);
        if (typeof str !== "string" || !isNumber(str)) {
          throw new Error(`Invalid JSON number: output of a number stringifier must be a string containing a JSON number (output: ${str})`);
        }
        return str;
      }
    }
    if (typeof value2 === "boolean" || typeof value2 === "number" || typeof value2 === "string" || value2 === null || value2 instanceof Date || value2 instanceof Boolean || value2 instanceof Number || value2 instanceof String) {
      return JSON.stringify(value2);
    }
    if (value2?.isLosslessNumber) {
      return value2.toString();
    }
    if (typeof value2 === "bigint") {
      return value2.toString();
    }
    if (Array.isArray(value2)) {
      return stringifyArray(value2, indent);
    }
    if (value2 && typeof value2 === "object") {
      return stringifyObject(value2, indent);
    }
    return void 0;
  }
  function stringifyArray(array, indent) {
    if (array.length === 0) {
      return "[]";
    }
    const childIndent = resolvedSpace ? indent + resolvedSpace : void 0;
    let str = resolvedSpace ? "[\n" : "[";
    for (let i = 0; i < array.length; i++) {
      const item = typeof replacer === "function" ? replacer.call(array, String(i), array[i]) : array[i];
      if (resolvedSpace) {
        str += childIndent;
      }
      if (typeof item !== "undefined" && typeof item !== "function") {
        str += stringifyValue(item, childIndent);
      } else {
        str += "null";
      }
      if (i < array.length - 1) {
        str += resolvedSpace ? ",\n" : ",";
      }
    }
    str += resolvedSpace ? `
${indent}]` : "]";
    return str;
  }
  function stringifyObject(object, indent) {
    if (typeof object.toJSON === "function") {
      return stringify(object.toJSON(), replacer, space, void 0);
    }
    const keys = Array.isArray(replacer) ? replacer.map(String) : Object.keys(object);
    if (keys.length === 0) {
      return "{}";
    }
    const childIndent = resolvedSpace ? indent + resolvedSpace : void 0;
    let first = true;
    let str = resolvedSpace ? "{\n" : "{";
    for (const key of keys) {
      const value2 = typeof replacer === "function" ? replacer.call(object, key, object[key]) : object[key];
      if (includeProperty(key, value2)) {
        if (first) {
          first = false;
        } else {
          str += resolvedSpace ? ",\n" : ",";
        }
        const keyStr = JSON.stringify(key);
        str += resolvedSpace ? `${childIndent + keyStr}: ` : `${keyStr}:`;
        str += stringifyValue(value2, childIndent);
      }
    }
    str += resolvedSpace ? `
${indent}}` : "}";
    return str;
  }
  function includeProperty(_key, value2) {
    return typeof value2 !== "undefined" && typeof value2 !== "function" && typeof value2 !== "symbol";
  }
}
function resolveSpace(space) {
  if (typeof space === "number") {
    return " ".repeat(space);
  }
  if (typeof space === "string" && space !== "") {
    return space;
  }
  return void 0;
}

// node_modules/starknet/node_modules/@noble/curves/esm/abstract/utils.js
var utils_exports = {};
__export(utils_exports, {
  aInRange: () => aInRange,
  abool: () => abool,
  abytes: () => abytes2,
  bitGet: () => bitGet,
  bitLen: () => bitLen,
  bitMask: () => bitMask,
  bitSet: () => bitSet,
  bytesToHex: () => bytesToHex,
  bytesToNumberBE: () => bytesToNumberBE,
  bytesToNumberLE: () => bytesToNumberLE,
  concatBytes: () => concatBytes,
  createHmacDrbg: () => createHmacDrbg,
  ensureBytes: () => ensureBytes,
  equalBytes: () => equalBytes,
  hexToBytes: () => hexToBytes,
  hexToNumber: () => hexToNumber,
  inRange: () => inRange,
  isBytes: () => isBytes2,
  memoized: () => memoized,
  notImplemented: () => notImplemented,
  numberToBytesBE: () => numberToBytesBE,
  numberToBytesLE: () => numberToBytesLE,
  numberToHexUnpadded: () => numberToHexUnpadded,
  numberToVarBytesBE: () => numberToVarBytesBE,
  utf8ToBytes: () => utf8ToBytes,
  validateObject: () => validateObject
});
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes2(item) {
  if (!isBytes2(item))
    throw new Error("Uint8Array expected");
}
function abool(title, value) {
  if (typeof value !== "boolean")
    throw new Error(title + " boolean expected, got " + value);
}
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes2(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function numberToHexUnpadded(num) {
  const hex = num.toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  abytes2(bytes);
  return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
  return hexToBytes(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function numberToVarBytesBE(n) {
  return hexToBytes(numberToHexUnpadded(n));
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes2(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes2(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function equalBytes(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
function bitGet(n, pos) {
  return n >> BigInt(pos) & _1n;
}
function bitSet(n, pos, value) {
  return n | (value ? _1n : _0n) << BigInt(pos);
}
var bitMask = (n) => (_2n << BigInt(n - 1)) - _1n;
var u8n = (data) => new Uint8Array(data);
var u8fr = (arr) => Uint8Array.from(arr);
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  if (typeof hashLen !== "number" || hashLen < 2)
    throw new Error("hashLen must be a number");
  if (typeof qByteLen !== "number" || qByteLen < 2)
    throw new Error("qByteLen must be a number");
  if (typeof hmacFn !== "function")
    throw new Error("hmacFn must be a function");
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...b) => hmacFn(k, v, ...b);
  const reseed = (seed = u8n()) => {
    k = h(u8fr([0]), seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(u8fr([1]), seed);
    v = h();
  };
  const gen3 = () => {
    if (i++ >= 1e3)
      throw new Error("drbg: tried 1000 values");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while (!(res = pred(gen3())))
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
var validatorFns = {
  bigint: (val) => typeof val === "bigint",
  function: (val) => typeof val === "function",
  boolean: (val) => typeof val === "boolean",
  string: (val) => typeof val === "string",
  stringOrUint8Array: (val) => typeof val === "string" || isBytes2(val),
  isSafeInteger: (val) => Number.isSafeInteger(val),
  array: (val) => Array.isArray(val),
  field: (val, object) => object.Fp.isValid(val),
  hash: (val) => typeof val === "function" && Number.isSafeInteger(val.outputLen)
};
function validateObject(object, validators, optValidators = {}) {
  const checkField = (fieldName, type, isOptional) => {
    const checkVal = validatorFns[type];
    if (typeof checkVal !== "function")
      throw new Error("invalid validator function");
    const val = object[fieldName];
    if (isOptional && val === void 0)
      return;
    if (!checkVal(val, object)) {
      throw new Error("param " + String(fieldName) + " is invalid. Expected " + type + ", got " + val);
    }
  };
  for (const [fieldName, type] of Object.entries(validators))
    checkField(fieldName, type, false);
  for (const [fieldName, type] of Object.entries(optValidators))
    checkField(fieldName, type, true);
  return object;
}
var notImplemented = () => {
  throw new Error("not implemented");
};
function memoized(fn) {
  const map = /* @__PURE__ */ new WeakMap();
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== void 0)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// node_modules/starknet/node_modules/@noble/hashes/esm/_assert.js
function anumber2(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function isBytes3(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes3(b, ...lengths) {
  if (!isBytes3(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes3(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}

// node_modules/starknet/node_modules/@noble/hashes/esm/utils.js
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var u32 = (arr) => new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
var createView = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
var rotr = (word, shift) => word << 32 - shift | word >>> shift;
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
var byteSwap = (word) => word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
var byteSwapIfBE = isLE ? (n) => n : (n) => byteSwap(n);
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
}
function utf8ToBytes2(str) {
  if (typeof str !== "string")
    throw new Error("utf8ToBytes expected string, got " + typeof str);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes2(data);
  abytes3(data);
  return data;
}
var Hash = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
function wrapConstructor(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function wrapConstructorWithOpts(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}
function wrapXOFConstructorWithOpts(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}

// node_modules/starknet/node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE4) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE4);
  const _32n4 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n4 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE4 ? 4 : 0;
  const l = isLE4 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE4);
  view.setUint32(byteOffset + l, wl, isLE4);
}
var Chi = (a, b, c) => a & b ^ ~a & c;
var Maj = (a, b, c) => a & b ^ a & c ^ b & c;
var HashMD = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE4) {
    super();
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE4;
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    const { view, buffer, blockLen } = this;
    data = toBytes(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE4 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    this.buffer.subarray(pos).fill(0);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE4);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state2 = this.get();
    if (outLen > state2.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state2[i], isLE4);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.length = length;
    to.pos = pos;
    to.finished = finished;
    to.destroyed = destroyed;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
};

// node_modules/starknet/node_modules/@noble/hashes/esm/sha256.js
var SHA256_K = /* @__PURE__ */ new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_IV = /* @__PURE__ */ new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends HashMD {
  constructor() {
    super(64, 32, 8, false);
    this.A = SHA256_IV[0] | 0;
    this.B = SHA256_IV[1] | 0;
    this.C = SHA256_IV[2] | 0;
    this.D = SHA256_IV[3] | 0;
    this.E = SHA256_IV[4] | 0;
    this.F = SHA256_IV[5] | 0;
    this.G = SHA256_IV[6] | 0;
    this.H = SHA256_IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    SHA256_W.fill(0);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    this.buffer.fill(0);
  }
};
var sha256 = /* @__PURE__ */ wrapConstructor(() => new SHA256());

// node_modules/@scure/starknet/lib/esm/index.js
var esm_exports3 = {};
__export(esm_exports3, {
  CURVE: () => CURVE,
  Fp251: () => Fp251,
  MAX_VALUE: () => MAX_VALUE,
  ProjectivePoint: () => ProjectivePoint,
  Signature: () => Signature,
  _poseidonMDS: () => _poseidonMDS,
  _starkCurve: () => _starkCurve,
  computeHashOnElements: () => computeHashOnElements,
  ethSigToPrivate: () => ethSigToPrivate,
  getAccountPath: () => getAccountPath,
  getPublicKey: () => getPublicKey,
  getSharedSecret: () => getSharedSecret,
  getStarkKey: () => getStarkKey,
  grindKey: () => grindKey,
  keccak: () => keccak,
  normalizePrivateKey: () => normalizePrivateKey,
  pedersen: () => pedersen,
  poseidonBasic: () => poseidonBasic,
  poseidonCreate: () => poseidonCreate,
  poseidonHash: () => poseidonHash,
  poseidonHashFunc: () => poseidonHashFunc,
  poseidonHashMany: () => poseidonHashMany,
  poseidonHashSingle: () => poseidonHashSingle,
  poseidonSmall: () => poseidonSmall,
  sign: () => sign,
  utils: () => utils,
  verify: () => verify
});

// node_modules/@scure/starknet/node_modules/@noble/hashes/esm/_assert.js
function anumber3(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function isBytes4(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes4(b, ...lengths) {
  if (!isBytes4(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput2(out, instance) {
  abytes4(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}

// node_modules/@scure/starknet/node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  let Ah = new Uint32Array(lst.length);
  let Al = new Uint32Array(lst.length);
  for (let i = 0; i < lst.length; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;

// node_modules/@scure/starknet/node_modules/@noble/hashes/esm/utils.js
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var u322 = (arr) => new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
var createView2 = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
var rotr2 = (word, shift) => word << 32 - shift | word >>> shift;
var isLE2 = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
var byteSwap2 = (word) => word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
function byteSwap322(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap2(arr[i]);
  }
}
function utf8ToBytes3(str) {
  if (typeof str !== "string")
    throw new Error("utf8ToBytes expected string, got " + typeof str);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes2(data) {
  if (typeof data === "string")
    data = utf8ToBytes3(data);
  abytes4(data);
  return data;
}
var Hash2 = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
function wrapConstructor2(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes2(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function wrapXOFConstructorWithOpts2(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes2(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}

// node_modules/@scure/starknet/node_modules/@noble/hashes/esm/sha3.js
var SHA3_PI = [];
var SHA3_ROTL = [];
var _SHA3_IOTA = [];
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _7n = /* @__PURE__ */ BigInt(7);
var _256n = /* @__PURE__ */ BigInt(256);
var _0x71n = /* @__PURE__ */ BigInt(113);
for (let round = 0, R = _1n2, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n2;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n2 ^ (R >> _7n) * _0x71n) % _256n;
    if (R & _2n2)
      t ^= _1n2 << (_1n2 << /* @__PURE__ */ BigInt(j)) - _1n2;
  }
  _SHA3_IOTA.push(t);
}
var [SHA3_IOTA_H, SHA3_IOTA_L] = /* @__PURE__ */ split(_SHA3_IOTA, true);
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
function keccakP(s, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
  B.fill(0);
}
var Keccak = class _Keccak extends Hash2 {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    super();
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    anumber3(outputLen);
    if (0 >= this.blockLen || this.blockLen >= 200)
      throw new Error("Sha3 supports only keccak-f1600 function");
    this.state = new Uint8Array(200);
    this.state32 = u322(this.state);
  }
  keccak() {
    if (!isLE2)
      byteSwap322(this.state32);
    keccakP(this.state32, this.rounds);
    if (!isLE2)
      byteSwap322(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists2(this);
    const { blockLen, state: state2 } = this;
    data = toBytes2(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state2[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state: state2, suffix, pos, blockLen } = this;
    state2[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state2[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists2(this, false);
    abytes4(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber3(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput2(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    this.state.fill(0);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var gen = (suffix, blockLen, outputLen) => wrapConstructor2(() => new Keccak(blockLen, suffix, outputLen));
var sha3_224 = /* @__PURE__ */ gen(6, 144, 224 / 8);
var sha3_256 = /* @__PURE__ */ gen(6, 136, 256 / 8);
var sha3_384 = /* @__PURE__ */ gen(6, 104, 384 / 8);
var sha3_512 = /* @__PURE__ */ gen(6, 72, 512 / 8);
var keccak_224 = /* @__PURE__ */ gen(1, 144, 224 / 8);
var keccak_256 = /* @__PURE__ */ gen(1, 136, 256 / 8);
var keccak_384 = /* @__PURE__ */ gen(1, 104, 384 / 8);
var keccak_512 = /* @__PURE__ */ gen(1, 72, 512 / 8);
var genShake = (suffix, blockLen, outputLen) => wrapXOFConstructorWithOpts2((opts = {}) => new Keccak(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, true));
var shake128 = /* @__PURE__ */ genShake(31, 168, 128 / 8);
var shake256 = /* @__PURE__ */ genShake(31, 136, 256 / 8);

// node_modules/@scure/starknet/node_modules/@noble/hashes/esm/_md.js
function setBigUint642(view, byteOffset, value, isLE4) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE4);
  const _32n4 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n4 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE4 ? 4 : 0;
  const l = isLE4 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE4);
  view.setUint32(byteOffset + l, wl, isLE4);
}
var Chi2 = (a, b, c) => a & b ^ ~a & c;
var Maj2 = (a, b, c) => a & b ^ a & c ^ b & c;
var HashMD2 = class extends Hash2 {
  constructor(blockLen, outputLen, padOffset, isLE4) {
    super();
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE4;
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView2(this.buffer);
  }
  update(data) {
    aexists2(this);
    const { view, buffer, blockLen } = this;
    data = toBytes2(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView2(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE4 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    this.buffer.subarray(pos).fill(0);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint642(view, blockLen - 8, BigInt(this.length * 8), isLE4);
    this.process(view, 0);
    const oview = createView2(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state2 = this.get();
    if (outLen > state2.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state2[i], isLE4);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.length = length;
    to.pos = pos;
    to.finished = finished;
    to.destroyed = destroyed;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
};

// node_modules/@scure/starknet/node_modules/@noble/hashes/esm/sha256.js
var SHA256_K2 = /* @__PURE__ */ new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_IV2 = /* @__PURE__ */ new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA256_W2 = /* @__PURE__ */ new Uint32Array(64);
var SHA2562 = class extends HashMD2 {
  constructor() {
    super(64, 32, 8, false);
    this.A = SHA256_IV2[0] | 0;
    this.B = SHA256_IV2[1] | 0;
    this.C = SHA256_IV2[2] | 0;
    this.D = SHA256_IV2[3] | 0;
    this.E = SHA256_IV2[4] | 0;
    this.F = SHA256_IV2[5] | 0;
    this.G = SHA256_IV2[6] | 0;
    this.H = SHA256_IV2[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W2[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W2[i - 15];
      const W2 = SHA256_W2[i - 2];
      const s0 = rotr2(W15, 7) ^ rotr2(W15, 18) ^ W15 >>> 3;
      const s1 = rotr2(W2, 17) ^ rotr2(W2, 19) ^ W2 >>> 10;
      SHA256_W2[i] = s1 + SHA256_W2[i - 7] + s0 + SHA256_W2[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr2(E, 6) ^ rotr2(E, 11) ^ rotr2(E, 25);
      const T1 = H + sigma1 + Chi2(E, F, G) + SHA256_K2[i] + SHA256_W2[i] | 0;
      const sigma0 = rotr2(A, 2) ^ rotr2(A, 13) ^ rotr2(A, 22);
      const T2 = sigma0 + Maj2(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    SHA256_W2.fill(0);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    this.buffer.fill(0);
  }
};
var sha2562 = /* @__PURE__ */ wrapConstructor2(() => new SHA2562());

// node_modules/@scure/starknet/node_modules/@noble/curves/esm/abstract/utils.js
var utils_exports2 = {};
__export(utils_exports2, {
  aInRange: () => aInRange2,
  abool: () => abool2,
  abytes: () => abytes5,
  bitGet: () => bitGet2,
  bitLen: () => bitLen2,
  bitMask: () => bitMask2,
  bitSet: () => bitSet2,
  bytesToHex: () => bytesToHex2,
  bytesToNumberBE: () => bytesToNumberBE2,
  bytesToNumberLE: () => bytesToNumberLE2,
  concatBytes: () => concatBytes2,
  createHmacDrbg: () => createHmacDrbg2,
  ensureBytes: () => ensureBytes2,
  equalBytes: () => equalBytes2,
  hexToBytes: () => hexToBytes2,
  hexToNumber: () => hexToNumber2,
  inRange: () => inRange2,
  isBytes: () => isBytes5,
  memoized: () => memoized2,
  notImplemented: () => notImplemented2,
  numberToBytesBE: () => numberToBytesBE2,
  numberToBytesLE: () => numberToBytesLE2,
  numberToHexUnpadded: () => numberToHexUnpadded2,
  numberToVarBytesBE: () => numberToVarBytesBE2,
  utf8ToBytes: () => utf8ToBytes4,
  validateObject: () => validateObject2
});
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
var _2n3 = /* @__PURE__ */ BigInt(2);
function isBytes5(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes5(item) {
  if (!isBytes5(item))
    throw new Error("Uint8Array expected");
}
function abool2(title, value) {
  if (typeof value !== "boolean")
    throw new Error(title + " boolean expected, got " + value);
}
var hexes2 = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex2(bytes) {
  abytes5(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes2[bytes[i]];
  }
  return hex;
}
function numberToHexUnpadded2(num) {
  const hex = num.toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber2(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n3 : BigInt("0x" + hex);
}
var asciis2 = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase162(ch) {
  if (ch >= asciis2._0 && ch <= asciis2._9)
    return ch - asciis2._0;
  if (ch >= asciis2.A && ch <= asciis2.F)
    return ch - (asciis2.A - 10);
  if (ch >= asciis2.a && ch <= asciis2.f)
    return ch - (asciis2.a - 10);
  return;
}
function hexToBytes2(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase162(hex.charCodeAt(hi));
    const n2 = asciiToBase162(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function bytesToNumberBE2(bytes) {
  return hexToNumber2(bytesToHex2(bytes));
}
function bytesToNumberLE2(bytes) {
  abytes5(bytes);
  return hexToNumber2(bytesToHex2(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE2(n, len) {
  return hexToBytes2(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE2(n, len) {
  return numberToBytesBE2(n, len).reverse();
}
function numberToVarBytesBE2(n) {
  return hexToBytes2(numberToHexUnpadded2(n));
}
function ensureBytes2(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes2(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes5(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function concatBytes2(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes5(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function equalBytes2(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function utf8ToBytes4(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
var isPosBig2 = (n) => typeof n === "bigint" && _0n3 <= n;
function inRange2(n, min, max) {
  return isPosBig2(n) && isPosBig2(min) && isPosBig2(max) && min <= n && n < max;
}
function aInRange2(title, n, min, max) {
  if (!inRange2(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen2(n) {
  let len;
  for (len = 0; n > _0n3; n >>= _1n3, len += 1)
    ;
  return len;
}
function bitGet2(n, pos) {
  return n >> BigInt(pos) & _1n3;
}
function bitSet2(n, pos, value) {
  return n | (value ? _1n3 : _0n3) << BigInt(pos);
}
var bitMask2 = (n) => (_2n3 << BigInt(n - 1)) - _1n3;
var u8n2 = (data) => new Uint8Array(data);
var u8fr2 = (arr) => Uint8Array.from(arr);
function createHmacDrbg2(hashLen, qByteLen, hmacFn) {
  if (typeof hashLen !== "number" || hashLen < 2)
    throw new Error("hashLen must be a number");
  if (typeof qByteLen !== "number" || qByteLen < 2)
    throw new Error("qByteLen must be a number");
  if (typeof hmacFn !== "function")
    throw new Error("hmacFn must be a function");
  let v = u8n2(hashLen);
  let k = u8n2(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...b) => hmacFn(k, v, ...b);
  const reseed = (seed = u8n2()) => {
    k = h(u8fr2([0]), seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(u8fr2([1]), seed);
    v = h();
  };
  const gen3 = () => {
    if (i++ >= 1e3)
      throw new Error("drbg: tried 1000 values");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes2(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while (!(res = pred(gen3())))
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
var validatorFns2 = {
  bigint: (val) => typeof val === "bigint",
  function: (val) => typeof val === "function",
  boolean: (val) => typeof val === "boolean",
  string: (val) => typeof val === "string",
  stringOrUint8Array: (val) => typeof val === "string" || isBytes5(val),
  isSafeInteger: (val) => Number.isSafeInteger(val),
  array: (val) => Array.isArray(val),
  field: (val, object) => object.Fp.isValid(val),
  hash: (val) => typeof val === "function" && Number.isSafeInteger(val.outputLen)
};
function validateObject2(object, validators, optValidators = {}) {
  const checkField = (fieldName, type, isOptional) => {
    const checkVal = validatorFns2[type];
    if (typeof checkVal !== "function")
      throw new Error("invalid validator function");
    const val = object[fieldName];
    if (isOptional && val === void 0)
      return;
    if (!checkVal(val, object)) {
      throw new Error("param " + String(fieldName) + " is invalid. Expected " + type + ", got " + val);
    }
  };
  for (const [fieldName, type] of Object.entries(validators))
    checkField(fieldName, type, false);
  for (const [fieldName, type] of Object.entries(optValidators))
    checkField(fieldName, type, true);
  return object;
}
var notImplemented2 = () => {
  throw new Error("not implemented");
};
function memoized2(fn) {
  const map = /* @__PURE__ */ new WeakMap();
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== void 0)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// node_modules/@scure/starknet/node_modules/@noble/curves/esm/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n4 = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  const result = a % b;
  return result >= _0n4 ? result : b + result;
}
function pow(num, power, modulo) {
  if (power < _0n4)
    throw new Error("invalid exponent, negatives unsupported");
  if (modulo <= _0n4)
    throw new Error("invalid modulus");
  if (modulo === _1n4)
    return _0n4;
  let res = _1n4;
  while (power > _0n4) {
    if (power & _1n4)
      res = res * num % modulo;
    num = num * num % modulo;
    power >>= _1n4;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n4)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n4)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n4, y = _1n4, u = _1n4, v = _0n4;
  while (a !== _0n4) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd2 = b;
  if (gcd2 !== _1n4)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function tonelliShanks(P) {
  const legendreC = (P - _1n4) / _2n4;
  let Q, S, Z;
  for (Q = P - _1n4, S = 0; Q % _2n4 === _0n4; Q /= _2n4, S++)
    ;
  for (Z = _2n4; Z < P && pow(Z, legendreC, P) !== P - _1n4; Z++) {
    if (Z > 1e3)
      throw new Error("Cannot find square root: likely non-prime P");
  }
  if (S === 1) {
    const p1div4 = (P + _1n4) / _4n;
    return function tonelliFast(Fp, n) {
      const root = Fp.pow(n, p1div4);
      if (!Fp.eql(Fp.sqr(root), n))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  const Q1div2 = (Q + _1n4) / _2n4;
  return function tonelliSlow(Fp, n) {
    if (Fp.pow(n, legendreC) === Fp.neg(Fp.ONE))
      throw new Error("Cannot find square root");
    let r = S;
    let g = Fp.pow(Fp.mul(Fp.ONE, Z), Q);
    let x = Fp.pow(n, Q1div2);
    let b = Fp.pow(n, Q);
    while (!Fp.eql(b, Fp.ONE)) {
      if (Fp.eql(b, Fp.ZERO))
        return Fp.ZERO;
      let m = 1;
      for (let t2 = Fp.sqr(b); m < r; m++) {
        if (Fp.eql(t2, Fp.ONE))
          break;
        t2 = Fp.sqr(t2);
      }
      const ge = Fp.pow(g, _1n4 << BigInt(r - m - 1));
      g = Fp.sqr(ge);
      x = Fp.mul(x, ge);
      b = Fp.mul(b, g);
      r = m;
    }
    return x;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n) {
    const p1div4 = (P + _1n4) / _4n;
    return function sqrt3mod4(Fp, n) {
      const root = Fp.pow(n, p1div4);
      if (!Fp.eql(Fp.sqr(root), n))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  if (P % _8n === _5n) {
    const c1 = (P - _5n) / _8n;
    return function sqrt5mod8(Fp, n) {
      const n2 = Fp.mul(n, _2n4);
      const v = Fp.pow(n2, c1);
      const nv = Fp.mul(n, v);
      const i = Fp.mul(Fp.mul(nv, _2n4), v);
      const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
      if (!Fp.eql(Fp.sqr(root), n))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  if (P % _16n === _9n) {
  }
  return tonelliShanks(P);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "isSafeInteger",
    BITS: "isSafeInteger"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  return validateObject2(field, opts);
}
function FpPow(f, num, power) {
  if (power < _0n4)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n4)
    return f.ONE;
  if (power === _1n4)
    return num;
  let p = f.ONE;
  let d = num;
  while (power > _0n4) {
    if (power & _1n4)
      p = f.mul(p, d);
    d = f.sqr(d);
    power >>= _1n4;
  }
  return p;
}
function FpInvertBatch(f, nums) {
  const tmp = new Array(nums.length);
  const lastMultiplied = nums.reduce((acc, num, i) => {
    if (f.is0(num))
      return acc;
    tmp[i] = acc;
    return f.mul(acc, num);
  }, f.ONE);
  const inverted = f.inv(lastMultiplied);
  nums.reduceRight((acc, num, i) => {
    if (f.is0(num))
      return acc;
    tmp[i] = f.mul(acc, tmp[i]);
    return f.mul(acc, num);
  }, inverted);
  return tmp;
}
function nLength(n, nBitLength2) {
  const _nBitLength = nBitLength2 !== void 0 ? nBitLength2 : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLen3, isLE4 = false, redef = {}) {
  if (ORDER <= _0n4)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, bitLen3);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    BITS,
    BYTES,
    MASK: bitMask2(BITS),
    ZERO: _0n4,
    ONE: _1n4,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n4 <= num && num < ORDER;
    },
    is0: (num) => num === _0n4,
    isOdd: (num) => (num & _1n4) === _1n4,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: redef.sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    invertBatch: (lst) => FpInvertBatch(f, lst),
    // TODO: do we really need constant cmov?
    // We don't have const-time bigints anyway, so probably will be not very useful
    cmov: (a, b, c) => c ? b : a,
    toBytes: (num) => isLE4 ? numberToBytesLE2(num, BYTES) : numberToBytesBE2(num, BYTES),
    fromBytes: (bytes) => {
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      return isLE4 ? bytesToNumberLE2(bytes) : bytesToNumberBE2(bytes);
    }
  });
  return Object.freeze(f);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  const bitLength = fieldOrder.toString(2).length;
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE4 = false) {
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = getMinHashLength(fieldOrder);
  if (len < 16 || len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE4 ? bytesToNumberBE2(key) : bytesToNumberLE2(key);
  const reduced = mod(num, fieldOrder - _1n4) + _1n4;
  return isLE4 ? numberToBytesLE2(reduced, fieldLen) : numberToBytesBE2(reduced, fieldLen);
}

// node_modules/@scure/starknet/node_modules/@noble/curves/esm/abstract/poseidon.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function validateOpts(opts) {
  const { Fp, mds, reversePartialPowIdx: rev, roundConstants: rc } = opts;
  const { roundsFull, roundsPartial, sboxPower, t } = opts;
  validateField(Fp);
  for (const i of ["t", "roundsFull", "roundsPartial"]) {
    if (typeof opts[i] !== "number" || !Number.isSafeInteger(opts[i]))
      throw new Error("invalid number " + i);
  }
  if (!Array.isArray(mds) || mds.length !== t)
    throw new Error("Poseidon: invalid MDS matrix");
  const _mds = mds.map((mdsRow) => {
    if (!Array.isArray(mdsRow) || mdsRow.length !== t)
      throw new Error("invalid MDS matrix row: " + mdsRow);
    return mdsRow.map((i) => {
      if (typeof i !== "bigint")
        throw new Error("invalid MDS matrix bigint: " + i);
      return Fp.create(i);
    });
  });
  if (rev !== void 0 && typeof rev !== "boolean")
    throw new Error("invalid param reversePartialPowIdx=" + rev);
  if (roundsFull & 1)
    throw new Error("roundsFull is not even" + roundsFull);
  const rounds = roundsFull + roundsPartial;
  if (!Array.isArray(rc) || rc.length !== rounds)
    throw new Error("Poseidon: invalid round constants");
  const roundConstants = rc.map((rc2) => {
    if (!Array.isArray(rc2) || rc2.length !== t)
      throw new Error("invalid round constants");
    return rc2.map((i) => {
      if (typeof i !== "bigint" || !Fp.isValid(i))
        throw new Error("invalid round constant");
      return Fp.create(i);
    });
  });
  if (!sboxPower || ![3, 5, 7].includes(sboxPower))
    throw new Error("invalid sboxPower");
  const _sboxPower = BigInt(sboxPower);
  let sboxFn = (n) => FpPow(Fp, n, _sboxPower);
  if (sboxPower === 3)
    sboxFn = (n) => Fp.mul(Fp.sqrN(n), n);
  else if (sboxPower === 5)
    sboxFn = (n) => Fp.mul(Fp.sqrN(Fp.sqrN(n)), n);
  return Object.freeze({ ...opts, rounds, sboxFn, roundConstants, mds: _mds });
}
function poseidon(opts) {
  const _opts = validateOpts(opts);
  const { Fp, mds, roundConstants, rounds: totalRounds, roundsPartial, sboxFn, t } = _opts;
  const halfRoundsFull = _opts.roundsFull / 2;
  const partialIdx = _opts.reversePartialPowIdx ? t - 1 : 0;
  const poseidonRound = (values, isFull, idx) => {
    values = values.map((i, j) => Fp.add(i, roundConstants[idx][j]));
    if (isFull)
      values = values.map((i) => sboxFn(i));
    else
      values[partialIdx] = sboxFn(values[partialIdx]);
    values = mds.map((i) => i.reduce((acc, i2, j) => Fp.add(acc, Fp.mulN(i2, values[j])), Fp.ZERO));
    return values;
  };
  const poseidonHash2 = function poseidonHash3(values) {
    if (!Array.isArray(values) || values.length !== t)
      throw new Error("invalid values, expected array of bigints with length " + t);
    values = values.map((i) => {
      if (typeof i !== "bigint")
        throw new Error("invalid bigint=" + i);
      return Fp.create(i);
    });
    let lastRound = 0;
    for (let i = 0; i < halfRoundsFull; i++)
      values = poseidonRound(values, true, lastRound++);
    for (let i = 0; i < roundsPartial; i++)
      values = poseidonRound(values, false, lastRound++);
    for (let i = 0; i < halfRoundsFull; i++)
      values = poseidonRound(values, true, lastRound++);
    if (lastRound !== totalRounds)
      throw new Error("invalid number of rounds");
    return values;
  };
  poseidonHash2.roundConstants = roundConstants;
  return poseidonHash2;
}

// node_modules/@scure/starknet/node_modules/@noble/curves/esm/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
function constTimeNegate(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, bits) {
  validateW(W, bits);
  const windows = Math.ceil(bits / W) + 1;
  const windowSize = 2 ** (W - 1);
  return { windows, windowSize };
}
function validateMSMPoints(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function wNAF(c, bits) {
  return {
    constTimeNegate,
    hasPrecomputes(elm) {
      return getW(elm) !== 1;
    },
    // non-const time multiplication ladder
    unsafeLadder(elm, n, p = c.ZERO) {
      let d = elm;
      while (n > _0n5) {
        if (n & _1n5)
          p = p.add(d);
        d = d.double();
        n >>= _1n5;
      }
      return p;
    },
    /**
     * Creates a wNAF precomputation window. Used for caching.
     * Default window size is set by `utils.precompute()` and is equal to 8.
     * Number of precomputed points depends on the curve size:
     * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
     * - 𝑊 is the window size
     * - 𝑛 is the bitlength of the curve order.
     * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
     * @param elm Point instance
     * @param W window size
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(elm, W) {
      const { windows, windowSize } = calcWOpts(W, bits);
      const points = [];
      let p = elm;
      let base = p;
      for (let window2 = 0; window2 < windows; window2++) {
        base = p;
        points.push(base);
        for (let i = 1; i < windowSize; i++) {
          base = base.add(p);
          points.push(base);
        }
        p = base.double();
      }
      return points;
    },
    /**
     * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @returns real and fake (for const-time) points
     */
    wNAF(W, precomputes, n) {
      const { windows, windowSize } = calcWOpts(W, bits);
      let p = c.ZERO;
      let f = c.BASE;
      const mask = BigInt(2 ** W - 1);
      const maxNumber = 2 ** W;
      const shiftBy = BigInt(W);
      for (let window2 = 0; window2 < windows; window2++) {
        const offset = window2 * windowSize;
        let wbits = Number(n & mask);
        n >>= shiftBy;
        if (wbits > windowSize) {
          wbits -= maxNumber;
          n += _1n5;
        }
        const offset1 = offset;
        const offset2 = offset + Math.abs(wbits) - 1;
        const cond1 = window2 % 2 !== 0;
        const cond2 = wbits < 0;
        if (wbits === 0) {
          f = f.add(constTimeNegate(cond1, precomputes[offset1]));
        } else {
          p = p.add(constTimeNegate(cond2, precomputes[offset2]));
        }
      }
      return { p, f };
    },
    /**
     * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @param acc accumulator point to add result of multiplication
     * @returns point
     */
    wNAFUnsafe(W, precomputes, n, acc = c.ZERO) {
      const { windows, windowSize } = calcWOpts(W, bits);
      const mask = BigInt(2 ** W - 1);
      const maxNumber = 2 ** W;
      const shiftBy = BigInt(W);
      for (let window2 = 0; window2 < windows; window2++) {
        const offset = window2 * windowSize;
        if (n === _0n5)
          break;
        let wbits = Number(n & mask);
        n >>= shiftBy;
        if (wbits > windowSize) {
          wbits -= maxNumber;
          n += _1n5;
        }
        if (wbits === 0)
          continue;
        let curr = precomputes[offset + Math.abs(wbits) - 1];
        if (wbits < 0)
          curr = curr.negate();
        acc = acc.add(curr);
      }
      return acc;
    },
    getPrecomputes(W, P, transform) {
      let comp = pointPrecomputes.get(P);
      if (!comp) {
        comp = this.precomputeWindow(P, W);
        if (W !== 1)
          pointPrecomputes.set(P, transform(comp));
      }
      return comp;
    },
    wNAFCached(P, n, transform) {
      const W = getW(P);
      return this.wNAF(W, this.getPrecomputes(W, P, transform), n);
    },
    wNAFCachedUnsafe(P, n, transform, prev) {
      const W = getW(P);
      if (W === 1)
        return this.unsafeLadder(P, n, prev);
      return this.wNAFUnsafe(W, this.getPrecomputes(W, P, transform), n, prev);
    },
    // We calculate precomputes for elliptic curve point multiplication
    // using windowed method. This specifies window size and
    // stores precomputed values. Usually only base point would be precomputed.
    setWindowSize(P, W) {
      validateW(W, bits);
      pointWindowSizes.set(P, W);
      pointPrecomputes.delete(P);
    }
  };
}
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints(points, c);
  validateMSMScalars(scalars, fieldN);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen2(BigInt(points.length));
  const windowSize = wbits > 12 ? wbits - 3 : wbits > 4 ? wbits - 2 : wbits ? 2 : 1;
  const MASK = (1 << windowSize) - 1;
  const buckets = new Array(MASK + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits; i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0; j < scalars.length; j++) {
      const scalar = scalars[j];
      const wbits2 = Number(scalar >> BigInt(i) & BigInt(MASK));
      buckets[wbits2] = buckets[wbits2].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0; j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function validateBasic(curve2) {
  validateField(curve2.Fp);
  validateObject2(curve2, {
    n: "bigint",
    h: "bigint",
    Gx: "field",
    Gy: "field"
  }, {
    nBitLength: "isSafeInteger",
    nByteLength: "isSafeInteger"
  });
  return Object.freeze({
    ...nLength(curve2.n, curve2.nBitLength),
    ...curve2,
    ...{ p: curve2.Fp.ORDER }
  });
}

// node_modules/@scure/starknet/node_modules/@noble/curves/esm/abstract/weierstrass.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function validateSigVerOpts(opts) {
  if (opts.lowS !== void 0)
    abool2("lowS", opts.lowS);
  if (opts.prehash !== void 0)
    abool2("prehash", opts.prehash);
}
function validatePointOpts(curve2) {
  const opts = validateBasic(curve2);
  validateObject2(opts, {
    a: "field",
    b: "field"
  }, {
    allowedPrivateKeyLengths: "array",
    wrapPrivateKey: "boolean",
    isTorsionFree: "function",
    clearCofactor: "function",
    allowInfinityPoint: "boolean",
    fromBytes: "function",
    toBytes: "function"
  });
  const { endo, Fp, a } = opts;
  if (endo) {
    if (!Fp.eql(a, Fp.ZERO)) {
      throw new Error("invalid endomorphism, can only be defined for Koblitz curves that have a=0");
    }
    if (typeof endo !== "object" || typeof endo.beta !== "bigint" || typeof endo.splitScalar !== "function") {
      throw new Error("invalid endomorphism, expected beta: bigint and splitScalar: function");
    }
  }
  return Object.freeze({ ...opts });
}
var { bytesToNumberBE: b2n, hexToBytes: h2b } = utils_exports2;
var DER = {
  // asn.1 DER encoding utils
  Err: class DERErr extends Error {
    constructor(m = "") {
      super(m);
    }
  },
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = DER;
      if (tag < 0 || tag > 256)
        throw new E("tlv.encode: wrong tag");
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded2(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded2(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded2(tag);
      return t + lenLen + len + data;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data) {
      const { Err: E } = DER;
      let pos = 0;
      if (tag < 0 || tag > 256)
        throw new E("tlv.encode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length = 0;
      if (!isLong)
        length = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length = length << 8 | b;
        pos += lenLen;
        if (length < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(num) {
      const { Err: E } = DER;
      if (num < _0n6)
        throw new E("integer: negative integers are not allowed");
      let hex = numberToHexUnpadded2(num);
      if (Number.parseInt(hex[0], 16) & 8)
        hex = "00" + hex;
      if (hex.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex;
    },
    decode(data) {
      const { Err: E } = DER;
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return b2n(data);
    }
  },
  toSig(hex) {
    const { Err: E, _int: int, _tlv: tlv } = DER;
    const data = typeof hex === "string" ? h2b(hex) : hex;
    abytes5(data);
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = DER;
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
var _0n6 = BigInt(0);
var _1n6 = BigInt(1);
var _2n5 = BigInt(2);
var _3n2 = BigInt(3);
var _4n2 = BigInt(4);
function weierstrassPoints(opts) {
  const CURVE2 = validatePointOpts(opts);
  const { Fp } = CURVE2;
  const Fn = Field(CURVE2.n, CURVE2.nBitLength);
  const toBytes5 = CURVE2.toBytes || ((_c, point, _isCompressed) => {
    const a = point.toAffine();
    return concatBytes2(Uint8Array.from([4]), Fp.toBytes(a.x), Fp.toBytes(a.y));
  });
  const fromBytes = CURVE2.fromBytes || ((bytes) => {
    const tail = bytes.subarray(1);
    const x = Fp.fromBytes(tail.subarray(0, Fp.BYTES));
    const y = Fp.fromBytes(tail.subarray(Fp.BYTES, 2 * Fp.BYTES));
    return { x, y };
  });
  function weierstrassEquation(x) {
    const { a, b } = CURVE2;
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, a)), b);
  }
  if (!Fp.eql(Fp.sqr(CURVE2.Gy), weierstrassEquation(CURVE2.Gx)))
    throw new Error("bad generator point: equation left != right");
  function isWithinCurveOrder(num) {
    return inRange2(num, _1n6, CURVE2.n);
  }
  function normPrivateKeyToScalar(key) {
    const { allowedPrivateKeyLengths: lengths, nByteLength, wrapPrivateKey, n: N } = CURVE2;
    if (lengths && typeof key !== "bigint") {
      if (isBytes5(key))
        key = bytesToHex2(key);
      if (typeof key !== "string" || !lengths.includes(key.length))
        throw new Error("invalid private key");
      key = key.padStart(nByteLength * 2, "0");
    }
    let num;
    try {
      num = typeof key === "bigint" ? key : bytesToNumberBE2(ensureBytes2("private key", key, nByteLength));
    } catch (error) {
      throw new Error("invalid private key, expected hex or " + nByteLength + " bytes, got " + typeof key);
    }
    if (wrapPrivateKey)
      num = mod(num, N);
    aInRange2("private key", num, _1n6, N);
    return num;
  }
  function assertPrjPoint(other) {
    if (!(other instanceof Point2))
      throw new Error("ProjectivePoint expected");
  }
  const toAffineMemo = memoized2((p, iz) => {
    const { px: x, py: y, pz: z } = p;
    if (Fp.eql(z, Fp.ONE))
      return { x, y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp.ONE : Fp.inv(z);
    const ax = Fp.mul(x, iz);
    const ay = Fp.mul(y, iz);
    const zz = Fp.mul(z, iz);
    if (is0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (!Fp.eql(zz, Fp.ONE))
      throw new Error("invZ was invalid");
    return { x: ax, y: ay };
  });
  const assertValidMemo = memoized2((p) => {
    if (p.is0()) {
      if (CURVE2.allowInfinityPoint && !Fp.is0(p.py))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp.isValid(x) || !Fp.isValid(y))
      throw new Error("bad point: x or y not FE");
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    if (!Fp.eql(left, right))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  class Point2 {
    constructor(px, py, pz) {
      this.px = px;
      this.py = py;
      this.pz = pz;
      if (px == null || !Fp.isValid(px))
        throw new Error("x required");
      if (py == null || !Fp.isValid(py))
        throw new Error("y required");
      if (pz == null || !Fp.isValid(pz))
        throw new Error("z required");
      Object.freeze(this);
    }
    // Does not validate if the point is on-curve.
    // Use fromHex instead, or call assertValidity() later.
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point2)
        throw new Error("projective point not allowed");
      const is0 = (i) => Fp.eql(i, Fp.ZERO);
      if (is0(x) && is0(y))
        return Point2.ZERO;
      return new Point2(x, y, Fp.ONE);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * Takes a bunch of Projective Points but executes only one
     * inversion on all of them. Inversion is very slow operation,
     * so this improves performance massively.
     * Optimization: converts a list of projective points to a list of identical points with Z=1.
     */
    static normalizeZ(points) {
      const toInv = Fp.invertBatch(points.map((p) => p.pz));
      return points.map((p, i) => p.toAffine(toInv[i])).map(Point2.fromAffine);
    }
    /**
     * Converts hash string or Uint8Array to Point.
     * @param hex short/long ECDSA hex
     */
    static fromHex(hex) {
      const P = Point2.fromAffine(fromBytes(ensureBytes2("pointHex", hex)));
      P.assertValidity();
      return P;
    }
    // Multiplies generator point by privateKey.
    static fromPrivateKey(privateKey) {
      return Point2.BASE.multiply(normPrivateKeyToScalar(privateKey));
    }
    // Multiscalar Multiplication
    static msm(points, scalars) {
      return pippenger(Point2, Fn, points, scalars);
    }
    // "Private method", don't use it directly
    _setWindowSize(windowSize) {
      wnaf.setWindowSize(this, windowSize);
    }
    // A point on curve is valid if it conforms to equation.
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (Fp.isOdd)
        return !Fp.isOdd(y);
      throw new Error("Field doesn't support isOdd");
    }
    /**
     * Compare one point to another.
     */
    equals(other) {
      assertPrjPoint(other);
      const { px: X1, py: Y1, pz: Z1 } = this;
      const { px: X2, py: Y2, pz: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /**
     * Flips point to one corresponding to (x, -y) in Affine coordinates.
     */
    negate() {
      return new Point2(this.px, Fp.neg(this.py), this.pz);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a, b } = CURVE2;
      const b3 = Fp.mul(b, _3n2);
      const { px: X1, py: Y1, pz: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = Fp.mul(a, Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = Fp.mul(a, t2);
      t3 = Fp.sub(t0, t2);
      t3 = Fp.mul(a, t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point2(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      assertPrjPoint(other);
      const { px: X1, py: Y1, pz: Z1 } = this;
      const { px: X2, py: Y2, pz: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      const a = CURVE2.a;
      const b3 = Fp.mul(CURVE2.b, _3n2);
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = Fp.mul(a, t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = Fp.mul(a, t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = Fp.mul(a, t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point2(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point2.ZERO);
    }
    wNAF(n) {
      return wnaf.wNAFCached(this, n, Point2.normalizeZ);
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed private key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(sc) {
      const { endo, n: N } = CURVE2;
      aInRange2("scalar", sc, _0n6, N);
      const I = Point2.ZERO;
      if (sc === _0n6)
        return I;
      if (this.is0() || sc === _1n6)
        return this;
      if (!endo || wnaf.hasPrecomputes(this))
        return wnaf.wNAFCachedUnsafe(this, sc, Point2.normalizeZ);
      let { k1neg, k1, k2neg, k2 } = endo.splitScalar(sc);
      let k1p = I;
      let k2p = I;
      let d = this;
      while (k1 > _0n6 || k2 > _0n6) {
        if (k1 & _1n6)
          k1p = k1p.add(d);
        if (k2 & _1n6)
          k2p = k2p.add(d);
        d = d.double();
        k1 >>= _1n6;
        k2 >>= _1n6;
      }
      if (k1neg)
        k1p = k1p.negate();
      if (k2neg)
        k2p = k2p.negate();
      k2p = new Point2(Fp.mul(k2p.px, endo.beta), k2p.py, k2p.pz);
      return k1p.add(k2p);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      const { endo, n: N } = CURVE2;
      aInRange2("scalar", scalar, _1n6, N);
      let point, fake;
      if (endo) {
        const { k1neg, k1, k2neg, k2 } = endo.splitScalar(scalar);
        let { p: k1p, f: f1p } = this.wNAF(k1);
        let { p: k2p, f: f2p } = this.wNAF(k2);
        k1p = wnaf.constTimeNegate(k1neg, k1p);
        k2p = wnaf.constTimeNegate(k2neg, k2p);
        k2p = new Point2(Fp.mul(k2p.px, endo.beta), k2p.py, k2p.pz);
        point = k1p.add(k2p);
        fake = f1p.add(f2p);
      } else {
        const { p, f } = this.wNAF(scalar);
        point = p;
        fake = f;
      }
      return Point2.normalizeZ([point, fake])[0];
    }
    /**
     * Efficiently calculate `aP + bQ`. Unsafe, can expose private key, if used incorrectly.
     * Not using Strauss-Shamir trick: precomputation tables are faster.
     * The trick could be useful if both P and Q are not G (not in our case).
     * @returns non-zero affine point
     */
    multiplyAndAddUnsafe(Q, a, b) {
      const G = Point2.BASE;
      const mul = (P, a2) => a2 === _0n6 || a2 === _1n6 || !P.equals(G) ? P.multiplyUnsafe(a2) : P.multiply(a2);
      const sum = mul(this, a).add(mul(Q, b));
      return sum.is0() ? void 0 : sum;
    }
    // Converts Projective point to affine (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    // (x, y, z) ∋ (x=x/z, y=y/z)
    toAffine(iz) {
      return toAffineMemo(this, iz);
    }
    isTorsionFree() {
      const { h: cofactor, isTorsionFree } = CURVE2;
      if (cofactor === _1n6)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point2, this);
      throw new Error("isTorsionFree() has not been declared for the elliptic curve");
    }
    clearCofactor() {
      const { h: cofactor, clearCofactor } = CURVE2;
      if (cofactor === _1n6)
        return this;
      if (clearCofactor)
        return clearCofactor(Point2, this);
      return this.multiplyUnsafe(CURVE2.h);
    }
    toRawBytes(isCompressed = true) {
      abool2("isCompressed", isCompressed);
      this.assertValidity();
      return toBytes5(Point2, this, isCompressed);
    }
    toHex(isCompressed = true) {
      abool2("isCompressed", isCompressed);
      return bytesToHex2(this.toRawBytes(isCompressed));
    }
  }
  Point2.BASE = new Point2(CURVE2.Gx, CURVE2.Gy, Fp.ONE);
  Point2.ZERO = new Point2(Fp.ZERO, Fp.ONE, Fp.ZERO);
  const _bits = CURVE2.nBitLength;
  const wnaf = wNAF(Point2, CURVE2.endo ? Math.ceil(_bits / 2) : _bits);
  return {
    CURVE: CURVE2,
    ProjectivePoint: Point2,
    normPrivateKeyToScalar,
    weierstrassEquation,
    isWithinCurveOrder
  };
}
function validateOpts2(curve2) {
  const opts = validateBasic(curve2);
  validateObject2(opts, {
    hash: "hash",
    hmac: "function",
    randomBytes: "function"
  }, {
    bits2int: "function",
    bits2int_modN: "function",
    lowS: "boolean"
  });
  return Object.freeze({ lowS: true, ...opts });
}
function weierstrass(curveDef) {
  const CURVE2 = validateOpts2(curveDef);
  const { Fp, n: CURVE_ORDER2 } = CURVE2;
  const compressedLen = Fp.BYTES + 1;
  const uncompressedLen = 2 * Fp.BYTES + 1;
  function modN(a) {
    return mod(a, CURVE_ORDER2);
  }
  function invN(a) {
    return invert(a, CURVE_ORDER2);
  }
  const { ProjectivePoint: Point2, normPrivateKeyToScalar, weierstrassEquation, isWithinCurveOrder } = weierstrassPoints({
    ...CURVE2,
    toBytes(_c, point, isCompressed) {
      const a = point.toAffine();
      const x = Fp.toBytes(a.x);
      const cat = concatBytes2;
      abool2("isCompressed", isCompressed);
      if (isCompressed) {
        return cat(Uint8Array.from([point.hasEvenY() ? 2 : 3]), x);
      } else {
        return cat(Uint8Array.from([4]), x, Fp.toBytes(a.y));
      }
    },
    fromBytes(bytes) {
      const len = bytes.length;
      const head = bytes[0];
      const tail = bytes.subarray(1);
      if (len === compressedLen && (head === 2 || head === 3)) {
        const x = bytesToNumberBE2(tail);
        if (!inRange2(x, _1n6, Fp.ORDER))
          throw new Error("Point is not on curve");
        const y2 = weierstrassEquation(x);
        let y;
        try {
          y = Fp.sqrt(y2);
        } catch (sqrtError) {
          const suffix = sqrtError instanceof Error ? ": " + sqrtError.message : "";
          throw new Error("Point is not on curve" + suffix);
        }
        const isYOdd = (y & _1n6) === _1n6;
        const isHeadOdd = (head & 1) === 1;
        if (isHeadOdd !== isYOdd)
          y = Fp.neg(y);
        return { x, y };
      } else if (len === uncompressedLen && head === 4) {
        const x = Fp.fromBytes(tail.subarray(0, Fp.BYTES));
        const y = Fp.fromBytes(tail.subarray(Fp.BYTES, 2 * Fp.BYTES));
        return { x, y };
      } else {
        const cl = compressedLen;
        const ul = uncompressedLen;
        throw new Error("invalid Point, expected length of " + cl + ", or uncompressed " + ul + ", got " + len);
      }
    }
  });
  const numToNByteStr = (num) => bytesToHex2(numberToBytesBE2(num, CURVE2.nByteLength));
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER2 >> _1n6;
    return number > HALF;
  }
  function normalizeS(s) {
    return isBiggerThanHalfOrder(s) ? modN(-s) : s;
  }
  const slcNum = (b, from, to) => bytesToNumberBE2(b.slice(from, to));
  class Signature2 {
    constructor(r, s, recovery) {
      this.r = r;
      this.s = s;
      this.recovery = recovery;
      this.assertValidity();
    }
    // pair (bytes of r, bytes of s)
    static fromCompact(hex) {
      const l = CURVE2.nByteLength;
      hex = ensureBytes2("compactSignature", hex, l * 2);
      return new Signature2(slcNum(hex, 0, l), slcNum(hex, l, 2 * l));
    }
    // DER encoded ECDSA signature
    // https://bitcoin.stackexchange.com/questions/57644/what-are-the-parts-of-a-bitcoin-transaction-input-script
    static fromDER(hex) {
      const { r, s } = DER.toSig(ensureBytes2("DER", hex));
      return new Signature2(r, s);
    }
    assertValidity() {
      aInRange2("r", this.r, _1n6, CURVE_ORDER2);
      aInRange2("s", this.s, _1n6, CURVE_ORDER2);
    }
    addRecoveryBit(recovery) {
      return new Signature2(this.r, this.s, recovery);
    }
    recoverPublicKey(msgHash) {
      const { r, s, recovery: rec } = this;
      const h = bits2int_modN(ensureBytes2("msgHash", msgHash));
      if (rec == null || ![0, 1, 2, 3].includes(rec))
        throw new Error("recovery id invalid");
      const radj = rec === 2 || rec === 3 ? r + CURVE2.n : r;
      if (radj >= Fp.ORDER)
        throw new Error("recovery id 2 or 3 invalid");
      const prefix = (rec & 1) === 0 ? "02" : "03";
      const R = Point2.fromHex(prefix + numToNByteStr(radj));
      const ir = invN(radj);
      const u1 = modN(-h * ir);
      const u2 = modN(s * ir);
      const Q = Point2.BASE.multiplyAndAddUnsafe(R, u1, u2);
      if (!Q)
        throw new Error("point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    normalizeS() {
      return this.hasHighS() ? new Signature2(this.r, modN(-this.s), this.recovery) : this;
    }
    // DER-encoded
    toDERRawBytes() {
      return hexToBytes2(this.toDERHex());
    }
    toDERHex() {
      return DER.hexFromSig({ r: this.r, s: this.s });
    }
    // padded bytes of r, then padded bytes of s
    toCompactRawBytes() {
      return hexToBytes2(this.toCompactHex());
    }
    toCompactHex() {
      return numToNByteStr(this.r) + numToNByteStr(this.s);
    }
  }
  const utils2 = {
    isValidPrivateKey(privateKey) {
      try {
        normPrivateKeyToScalar(privateKey);
        return true;
      } catch (error) {
        return false;
      }
    },
    normPrivateKeyToScalar,
    /**
     * Produces cryptographically secure private key from random of size
     * (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
     */
    randomPrivateKey: () => {
      const length = getMinHashLength(CURVE2.n);
      return mapHashToField(CURVE2.randomBytes(length), CURVE2.n);
    },
    /**
     * Creates precompute table for an arbitrary EC point. Makes point "cached".
     * Allows to massively speed-up `point.multiply(scalar)`.
     * @returns cached point
     * @example
     * const fast = utils.precompute(8, ProjectivePoint.fromHex(someonesPubKey));
     * fast.multiply(privKey); // much faster ECDH now
     */
    precompute(windowSize = 8, point = Point2.BASE) {
      point._setWindowSize(windowSize);
      point.multiply(BigInt(3));
      return point;
    }
  };
  function getPublicKey2(privateKey, isCompressed = true) {
    return Point2.fromPrivateKey(privateKey).toRawBytes(isCompressed);
  }
  function isProbPub(item) {
    const arr = isBytes5(item);
    const str = typeof item === "string";
    const len = (arr || str) && item.length;
    if (arr)
      return len === compressedLen || len === uncompressedLen;
    if (str)
      return len === 2 * compressedLen || len === 2 * uncompressedLen;
    if (item instanceof Point2)
      return true;
    return false;
  }
  function getSharedSecret3(privateA, publicB, isCompressed = true) {
    if (isProbPub(privateA))
      throw new Error("first arg must be private key");
    if (!isProbPub(publicB))
      throw new Error("second arg must be public key");
    const b = Point2.fromHex(publicB);
    return b.multiply(normPrivateKeyToScalar(privateA)).toRawBytes(isCompressed);
  }
  const bits2int2 = CURVE2.bits2int || function(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE2(bytes);
    const delta = bytes.length * 8 - CURVE2.nBitLength;
    return delta > 0 ? num >> BigInt(delta) : num;
  };
  const bits2int_modN = CURVE2.bits2int_modN || function(bytes) {
    return modN(bits2int2(bytes));
  };
  const ORDER_MASK = bitMask2(CURVE2.nBitLength);
  function int2octets(num) {
    aInRange2("num < 2^" + CURVE2.nBitLength, num, _0n6, ORDER_MASK);
    return numberToBytesBE2(num, CURVE2.nByteLength);
  }
  function prepSig(msgHash, privateKey, opts = defaultSigOpts) {
    if (["recovered", "canonical"].some((k) => k in opts))
      throw new Error("sign() legacy options not supported");
    const { hash, randomBytes: randomBytes3 } = CURVE2;
    let { lowS, prehash, extraEntropy: ent } = opts;
    if (lowS == null)
      lowS = true;
    msgHash = ensureBytes2("msgHash", msgHash);
    validateSigVerOpts(opts);
    if (prehash)
      msgHash = ensureBytes2("prehashed msgHash", hash(msgHash));
    const h1int = bits2int_modN(msgHash);
    const d = normPrivateKeyToScalar(privateKey);
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (ent != null && ent !== false) {
      const e = ent === true ? randomBytes3(Fp.BYTES) : ent;
      seedArgs.push(ensureBytes2("extraEntropy", e));
    }
    const seed = concatBytes2(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int2(kBytes);
      if (!isWithinCurveOrder(k))
        return;
      const ik = invN(k);
      const q = Point2.BASE.multiply(k).toAffine();
      const r = modN(q.x);
      if (r === _0n6)
        return;
      const s = modN(ik * modN(m + r * d));
      if (s === _0n6)
        return;
      let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n6);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = normalizeS(s);
        recovery ^= 1;
      }
      return new Signature2(r, normS, recovery);
    }
    return { seed, k2sig };
  }
  const defaultSigOpts = { lowS: CURVE2.lowS, prehash: false };
  const defaultVerOpts = { lowS: CURVE2.lowS, prehash: false };
  function sign2(msgHash, privKey, opts = defaultSigOpts) {
    const { seed, k2sig } = prepSig(msgHash, privKey, opts);
    const C = CURVE2;
    const drbg = createHmacDrbg2(C.hash.outputLen, C.nByteLength, C.hmac);
    return drbg(seed, k2sig);
  }
  Point2.BASE._setWindowSize(8);
  function verify2(signature, msgHash, publicKey2, opts = defaultVerOpts) {
    const sg = signature;
    msgHash = ensureBytes2("msgHash", msgHash);
    publicKey2 = ensureBytes2("publicKey", publicKey2);
    const { lowS, prehash, format } = opts;
    validateSigVerOpts(opts);
    if ("strict" in opts)
      throw new Error("options.strict was renamed to lowS");
    if (format !== void 0 && format !== "compact" && format !== "der")
      throw new Error("format must be compact or der");
    const isHex3 = typeof sg === "string" || isBytes5(sg);
    const isObj = !isHex3 && !format && typeof sg === "object" && sg !== null && typeof sg.r === "bigint" && typeof sg.s === "bigint";
    if (!isHex3 && !isObj)
      throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
    let _sig = void 0;
    let P;
    try {
      if (isObj)
        _sig = new Signature2(sg.r, sg.s);
      if (isHex3) {
        try {
          if (format !== "compact")
            _sig = Signature2.fromDER(sg);
        } catch (derError) {
          if (!(derError instanceof DER.Err))
            throw derError;
        }
        if (!_sig && format !== "der")
          _sig = Signature2.fromCompact(sg);
      }
      P = Point2.fromHex(publicKey2);
    } catch (error) {
      return false;
    }
    if (!_sig)
      return false;
    if (lowS && _sig.hasHighS())
      return false;
    if (prehash)
      msgHash = CURVE2.hash(msgHash);
    const { r, s } = _sig;
    const h = bits2int_modN(msgHash);
    const is = invN(s);
    const u1 = modN(h * is);
    const u2 = modN(r * is);
    const R = Point2.BASE.multiplyAndAddUnsafe(P, u1, u2)?.toAffine();
    if (!R)
      return false;
    const v = modN(R.x);
    return v === r;
  }
  return {
    CURVE: CURVE2,
    getPublicKey: getPublicKey2,
    getSharedSecret: getSharedSecret3,
    sign: sign2,
    verify: verify2,
    ProjectivePoint: Point2,
    Signature: Signature2,
    utils: utils2
  };
}

// node_modules/@scure/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/_assert.js
function anumber4(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function isBytes6(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes6(b, ...lengths) {
  if (!isBytes6(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new Error("Hash should be wrapped by utils.wrapConstructor");
  anumber4(h.outputLen);
  anumber4(h.blockLen);
}
function aexists3(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}

// node_modules/@scure/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/cryptoNode.js
import * as nc from "node:crypto";
var crypto2 = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && "randomBytes" in nc ? nc : void 0;

// node_modules/@scure/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/utils.js
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function utf8ToBytes5(str) {
  if (typeof str !== "string")
    throw new Error("utf8ToBytes expected string, got " + typeof str);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes3(data) {
  if (typeof data === "string")
    data = utf8ToBytes5(data);
  abytes6(data);
  return data;
}
function concatBytes3(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes6(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
var Hash3 = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
function randomBytes(bytesLength = 32) {
  if (crypto2 && typeof crypto2.getRandomValues === "function") {
    return crypto2.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto2 && typeof crypto2.randomBytes === "function") {
    return crypto2.randomBytes(bytesLength);
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// node_modules/@scure/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/hmac.js
var HMAC = class extends Hash3 {
  constructor(hash, _key) {
    super();
    this.finished = false;
    this.destroyed = false;
    ahash(hash);
    const key = toBytes3(_key);
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    pad.fill(0);
  }
  update(buf) {
    aexists3(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists3(this);
    abytes6(out, this.outputLen);
    this.finished = true;
    this.iHash.digestInto(out);
    this.oHash.update(out);
    this.oHash.digestInto(out);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to || (to = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
hmac.create = (hash, key) => new HMAC(hash, key);

// node_modules/@scure/starknet/node_modules/@noble/curves/esm/_shortw_utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function getHash(hash) {
  return {
    hash,
    hmac: (key, ...msgs) => hmac(hash, key, concatBytes3(...msgs)),
    randomBytes
  };
}

// node_modules/@scure/starknet/lib/esm/index.js
/*! scure-starknet - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var CURVE_ORDER = BigInt("3618502788666131213697322783095070105526743751716087489154079457884512865583");
var MAX_VALUE = BigInt("0x800000000000000000000000000000000000000000000000000000000000000");
var nBitLength = 252;
function bits2int(bytes) {
  while (bytes[0] === 0)
    bytes = bytes.subarray(1);
  const delta = bytes.length * 8 - nBitLength;
  const num = bytesToNumberBE2(bytes);
  return delta > 0 ? num >> BigInt(delta) : num;
}
function hex0xToBytes(hex) {
  if (typeof hex === "string") {
    hex = strip0x(hex);
    if (hex.length & 1)
      hex = "0" + hex;
  }
  return hexToBytes2(hex);
}
var curve = weierstrass({
  a: BigInt(1),
  // Params: a, b
  b: BigInt("3141592653589793238462643383279502884197169399375105820974944592307816406665"),
  // Field over which we'll do calculations; 2n**251n + 17n * 2n**192n + 1n
  // There is no efficient sqrt for field (P%4==1)
  Fp: Field(BigInt("0x800000000000011000000000000000000000000000000000000000000000001")),
  n: CURVE_ORDER,
  // Curve order, total count of valid points in the field.
  nBitLength,
  // len(bin(N).replace('0b',''))
  // Base point (x, y) aka generator point
  Gx: BigInt("874739451078007766457464989774322083649278607533249481151382481072868806602"),
  Gy: BigInt("152666792071518830868575557812948353041420400780739481342941381225525861407"),
  h: BigInt(1),
  // cofactor
  lowS: false,
  // Allow high-s signatures
  ...getHash(sha2562),
  // Custom truncation routines for stark curve
  bits2int,
  bits2int_modN: (bytes) => {
    const hex = bytesToNumberBE2(bytes).toString(16);
    if (hex.length === 63)
      bytes = hex0xToBytes(hex + "0");
    return mod(bits2int(bytes), CURVE_ORDER);
  }
});
var _starkCurve = curve;
function ensureBytes3(hex) {
  return ensureBytes2("", typeof hex === "string" ? hex0xToBytes(hex) : hex);
}
function normalizePrivateKey(privKey) {
  return bytesToHex2(ensureBytes3(privKey)).padStart(64, "0");
}
function getPublicKey(privKey, isCompressed = false) {
  return curve.getPublicKey(normalizePrivateKey(privKey), isCompressed);
}
function getSharedSecret(privKeyA, pubKeyB) {
  return curve.getSharedSecret(normalizePrivateKey(privKeyA), pubKeyB);
}
function checkSignature(signature) {
  const { r, s } = signature;
  if (r < 0n || r >= MAX_VALUE)
    throw new Error(`Signature.r should be [1, ${MAX_VALUE})`);
  const w = invert(s, CURVE_ORDER);
  if (w < 0n || w >= MAX_VALUE)
    throw new Error(`inv(Signature.s) should be [1, ${MAX_VALUE})`);
}
function checkMessage(msgHash) {
  const bytes = ensureBytes3(msgHash);
  const num = bytesToNumberBE2(bytes);
  if (num >= MAX_VALUE)
    throw new Error(`msgHash should be [0, ${MAX_VALUE})`);
  return bytes;
}
function sign(msgHash, privKey, opts) {
  const sig = curve.sign(checkMessage(msgHash), normalizePrivateKey(privKey), opts);
  checkSignature(sig);
  return sig;
}
function verify(signature, msgHash, pubKey) {
  if (!(signature instanceof Signature)) {
    const bytes = ensureBytes3(signature);
    try {
      signature = Signature.fromDER(bytes);
    } catch (derError) {
      if (!(derError instanceof DER.Err))
        throw derError;
      signature = Signature.fromCompact(bytes);
    }
  }
  checkSignature(signature);
  return curve.verify(signature, checkMessage(msgHash), ensureBytes3(pubKey));
}
var { CURVE, ProjectivePoint, Signature, utils } = curve;
function extractX(bytes) {
  const hex = bytesToHex2(bytes.subarray(1));
  const stripped = hex.replace(/^0+/gm, "");
  return `0x${stripped}`;
}
function strip0x(hex) {
  return hex.replace(/^0x/i, "");
}
function grindKey(seed) {
  const _seed = ensureBytes3(seed);
  const sha256mask = 2n ** 256n;
  const limit = sha256mask - mod(sha256mask, CURVE_ORDER);
  for (let i = 0; ; i++) {
    const key = sha256Num(concatBytes2(_seed, numberToVarBytesBE2(BigInt(i))));
    if (key < limit)
      return mod(key, CURVE_ORDER).toString(16);
    if (i === 1e5)
      throw new Error("grindKey is broken: tried 100k vals");
  }
}
function getStarkKey(privateKey) {
  return extractX(getPublicKey(privateKey, true));
}
function ethSigToPrivate(signature) {
  signature = strip0x(signature);
  if (signature.length !== 130)
    throw new Error("Wrong ethereum signature");
  return grindKey(signature.substring(0, 64));
}
var MASK_31 = 2n ** 31n - 1n;
var int31 = (n) => Number(n & MASK_31);
function getAccountPath(layer, application, ethereumAddress, index) {
  const layerNum = int31(sha256Num(layer));
  const applicationNum = int31(sha256Num(application));
  const eth = hexToNumber2(strip0x(ethereumAddress));
  return `m/2645'/${layerNum}'/${applicationNum}'/${int31(eth)}'/${int31(eth >> 31n)}'/${index}`;
}
var PEDERSEN_POINTS = [
  new ProjectivePoint(2089986280348253421170679821480865132823066470938446095505822317253594081284n, 1713931329540660377023406109199410414810705867260802078187082345529207694986n, 1n),
  new ProjectivePoint(996781205833008774514500082376783249102396023663454813447423147977397232763n, 1668503676786377725805489344771023921079126552019160156920634619255970485781n, 1n),
  new ProjectivePoint(2251563274489750535117886426533222435294046428347329203627021249169616184184n, 1798716007562728905295480679789526322175868328062420237419143593021674992973n, 1n),
  new ProjectivePoint(2138414695194151160943305727036575959195309218611738193261179310511854807447n, 113410276730064486255102093846540133784865286929052426931474106396135072156n, 1n),
  new ProjectivePoint(2379962749567351885752724891227938183011949129833673362440656643086021394946n, 776496453633298175483985398648758586525933812536653089401905292063708816422n, 1n)
];
function pedersenPrecompute(p1, p2) {
  const out = [];
  let p = p1;
  for (let i = 0; i < 248; i++) {
    out.push(p);
    p = p.double();
  }
  p = p2;
  for (let i = 0; i < 4; i++) {
    out.push(p);
    p = p.double();
  }
  return out;
}
var PEDERSEN_POINTS1 = pedersenPrecompute(PEDERSEN_POINTS[1], PEDERSEN_POINTS[2]);
var PEDERSEN_POINTS2 = pedersenPrecompute(PEDERSEN_POINTS[3], PEDERSEN_POINTS[4]);
function pedersenArg(arg) {
  let value;
  if (typeof arg === "bigint") {
    value = arg;
  } else if (typeof arg === "number") {
    if (!Number.isSafeInteger(arg))
      throw new Error(`Invalid pedersenArg: ${arg}`);
    value = BigInt(arg);
  } else {
    value = bytesToNumberBE2(ensureBytes3(arg));
  }
  if (!(0n <= value && value < curve.CURVE.Fp.ORDER))
    throw new Error(`PedersenArg should be 0 <= value < CURVE.P: ${value}`);
  return value;
}
function pedersenSingle(point, value, constants) {
  let x = pedersenArg(value);
  for (let j = 0; j < 252; j++) {
    const pt = constants[j];
    if (!pt)
      throw new Error("invalid constant index");
    if (pt.equals(point))
      throw new Error("Same point");
    if ((x & 1n) !== 0n)
      point = point.add(pt);
    x >>= 1n;
  }
  return point;
}
function pedersen(x, y) {
  let point = PEDERSEN_POINTS[0];
  point = pedersenSingle(point, x, PEDERSEN_POINTS1);
  point = pedersenSingle(point, y, PEDERSEN_POINTS2);
  return extractX(point.toRawBytes(true));
}
var computeHashOnElements = (data, fn = pedersen) => [0, ...data, data.length].reduce((x, y) => fn(x, y));
var MASK_250 = bitMask2(250);
var keccak = (data) => bytesToNumberBE2(keccak_256(data)) & MASK_250;
var sha256Num = (data) => bytesToNumberBE2(sha2562(data));
var Fp251 = Field(BigInt("3618502788666131213697322783095070105623107215331596699973092056135872020481"));
function poseidonRoundConstant(Fp, name, idx) {
  const val = Fp.fromBytes(sha2562(utf8ToBytes3(`${name}${idx}`)));
  return Fp.create(val);
}
function _poseidonMDS(Fp, name, m, attempt = 0) {
  const x_values = [];
  const y_values = [];
  for (let i = 0; i < m; i++) {
    x_values.push(poseidonRoundConstant(Fp, `${name}x`, attempt * m + i));
    y_values.push(poseidonRoundConstant(Fp, `${name}y`, attempt * m + i));
  }
  if ((/* @__PURE__ */ new Set([...x_values, ...y_values])).size !== 2 * m)
    throw new Error("X and Y values are not distinct");
  return x_values.map((x) => y_values.map((y) => Fp.inv(Fp.sub(x, y))));
}
var MDS_SMALL = [
  [3, 1, 1],
  [1, -1, 1],
  [1, 1, -2]
].map((i) => i.map(BigInt));
function poseidonBasic(opts, mds) {
  validateField(opts.Fp);
  if (!Number.isSafeInteger(opts.rate) || !Number.isSafeInteger(opts.capacity))
    throw new Error(`Wrong poseidon opts: ${opts}`);
  const m = opts.rate + opts.capacity;
  const rounds = opts.roundsFull + opts.roundsPartial;
  const roundConstants = [];
  for (let i = 0; i < rounds; i++) {
    const row = [];
    for (let j = 0; j < m; j++)
      row.push(poseidonRoundConstant(opts.Fp, "Hades", m * i + j));
    roundConstants.push(row);
  }
  const res = poseidon({
    ...opts,
    t: m,
    sboxPower: 3,
    reversePartialPowIdx: true,
    // Why?!
    mds,
    roundConstants
  });
  res.m = m;
  res.rate = opts.rate;
  res.capacity = opts.capacity;
  return res;
}
function poseidonCreate(opts, mdsAttempt = 0) {
  const m = opts.rate + opts.capacity;
  if (!Number.isSafeInteger(mdsAttempt))
    throw new Error(`Wrong mdsAttempt=${mdsAttempt}`);
  return poseidonBasic(opts, _poseidonMDS(opts.Fp, "HadesMDS", m, mdsAttempt));
}
var poseidonSmall = poseidonBasic({ Fp: Fp251, rate: 2, capacity: 1, roundsFull: 8, roundsPartial: 83 }, MDS_SMALL);
function poseidonHash(x, y, fn = poseidonSmall) {
  return fn([x, y, 2n])[0];
}
function poseidonHashFunc(x, y, fn = poseidonSmall) {
  return numberToVarBytesBE2(poseidonHash(bytesToNumberBE2(x), bytesToNumberBE2(y), fn));
}
function poseidonHashSingle(x, fn = poseidonSmall) {
  return fn([x, 0n, 1n])[0];
}
function poseidonHashMany(values, fn = poseidonSmall) {
  const { m, rate } = fn;
  if (!Array.isArray(values))
    throw new Error("bigint array expected in values");
  const padded = Array.from(values);
  padded.push(1n);
  while (padded.length % rate !== 0)
    padded.push(0n);
  let state2 = new Array(m).fill(0n);
  for (let i = 0; i < padded.length; i += rate) {
    for (let j = 0; j < rate; j++) {
      const item = padded[i + j];
      if (typeof item === "undefined")
        throw new Error("invalid index");
      if (typeof state2[j] === "undefined")
        throw new Error("state[j] is undefined");
      state2[j] = state2[j] + item;
    }
    state2 = fn(state2);
  }
  return state2[0];
}

// node_modules/starknet/node_modules/@noble/hashes/esm/_u64.js
var U32_MASK642 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n2 = /* @__PURE__ */ BigInt(32);
function fromBig2(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK642), l: Number(n >> _32n2 & U32_MASK642) };
  return { h: Number(n >> _32n2 & U32_MASK642) | 0, l: Number(n & U32_MASK642) | 0 };
}
function split2(lst, le = false) {
  let Ah = new Uint32Array(lst.length);
  let Al = new Uint32Array(lst.length);
  for (let i = 0; i < lst.length; i++) {
    const { h, l } = fromBig2(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var rotlSH2 = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL2 = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH2 = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL2 = (h, l, s) => h << s - 32 | l >>> 64 - s;

// node_modules/starknet/node_modules/@noble/hashes/esm/sha3.js
var SHA3_PI2 = [];
var SHA3_ROTL2 = [];
var _SHA3_IOTA2 = [];
var _0n7 = /* @__PURE__ */ BigInt(0);
var _1n7 = /* @__PURE__ */ BigInt(1);
var _2n6 = /* @__PURE__ */ BigInt(2);
var _7n2 = /* @__PURE__ */ BigInt(7);
var _256n2 = /* @__PURE__ */ BigInt(256);
var _0x71n2 = /* @__PURE__ */ BigInt(113);
for (let round = 0, R = _1n7, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI2.push(2 * (5 * y + x));
  SHA3_ROTL2.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n7;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n7 ^ (R >> _7n2) * _0x71n2) % _256n2;
    if (R & _2n6)
      t ^= _1n7 << (_1n7 << /* @__PURE__ */ BigInt(j)) - _1n7;
  }
  _SHA3_IOTA2.push(t);
}
var [SHA3_IOTA_H2, SHA3_IOTA_L2] = /* @__PURE__ */ split2(_SHA3_IOTA2, true);
var rotlH2 = (h, l, s) => s > 32 ? rotlBH2(h, l, s) : rotlSH2(h, l, s);
var rotlL2 = (h, l, s) => s > 32 ? rotlBL2(h, l, s) : rotlSL2(h, l, s);
function keccakP2(s, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH2(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL2(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL2[t];
      const Th = rotlH2(curH, curL, shift);
      const Tl = rotlL2(curH, curL, shift);
      const PI = SHA3_PI2[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H2[round];
    s[1] ^= SHA3_IOTA_L2[round];
  }
  B.fill(0);
}
var Keccak2 = class _Keccak extends Hash {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    super();
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    anumber2(outputLen);
    if (0 >= this.blockLen || this.blockLen >= 200)
      throw new Error("Sha3 supports only keccak-f1600 function");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  keccak() {
    if (!isLE)
      byteSwap32(this.state32);
    keccakP2(this.state32, this.rounds);
    if (!isLE)
      byteSwap32(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists(this);
    const { blockLen, state: state2 } = this;
    data = toBytes(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state2[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state: state2, suffix, pos, blockLen } = this;
    state2[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state2[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists(this, false);
    abytes3(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber2(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    this.state.fill(0);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var gen2 = (suffix, blockLen, outputLen) => wrapConstructor(() => new Keccak2(blockLen, suffix, outputLen));
var sha3_2242 = /* @__PURE__ */ gen2(6, 144, 224 / 8);
var sha3_2562 = /* @__PURE__ */ gen2(6, 136, 256 / 8);
var sha3_3842 = /* @__PURE__ */ gen2(6, 104, 384 / 8);
var sha3_5122 = /* @__PURE__ */ gen2(6, 72, 512 / 8);
var keccak_2242 = /* @__PURE__ */ gen2(1, 144, 224 / 8);
var keccak_2562 = /* @__PURE__ */ gen2(1, 136, 256 / 8);
var keccak_3842 = /* @__PURE__ */ gen2(1, 104, 384 / 8);
var keccak_5122 = /* @__PURE__ */ gen2(1, 72, 512 / 8);
var genShake2 = (suffix, blockLen, outputLen) => wrapXOFConstructorWithOpts((opts = {}) => new Keccak2(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, true));
var shake1282 = /* @__PURE__ */ genShake2(31, 168, 128 / 8);
var shake2562 = /* @__PURE__ */ genShake2(31, 136, 256 / 8);

// node_modules/starknet/node_modules/@noble/curves/esm/abstract/weierstrass.js
var weierstrass_exports = {};
__export(weierstrass_exports, {
  DER: () => DER2,
  SWUFpSqrtRatio: () => SWUFpSqrtRatio,
  mapToCurveSimpleSWU: () => mapToCurveSimpleSWU,
  weierstrass: () => weierstrass2,
  weierstrassPoints: () => weierstrassPoints2
});

// node_modules/starknet/node_modules/@noble/curves/esm/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n8 = BigInt(0);
var _1n8 = BigInt(1);
var _2n7 = /* @__PURE__ */ BigInt(2);
var _3n3 = /* @__PURE__ */ BigInt(3);
var _4n3 = /* @__PURE__ */ BigInt(4);
var _5n2 = /* @__PURE__ */ BigInt(5);
var _8n2 = /* @__PURE__ */ BigInt(8);
var _9n2 = /* @__PURE__ */ BigInt(9);
var _16n2 = /* @__PURE__ */ BigInt(16);
function mod2(a, b) {
  const result = a % b;
  return result >= _0n8 ? result : b + result;
}
function pow2(num, power, modulo) {
  if (power < _0n8)
    throw new Error("invalid exponent, negatives unsupported");
  if (modulo <= _0n8)
    throw new Error("invalid modulus");
  if (modulo === _1n8)
    return _0n8;
  let res = _1n8;
  while (power > _0n8) {
    if (power & _1n8)
      res = res * num % modulo;
    num = num * num % modulo;
    power >>= _1n8;
  }
  return res;
}
function pow22(x, power, modulo) {
  let res = x;
  while (power-- > _0n8) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert2(number, modulo) {
  if (number === _0n8)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n8)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod2(number, modulo);
  let b = modulo;
  let x = _0n8, y = _1n8, u = _1n8, v = _0n8;
  while (a !== _0n8) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd2 = b;
  if (gcd2 !== _1n8)
    throw new Error("invert: does not exist");
  return mod2(x, modulo);
}
function tonelliShanks2(P) {
  const legendreC = (P - _1n8) / _2n7;
  let Q, S, Z;
  for (Q = P - _1n8, S = 0; Q % _2n7 === _0n8; Q /= _2n7, S++)
    ;
  for (Z = _2n7; Z < P && pow2(Z, legendreC, P) !== P - _1n8; Z++) {
    if (Z > 1e3)
      throw new Error("Cannot find square root: likely non-prime P");
  }
  if (S === 1) {
    const p1div4 = (P + _1n8) / _4n3;
    return function tonelliFast(Fp, n) {
      const root = Fp.pow(n, p1div4);
      if (!Fp.eql(Fp.sqr(root), n))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  const Q1div2 = (Q + _1n8) / _2n7;
  return function tonelliSlow(Fp, n) {
    if (Fp.pow(n, legendreC) === Fp.neg(Fp.ONE))
      throw new Error("Cannot find square root");
    let r = S;
    let g = Fp.pow(Fp.mul(Fp.ONE, Z), Q);
    let x = Fp.pow(n, Q1div2);
    let b = Fp.pow(n, Q);
    while (!Fp.eql(b, Fp.ONE)) {
      if (Fp.eql(b, Fp.ZERO))
        return Fp.ZERO;
      let m = 1;
      for (let t2 = Fp.sqr(b); m < r; m++) {
        if (Fp.eql(t2, Fp.ONE))
          break;
        t2 = Fp.sqr(t2);
      }
      const ge = Fp.pow(g, _1n8 << BigInt(r - m - 1));
      g = Fp.sqr(ge);
      x = Fp.mul(x, ge);
      b = Fp.mul(b, g);
      r = m;
    }
    return x;
  };
}
function FpSqrt2(P) {
  if (P % _4n3 === _3n3) {
    const p1div4 = (P + _1n8) / _4n3;
    return function sqrt3mod4(Fp, n) {
      const root = Fp.pow(n, p1div4);
      if (!Fp.eql(Fp.sqr(root), n))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  if (P % _8n2 === _5n2) {
    const c1 = (P - _5n2) / _8n2;
    return function sqrt5mod8(Fp, n) {
      const n2 = Fp.mul(n, _2n7);
      const v = Fp.pow(n2, c1);
      const nv = Fp.mul(n, v);
      const i = Fp.mul(Fp.mul(nv, _2n7), v);
      const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
      if (!Fp.eql(Fp.sqr(root), n))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  if (P % _16n2 === _9n2) {
  }
  return tonelliShanks2(P);
}
var FIELD_FIELDS2 = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField2(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "isSafeInteger",
    BITS: "isSafeInteger"
  };
  const opts = FIELD_FIELDS2.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  return validateObject(field, opts);
}
function FpPow2(f, num, power) {
  if (power < _0n8)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n8)
    return f.ONE;
  if (power === _1n8)
    return num;
  let p = f.ONE;
  let d = num;
  while (power > _0n8) {
    if (power & _1n8)
      p = f.mul(p, d);
    d = f.sqr(d);
    power >>= _1n8;
  }
  return p;
}
function FpInvertBatch2(f, nums) {
  const tmp = new Array(nums.length);
  const lastMultiplied = nums.reduce((acc, num, i) => {
    if (f.is0(num))
      return acc;
    tmp[i] = acc;
    return f.mul(acc, num);
  }, f.ONE);
  const inverted = f.inv(lastMultiplied);
  nums.reduceRight((acc, num, i) => {
    if (f.is0(num))
      return acc;
    tmp[i] = f.mul(acc, tmp[i]);
    return f.mul(acc, num);
  }, inverted);
  return tmp;
}
function nLength2(n, nBitLength2) {
  const _nBitLength = nBitLength2 !== void 0 ? nBitLength2 : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field2(ORDER, bitLen3, isLE4 = false, redef = {}) {
  if (ORDER <= _0n8)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  const { nBitLength: BITS, nByteLength: BYTES } = nLength2(ORDER, bitLen3);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n8,
    ONE: _1n8,
    create: (num) => mod2(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n8 <= num && num < ORDER;
    },
    is0: (num) => num === _0n8,
    isOdd: (num) => (num & _1n8) === _1n8,
    neg: (num) => mod2(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod2(num * num, ORDER),
    add: (lhs, rhs) => mod2(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod2(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod2(lhs * rhs, ORDER),
    pow: (num, power) => FpPow2(f, num, power),
    div: (lhs, rhs) => mod2(lhs * invert2(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert2(num, ORDER),
    sqrt: redef.sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt2(ORDER);
      return sqrtP(f, n);
    }),
    invertBatch: (lst) => FpInvertBatch2(f, lst),
    // TODO: do we really need constant cmov?
    // We don't have const-time bigints anyway, so probably will be not very useful
    cmov: (a, b, c) => c ? b : a,
    toBytes: (num) => isLE4 ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes) => {
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      return isLE4 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    }
  });
  return Object.freeze(f);
}
function getFieldBytesLength2(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  const bitLength = fieldOrder.toString(2).length;
  return Math.ceil(bitLength / 8);
}
function getMinHashLength2(fieldOrder) {
  const length = getFieldBytesLength2(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField2(key, fieldOrder, isLE4 = false) {
  const len = key.length;
  const fieldLen = getFieldBytesLength2(fieldOrder);
  const minLen = getMinHashLength2(fieldOrder);
  if (len < 16 || len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE4 ? bytesToNumberBE(key) : bytesToNumberLE(key);
  const reduced = mod2(num, fieldOrder - _1n8) + _1n8;
  return isLE4 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// node_modules/starknet/node_modules/@noble/curves/esm/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n9 = BigInt(0);
var _1n9 = BigInt(1);
function constTimeNegate2(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function validateW2(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts2(W, bits) {
  validateW2(W, bits);
  const windows = Math.ceil(bits / W) + 1;
  const windowSize = 2 ** (W - 1);
  return { windows, windowSize };
}
function validateMSMPoints2(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars2(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes2 = /* @__PURE__ */ new WeakMap();
var pointWindowSizes2 = /* @__PURE__ */ new WeakMap();
function getW2(P) {
  return pointWindowSizes2.get(P) || 1;
}
function wNAF2(c, bits) {
  return {
    constTimeNegate: constTimeNegate2,
    hasPrecomputes(elm) {
      return getW2(elm) !== 1;
    },
    // non-const time multiplication ladder
    unsafeLadder(elm, n, p = c.ZERO) {
      let d = elm;
      while (n > _0n9) {
        if (n & _1n9)
          p = p.add(d);
        d = d.double();
        n >>= _1n9;
      }
      return p;
    },
    /**
     * Creates a wNAF precomputation window. Used for caching.
     * Default window size is set by `utils.precompute()` and is equal to 8.
     * Number of precomputed points depends on the curve size:
     * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
     * - 𝑊 is the window size
     * - 𝑛 is the bitlength of the curve order.
     * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
     * @param elm Point instance
     * @param W window size
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(elm, W) {
      const { windows, windowSize } = calcWOpts2(W, bits);
      const points = [];
      let p = elm;
      let base = p;
      for (let window2 = 0; window2 < windows; window2++) {
        base = p;
        points.push(base);
        for (let i = 1; i < windowSize; i++) {
          base = base.add(p);
          points.push(base);
        }
        p = base.double();
      }
      return points;
    },
    /**
     * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @returns real and fake (for const-time) points
     */
    wNAF(W, precomputes, n) {
      const { windows, windowSize } = calcWOpts2(W, bits);
      let p = c.ZERO;
      let f = c.BASE;
      const mask = BigInt(2 ** W - 1);
      const maxNumber = 2 ** W;
      const shiftBy = BigInt(W);
      for (let window2 = 0; window2 < windows; window2++) {
        const offset = window2 * windowSize;
        let wbits = Number(n & mask);
        n >>= shiftBy;
        if (wbits > windowSize) {
          wbits -= maxNumber;
          n += _1n9;
        }
        const offset1 = offset;
        const offset2 = offset + Math.abs(wbits) - 1;
        const cond1 = window2 % 2 !== 0;
        const cond2 = wbits < 0;
        if (wbits === 0) {
          f = f.add(constTimeNegate2(cond1, precomputes[offset1]));
        } else {
          p = p.add(constTimeNegate2(cond2, precomputes[offset2]));
        }
      }
      return { p, f };
    },
    /**
     * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @param acc accumulator point to add result of multiplication
     * @returns point
     */
    wNAFUnsafe(W, precomputes, n, acc = c.ZERO) {
      const { windows, windowSize } = calcWOpts2(W, bits);
      const mask = BigInt(2 ** W - 1);
      const maxNumber = 2 ** W;
      const shiftBy = BigInt(W);
      for (let window2 = 0; window2 < windows; window2++) {
        const offset = window2 * windowSize;
        if (n === _0n9)
          break;
        let wbits = Number(n & mask);
        n >>= shiftBy;
        if (wbits > windowSize) {
          wbits -= maxNumber;
          n += _1n9;
        }
        if (wbits === 0)
          continue;
        let curr = precomputes[offset + Math.abs(wbits) - 1];
        if (wbits < 0)
          curr = curr.negate();
        acc = acc.add(curr);
      }
      return acc;
    },
    getPrecomputes(W, P, transform) {
      let comp = pointPrecomputes2.get(P);
      if (!comp) {
        comp = this.precomputeWindow(P, W);
        if (W !== 1)
          pointPrecomputes2.set(P, transform(comp));
      }
      return comp;
    },
    wNAFCached(P, n, transform) {
      const W = getW2(P);
      return this.wNAF(W, this.getPrecomputes(W, P, transform), n);
    },
    wNAFCachedUnsafe(P, n, transform, prev) {
      const W = getW2(P);
      if (W === 1)
        return this.unsafeLadder(P, n, prev);
      return this.wNAFUnsafe(W, this.getPrecomputes(W, P, transform), n, prev);
    },
    // We calculate precomputes for elliptic curve point multiplication
    // using windowed method. This specifies window size and
    // stores precomputed values. Usually only base point would be precomputed.
    setWindowSize(P, W) {
      validateW2(W, bits);
      pointWindowSizes2.set(P, W);
      pointPrecomputes2.delete(P);
    }
  };
}
function pippenger2(c, fieldN, points, scalars) {
  validateMSMPoints2(points, c);
  validateMSMScalars2(scalars, fieldN);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen(BigInt(points.length));
  const windowSize = wbits > 12 ? wbits - 3 : wbits > 4 ? wbits - 2 : wbits ? 2 : 1;
  const MASK = (1 << windowSize) - 1;
  const buckets = new Array(MASK + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits; i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0; j < scalars.length; j++) {
      const scalar = scalars[j];
      const wbits2 = Number(scalar >> BigInt(i) & BigInt(MASK));
      buckets[wbits2] = buckets[wbits2].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0; j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function validateBasic2(curve2) {
  validateField2(curve2.Fp);
  validateObject(curve2, {
    n: "bigint",
    h: "bigint",
    Gx: "field",
    Gy: "field"
  }, {
    nBitLength: "isSafeInteger",
    nByteLength: "isSafeInteger"
  });
  return Object.freeze({
    ...nLength2(curve2.n, curve2.nBitLength),
    ...curve2,
    ...{ p: curve2.Fp.ORDER }
  });
}

// node_modules/starknet/node_modules/@noble/curves/esm/abstract/weierstrass.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function validateSigVerOpts2(opts) {
  if (opts.lowS !== void 0)
    abool("lowS", opts.lowS);
  if (opts.prehash !== void 0)
    abool("prehash", opts.prehash);
}
function validatePointOpts2(curve2) {
  const opts = validateBasic2(curve2);
  validateObject(opts, {
    a: "field",
    b: "field"
  }, {
    allowedPrivateKeyLengths: "array",
    wrapPrivateKey: "boolean",
    isTorsionFree: "function",
    clearCofactor: "function",
    allowInfinityPoint: "boolean",
    fromBytes: "function",
    toBytes: "function"
  });
  const { endo, Fp, a } = opts;
  if (endo) {
    if (!Fp.eql(a, Fp.ZERO)) {
      throw new Error("invalid endomorphism, can only be defined for Koblitz curves that have a=0");
    }
    if (typeof endo !== "object" || typeof endo.beta !== "bigint" || typeof endo.splitScalar !== "function") {
      throw new Error("invalid endomorphism, expected beta: bigint and splitScalar: function");
    }
  }
  return Object.freeze({ ...opts });
}
var { bytesToNumberBE: b2n2, hexToBytes: h2b2 } = utils_exports;
var DER2 = {
  // asn.1 DER encoding utils
  Err: class DERErr2 extends Error {
    constructor(m = "") {
      super(m);
    }
  },
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = DER2;
      if (tag < 0 || tag > 256)
        throw new E("tlv.encode: wrong tag");
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded(tag);
      return t + lenLen + len + data;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data) {
      const { Err: E } = DER2;
      let pos = 0;
      if (tag < 0 || tag > 256)
        throw new E("tlv.encode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length = 0;
      if (!isLong)
        length = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length = length << 8 | b;
        pos += lenLen;
        if (length < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(num) {
      const { Err: E } = DER2;
      if (num < _0n10)
        throw new E("integer: negative integers are not allowed");
      let hex = numberToHexUnpadded(num);
      if (Number.parseInt(hex[0], 16) & 8)
        hex = "00" + hex;
      if (hex.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex;
    },
    decode(data) {
      const { Err: E } = DER2;
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return b2n2(data);
    }
  },
  toSig(hex) {
    const { Err: E, _int: int, _tlv: tlv } = DER2;
    const data = typeof hex === "string" ? h2b2(hex) : hex;
    abytes2(data);
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = DER2;
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
var _0n10 = BigInt(0);
var _1n10 = BigInt(1);
var _2n8 = BigInt(2);
var _3n4 = BigInt(3);
var _4n4 = BigInt(4);
function weierstrassPoints2(opts) {
  const CURVE2 = validatePointOpts2(opts);
  const { Fp } = CURVE2;
  const Fn = Field2(CURVE2.n, CURVE2.nBitLength);
  const toBytes5 = CURVE2.toBytes || ((_c, point, _isCompressed) => {
    const a = point.toAffine();
    return concatBytes(Uint8Array.from([4]), Fp.toBytes(a.x), Fp.toBytes(a.y));
  });
  const fromBytes = CURVE2.fromBytes || ((bytes) => {
    const tail = bytes.subarray(1);
    const x = Fp.fromBytes(tail.subarray(0, Fp.BYTES));
    const y = Fp.fromBytes(tail.subarray(Fp.BYTES, 2 * Fp.BYTES));
    return { x, y };
  });
  function weierstrassEquation(x) {
    const { a, b } = CURVE2;
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, a)), b);
  }
  if (!Fp.eql(Fp.sqr(CURVE2.Gy), weierstrassEquation(CURVE2.Gx)))
    throw new Error("bad generator point: equation left != right");
  function isWithinCurveOrder(num) {
    return inRange(num, _1n10, CURVE2.n);
  }
  function normPrivateKeyToScalar(key) {
    const { allowedPrivateKeyLengths: lengths, nByteLength, wrapPrivateKey, n: N } = CURVE2;
    if (lengths && typeof key !== "bigint") {
      if (isBytes2(key))
        key = bytesToHex(key);
      if (typeof key !== "string" || !lengths.includes(key.length))
        throw new Error("invalid private key");
      key = key.padStart(nByteLength * 2, "0");
    }
    let num;
    try {
      num = typeof key === "bigint" ? key : bytesToNumberBE(ensureBytes("private key", key, nByteLength));
    } catch (error) {
      throw new Error("invalid private key, expected hex or " + nByteLength + " bytes, got " + typeof key);
    }
    if (wrapPrivateKey)
      num = mod2(num, N);
    aInRange("private key", num, _1n10, N);
    return num;
  }
  function assertPrjPoint(other) {
    if (!(other instanceof Point2))
      throw new Error("ProjectivePoint expected");
  }
  const toAffineMemo = memoized((p, iz) => {
    const { px: x, py: y, pz: z } = p;
    if (Fp.eql(z, Fp.ONE))
      return { x, y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp.ONE : Fp.inv(z);
    const ax = Fp.mul(x, iz);
    const ay = Fp.mul(y, iz);
    const zz = Fp.mul(z, iz);
    if (is0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (!Fp.eql(zz, Fp.ONE))
      throw new Error("invZ was invalid");
    return { x: ax, y: ay };
  });
  const assertValidMemo = memoized((p) => {
    if (p.is0()) {
      if (CURVE2.allowInfinityPoint && !Fp.is0(p.py))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp.isValid(x) || !Fp.isValid(y))
      throw new Error("bad point: x or y not FE");
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    if (!Fp.eql(left, right))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  class Point2 {
    constructor(px, py, pz) {
      this.px = px;
      this.py = py;
      this.pz = pz;
      if (px == null || !Fp.isValid(px))
        throw new Error("x required");
      if (py == null || !Fp.isValid(py))
        throw new Error("y required");
      if (pz == null || !Fp.isValid(pz))
        throw new Error("z required");
      Object.freeze(this);
    }
    // Does not validate if the point is on-curve.
    // Use fromHex instead, or call assertValidity() later.
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point2)
        throw new Error("projective point not allowed");
      const is0 = (i) => Fp.eql(i, Fp.ZERO);
      if (is0(x) && is0(y))
        return Point2.ZERO;
      return new Point2(x, y, Fp.ONE);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * Takes a bunch of Projective Points but executes only one
     * inversion on all of them. Inversion is very slow operation,
     * so this improves performance massively.
     * Optimization: converts a list of projective points to a list of identical points with Z=1.
     */
    static normalizeZ(points) {
      const toInv = Fp.invertBatch(points.map((p) => p.pz));
      return points.map((p, i) => p.toAffine(toInv[i])).map(Point2.fromAffine);
    }
    /**
     * Converts hash string or Uint8Array to Point.
     * @param hex short/long ECDSA hex
     */
    static fromHex(hex) {
      const P = Point2.fromAffine(fromBytes(ensureBytes("pointHex", hex)));
      P.assertValidity();
      return P;
    }
    // Multiplies generator point by privateKey.
    static fromPrivateKey(privateKey) {
      return Point2.BASE.multiply(normPrivateKeyToScalar(privateKey));
    }
    // Multiscalar Multiplication
    static msm(points, scalars) {
      return pippenger2(Point2, Fn, points, scalars);
    }
    // "Private method", don't use it directly
    _setWindowSize(windowSize) {
      wnaf.setWindowSize(this, windowSize);
    }
    // A point on curve is valid if it conforms to equation.
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (Fp.isOdd)
        return !Fp.isOdd(y);
      throw new Error("Field doesn't support isOdd");
    }
    /**
     * Compare one point to another.
     */
    equals(other) {
      assertPrjPoint(other);
      const { px: X1, py: Y1, pz: Z1 } = this;
      const { px: X2, py: Y2, pz: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /**
     * Flips point to one corresponding to (x, -y) in Affine coordinates.
     */
    negate() {
      return new Point2(this.px, Fp.neg(this.py), this.pz);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a, b } = CURVE2;
      const b3 = Fp.mul(b, _3n4);
      const { px: X1, py: Y1, pz: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = Fp.mul(a, Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = Fp.mul(a, t2);
      t3 = Fp.sub(t0, t2);
      t3 = Fp.mul(a, t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point2(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      assertPrjPoint(other);
      const { px: X1, py: Y1, pz: Z1 } = this;
      const { px: X2, py: Y2, pz: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      const a = CURVE2.a;
      const b3 = Fp.mul(CURVE2.b, _3n4);
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = Fp.mul(a, t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = Fp.mul(a, t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = Fp.mul(a, t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point2(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point2.ZERO);
    }
    wNAF(n) {
      return wnaf.wNAFCached(this, n, Point2.normalizeZ);
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed private key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(sc) {
      const { endo, n: N } = CURVE2;
      aInRange("scalar", sc, _0n10, N);
      const I = Point2.ZERO;
      if (sc === _0n10)
        return I;
      if (this.is0() || sc === _1n10)
        return this;
      if (!endo || wnaf.hasPrecomputes(this))
        return wnaf.wNAFCachedUnsafe(this, sc, Point2.normalizeZ);
      let { k1neg, k1, k2neg, k2 } = endo.splitScalar(sc);
      let k1p = I;
      let k2p = I;
      let d = this;
      while (k1 > _0n10 || k2 > _0n10) {
        if (k1 & _1n10)
          k1p = k1p.add(d);
        if (k2 & _1n10)
          k2p = k2p.add(d);
        d = d.double();
        k1 >>= _1n10;
        k2 >>= _1n10;
      }
      if (k1neg)
        k1p = k1p.negate();
      if (k2neg)
        k2p = k2p.negate();
      k2p = new Point2(Fp.mul(k2p.px, endo.beta), k2p.py, k2p.pz);
      return k1p.add(k2p);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      const { endo, n: N } = CURVE2;
      aInRange("scalar", scalar, _1n10, N);
      let point, fake;
      if (endo) {
        const { k1neg, k1, k2neg, k2 } = endo.splitScalar(scalar);
        let { p: k1p, f: f1p } = this.wNAF(k1);
        let { p: k2p, f: f2p } = this.wNAF(k2);
        k1p = wnaf.constTimeNegate(k1neg, k1p);
        k2p = wnaf.constTimeNegate(k2neg, k2p);
        k2p = new Point2(Fp.mul(k2p.px, endo.beta), k2p.py, k2p.pz);
        point = k1p.add(k2p);
        fake = f1p.add(f2p);
      } else {
        const { p, f } = this.wNAF(scalar);
        point = p;
        fake = f;
      }
      return Point2.normalizeZ([point, fake])[0];
    }
    /**
     * Efficiently calculate `aP + bQ`. Unsafe, can expose private key, if used incorrectly.
     * Not using Strauss-Shamir trick: precomputation tables are faster.
     * The trick could be useful if both P and Q are not G (not in our case).
     * @returns non-zero affine point
     */
    multiplyAndAddUnsafe(Q, a, b) {
      const G = Point2.BASE;
      const mul = (P, a2) => a2 === _0n10 || a2 === _1n10 || !P.equals(G) ? P.multiplyUnsafe(a2) : P.multiply(a2);
      const sum = mul(this, a).add(mul(Q, b));
      return sum.is0() ? void 0 : sum;
    }
    // Converts Projective point to affine (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    // (x, y, z) ∋ (x=x/z, y=y/z)
    toAffine(iz) {
      return toAffineMemo(this, iz);
    }
    isTorsionFree() {
      const { h: cofactor, isTorsionFree } = CURVE2;
      if (cofactor === _1n10)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point2, this);
      throw new Error("isTorsionFree() has not been declared for the elliptic curve");
    }
    clearCofactor() {
      const { h: cofactor, clearCofactor } = CURVE2;
      if (cofactor === _1n10)
        return this;
      if (clearCofactor)
        return clearCofactor(Point2, this);
      return this.multiplyUnsafe(CURVE2.h);
    }
    toRawBytes(isCompressed = true) {
      abool("isCompressed", isCompressed);
      this.assertValidity();
      return toBytes5(Point2, this, isCompressed);
    }
    toHex(isCompressed = true) {
      abool("isCompressed", isCompressed);
      return bytesToHex(this.toRawBytes(isCompressed));
    }
  }
  Point2.BASE = new Point2(CURVE2.Gx, CURVE2.Gy, Fp.ONE);
  Point2.ZERO = new Point2(Fp.ZERO, Fp.ONE, Fp.ZERO);
  const _bits = CURVE2.nBitLength;
  const wnaf = wNAF2(Point2, CURVE2.endo ? Math.ceil(_bits / 2) : _bits);
  return {
    CURVE: CURVE2,
    ProjectivePoint: Point2,
    normPrivateKeyToScalar,
    weierstrassEquation,
    isWithinCurveOrder
  };
}
function validateOpts3(curve2) {
  const opts = validateBasic2(curve2);
  validateObject(opts, {
    hash: "hash",
    hmac: "function",
    randomBytes: "function"
  }, {
    bits2int: "function",
    bits2int_modN: "function",
    lowS: "boolean"
  });
  return Object.freeze({ lowS: true, ...opts });
}
function weierstrass2(curveDef) {
  const CURVE2 = validateOpts3(curveDef);
  const { Fp, n: CURVE_ORDER2 } = CURVE2;
  const compressedLen = Fp.BYTES + 1;
  const uncompressedLen = 2 * Fp.BYTES + 1;
  function modN(a) {
    return mod2(a, CURVE_ORDER2);
  }
  function invN(a) {
    return invert2(a, CURVE_ORDER2);
  }
  const { ProjectivePoint: Point2, normPrivateKeyToScalar, weierstrassEquation, isWithinCurveOrder } = weierstrassPoints2({
    ...CURVE2,
    toBytes(_c, point, isCompressed) {
      const a = point.toAffine();
      const x = Fp.toBytes(a.x);
      const cat = concatBytes;
      abool("isCompressed", isCompressed);
      if (isCompressed) {
        return cat(Uint8Array.from([point.hasEvenY() ? 2 : 3]), x);
      } else {
        return cat(Uint8Array.from([4]), x, Fp.toBytes(a.y));
      }
    },
    fromBytes(bytes) {
      const len = bytes.length;
      const head = bytes[0];
      const tail = bytes.subarray(1);
      if (len === compressedLen && (head === 2 || head === 3)) {
        const x = bytesToNumberBE(tail);
        if (!inRange(x, _1n10, Fp.ORDER))
          throw new Error("Point is not on curve");
        const y2 = weierstrassEquation(x);
        let y;
        try {
          y = Fp.sqrt(y2);
        } catch (sqrtError) {
          const suffix = sqrtError instanceof Error ? ": " + sqrtError.message : "";
          throw new Error("Point is not on curve" + suffix);
        }
        const isYOdd = (y & _1n10) === _1n10;
        const isHeadOdd = (head & 1) === 1;
        if (isHeadOdd !== isYOdd)
          y = Fp.neg(y);
        return { x, y };
      } else if (len === uncompressedLen && head === 4) {
        const x = Fp.fromBytes(tail.subarray(0, Fp.BYTES));
        const y = Fp.fromBytes(tail.subarray(Fp.BYTES, 2 * Fp.BYTES));
        return { x, y };
      } else {
        const cl = compressedLen;
        const ul = uncompressedLen;
        throw new Error("invalid Point, expected length of " + cl + ", or uncompressed " + ul + ", got " + len);
      }
    }
  });
  const numToNByteStr = (num) => bytesToHex(numberToBytesBE(num, CURVE2.nByteLength));
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER2 >> _1n10;
    return number > HALF;
  }
  function normalizeS(s) {
    return isBiggerThanHalfOrder(s) ? modN(-s) : s;
  }
  const slcNum = (b, from, to) => bytesToNumberBE(b.slice(from, to));
  class Signature2 {
    constructor(r, s, recovery) {
      this.r = r;
      this.s = s;
      this.recovery = recovery;
      this.assertValidity();
    }
    // pair (bytes of r, bytes of s)
    static fromCompact(hex) {
      const l = CURVE2.nByteLength;
      hex = ensureBytes("compactSignature", hex, l * 2);
      return new Signature2(slcNum(hex, 0, l), slcNum(hex, l, 2 * l));
    }
    // DER encoded ECDSA signature
    // https://bitcoin.stackexchange.com/questions/57644/what-are-the-parts-of-a-bitcoin-transaction-input-script
    static fromDER(hex) {
      const { r, s } = DER2.toSig(ensureBytes("DER", hex));
      return new Signature2(r, s);
    }
    assertValidity() {
      aInRange("r", this.r, _1n10, CURVE_ORDER2);
      aInRange("s", this.s, _1n10, CURVE_ORDER2);
    }
    addRecoveryBit(recovery) {
      return new Signature2(this.r, this.s, recovery);
    }
    recoverPublicKey(msgHash) {
      const { r, s, recovery: rec } = this;
      const h = bits2int_modN(ensureBytes("msgHash", msgHash));
      if (rec == null || ![0, 1, 2, 3].includes(rec))
        throw new Error("recovery id invalid");
      const radj = rec === 2 || rec === 3 ? r + CURVE2.n : r;
      if (radj >= Fp.ORDER)
        throw new Error("recovery id 2 or 3 invalid");
      const prefix = (rec & 1) === 0 ? "02" : "03";
      const R = Point2.fromHex(prefix + numToNByteStr(radj));
      const ir = invN(radj);
      const u1 = modN(-h * ir);
      const u2 = modN(s * ir);
      const Q = Point2.BASE.multiplyAndAddUnsafe(R, u1, u2);
      if (!Q)
        throw new Error("point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    normalizeS() {
      return this.hasHighS() ? new Signature2(this.r, modN(-this.s), this.recovery) : this;
    }
    // DER-encoded
    toDERRawBytes() {
      return hexToBytes(this.toDERHex());
    }
    toDERHex() {
      return DER2.hexFromSig({ r: this.r, s: this.s });
    }
    // padded bytes of r, then padded bytes of s
    toCompactRawBytes() {
      return hexToBytes(this.toCompactHex());
    }
    toCompactHex() {
      return numToNByteStr(this.r) + numToNByteStr(this.s);
    }
  }
  const utils2 = {
    isValidPrivateKey(privateKey) {
      try {
        normPrivateKeyToScalar(privateKey);
        return true;
      } catch (error) {
        return false;
      }
    },
    normPrivateKeyToScalar,
    /**
     * Produces cryptographically secure private key from random of size
     * (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
     */
    randomPrivateKey: () => {
      const length = getMinHashLength2(CURVE2.n);
      return mapHashToField2(CURVE2.randomBytes(length), CURVE2.n);
    },
    /**
     * Creates precompute table for an arbitrary EC point. Makes point "cached".
     * Allows to massively speed-up `point.multiply(scalar)`.
     * @returns cached point
     * @example
     * const fast = utils.precompute(8, ProjectivePoint.fromHex(someonesPubKey));
     * fast.multiply(privKey); // much faster ECDH now
     */
    precompute(windowSize = 8, point = Point2.BASE) {
      point._setWindowSize(windowSize);
      point.multiply(BigInt(3));
      return point;
    }
  };
  function getPublicKey2(privateKey, isCompressed = true) {
    return Point2.fromPrivateKey(privateKey).toRawBytes(isCompressed);
  }
  function isProbPub(item) {
    const arr = isBytes2(item);
    const str = typeof item === "string";
    const len = (arr || str) && item.length;
    if (arr)
      return len === compressedLen || len === uncompressedLen;
    if (str)
      return len === 2 * compressedLen || len === 2 * uncompressedLen;
    if (item instanceof Point2)
      return true;
    return false;
  }
  function getSharedSecret3(privateA, publicB, isCompressed = true) {
    if (isProbPub(privateA))
      throw new Error("first arg must be private key");
    if (!isProbPub(publicB))
      throw new Error("second arg must be public key");
    const b = Point2.fromHex(publicB);
    return b.multiply(normPrivateKeyToScalar(privateA)).toRawBytes(isCompressed);
  }
  const bits2int2 = CURVE2.bits2int || function(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE(bytes);
    const delta = bytes.length * 8 - CURVE2.nBitLength;
    return delta > 0 ? num >> BigInt(delta) : num;
  };
  const bits2int_modN = CURVE2.bits2int_modN || function(bytes) {
    return modN(bits2int2(bytes));
  };
  const ORDER_MASK = bitMask(CURVE2.nBitLength);
  function int2octets(num) {
    aInRange("num < 2^" + CURVE2.nBitLength, num, _0n10, ORDER_MASK);
    return numberToBytesBE(num, CURVE2.nByteLength);
  }
  function prepSig(msgHash, privateKey, opts = defaultSigOpts) {
    if (["recovered", "canonical"].some((k) => k in opts))
      throw new Error("sign() legacy options not supported");
    const { hash, randomBytes: randomBytes3 } = CURVE2;
    let { lowS, prehash, extraEntropy: ent } = opts;
    if (lowS == null)
      lowS = true;
    msgHash = ensureBytes("msgHash", msgHash);
    validateSigVerOpts2(opts);
    if (prehash)
      msgHash = ensureBytes("prehashed msgHash", hash(msgHash));
    const h1int = bits2int_modN(msgHash);
    const d = normPrivateKeyToScalar(privateKey);
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (ent != null && ent !== false) {
      const e = ent === true ? randomBytes3(Fp.BYTES) : ent;
      seedArgs.push(ensureBytes("extraEntropy", e));
    }
    const seed = concatBytes(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int2(kBytes);
      if (!isWithinCurveOrder(k))
        return;
      const ik = invN(k);
      const q = Point2.BASE.multiply(k).toAffine();
      const r = modN(q.x);
      if (r === _0n10)
        return;
      const s = modN(ik * modN(m + r * d));
      if (s === _0n10)
        return;
      let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n10);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = normalizeS(s);
        recovery ^= 1;
      }
      return new Signature2(r, normS, recovery);
    }
    return { seed, k2sig };
  }
  const defaultSigOpts = { lowS: CURVE2.lowS, prehash: false };
  const defaultVerOpts = { lowS: CURVE2.lowS, prehash: false };
  function sign2(msgHash, privKey, opts = defaultSigOpts) {
    const { seed, k2sig } = prepSig(msgHash, privKey, opts);
    const C = CURVE2;
    const drbg = createHmacDrbg(C.hash.outputLen, C.nByteLength, C.hmac);
    return drbg(seed, k2sig);
  }
  Point2.BASE._setWindowSize(8);
  function verify2(signature, msgHash, publicKey2, opts = defaultVerOpts) {
    const sg = signature;
    msgHash = ensureBytes("msgHash", msgHash);
    publicKey2 = ensureBytes("publicKey", publicKey2);
    const { lowS, prehash, format } = opts;
    validateSigVerOpts2(opts);
    if ("strict" in opts)
      throw new Error("options.strict was renamed to lowS");
    if (format !== void 0 && format !== "compact" && format !== "der")
      throw new Error("format must be compact or der");
    const isHex3 = typeof sg === "string" || isBytes2(sg);
    const isObj = !isHex3 && !format && typeof sg === "object" && sg !== null && typeof sg.r === "bigint" && typeof sg.s === "bigint";
    if (!isHex3 && !isObj)
      throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
    let _sig = void 0;
    let P;
    try {
      if (isObj)
        _sig = new Signature2(sg.r, sg.s);
      if (isHex3) {
        try {
          if (format !== "compact")
            _sig = Signature2.fromDER(sg);
        } catch (derError) {
          if (!(derError instanceof DER2.Err))
            throw derError;
        }
        if (!_sig && format !== "der")
          _sig = Signature2.fromCompact(sg);
      }
      P = Point2.fromHex(publicKey2);
    } catch (error) {
      return false;
    }
    if (!_sig)
      return false;
    if (lowS && _sig.hasHighS())
      return false;
    if (prehash)
      msgHash = CURVE2.hash(msgHash);
    const { r, s } = _sig;
    const h = bits2int_modN(msgHash);
    const is = invN(s);
    const u1 = modN(h * is);
    const u2 = modN(r * is);
    const R = Point2.BASE.multiplyAndAddUnsafe(P, u1, u2)?.toAffine();
    if (!R)
      return false;
    const v = modN(R.x);
    return v === r;
  }
  return {
    CURVE: CURVE2,
    getPublicKey: getPublicKey2,
    getSharedSecret: getSharedSecret3,
    sign: sign2,
    verify: verify2,
    ProjectivePoint: Point2,
    Signature: Signature2,
    utils: utils2
  };
}
function SWUFpSqrtRatio(Fp, Z) {
  const q = Fp.ORDER;
  let l = _0n10;
  for (let o = q - _1n10; o % _2n8 === _0n10; o /= _2n8)
    l += _1n10;
  const c1 = l;
  const _2n_pow_c1_1 = _2n8 << c1 - _1n10 - _1n10;
  const _2n_pow_c1 = _2n_pow_c1_1 * _2n8;
  const c2 = (q - _1n10) / _2n_pow_c1;
  const c3 = (c2 - _1n10) / _2n8;
  const c4 = _2n_pow_c1 - _1n10;
  const c5 = _2n_pow_c1_1;
  const c6 = Fp.pow(Z, c2);
  const c7 = Fp.pow(Z, (c2 + _1n10) / _2n8);
  let sqrtRatio = (u, v) => {
    let tv1 = c6;
    let tv2 = Fp.pow(v, c4);
    let tv3 = Fp.sqr(tv2);
    tv3 = Fp.mul(tv3, v);
    let tv5 = Fp.mul(u, tv3);
    tv5 = Fp.pow(tv5, c3);
    tv5 = Fp.mul(tv5, tv2);
    tv2 = Fp.mul(tv5, v);
    tv3 = Fp.mul(tv5, u);
    let tv4 = Fp.mul(tv3, tv2);
    tv5 = Fp.pow(tv4, c5);
    let isQR = Fp.eql(tv5, Fp.ONE);
    tv2 = Fp.mul(tv3, c7);
    tv5 = Fp.mul(tv4, tv1);
    tv3 = Fp.cmov(tv2, tv3, isQR);
    tv4 = Fp.cmov(tv5, tv4, isQR);
    for (let i = c1; i > _1n10; i--) {
      let tv52 = i - _2n8;
      tv52 = _2n8 << tv52 - _1n10;
      let tvv5 = Fp.pow(tv4, tv52);
      const e1 = Fp.eql(tvv5, Fp.ONE);
      tv2 = Fp.mul(tv3, tv1);
      tv1 = Fp.mul(tv1, tv1);
      tvv5 = Fp.mul(tv4, tv1);
      tv3 = Fp.cmov(tv2, tv3, e1);
      tv4 = Fp.cmov(tvv5, tv4, e1);
    }
    return { isValid: isQR, value: tv3 };
  };
  if (Fp.ORDER % _4n4 === _3n4) {
    const c12 = (Fp.ORDER - _3n4) / _4n4;
    const c22 = Fp.sqrt(Fp.neg(Z));
    sqrtRatio = (u, v) => {
      let tv1 = Fp.sqr(v);
      const tv2 = Fp.mul(u, v);
      tv1 = Fp.mul(tv1, tv2);
      let y1 = Fp.pow(tv1, c12);
      y1 = Fp.mul(y1, tv2);
      const y2 = Fp.mul(y1, c22);
      const tv3 = Fp.mul(Fp.sqr(y1), v);
      const isQR = Fp.eql(tv3, u);
      let y = Fp.cmov(y2, y1, isQR);
      return { isValid: isQR, value: y };
    };
  }
  return sqrtRatio;
}
function mapToCurveSimpleSWU(Fp, opts) {
  validateField2(Fp);
  if (!Fp.isValid(opts.A) || !Fp.isValid(opts.B) || !Fp.isValid(opts.Z))
    throw new Error("mapToCurveSimpleSWU: invalid opts");
  const sqrtRatio = SWUFpSqrtRatio(Fp, opts.Z);
  if (!Fp.isOdd)
    throw new Error("Fp.isOdd is not implemented!");
  return (u) => {
    let tv1, tv2, tv3, tv4, tv5, tv6, x, y;
    tv1 = Fp.sqr(u);
    tv1 = Fp.mul(tv1, opts.Z);
    tv2 = Fp.sqr(tv1);
    tv2 = Fp.add(tv2, tv1);
    tv3 = Fp.add(tv2, Fp.ONE);
    tv3 = Fp.mul(tv3, opts.B);
    tv4 = Fp.cmov(opts.Z, Fp.neg(tv2), !Fp.eql(tv2, Fp.ZERO));
    tv4 = Fp.mul(tv4, opts.A);
    tv2 = Fp.sqr(tv3);
    tv6 = Fp.sqr(tv4);
    tv5 = Fp.mul(tv6, opts.A);
    tv2 = Fp.add(tv2, tv5);
    tv2 = Fp.mul(tv2, tv3);
    tv6 = Fp.mul(tv6, tv4);
    tv5 = Fp.mul(tv6, opts.B);
    tv2 = Fp.add(tv2, tv5);
    x = Fp.mul(tv1, tv3);
    const { isValid, value } = sqrtRatio(tv2, tv6);
    y = Fp.mul(tv1, u);
    y = Fp.mul(y, value);
    x = Fp.cmov(x, tv3, isValid);
    y = Fp.cmov(y, value, isValid);
    const e1 = Fp.isOdd(u) === Fp.isOdd(y);
    y = Fp.cmov(Fp.neg(y), y, e1);
    x = Fp.div(x, tv4);
    return { x, y };
  };
}

// node_modules/starknet/node_modules/@noble/curves/esm/abstract/poseidon.js
var poseidon_exports = {};
__export(poseidon_exports, {
  poseidon: () => poseidon2,
  splitConstants: () => splitConstants,
  validateOpts: () => validateOpts4
});
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function validateOpts4(opts) {
  const { Fp, mds, reversePartialPowIdx: rev, roundConstants: rc } = opts;
  const { roundsFull, roundsPartial, sboxPower, t } = opts;
  validateField2(Fp);
  for (const i of ["t", "roundsFull", "roundsPartial"]) {
    if (typeof opts[i] !== "number" || !Number.isSafeInteger(opts[i]))
      throw new Error("invalid number " + i);
  }
  if (!Array.isArray(mds) || mds.length !== t)
    throw new Error("Poseidon: invalid MDS matrix");
  const _mds = mds.map((mdsRow) => {
    if (!Array.isArray(mdsRow) || mdsRow.length !== t)
      throw new Error("invalid MDS matrix row: " + mdsRow);
    return mdsRow.map((i) => {
      if (typeof i !== "bigint")
        throw new Error("invalid MDS matrix bigint: " + i);
      return Fp.create(i);
    });
  });
  if (rev !== void 0 && typeof rev !== "boolean")
    throw new Error("invalid param reversePartialPowIdx=" + rev);
  if (roundsFull & 1)
    throw new Error("roundsFull is not even" + roundsFull);
  const rounds = roundsFull + roundsPartial;
  if (!Array.isArray(rc) || rc.length !== rounds)
    throw new Error("Poseidon: invalid round constants");
  const roundConstants = rc.map((rc2) => {
    if (!Array.isArray(rc2) || rc2.length !== t)
      throw new Error("invalid round constants");
    return rc2.map((i) => {
      if (typeof i !== "bigint" || !Fp.isValid(i))
        throw new Error("invalid round constant");
      return Fp.create(i);
    });
  });
  if (!sboxPower || ![3, 5, 7].includes(sboxPower))
    throw new Error("invalid sboxPower");
  const _sboxPower = BigInt(sboxPower);
  let sboxFn = (n) => FpPow2(Fp, n, _sboxPower);
  if (sboxPower === 3)
    sboxFn = (n) => Fp.mul(Fp.sqrN(n), n);
  else if (sboxPower === 5)
    sboxFn = (n) => Fp.mul(Fp.sqrN(Fp.sqrN(n)), n);
  return Object.freeze({ ...opts, rounds, sboxFn, roundConstants, mds: _mds });
}
function splitConstants(rc, t) {
  if (typeof t !== "number")
    throw new Error("poseidonSplitConstants: invalid t");
  if (!Array.isArray(rc) || rc.length % t)
    throw new Error("poseidonSplitConstants: invalid rc");
  const res = [];
  let tmp = [];
  for (let i = 0; i < rc.length; i++) {
    tmp.push(rc[i]);
    if (tmp.length === t) {
      res.push(tmp);
      tmp = [];
    }
  }
  return res;
}
function poseidon2(opts) {
  const _opts = validateOpts4(opts);
  const { Fp, mds, roundConstants, rounds: totalRounds, roundsPartial, sboxFn, t } = _opts;
  const halfRoundsFull = _opts.roundsFull / 2;
  const partialIdx = _opts.reversePartialPowIdx ? t - 1 : 0;
  const poseidonRound = (values, isFull, idx) => {
    values = values.map((i, j) => Fp.add(i, roundConstants[idx][j]));
    if (isFull)
      values = values.map((i) => sboxFn(i));
    else
      values[partialIdx] = sboxFn(values[partialIdx]);
    values = mds.map((i) => i.reduce((acc, i2, j) => Fp.add(acc, Fp.mulN(i2, values[j])), Fp.ZERO));
    return values;
  };
  const poseidonHash2 = function poseidonHash3(values) {
    if (!Array.isArray(values) || values.length !== t)
      throw new Error("invalid values, expected array of bigints with length " + t);
    values = values.map((i) => {
      if (typeof i !== "bigint")
        throw new Error("invalid bigint=" + i);
      return Fp.create(i);
    });
    let lastRound = 0;
    for (let i = 0; i < halfRoundsFull; i++)
      values = poseidonRound(values, true, lastRound++);
    for (let i = 0; i < roundsPartial; i++)
      values = poseidonRound(values, false, lastRound++);
    for (let i = 0; i < halfRoundsFull; i++)
      values = poseidonRound(values, true, lastRound++);
    if (lastRound !== totalRounds)
      throw new Error("invalid number of rounds");
    return values;
  };
  poseidonHash2.roundConstants = roundConstants;
  return poseidonHash2;
}

// node_modules/starknet/node_modules/@noble/hashes/esm/_blake.js
var SIGMA = /* @__PURE__ */ new Uint8Array([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9,
  12,
  5,
  1,
  15,
  14,
  13,
  4,
  10,
  0,
  7,
  6,
  3,
  9,
  2,
  8,
  11,
  13,
  11,
  7,
  14,
  12,
  1,
  3,
  9,
  5,
  0,
  15,
  4,
  8,
  6,
  2,
  10,
  6,
  15,
  14,
  9,
  11,
  3,
  0,
  8,
  12,
  2,
  13,
  7,
  1,
  4,
  10,
  5,
  10,
  2,
  8,
  4,
  7,
  6,
  1,
  5,
  15,
  11,
  9,
  14,
  3,
  12,
  13,
  0,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3
]);
var BLAKE = class extends Hash {
  constructor(blockLen, outputLen, opts = {}, keyLen, saltLen, persLen) {
    super();
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.length = 0;
    this.pos = 0;
    this.finished = false;
    this.destroyed = false;
    anumber2(blockLen);
    anumber2(outputLen);
    anumber2(keyLen);
    if (outputLen < 0 || outputLen > keyLen)
      throw new Error("outputLen bigger than keyLen");
    if (opts.key !== void 0 && (opts.key.length < 1 || opts.key.length > keyLen))
      throw new Error("key length must be undefined or 1.." + keyLen);
    if (opts.salt !== void 0 && opts.salt.length !== saltLen)
      throw new Error("salt must be undefined or " + saltLen);
    if (opts.personalization !== void 0 && opts.personalization.length !== persLen)
      throw new Error("personalization must be undefined or " + persLen);
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u32(this.buffer);
  }
  update(data) {
    aexists(this);
    const { blockLen, buffer, buffer32 } = this;
    data = toBytes(data);
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0; pos < len; ) {
      if (this.pos === blockLen) {
        if (!isLE)
          byteSwap32(buffer32);
        this.compress(buffer32, 0, false);
        if (!isLE)
          byteSwap32(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        if (!isLE)
          byteSwap32(data32);
        for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        if (!isLE)
          byteSwap32(data32);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    const { pos, buffer32 } = this;
    this.finished = true;
    this.buffer.subarray(pos).fill(0);
    if (!isLE)
      byteSwap32(buffer32);
    this.compress(buffer32, 0, true);
    if (!isLE)
      byteSwap32(buffer32);
    const out32 = u32(out);
    this.get().forEach((v, i) => out32[i] = byteSwapIfBE(v));
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    const { buffer, length, finished, destroyed, outputLen, pos } = this;
    to || (to = new this.constructor({ dkLen: outputLen }));
    to.set(...this.get());
    to.length = length;
    to.finished = finished;
    to.destroyed = destroyed;
    to.outputLen = outputLen;
    to.buffer.set(buffer);
    to.pos = pos;
    return to;
  }
};

// node_modules/starknet/node_modules/@noble/hashes/esm/blake2s.js
var B2S_IV = /* @__PURE__ */ new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
function G1s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 16);
  c = c + d | 0;
  b = rotr(b ^ c, 12);
  return { a, b, c, d };
}
function G2s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 8);
  c = c + d | 0;
  b = rotr(b ^ c, 7);
  return { a, b, c, d };
}
function compress(s, offset, msg, rounds, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15) {
  let j = 0;
  for (let i = 0; i < rounds; i++) {
    ({ a: v0, b: v4, c: v8, d: v12 } = G1s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v0, b: v4, c: v8, d: v12 } = G2s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G1s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G2s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G1s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G2s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G1s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G2s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G1s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G2s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G1s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G2s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G1s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G2s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G1s(v3, v4, v9, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G2s(v3, v4, v9, v14, msg[offset + s[j++]]));
  }
  return { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 };
}
var BLAKE2s = class extends BLAKE {
  constructor(opts = {}) {
    super(64, opts.dkLen === void 0 ? 32 : opts.dkLen, opts, 32, 8, 8);
    this.v0 = B2S_IV[0] | 0;
    this.v1 = B2S_IV[1] | 0;
    this.v2 = B2S_IV[2] | 0;
    this.v3 = B2S_IV[3] | 0;
    this.v4 = B2S_IV[4] | 0;
    this.v5 = B2S_IV[5] | 0;
    this.v6 = B2S_IV[6] | 0;
    this.v7 = B2S_IV[7] | 0;
    const keyLength = opts.key ? opts.key.length : 0;
    this.v0 ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
    if (opts.salt) {
      const salt = u32(toBytes(opts.salt));
      this.v4 ^= byteSwapIfBE(salt[0]);
      this.v5 ^= byteSwapIfBE(salt[1]);
    }
    if (opts.personalization) {
      const pers = u32(toBytes(opts.personalization));
      this.v6 ^= byteSwapIfBE(pers[0]);
      this.v7 ^= byteSwapIfBE(pers[1]);
    }
    if (opts.key) {
      const tmp = new Uint8Array(this.blockLen);
      tmp.set(toBytes(opts.key));
      this.update(tmp);
    }
  }
  get() {
    const { v0, v1, v2, v3, v4, v5, v6, v7 } = this;
    return [v0, v1, v2, v3, v4, v5, v6, v7];
  }
  // prettier-ignore
  set(v0, v1, v2, v3, v4, v5, v6, v7) {
    this.v0 = v0 | 0;
    this.v1 = v1 | 0;
    this.v2 = v2 | 0;
    this.v3 = v3 | 0;
    this.v4 = v4 | 0;
    this.v5 = v5 | 0;
    this.v6 = v6 | 0;
    this.v7 = v7 | 0;
  }
  compress(msg, offset, isLast) {
    const { h, l } = fromBig2(BigInt(this.length));
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = compress(SIGMA, offset, msg, 10, this.v0, this.v1, this.v2, this.v3, this.v4, this.v5, this.v6, this.v7, B2S_IV[0], B2S_IV[1], B2S_IV[2], B2S_IV[3], l ^ B2S_IV[4], h ^ B2S_IV[5], isLast ? ~B2S_IV[6] : B2S_IV[6], B2S_IV[7]);
    this.v0 ^= v0 ^ v8;
    this.v1 ^= v1 ^ v9;
    this.v2 ^= v2 ^ v10;
    this.v3 ^= v3 ^ v11;
    this.v4 ^= v4 ^ v12;
    this.v5 ^= v5 ^ v13;
    this.v6 ^= v6 ^ v14;
    this.v7 ^= v7 ^ v15;
  }
  destroy() {
    this.destroyed = true;
    this.buffer32.fill(0);
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var blake2s = /* @__PURE__ */ wrapConstructorWithOpts((opts) => new BLAKE2s(opts));

// node_modules/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/_assert.js
function anumber5(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function isBytes7(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes7(b, ...lengths) {
  if (!isBytes7(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function ahash2(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new Error("Hash should be wrapped by utils.wrapConstructor");
  anumber5(h.outputLen);
  anumber5(h.blockLen);
}
function aexists4(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput3(out, instance) {
  abytes7(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}

// node_modules/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/cryptoNode.js
import * as nc2 from "node:crypto";
var crypto3 = nc2 && typeof nc2 === "object" && "webcrypto" in nc2 ? nc2.webcrypto : nc2 && typeof nc2 === "object" && "randomBytes" in nc2 ? nc2 : void 0;

// node_modules/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/utils.js
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var createView3 = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
var rotr3 = (word, shift) => word << 32 - shift | word >>> shift;
function utf8ToBytes6(str) {
  if (typeof str !== "string")
    throw new Error("utf8ToBytes expected string, got " + typeof str);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes4(data) {
  if (typeof data === "string")
    data = utf8ToBytes6(data);
  abytes7(data);
  return data;
}
function concatBytes4(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes7(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
var Hash4 = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
function wrapConstructor3(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes4(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes2(bytesLength = 32) {
  if (crypto3 && typeof crypto3.getRandomValues === "function") {
    return crypto3.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto3 && typeof crypto3.randomBytes === "function") {
    return crypto3.randomBytes(bytesLength);
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// node_modules/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/_md.js
function setBigUint643(view, byteOffset, value, isLE4) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE4);
  const _32n4 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n4 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE4 ? 4 : 0;
  const l = isLE4 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE4);
  view.setUint32(byteOffset + l, wl, isLE4);
}
var Chi3 = (a, b, c) => a & b ^ ~a & c;
var Maj3 = (a, b, c) => a & b ^ a & c ^ b & c;
var HashMD3 = class extends Hash4 {
  constructor(blockLen, outputLen, padOffset, isLE4) {
    super();
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE4;
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView3(this.buffer);
  }
  update(data) {
    aexists4(this);
    const { view, buffer, blockLen } = this;
    data = toBytes4(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView3(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists4(this);
    aoutput3(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE4 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    this.buffer.subarray(pos).fill(0);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint643(view, blockLen - 8, BigInt(this.length * 8), isLE4);
    this.process(view, 0);
    const oview = createView3(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state2 = this.get();
    if (outLen > state2.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state2[i], isLE4);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.length = length;
    to.pos = pos;
    to.finished = finished;
    to.destroyed = destroyed;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
};

// node_modules/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/sha256.js
var SHA256_K3 = /* @__PURE__ */ new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_IV3 = /* @__PURE__ */ new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA256_W3 = /* @__PURE__ */ new Uint32Array(64);
var SHA2563 = class extends HashMD3 {
  constructor() {
    super(64, 32, 8, false);
    this.A = SHA256_IV3[0] | 0;
    this.B = SHA256_IV3[1] | 0;
    this.C = SHA256_IV3[2] | 0;
    this.D = SHA256_IV3[3] | 0;
    this.E = SHA256_IV3[4] | 0;
    this.F = SHA256_IV3[5] | 0;
    this.G = SHA256_IV3[6] | 0;
    this.H = SHA256_IV3[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W3[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W3[i - 15];
      const W2 = SHA256_W3[i - 2];
      const s0 = rotr3(W15, 7) ^ rotr3(W15, 18) ^ W15 >>> 3;
      const s1 = rotr3(W2, 17) ^ rotr3(W2, 19) ^ W2 >>> 10;
      SHA256_W3[i] = s1 + SHA256_W3[i - 7] + s0 + SHA256_W3[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr3(E, 6) ^ rotr3(E, 11) ^ rotr3(E, 25);
      const T1 = H + sigma1 + Chi3(E, F, G) + SHA256_K3[i] + SHA256_W3[i] | 0;
      const sigma0 = rotr3(A, 2) ^ rotr3(A, 13) ^ rotr3(A, 22);
      const T2 = sigma0 + Maj3(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    SHA256_W3.fill(0);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    this.buffer.fill(0);
  }
};
var sha2563 = /* @__PURE__ */ wrapConstructor3(() => new SHA2563());

// node_modules/starknet/node_modules/@noble/curves/node_modules/@noble/hashes/esm/hmac.js
var HMAC2 = class extends Hash4 {
  constructor(hash, _key) {
    super();
    this.finished = false;
    this.destroyed = false;
    ahash2(hash);
    const key = toBytes4(_key);
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    pad.fill(0);
  }
  update(buf) {
    aexists4(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists4(this);
    abytes7(out, this.outputLen);
    this.finished = true;
    this.iHash.digestInto(out);
    this.oHash.update(out);
    this.oHash.digestInto(out);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to || (to = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac2 = (hash, key, message) => new HMAC2(hash, key).update(message).digest();
hmac2.create = (hash, key) => new HMAC2(hash, key);

// node_modules/starknet/node_modules/@noble/curves/esm/_shortw_utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function getHash2(hash) {
  return {
    hash,
    hmac: (key, ...msgs) => hmac2(hash, key, concatBytes4(...msgs)),
    randomBytes: randomBytes2
  };
}
function createCurve(curveDef, defHash) {
  const create = (hash) => weierstrass2({ ...curveDef, ...getHash2(hash) });
  return Object.freeze({ ...create(defHash), create });
}

// node_modules/starknet/node_modules/@noble/curves/esm/secp256k1.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var secp256k1P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f");
var secp256k1N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
var _1n11 = BigInt(1);
var _2n9 = BigInt(2);
var divNearest = (a, b) => (a + b / _2n9) / b;
function sqrtMod(y) {
  const P = secp256k1P;
  const _3n5 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P;
  const b3 = b2 * b2 * y % P;
  const b6 = pow22(b3, _3n5, P) * b3 % P;
  const b9 = pow22(b6, _3n5, P) * b3 % P;
  const b11 = pow22(b9, _2n9, P) * b2 % P;
  const b22 = pow22(b11, _11n, P) * b11 % P;
  const b44 = pow22(b22, _22n, P) * b22 % P;
  const b88 = pow22(b44, _44n, P) * b44 % P;
  const b176 = pow22(b88, _88n, P) * b88 % P;
  const b220 = pow22(b176, _44n, P) * b44 % P;
  const b223 = pow22(b220, _3n5, P) * b3 % P;
  const t1 = pow22(b223, _23n, P) * b22 % P;
  const t2 = pow22(t1, _6n, P) * b2 % P;
  const root = pow22(t2, _2n9, P);
  if (!Fpk1.eql(Fpk1.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fpk1 = Field2(secp256k1P, void 0, void 0, { sqrt: sqrtMod });
var secp256k1 = createCurve({
  a: BigInt(0),
  // equation params: a, b
  b: BigInt(7),
  // Seem to be rigid: bitcointalk.org/index.php?topic=289795.msg3183975#msg3183975
  Fp: Fpk1,
  // Field's prime: 2n**256n - 2n**32n - 2n**9n - 2n**8n - 2n**7n - 2n**6n - 2n**4n - 1n
  n: secp256k1N,
  // Curve order, total count of valid points in the field
  // Base point (x, y) aka generator point
  Gx: BigInt("55066263022277343669578718895168534326250603453777594175500187360389116729240"),
  Gy: BigInt("32670510020758816978083085130507043184471273380659243275938904335757337482424"),
  h: BigInt(1),
  // Cofactor
  lowS: true,
  // Allow only low-S signatures by default in sign() and verify()
  /**
   * secp256k1 belongs to Koblitz curves: it has efficiently computable endomorphism.
   * Endomorphism uses 2x less RAM, speeds up precomputation by 2x and ECDH / key recovery by 20%.
   * For precomputed wNAF it trades off 1/2 init time & 1/3 ram for 20% perf hit.
   * Explanation: https://gist.github.com/paulmillr/eb670806793e84df628a7c434a873066
   */
  endo: {
    beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
    splitScalar: (k) => {
      const n = secp256k1N;
      const a1 = BigInt("0x3086d221a7d46bcde86c90e49284eb15");
      const b1 = -_1n11 * BigInt("0xe4437ed6010e88286f547fa90abfe4c3");
      const a2 = BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8");
      const b2 = a1;
      const POW_2_128 = BigInt("0x100000000000000000000000000000000");
      const c1 = divNearest(b2 * k, n);
      const c2 = divNearest(-b1 * k, n);
      let k1 = mod2(k - c1 * a1 - c2 * a2, n);
      let k2 = mod2(-c1 * b1 - c2 * b2, n);
      const k1neg = k1 > POW_2_128;
      const k2neg = k2 > POW_2_128;
      if (k1neg)
        k1 = n - k1;
      if (k2neg)
        k2 = n - k2;
      if (k1 > POW_2_128 || k2 > POW_2_128) {
        throw new Error("splitScalar: Endomorphism failed, k=" + k);
      }
      return { k1neg, k1, k2neg, k2 };
    }
  }
}, sha2563);
var _0n11 = BigInt(0);
var Point = secp256k1.ProjectivePoint;

// node_modules/@starknet-io/starknet-types-0101/dist/esm/api/constants.js
var STATUS_ACCEPTED_ON_L23 = "ACCEPTED_ON_L2";
var STATUS_ACCEPTED_ON_L13 = "ACCEPTED_ON_L1";
var STATUS_RECEIVED3 = "RECEIVED";
var STATUS_CANDIDATE3 = "CANDIDATE";
var STATUS_PRE_CONFIRMED3 = "PRE_CONFIRMED";
var STATUS_PRE_CONFIRMED_LOWERCASE3 = STATUS_PRE_CONFIRMED3.toLowerCase();
var TXN_TYPE_DECLARE3 = "DECLARE";
var TXN_TYPE_DEPLOY3 = "DEPLOY";
var TXN_TYPE_DEPLOY_ACCOUNT3 = "DEPLOY_ACCOUNT";
var TXN_TYPE_INVOKE3 = "INVOKE";
var TXN_TYPE_L1_HANDLER3 = "L1_HANDLER";
var ETransactionType3 = {
  DECLARE: TXN_TYPE_DECLARE3,
  DEPLOY: TXN_TYPE_DEPLOY3,
  DEPLOY_ACCOUNT: TXN_TYPE_DEPLOY_ACCOUNT3,
  INVOKE: TXN_TYPE_INVOKE3,
  L1_HANDLER: TXN_TYPE_L1_HANDLER3
};
var ESimulationFlag3 = {
  SKIP_VALIDATE: "SKIP_VALIDATE",
  SKIP_FEE_CHARGE: "SKIP_FEE_CHARGE",
  RETURN_INITIAL_READS: "RETURN_INITIAL_READS"
};
var ETxnResponseFlag2 = {
  INCLUDE_PROOF_FACTS: "INCLUDE_PROOF_FACTS"
};
var ETraceFlag2 = {
  RETURN_INITIAL_READS: "RETURN_INITIAL_READS"
};
var ETransactionStatus3 = {
  RECEIVED: STATUS_RECEIVED3,
  CANDIDATE: STATUS_CANDIDATE3,
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED3,
  ACCEPTED_ON_L2: STATUS_ACCEPTED_ON_L23,
  ACCEPTED_ON_L1: STATUS_ACCEPTED_ON_L13
};
var ETransactionFinalityStatus3 = {
  PRE_CONFIRMED: STATUS_PRE_CONFIRMED3,
  ACCEPTED_ON_L2: STATUS_ACCEPTED_ON_L23,
  ACCEPTED_ON_L1: STATUS_ACCEPTED_ON_L13
};
var ETransactionVersion5 = {
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V0: "0x0",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V1: "0x1",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  V2: "0x2",
  V3: "0x3",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F0: "0x100000000000000000000000000000000",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F1: "0x100000000000000000000000000000001",
  /**
   * @deprecated Starknet 0.14 will not support this transaction
   */
  F2: "0x100000000000000000000000000000002",
  F3: "0x100000000000000000000000000000003"
};
var ETransactionVersion23 = {
  V0: ETransactionVersion5.V0,
  V1: ETransactionVersion5.V1,
  V2: ETransactionVersion5.V2,
  F0: ETransactionVersion5.F0,
  F1: ETransactionVersion5.F1,
  F2: ETransactionVersion5.F2
};
var ETransactionVersion33 = {
  V3: ETransactionVersion5.V3,
  F3: ETransactionVersion5.F3
};

// node_modules/starknet/dist/index.mjs
var __defProp2 = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export2 = (target, all) => {
  for (var name in all)
    __defProp2(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod5, secondTarget) => (__copyProps(target, mod5, "default"), secondTarget && __copyProps(secondTarget, mod5, "default"));
var constants_exports = {};
__export2(constants_exports, {
  ADDR_BOUND: () => ADDR_BOUND,
  API_VERSION: () => API_VERSION,
  BaseUrl: () => _BaseUrl,
  DEFAULT_GLOBAL_CONFIG: () => DEFAULT_GLOBAL_CONFIG,
  HARDENING_4BYTES: () => HARDENING_4BYTES,
  HARDENING_BYTE: () => HARDENING_BYTE,
  IS_BROWSER: () => IS_BROWSER,
  LegacyUDC: () => LegacyUDC,
  MASK_250: () => MASK_2502,
  MASK_31: () => MASK_312,
  MAX_STORAGE_ITEM_SIZE: () => MAX_STORAGE_ITEM_SIZE,
  NetworkName: () => _NetworkName,
  OutsideExecutionCallerAny: () => OutsideExecutionCallerAny,
  PAYMASTER_RPC_NODES: () => PAYMASTER_RPC_NODES,
  PRIME: () => PRIME,
  RANGE_FELT: () => RANGE_FELT,
  RANGE_I128: () => RANGE_I128,
  RANGE_I16: () => RANGE_I16,
  RANGE_I32: () => RANGE_I32,
  RANGE_I64: () => RANGE_I64,
  RANGE_I8: () => RANGE_I8,
  RANGE_U128: () => RANGE_U128,
  RANGE_U16: () => RANGE_U16,
  RANGE_U32: () => RANGE_U32,
  RANGE_U64: () => RANGE_U64,
  RANGE_U8: () => RANGE_U8,
  RANGE_U96: () => RANGE_U96,
  RPC_DEFAULT_NODES: () => RPC_DEFAULT_NODES,
  SNIP9_V1_INTERFACE_ID: () => SNIP9_V1_INTERFACE_ID,
  SNIP9_V2_INTERFACE_ID: () => SNIP9_V2_INTERFACE_ID,
  SN_VERSION_IMPLEMENTING_BLAKE_FOR_COMPILED_CLASS: () => SN_VERSION_IMPLEMENTING_BLAKE_FOR_COMPILED_CLASS,
  SYSTEM_MESSAGES: () => SYSTEM_MESSAGES,
  StarknetChainId: () => _StarknetChainId,
  SupportedRpcVersion: () => _SupportedRpcVersion,
  TEXT_TO_FELT_MAX_LEN: () => TEXT_TO_FELT_MAX_LEN,
  TransactionHashPrefix: () => _TransactionHashPrefix,
  UDC: () => UDC,
  ZERO: () => ZERO
});
var api_exports3 = {};
__export2(api_exports3, {
  JRPC: () => jsonrpc_exports,
  PAYMASTER_API: () => snip_29_exports2,
  RPCSPEC0103: () => esm_exports2,
  RPCSPEC09: () => esm_exports
});
var jsonrpc_exports = {};
var rpc_exports = {};
__reExport(rpc_exports, esm_exports2);
__reExport(api_exports3, rpc_exports);
var { ETransactionVersion: ETransactionVersion6 } = esm_exports;
var { ETransactionVersion2: ETransactionVersion24 } = esm_exports;
var { ETransactionVersion3: ETransactionVersion34 } = esm_exports;
var { EDataAvailabilityMode: EDataAvailabilityMode3 } = esm_exports2;
var { EDAMode: EDAMode3 } = esm_exports2;
function isRPC08Plus_ResourceBoundsBN(entry) {
  return "l1_data_gas" in entry;
}
var { ETxnResponseFlag: ETxnResponseFlag3 } = esm_exports2;
var { ETraceFlag: ETraceFlag3 } = esm_exports2;
var { ESubscriptionTag: ESubscriptionTag2 } = esm_exports2;
var { ETransactionStatus: ETransactionStatus4 } = esm_exports2;
var { ETransactionExecutionStatus: ETransactionExecutionStatus3 } = esm_exports2;
var { ETransactionType: TransactionType } = esm_exports;
var { EBlockStatus: BlockStatus } = esm_exports;
var { ETransactionFinalityStatus: TransactionFinalityStatus } = esm_exports;
var { ETransactionExecutionStatus: TransactionExecutionStatus } = esm_exports;
var { EBlockTag: BlockTag } = esm_exports;
var encode_exports = {};
__export2(encode_exports, {
  IS_BROWSER: () => IS_BROWSER,
  addHexPrefix: () => addHexPrefix,
  arrayBufferToString: () => arrayBufferToString,
  atobUniversal: () => atobUniversal,
  bigIntToUint8Array: () => bigIntToUint8Array,
  btoaUniversal: () => btoaUniversal,
  buf2hex: () => buf2hex,
  calcByteLength: () => calcByteLength,
  concatenateArrayBuffer: () => concatenateArrayBuffer,
  hexStringToUint8Array: () => hexStringToUint8Array,
  padLeft: () => padLeft,
  pascalToSnake: () => pascalToSnake,
  removeHexPrefix: () => removeHexPrefix,
  sanitizeBytes: () => sanitizeBytes,
  sanitizeHex: () => sanitizeHex,
  stringToUint8Array: () => stringToUint8Array,
  uint8ArrayToBigInt: () => uint8ArrayToBigInt,
  utf8ToArray: () => utf8ToArray,
  utf8ToBigInt: () => utf8ToBigInt,
  utf8ToUint8Array: () => utf8ToUint8Array
});
var IS_BROWSER = typeof window !== "undefined";
var STRING_ZERO = "0";
function arrayBufferToString(array) {
  return new Uint8Array(array).reduce((data, byte) => data + String.fromCharCode(byte), "");
}
function utf8ToUint8Array(str) {
  return new TextEncoder().encode(str);
}
var utf8ToArray = utf8ToUint8Array;
function utf8ToBigInt(str) {
  return uint8ArrayToBigInt(utf8ToUint8Array(str));
}
function atobUniversal(a) {
  return base64.decode(a);
}
function btoaUniversal(b) {
  return base64.encode(new Uint8Array(b));
}
function buf2hex(buffer) {
  return buffer.reduce((r, x) => r + x.toString(16).padStart(2, "0"), "");
}
function removeHexPrefix(hex) {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}
function addHexPrefix(hex) {
  return `0x${removeHexPrefix(hex)}`;
}
function padString(str, length, left, padding2 = STRING_ZERO) {
  const diff = length - str.length;
  let result = str;
  if (diff > 0) {
    const pad = padding2.repeat(diff);
    result = left ? pad + str : str + pad;
  }
  return result;
}
function padLeft(str, length, padding2 = STRING_ZERO) {
  return padString(str, length, true, padding2);
}
function calcByteLength(str, byteSize = 8) {
  const { length } = str;
  const remainder = length % byteSize;
  return remainder ? (length - remainder) / byteSize * byteSize + byteSize : length;
}
function sanitizeBytes(str, byteSize = 8, padding2 = STRING_ZERO) {
  return padLeft(str, calcByteLength(str, byteSize), padding2);
}
function sanitizeHex(hex) {
  const hexWithoutPrefix = removeHexPrefix(hex);
  const sanitizedHex = sanitizeBytes(hexWithoutPrefix, 2);
  return sanitizedHex ? addHexPrefix(sanitizedHex) : sanitizedHex;
}
var pascalToSnake = (text) => /[a-z]/.test(text) ? text.split(/(?=[A-Z])/).join("_").toUpperCase() : text;
function concatenateArrayBuffer(uint8arrays) {
  const totalLength = uint8arrays.reduce((total, uint8array) => total + uint8array.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  uint8arrays.forEach((uint8array) => {
    result.set(uint8array, offset);
    offset += uint8array.byteLength;
  });
  return result;
}
function hexStringToUint8Array(hex) {
  if (!isHexString(addHexPrefix(hex))) {
    throw new Error(`Invalid hex string: "${hex}"`);
  }
  const paddedHex = removeHexPrefix(sanitizeHex(hex));
  const bytes = new Uint8Array(paddedHex.length / 2);
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes[i / 2] = parseInt(paddedHex.substring(i, i + 2), 16);
  }
  return bytes;
}
function isHexString(hex) {
  return /^0[xX][0-9a-fA-F]*$/.test(hex);
}
function isDecimalString(str) {
  return /^[0-9]+$/.test(str);
}
function stringToUint8Array(str) {
  if (isHexString(str)) {
    return hexStringToUint8Array(str);
  }
  if (isDecimalString(str)) {
    const value = BigInt(str);
    return bigIntToUint8Array(value);
  }
  return utf8ToUint8Array(str);
}
function bigIntToUint8Array(value) {
  if (value < 0n) {
    throw new Error(`Cannot convert negative bigint ${value} to Uint8Array`);
  }
  if (value === 0n) {
    return new Uint8Array([0]);
  }
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToBigInt(data) {
  if (!data || data.length === 0) {
    return 0n;
  }
  let hex = "0x";
  for (let i = 0; i < data.length; i += 1) {
    hex += data[i].toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}
var TEXT_TO_FELT_MAX_LEN = 31;
var ZERO = 0n;
var MASK_2502 = 2n ** 250n - 1n;
var MASK_312 = 2n ** 31n - 1n;
var API_VERSION = ZERO;
var PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;
var MAX_STORAGE_ITEM_SIZE = 256n;
var ADDR_BOUND = 2n ** 251n - MAX_STORAGE_ITEM_SIZE;
var range = (min, max) => ({ min, max });
var RANGE_FELT = range(ZERO, PRIME - 1n);
var RANGE_U8 = range(ZERO, 2n ** 8n - 1n);
var RANGE_U16 = range(ZERO, 2n ** 16n - 1n);
var RANGE_U32 = range(ZERO, 2n ** 32n - 1n);
var RANGE_U64 = range(ZERO, 2n ** 64n - 1n);
var RANGE_U96 = range(ZERO, 2n ** 96n - 1n);
var RANGE_U128 = range(ZERO, 2n ** 128n - 1n);
var RANGE_I8 = range(-(2n ** 7n), 2n ** 7n - 1n);
var RANGE_I16 = range(-(2n ** 15n), 2n ** 15n - 1n);
var RANGE_I32 = range(-(2n ** 31n), 2n ** 31n - 1n);
var RANGE_I64 = range(-(2n ** 63n), 2n ** 63n - 1n);
var RANGE_I128 = range(-(2n ** 127n), 2n ** 127n - 1n);
var LegacyUDC = {
  ADDRESS: "0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf",
  ENTRYPOINT: "deployContract"
};
var UDC = {
  ADDRESS: "0x02ceed65a4bd731034c01113685c831b01c15d7d432f71afb1cf1634b53a2125",
  ENTRYPOINT: "deploy_contract"
};
var OutsideExecutionCallerAny = "0x414e595f43414c4c4552";
var SNIP9_V1_INTERFACE_ID = "0x68cfd18b92d1907b8ba3cc324900277f5a3622099431ea85dd8089255e4181";
var SNIP9_V2_INTERFACE_ID = "0x1d1144bb2138366ff28d8e9ab57456b1d332ac42196230c3a602003c89872";
var HARDENING_BYTE = 128;
var HARDENING_4BYTES = 2147483648n;
var _BaseUrl = {
  SN_MAIN: "https://alpha-mainnet.starknet.io",
  SN_SEPOLIA: "https://alpha-sepolia.starknet.io"
};
var _NetworkName = {
  SN_MAIN: "SN_MAIN",
  SN_SEPOLIA: "SN_SEPOLIA"
};
var _StarknetChainId = {
  SN_MAIN: "0x534e5f4d41494e",
  // encodeShortString('SN_MAIN'),
  SN_SEPOLIA: "0x534e5f5345504f4c4941"
  // encodeShortString('SN_SEPOLIA')
};
var _TransactionHashPrefix = {
  DECLARE: "0x6465636c617265",
  // encodeShortString('declare'),
  DEPLOY: "0x6465706c6f79",
  // encodeShortString('deploy'),
  DEPLOY_ACCOUNT: "0x6465706c6f795f6163636f756e74",
  // encodeShortString('deploy_account'),
  INVOKE: "0x696e766f6b65",
  // encodeShortString('invoke'),
  L1_HANDLER: "0x6c315f68616e646c6572"
  // encodeShortString('l1_handler'),
};
var _SupportedRpcVersion = {
  "0.9.0": "0.9.0",
  "0.10.0": "0.10.0",
  "0.10.2": "0.10.2",
  "0.10.3": "0.10.3",
  v0_9_0: "0.9.0",
  v0_10_0: "0.10.0",
  v0_10_2: "0.10.2",
  v0_10_3: "0.10.3"
};
var DEFAULT_GLOBAL_CONFIG = {
  rpcVersion: "0.10.0",
  transactionVersion: api_exports3.ETransactionVersion.V3,
  // Starknet 0.14.0 only V3 transactions
  logLevel: "INFO",
  resourceBoundsOverhead: {
    l1_gas: {
      max_amount: 50,
      max_price_per_unit: 50
    },
    l1_data_gas: {
      max_amount: 50,
      max_price_per_unit: 50
    },
    l2_gas: {
      max_amount: 50,
      max_price_per_unit: 50
    }
  },
  defaultTipType: "recommendedTip",
  channelDefaults: {
    options: {
      headers: { "Content-Type": "application/json" },
      blockIdentifier: BlockTag.LATEST,
      retries: 200,
      transactionRetryIntervalFallback: 5e3
    },
    methods: {
      simulateTransaction: {
        skipValidate: true,
        skipFeeCharge: true
      },
      getEstimateFee: {
        skipValidate: true
      }
    }
  },
  fetch: void 0,
  websocket: void 0,
  buffer: void 0,
  blake: void 0
};
var RPC_DEFAULT_NODES = {
  SN_MAIN: [`https://api.zan.top/public/starknet-mainnet/rpc/`],
  SN_SEPOLIA: [`https://api.zan.top/public/starknet-sepolia/rpc/`]
};
var PAYMASTER_RPC_NODES = {
  SN_MAIN: [`https://starknet.paymaster.avnu.fi`],
  SN_SEPOLIA: [`https://sepolia.paymaster.avnu.fi`]
};
var SYSTEM_MESSAGES = {
  legacyTxWarningMessage: "You are using a deprecated transaction version (V0,V1,V2)!\nUpdate to the latest V3 transactions!",
  legacyTxRPC08Message: "RPC 0.8+ do not support legacy transactions, use RPC 0.8+ v3 transactions!",
  SWOldV3: "RPC 0.7 V3 tx (improper resource bounds) not supported in RPC 0.8+",
  channelVersionMismatch: "Channel specification version is not compatible with the connected node Specification Version",
  unsupportedSpecVersion: "The connected node specification version is not supported by this library",
  maxFeeInV3: "maxFee is not supported in V3 transactions, use resourceBounds instead",
  declareNonSierra: "Declaring non Sierra (Cairo0)contract using RPC 0.8+",
  unsupportedMethodForRpcVersion: "Unsupported method for RPC version",
  txEvictedFromMempool: "Transaction TTL, evicted from the mempool, try to increase the tip",
  consensusFailed: "Consensus failed to finalize the block proposal",
  txFailsBlockBuildingValidation: "Transaction fails block building validation"
};
var SN_VERSION_IMPLEMENTING_BLAKE_FOR_COMPILED_CLASS = "0.14.1";
var Configuration = class _Configuration {
  static instance;
  config;
  constructor() {
    this.initialize();
  }
  initialize() {
    this.config = { ...DEFAULT_GLOBAL_CONFIG };
  }
  static getInstance() {
    if (!_Configuration.instance) {
      _Configuration.instance = new _Configuration();
    }
    return _Configuration.instance;
  }
  /**
   * Get a nested value from an object using a dot-notation path
   * @param obj - The object to traverse
   * @param path - The dot-notation path (e.g., 'a.b.c')
   * @returns The value at the path, or undefined if not found
   */
  getNestedValue(obj, path) {
    const keys = path.split(".");
    return keys.reduce((current, key) => {
      if (current === null || current === void 0) {
        return void 0;
      }
      return current[key];
    }, obj);
  }
  /**
   * Set a nested value in an object using a dot-notation path
   * @param obj - The object to modify
   * @param path - The dot-notation path (e.g., 'a.b.c')
   * @param value - The value to set
   */
  setNestedValue(obj, path, value) {
    const keys = path.split(".");
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
        current[key] = {};
      }
      return current[key];
    }, obj);
    target[lastKey] = value;
  }
  get(key, defaultValue) {
    if (key.includes(".")) {
      const value = this.getNestedValue(this.config, key);
      return value ?? defaultValue;
    }
    return this.config[key] ?? defaultValue;
  }
  set(key, value) {
    if (key.includes(".")) {
      this.setNestedValue(this.config, key, value);
    } else {
      this.config[key] = value;
    }
  }
  update(configData) {
    this.config = {
      ...this.config,
      ...configData
    };
  }
  getAll() {
    return { ...this.config };
  }
  reset() {
    this.initialize();
  }
  delete(key) {
    delete this.config[key];
  }
  hasKey(key) {
    return key in this.config;
  }
};
var config2 = Configuration.getInstance();
var LogLevelIndex = {
  DEBUG: 5,
  INFO: 4,
  WARN: 3,
  ERROR: 2,
  FATAL: 1,
  OFF: 0
};
var Logger = class _Logger {
  static instance;
  config;
  constructor() {
    this.config = config2;
  }
  static getInstance() {
    if (!_Logger.instance) {
      _Logger.instance = new _Logger();
    }
    return _Logger.instance;
  }
  getTimestamp() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  shouldLog(messageLevel) {
    const configLevel = this.config.get("logLevel", "INFO");
    return messageLevel <= LogLevelIndex[configLevel];
  }
  formatMessage(logMessage) {
    const { level, message, timestamp, data } = logMessage;
    let formattedMessage = `[${timestamp}] ${level}: ${message}`;
    if (data) {
      try {
        formattedMessage += `
${JSON.stringify(data, null, 2)}`;
      } catch (error) {
        formattedMessage += `
[JSON.stringify Error/Circular]: ${error}`;
      }
    }
    return formattedMessage;
  }
  log(level, message, data) {
    if (!this.shouldLog(LogLevelIndex[level])) {
      return;
    }
    const logMessage = {
      level,
      message,
      timestamp: this.getTimestamp(),
      data
    };
    const formattedMessage = this.formatMessage(logMessage);
    switch (level) {
      case "DEBUG":
        console.debug(formattedMessage);
        break;
      case "INFO":
        console.info(formattedMessage);
        break;
      case "WARN":
        console.warn(formattedMessage);
        break;
      case "ERROR":
      case "FATAL":
        console.error(formattedMessage);
        break;
      case "OFF":
        break;
      default:
        console.log(formattedMessage);
        break;
    }
  }
  /**
   * debug will be displayed when LogLevel level is set to DEBUG(5)
   */
  debug(message, data) {
    this.log("DEBUG", message, data);
  }
  /**
   * info will be displayed when LogLevel level is set to DEBUG(5), INFO(4)
   */
  info(message, data) {
    this.log("INFO", message, data);
  }
  /**
   * warn will be displayed when LogLevel level is set to DEBUG(5), INFO(4), WARN(3)
   */
  warn(message, data) {
    this.log("WARN", message, data);
  }
  /**
   * error will be displayed when LogLevel level is set to DEBUG(5), INFO(4), WARN(3), ERROR(2)
   */
  error(message, data) {
    this.log("ERROR", message, data);
  }
  /**
   * fatal will be displayed when LogLevel level is set to DEBUG(5), INFO(4), WARN(3), ERROR(2), FATAL(1)
   */
  fatal(message, data) {
    this.log("FATAL", message, data);
  }
  /**
   * Set the logging level you would like system to display
   * * 5 DEBUG  - show all logs
   * * 4 INFO
   * * 3 WARN
   * * 2 ERROR
   * * 1 FATAL
   * * 0 OFF    - disable logs
   */
  setLogLevel(level) {
    this.config.set("logLevel", level);
  }
  getLogLevel() {
    return this.config.get("logLevel", "INFO");
  }
  /**
   *
   * @returns logs levels displayed on the configured LogLevel
   */
  getEnabledLogLevels() {
    return Object.keys(LogLevelIndex).filter((s) => {
      return this.shouldLog(LogLevelIndex[s]) && s !== "OFF";
    });
  }
};
var logger = Logger.getInstance();
var rpc_0_9_0_exports = {};
__export2(rpc_0_9_0_exports, {
  RpcChannel: () => RpcChannel
});
var ValidateType = {
  DEPLOY: "DEPLOY",
  CALL: "CALL",
  INVOKE: "INVOKE"
};
var Uint = {
  u8: "core::integer::u8",
  u16: "core::integer::u16",
  u32: "core::integer::u32",
  u64: "core::integer::u64",
  u96: "core::integer::u96",
  u128: "core::integer::u128",
  u256: "core::integer::u256",
  // This one is struct
  u512: "core::integer::u512"
  // This one is struct
};
var Int = {
  i8: "core::integer::i8",
  i16: "core::integer::i16",
  i32: "core::integer::i32",
  i64: "core::integer::i64",
  i128: "core::integer::i128"
};
var Literal = {
  ClassHash: "core::starknet::class_hash::ClassHash",
  ContractAddress: "core::starknet::contract_address::ContractAddress",
  Secp256k1Point: "core::starknet::secp256k1::Secp256k1Point",
  U96: "core::internal::bounded_int::BoundedInt::<0, 79228162514264337593543950335>"
};
var ETH_ADDRESS = "core::starknet::eth_address::EthAddress";
var NON_ZERO_PREFIX = "core::zeroable::NonZero::";
var OutsideExecutionTypesV1 = {
  StarkNetDomain: [
    { name: "name", type: "felt" },
    { name: "version", type: "felt" },
    { name: "chainId", type: "felt" }
  ],
  OutsideExecution: [
    { name: "caller", type: "felt" },
    { name: "nonce", type: "felt" },
    { name: "execute_after", type: "felt" },
    { name: "execute_before", type: "felt" },
    { name: "calls_len", type: "felt" },
    { name: "calls", type: "OutsideCall*" }
  ],
  OutsideCall: [
    { name: "to", type: "felt" },
    { name: "selector", type: "felt" },
    { name: "calldata_len", type: "felt" },
    { name: "calldata", type: "felt*" }
  ]
};
var OutsideExecutionTypesV2 = {
  StarknetDomain: [
    // SNIP-12 revision 1 is used, so should be "StarknetDomain", not "StarkNetDomain"
    { name: "name", type: "shortstring" },
    { name: "version", type: "shortstring" },
    // set to 2 in v2
    { name: "chainId", type: "shortstring" },
    { name: "revision", type: "shortstring" }
  ],
  OutsideExecution: [
    { name: "Caller", type: "ContractAddress" },
    { name: "Nonce", type: "felt" },
    { name: "Execute After", type: "u128" },
    { name: "Execute Before", type: "u128" },
    { name: "Calls", type: "Call*" }
  ],
  Call: [
    { name: "To", type: "ContractAddress" },
    { name: "Selector", type: "selector" },
    { name: "Calldata", type: "felt*" }
  ]
};
var OutsideExecutionVersion = {
  UNSUPPORTED: "0",
  V1: "1",
  V2: "2"
};
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failure");
  }
}
var json_exports = {};
__export2(json_exports, {
  parse: () => parse2,
  parseAlwaysAsBig: () => parseAlwaysAsBig,
  stringify: () => stringify2
});
var parseIntAsNumberOrBigInt = (str) => {
  if (!isInteger(str)) return parseFloat(str);
  const num = parseInt(str, 10);
  return Number.isSafeInteger(num) ? num : BigInt(str);
};
var parse2 = (str) => parse(String(str), void 0, parseIntAsNumberOrBigInt);
var parseAlwaysAsBig = (str) => parse(String(str), void 0, parseNumberAndBigInt);
var stringify2 = (value, replacer, space, numberStringifiers) => stringify(value, replacer, space, numberStringifiers);
var BatchClient = class {
  nodeUrl;
  headers;
  interval;
  requestId = 0;
  pendingRequests = {};
  batchPromises = {};
  delayTimer;
  delayPromise;
  delayPromiseResolve;
  baseFetch;
  rpcMethods;
  constructor(options) {
    this.nodeUrl = options.nodeUrl;
    this.headers = options.headers;
    this.interval = options.interval;
    this.baseFetch = options.baseFetch;
    this.rpcMethods = options.rpcMethods;
  }
  async wait() {
    if (!this.delayPromise || !this.delayPromiseResolve) {
      this.delayPromise = new Promise((resolve2) => {
        this.delayPromiseResolve = resolve2;
      });
    }
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = void 0;
    }
    this.delayTimer = setTimeout(() => {
      if (this.delayPromiseResolve) {
        this.delayPromiseResolve();
        this.delayPromise = void 0;
        this.delayPromiseResolve = void 0;
      }
    }, this.interval);
    return this.delayPromise;
  }
  addPendingRequest(method, params, id) {
    const request = {
      id: id ?? `batched_${this.requestId += 1}`,
      jsonrpc: "2.0",
      method: method.description || String(method),
      params: params ?? void 0
    };
    this.pendingRequests[request.id] = request;
    return request.id;
  }
  async sendBatch(requests) {
    const raw = await this.baseFetch(this.nodeUrl, {
      method: "POST",
      body: stringify2(requests),
      headers: this.headers
    });
    return raw.json();
  }
  /**
   * Automatically batches and fetches JSON-RPC calls in a single request.
   * @param method Method to call
   * @param params Method parameters
   * @param id JSON-RPC Request ID
   * @returns JSON-RPC Response
   */
  async fetch(method, params, id) {
    const requestId = this.addPendingRequest(method, params, id);
    await this.wait();
    const requests = this.pendingRequests;
    this.pendingRequests = {};
    if (!this.batchPromises[requestId]) {
      const promise = this.sendBatch(Object.values(requests));
      Object.keys(requests).forEach((key) => {
        this.batchPromises[key] = promise;
      });
    }
    const results = await this.batchPromises[requestId];
    delete this.batchPromises[requestId];
    const result = results.find((res) => res.id === requestId);
    if (!result)
      throw new Error(`Couldn't find the result for the request. Method: ${String(method)}`);
    return result;
  }
};
var num_exports = {};
__export2(num_exports, {
  addPercent: () => addPercent,
  assertInRange: () => assertInRange,
  bigNumberishArrayToDecimalStringArray: () => bigNumberishArrayToDecimalStringArray,
  bigNumberishArrayToHexadecimalStringArray: () => bigNumberishArrayToHexadecimalStringArray,
  cleanHex: () => cleanHex,
  getDecimalString: () => getDecimalString,
  getHexString: () => getHexString,
  getHexStringArray: () => getHexStringArray,
  getNext: () => getNext,
  hexToBytes: () => hexToBytes3,
  hexToDecimalString: () => hexToDecimalString,
  isBigNumberish: () => isBigNumberish,
  isHex: () => isHex2,
  isHexString: () => isHexString2,
  isStringWholeNumber: () => isStringWholeNumber,
  stringToSha256ToArrayBuff4: () => stringToSha256ToArrayBuff4,
  toBigInt: () => toBigInt,
  toCairoBool: () => toCairoBool,
  toHex: () => toHex,
  toHex64: () => toHex64,
  toHexString: () => toHexString,
  toStorageKey: () => toStorageKey,
  tryToBigInt: () => tryToBigInt
});
var isUndefined = (value) => {
  return typeof value === "undefined" || value === void 0;
};
function isNumber2(value) {
  return typeof value === "number";
}
function isBoolean(value) {
  return typeof value === "boolean";
}
function isBigInt(value) {
  return typeof value === "bigint";
}
function isString(value) {
  return typeof value === "string";
}
function isBuffer(obj) {
  return typeof Buffer !== "undefined" && obj instanceof Buffer;
}
function isObject2(item) {
  return !!item && typeof item === "object" && !Array.isArray(item);
}
function isInteger2(value) {
  return Number.isInteger(value);
}
function isHex2(hex) {
  return /^0[xX][0-9a-fA-F]*$/.test(hex);
}
var isHexString2 = isHex2;
function toBigInt(value) {
  return BigInt(value);
}
function tryToBigInt(value) {
  return value ? BigInt(value) : void 0;
}
function toHex(value) {
  return addHexPrefix(toBigInt(value).toString(16));
}
var toHexString = toHex;
function cleanHex(hex) {
  return toHex(hex);
}
function toStorageKey(number) {
  return addHexPrefix(toBigInt(number).toString(16).padStart(64, "0"));
}
function toHex64(number) {
  const res = addHexPrefix(toBigInt(number).toString(16).padStart(64, "0"));
  if (res.length !== 66) throw TypeError("number is too big for hex 0x(64) representation");
  return res;
}
function hexToDecimalString(hex) {
  return BigInt(addHexPrefix(hex)).toString(10);
}
function assertInRange(input, lowerBound, upperBound, inputName = "") {
  const messageSuffix = inputName === "" ? "invalid length" : `invalid ${inputName} length`;
  const inputBigInt = BigInt(input);
  const lowerBoundBigInt = BigInt(lowerBound);
  const upperBoundBigInt = BigInt(upperBound);
  assert(
    inputBigInt >= lowerBoundBigInt && inputBigInt <= upperBoundBigInt,
    `Message not signable, ${messageSuffix}.`
  );
}
function bigNumberishArrayToDecimalStringArray(data) {
  return data.map((x) => toBigInt(x).toString(10));
}
function bigNumberishArrayToHexadecimalStringArray(data) {
  return data.map((x) => toHex(x));
}
function isStringWholeNumber(str) {
  return /^\d+$/.test(str);
}
function getDecimalString(str) {
  if (isHex2(str)) {
    return hexToDecimalString(str);
  }
  if (isStringWholeNumber(str)) {
    return str;
  }
  throw new Error(`${str} needs to be a hex-string or whole-number-string`);
}
function getHexString(str) {
  if (isHex2(str)) {
    return str;
  }
  if (isStringWholeNumber(str)) {
    return toHexString(str);
  }
  throw new Error(`${str} needs to be a hex-string or whole-number-string`);
}
function getHexStringArray(array) {
  return array.map(getHexString);
}
function toCairoBool(value) {
  return (+value).toString();
}
function hexToBytes3(str) {
  if (!isHex2(str)) throw new Error(`${str} needs to be a hex-string`);
  let adaptedValue = removeHexPrefix(str);
  if (adaptedValue.length % 2 !== 0) {
    adaptedValue = `0${adaptedValue}`;
  }
  return hexToBytes(adaptedValue);
}
function addPercent(number, percent) {
  const bigIntNum = BigInt(number);
  return bigIntNum + bigIntNum * BigInt(percent) / 100n;
}
function stringToSha256ToArrayBuff4(str) {
  const int312 = (n) => Number(n & MASK_312);
  const result = int312(BigInt(addHexPrefix(buf2hex(sha256(str)))));
  return hexToBytes3(toHex(result));
}
function isBigNumberish(input) {
  return isNumber2(input) || isBigInt(input) || isString(input) && (isHex2(input) || isStringWholeNumber(input));
}
function getNext(iterator) {
  const it = iterator.next();
  if (it.done) throw new Error("Unexpected end of response");
  return it.value;
}
var selector_exports = {};
__export2(selector_exports, {
  getL1MessageHash: () => getL1MessageHash,
  getL2MessageHash: () => getL2MessageHash,
  getSelector: () => getSelector,
  getSelectorFromName: () => getSelectorFromName,
  keccakBn: () => keccakBn,
  solidityUint256PackedKeccak256: () => solidityUint256PackedKeccak256,
  starknetKeccak: () => starknetKeccak
});
function keccakBn(value) {
  const hexWithoutPrefix = removeHexPrefix(toHex(BigInt(value)));
  const evenHex = hexWithoutPrefix.length % 2 === 0 ? hexWithoutPrefix : `0${hexWithoutPrefix}`;
  return addHexPrefix(keccak(hexToBytes3(addHexPrefix(evenHex))).toString(16));
}
function keccakHex(str) {
  return addHexPrefix(keccak(utf8ToArray(str)).toString(16));
}
function starknetKeccak(str) {
  const hash = BigInt(keccakHex(str));
  return hash & MASK_2502;
}
function getSelectorFromName(funcName) {
  return toHex(starknetKeccak(funcName));
}
function getSelector(value) {
  if (isNumber2(value) || isBigInt(value)) return toHex(value);
  if (isHex2(value)) return value;
  if (isStringWholeNumber(value)) return toHex(value);
  return getSelectorFromName(value);
}
function solidityUint256PackedKeccak256(params) {
  const myEncode = addHexPrefix(
    params.reduce(
      (res, par) => res + removeHexPrefix(toHex(par)).padStart(64, "0"),
      ""
    )
  );
  return addHexPrefix(bytesToHex(keccak_2562(hexToBytes3(myEncode))));
}
function getL2MessageHash(l1FromAddress, l2ToAddress, l2Selector, l2Calldata, l1Nonce) {
  return solidityUint256PackedKeccak256([
    l1FromAddress,
    l2ToAddress,
    l1Nonce,
    l2Selector,
    l2Calldata.length,
    ...l2Calldata
  ]);
}
function getL1MessageHash(fromL2Address, toL1Address, payload) {
  return solidityUint256PackedKeccak256([fromL2Address, toL1Address, payload.length, ...payload]);
}
var shortString_exports = {};
__export2(shortString_exports, {
  decodeShortString: () => decodeShortString,
  encodeShortString: () => encodeShortString,
  isASCII: () => isASCII,
  isDecimalString: () => isDecimalString2,
  isLongText: () => isLongText,
  isShortString: () => isShortString,
  isShortText: () => isShortText,
  isText: () => isText,
  splitLongString: () => splitLongString
});
function isASCII(str) {
  return /^[\x00-\x7F]*$/.test(str);
}
function isShortString(str) {
  return str.length <= TEXT_TO_FELT_MAX_LEN;
}
function isDecimalString2(str) {
  return /^[0-9]*$/i.test(str);
}
function isText(val) {
  return isString(val) && !isHex2(val) && !isStringWholeNumber(val);
}
var isShortText = (val) => isText(val) && isShortString(val);
var isLongText = (val) => isText(val) && !isShortString(val);
function splitLongString(longStr) {
  const regex = RegExp(`[^]{1,${TEXT_TO_FELT_MAX_LEN}}`, "g");
  return longStr.match(regex) || [];
}
function encodeShortString(str) {
  if (!isASCII(str)) throw new Error(`${str} is not an ASCII string`);
  if (!isShortString(str)) throw new Error(`${str} is too long`);
  return addHexPrefix(str.replace(/./g, (char) => char.charCodeAt(0).toString(16)));
}
function decodeShortString(str) {
  if (!isASCII(str)) throw new Error(`${str} is not an ASCII string`);
  if (isHex2(str)) {
    return removeHexPrefix(str).replace(/.{2}/g, (hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  if (isDecimalString2(str)) {
    return decodeShortString("0X".concat(BigInt(str).toString(16)));
  }
  throw new Error(`${str} is not Hex or decimal`);
}
var byteArray_exports = {};
__export2(byteArray_exports, {
  byteArrayFromString: () => byteArrayFromString,
  stringFromByteArray: () => stringFromByteArray
});
function stringFromByteArray(myByteArray) {
  const pending_word = BigInt(myByteArray.pending_word) === 0n ? "" : decodeShortString(toHex(myByteArray.pending_word));
  return myByteArray.data.reduce((cumuledString, encodedString) => {
    const add2 = BigInt(encodedString) === 0n ? "" : decodeShortString(toHex(encodedString));
    return cumuledString + add2;
  }, "") + pending_word;
}
function byteArrayFromString(targetString) {
  const shortStrings = splitLongString(targetString);
  const remainder = shortStrings[shortStrings.length - 1];
  const shortStringsEncoded = shortStrings.map(encodeShortString);
  const [pendingWord, pendingWordLength] = remainder === void 0 || remainder.length === 31 ? ["0x00", 0] : [shortStringsEncoded.pop(), remainder.length];
  return {
    data: shortStringsEncoded.length === 0 ? [] : shortStringsEncoded,
    pending_word: pendingWord,
    pending_word_len: pendingWordLength
  };
}
var cairo_exports = {};
__export2(cairo_exports, {
  felt: () => felt,
  getAbiContractVersion: () => getAbiContractVersion,
  getArrayType: () => getArrayType,
  isCairo1Abi: () => isCairo1Abi,
  isCairo1Type: () => isCairo1Type,
  isLen: () => isLen,
  isTypeArray: () => isTypeArray,
  isTypeBool: () => isTypeBool,
  isTypeContractAddress: () => isTypeContractAddress,
  isTypeEnum: () => isTypeEnum,
  isTypeEthAddress: () => isTypeEthAddress,
  isTypeFelt: () => isTypeFelt,
  isTypeInt: () => isTypeInt,
  isTypeLiteral: () => isTypeLiteral,
  isTypeNamedTuple: () => isTypeNamedTuple,
  isTypeNonZero: () => isTypeNonZero,
  isTypeOption: () => isTypeOption,
  isTypeResult: () => isTypeResult,
  isTypeSecp256k1Point: () => isTypeSecp256k1Point,
  isTypeStruct: () => isTypeStruct,
  isTypeTuple: () => isTypeTuple,
  isTypeU96: () => isTypeU96,
  isTypeUint: () => isTypeUint,
  isTypeUint256: () => isTypeUint256,
  tuple: () => tuple,
  uint256: () => uint256,
  uint512: () => uint512
});
function addCompiledFlag(compiled) {
  Object.defineProperty(compiled, "__compiled__", {
    enumerable: false,
    writable: false,
    value: true
  });
  return compiled;
}
var CairoFelt252 = class _CairoFelt252 {
  /**
   * byte representation of the felt252
   */
  data;
  static abiSelector = "core::felt252";
  constructor(data) {
    _CairoFelt252.validate(data);
    const processedData = _CairoFelt252.__processData(data);
    this.data = processedData.subarray(processedData.findIndex((x) => x > 0));
  }
  static __processData(data) {
    if (isString(data)) {
      return stringToUint8Array(data);
    }
    if (isBigInt(data)) {
      return bigIntToUint8Array(data);
    }
    if (Number.isInteger(data)) {
      return bigIntToUint8Array(BigInt(data));
    }
    if (isBoolean(data)) {
      return bigIntToUint8Array(BigInt(data ? 1 : 0));
    }
    throw new Error(`${data} can't be computed by felt()`);
  }
  toBigInt() {
    return uint8ArrayToBigInt(this.data);
  }
  decodeUtf8() {
    return new TextDecoder().decode(this.data);
  }
  toHexString() {
    return addHexPrefix(this.toBigInt().toString(16));
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  static assertRange(val) {
    assert(val >= 0n && val < PRIME, `Value ${val} is out of felt252 range [0, ${PRIME})`);
  }
  static validate(data) {
    assert(data !== null, "null value is not allowed for felt252");
    assert(data !== void 0, "undefined value is not allowed for felt252");
    assert(
      isString(data) || isNumber2(data) || isBigInt(data) || isBoolean(data),
      `Unsupported data type '${typeof data}' for felt252. Expected string, number, bigint, or boolean`
    );
    const value = _CairoFelt252.__processData(data);
    const bn = uint8ArrayToBigInt(value);
    _CairoFelt252.assertRange(bn);
  }
  static is(data) {
    try {
      _CairoFelt252.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  static isAbiType(abiType) {
    return abiType === _CairoFelt252.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    return new _CairoFelt252(getNext(responseIterator));
  }
};
function CairoFelt(it) {
  if (isBigInt(it) || Number.isInteger(it)) {
    const val = BigInt(it);
    CairoFelt252.assertRange(val);
    return val.toString();
  }
  if (isString(it)) {
    if (isHex2(it)) {
      const val = BigInt(it);
      CairoFelt252.assertRange(val);
      return val.toString();
    }
    if (isText(it)) {
      if (!isShortString(it)) {
        throw new Error(
          `${it} is a long string > 31 chars. Please split it into an array of short strings.`
        );
      }
      return BigInt(encodeShortString(it)).toString();
    }
    if (isStringWholeNumber(it)) {
      const val = BigInt(it);
      CairoFelt252.assertRange(val);
      return val.toString();
    }
  }
  if (isBoolean(it)) {
    return `${+it}`;
  }
  throw new Error(`${it} can't be computed by felt()`);
}
var UINT_128_MAX = (1n << 128n) - 1n;
var UINT_256_MAX = (1n << 256n) - 1n;
var UINT_256_MIN = 0n;
var UINT_256_LOW_MAX = 340282366920938463463374607431768211455n;
var UINT_256_HIGH_MAX = 340282366920938463463374607431768211455n;
var UINT_256_LOW_MIN = 0n;
var UINT_256_HIGH_MIN = 0n;
var CairoUint256 = class _CairoUint256 {
  low;
  // TODO should be u128
  high;
  // TODO should be u128
  static abiSelector = "core::integer::u256";
  constructor(...arr) {
    if (isObject2(arr[0]) && arr.length === 1 && "low" in arr[0] && "high" in arr[0]) {
      const props = _CairoUint256.validateProps(
        arr[0].low,
        arr[0].high
      );
      this.low = props.low;
      this.high = props.high;
    } else if (arr.length === 1) {
      const bigInt = _CairoUint256.validate(arr[0]);
      this.low = bigInt & UINT_128_MAX;
      this.high = bigInt >> 128n;
    } else if (arr.length === 2) {
      const props = _CairoUint256.validateProps(arr[0], arr[1]);
      this.low = props.low;
      this.high = props.high;
    } else {
      throw Error("Incorrect constructor parameters");
    }
  }
  /**
   * Validate if BigNumberish can be represented as Unit256
   */
  static validate(bigNumberish) {
    assert(bigNumberish !== null, "null value is not allowed for u256");
    assert(bigNumberish !== void 0, "undefined value is not allowed for u256");
    assert(
      isBigNumberish(bigNumberish) || isObject2(bigNumberish),
      `Unsupported data type '${typeof bigNumberish}' for u256. Expected string, number, bigint, or Uint256 object`
    );
    const bigInt = BigInt(bigNumberish);
    assert(bigInt >= UINT_256_MIN, "bigNumberish is smaller than UINT_256_MIN");
    assert(bigInt <= UINT_256_MAX, "bigNumberish is bigger than UINT_256_MAX");
    return bigInt;
  }
  /**
   * Validate if low and high can be represented as Unit256
   */
  static validateProps(low, high) {
    const bigIntLow = BigInt(low);
    const bigIntHigh = BigInt(high);
    assert(
      bigIntLow >= UINT_256_LOW_MIN && bigIntLow <= UINT_256_LOW_MAX,
      "low is out of range UINT_256_LOW_MIN - UINT_256_LOW_MAX"
    );
    assert(
      bigIntHigh >= UINT_256_HIGH_MIN && bigIntHigh <= UINT_256_HIGH_MAX,
      "high is out of range UINT_256_HIGH_MIN - UINT_256_HIGH_MAX"
    );
    return { low: bigIntLow, high: bigIntHigh };
  }
  /**
   * Check if BigNumberish can be represented as Unit256
   */
  static is(bigNumberish) {
    try {
      _CairoUint256.validate(bigNumberish);
    } catch (error) {
      return false;
    }
    return true;
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoUint256.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    const low = getNext(responseIterator);
    const high = getNext(responseIterator);
    return new _CairoUint256(low, high);
  }
  /**
   * Return bigint representation
   */
  toBigInt() {
    return (this.high << 128n) + this.low;
  }
  /**
   * Return Uint256 structure with HexString props
   * {low: HexString, high: HexString}
   */
  toUint256HexString() {
    return {
      low: addHexPrefix(this.low.toString(16)),
      high: addHexPrefix(this.high.toString(16))
    };
  }
  /**
   * Return Uint256 structure with DecimalString props
   * {low: DecString, high: DecString}
   */
  toUint256DecimalString() {
    return {
      low: this.low.toString(10),
      high: this.high.toString(10)
    };
  }
  /**
   * Return api requests representation witch is felt array
   */
  toApiRequest() {
    return [CairoFelt(this.low), CairoFelt(this.high)];
  }
};
var UINT_512_MAX = (1n << 512n) - 1n;
var UINT_512_MIN = 0n;
var UINT_128_MIN = 0n;
var CairoUint512 = class _CairoUint512 {
  limb0;
  // TODO should be u128
  limb1;
  // TODO should be u128
  limb2;
  // TODO should be u128
  limb3;
  // TODO should be u128
  static abiSelector = "core::integer::u512";
  constructor(...arr) {
    if (isObject2(arr[0]) && arr.length === 1 && "limb0" in arr[0] && "limb1" in arr[0] && "limb2" in arr[0] && "limb3" in arr[0]) {
      const props = _CairoUint512.validateProps(
        arr[0].limb0,
        arr[0].limb1,
        arr[0].limb2,
        arr[0].limb3
      );
      this.limb0 = props.limb0;
      this.limb1 = props.limb1;
      this.limb2 = props.limb2;
      this.limb3 = props.limb3;
    } else if (arr.length === 1) {
      const bigInt = _CairoUint512.validate(arr[0]);
      this.limb0 = bigInt & UINT_128_MAX;
      this.limb1 = (bigInt & UINT_128_MAX << 128n) >> 128n;
      this.limb2 = (bigInt & UINT_128_MAX << 256n) >> 256n;
      this.limb3 = bigInt >> 384n;
    } else if (arr.length === 4) {
      const props = _CairoUint512.validateProps(arr[0], arr[1], arr[2], arr[3]);
      this.limb0 = props.limb0;
      this.limb1 = props.limb1;
      this.limb2 = props.limb2;
      this.limb3 = props.limb3;
    } else {
      throw Error("Incorrect Uint512 constructor parameters");
    }
  }
  /**
   * Validate if BigNumberish can be represented as Uint512
   */
  static validate(bigNumberish) {
    assert(bigNumberish !== null, "null value is not allowed for u512");
    assert(bigNumberish !== void 0, "undefined value is not allowed for u512");
    assert(
      isBigNumberish(bigNumberish) || isObject2(bigNumberish),
      `Unsupported data type '${typeof bigNumberish}' for u512. Expected string, number, bigint, or Uint512 object`
    );
    const bigInt = BigInt(bigNumberish);
    assert(bigInt >= UINT_512_MIN, "bigNumberish is smaller than UINT_512_MIN.");
    assert(bigInt <= UINT_512_MAX, "bigNumberish is bigger than UINT_512_MAX.");
    return bigInt;
  }
  /**
   * Validate if limbs can be represented as Uint512
   */
  static validateProps(limb0, limb1, limb2, limb3) {
    const l0 = BigInt(limb0);
    const l1 = BigInt(limb1);
    const l2 = BigInt(limb2);
    const l3 = BigInt(limb3);
    [l0, l1, l2, l3].forEach((value, index) => {
      assert(
        value >= UINT_128_MIN && value <= UINT_128_MAX,
        `limb${index} is not in the range of a u128 number`
      );
    });
    return { limb0: l0, limb1: l1, limb2: l2, limb3: l3 };
  }
  /**
   * Check if BigNumberish can be represented as Uint512
   */
  static is(bigNumberish) {
    try {
      _CairoUint512.validate(bigNumberish);
    } catch (error) {
      return false;
    }
    return true;
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoUint512.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    const limb0 = getNext(responseIterator);
    const limb1 = getNext(responseIterator);
    const limb2 = getNext(responseIterator);
    const limb3 = getNext(responseIterator);
    return new _CairoUint512(limb0, limb1, limb2, limb3);
  }
  /**
   * Return bigint representation
   */
  toBigInt() {
    return (this.limb3 << 384n) + (this.limb2 << 256n) + (this.limb1 << 128n) + this.limb0;
  }
  /**
   * Return Uint512 structure with HexString props
   * limbx: HexString
   */
  toUint512HexString() {
    return {
      limb0: addHexPrefix(this.limb0.toString(16)),
      limb1: addHexPrefix(this.limb1.toString(16)),
      limb2: addHexPrefix(this.limb2.toString(16)),
      limb3: addHexPrefix(this.limb3.toString(16))
    };
  }
  /**
   * Return Uint512 structure with DecimalString props
   * limbx DecString
   */
  toUint512DecimalString() {
    return {
      limb0: this.limb0.toString(10),
      limb1: this.limb1.toString(10),
      limb2: this.limb2.toString(10),
      limb3: this.limb3.toString(10)
    };
  }
  /**
   * Return api requests representation witch is felt array
   */
  toApiRequest() {
    return [
      CairoFelt(this.limb0),
      CairoFelt(this.limb1),
      CairoFelt(this.limb2),
      CairoFelt(this.limb3)
    ];
  }
};
var isLen = (name) => /_len$/.test(name);
var isTypeFelt = (type) => type === "felt" || type === "core::felt252";
var isTypeArray = (type) => /\*/.test(type) || type.startsWith("core::array::Array::") || type.startsWith("core::array::Span::");
var isTypeTuple = (type) => type.startsWith("(") && type.endsWith(")");
var isTypeNamedTuple = (type) => {
  const start = type.indexOf("(");
  return start !== -1 && type.indexOf(")", start + 1) !== -1 && type.includes(":");
};
var isTypeStruct = (type, structs) => type in structs;
var isTypeEnum = (type, enums) => type in enums;
var isTypeOption = (type) => type.startsWith("core::option::Option::");
var isTypeResult = (type) => type.startsWith("core::result::Result::");
var isTypeUint = (type) => Object.values(Uint).includes(type);
var isTypeInt = (type) => Object.values(Int).includes(type);
var isTypeUint256 = (type) => CairoUint256.isAbiType(type);
var isTypeLiteral = (type) => Object.values(Literal).includes(type);
var isTypeBool = (type) => type === "core::bool";
var isTypeContractAddress = (type) => type === Literal.ContractAddress;
var isTypeEthAddress = (type) => type === ETH_ADDRESS;
var isTypeU96 = (type) => type === "core::internal::bounded_int::BoundedInt::<0, 79228162514264337593543950335>";
var isTypeSecp256k1Point = (type) => type === Literal.Secp256k1Point;
var isCairo1Type = (type) => type.includes("::");
var getArrayType = (type) => {
  return isCairo1Type(type) ? type.substring(type.indexOf("<") + 1, type.lastIndexOf(">")) : type.replaceAll("*", "");
};
function isCairo1Abi(abi) {
  const { cairo } = getAbiContractVersion(abi);
  if (cairo === void 0) {
    throw Error("Unable to determine Cairo version");
  }
  return cairo === "1";
}
function isTypeNonZero(type) {
  return type.startsWith(NON_ZERO_PREFIX);
}
function getAbiContractVersion(abi) {
  if (abi.find((it) => it.type === "interface")) {
    return { cairo: "1", compiler: "2" };
  }
  const testSubject = abi.find(
    (it) => (it.type === "function" || it.type === "constructor") && (it.inputs.length || it.outputs.length)
  );
  if (!testSubject) {
    return { cairo: void 0, compiler: void 0 };
  }
  const io = testSubject.inputs.length ? testSubject.inputs : testSubject.outputs;
  if (isCairo1Type(io[0].type)) {
    return { cairo: "1", compiler: "1" };
  }
  return { cairo: "0", compiler: "0" };
}
var uint256 = (it) => {
  return new CairoUint256(it).toUint256DecimalString();
};
var uint512 = (it) => {
  return new CairoUint512(it).toUint512DecimalString();
};
var tuple = (...args) => ({ ...args });
function felt(it) {
  return CairoFelt(it);
}
var CairoCustomEnum = class {
  /**
   * direct readonly access to variants of the Cairo Custom Enum.
   * @returns a value of type any
   * @example
   * ```typescript
   * const successValue = myCairoEnum.variant.Success;
   */
  variant;
  /**
   * @param enumContent an object with the variants as keys and the content as value. Only one content shall be defined.
   */
  constructor(enumContent) {
    const variantsList = Object.values(enumContent);
    if (variantsList.length === 0) {
      throw new Error("This Enum must have at least 1 variant");
    }
    const nbActiveVariants = variantsList.filter((content) => !isUndefined(content)).length;
    if (nbActiveVariants !== 1) {
      throw new Error("This Enum must have exactly one active variant");
    }
    this.variant = enumContent;
  }
  /**
   *
   * @returns the content of the valid variant of a Cairo custom Enum.
   */
  unwrap() {
    const variants = Object.values(this.variant);
    return variants.find((item) => !isUndefined(item));
  }
  /**
   *
   * @returns the name of the valid variant of a Cairo custom Enum.
   */
  activeVariant() {
    const variants = Object.entries(this.variant);
    const activeVariant = variants.find((item) => !isUndefined(item[1]));
    return isUndefined(activeVariant) ? "" : activeVariant[0];
  }
};
var CairoOptionVariant = {
  Some: 0,
  None: 1
};
var CairoOption = class {
  Some;
  None;
  constructor(variant, content) {
    if (!(variant in Object.values(CairoOptionVariant))) {
      throw new Error("Wrong variant! It should be CairoOptionVariant.Some or .None.");
    }
    if (variant === CairoOptionVariant.Some) {
      if (isUndefined(content)) {
        throw new Error(
          'The creation of a Cairo Option with "Some" variant needs a content as input.'
        );
      }
      this.Some = content;
      this.None = void 0;
    } else {
      this.Some = void 0;
      this.None = true;
    }
  }
  /**
   *
   * @returns the content of the valid variant of a Cairo custom Enum.
   *  If None, returns 'undefined'.
   */
  unwrap() {
    return this.None ? void 0 : this.Some;
  }
  /**
   *
   * @returns true if the valid variant is 'isSome'.
   */
  isSome() {
    return !isUndefined(this.Some);
  }
  /**
   *
   * @returns true if the valid variant is 'isNone'.
   */
  isNone() {
    return this.None === true;
  }
};
var CairoResultVariant = {
  Ok: 0,
  Err: 1
};
var CairoResult = class {
  Ok;
  Err;
  constructor(variant, resultContent) {
    if (!(variant in Object.values(CairoResultVariant))) {
      throw new Error("Wrong variant! It should be CairoResultVariant.Ok or .Err.");
    }
    if (variant === CairoResultVariant.Ok) {
      this.Ok = resultContent;
      this.Err = void 0;
    } else {
      this.Ok = void 0;
      this.Err = resultContent;
    }
  }
  /**
   *
   * @returns the content of the valid variant of a Cairo Result.
   */
  unwrap() {
    if (!isUndefined(this.Ok)) {
      return this.Ok;
    }
    if (!isUndefined(this.Err)) {
      return this.Err;
    }
    throw new Error("Both Result.Ok and .Err are undefined. Not authorized.");
  }
  /**
   *
   * @returns true if the valid variant is 'Ok'.
   */
  isOk() {
    return !isUndefined(this.Ok);
  }
  /**
   *
   * @returns true if the valid variant is 'isErr'.
   */
  isErr() {
    return !isUndefined(this.Err);
  }
};
var guard = {
  /**
   * Checks if the data is a BigInt (BN) and throws an error if not.
   *
   * @param {Record<string, any>} data - The data object containing the key to check.
   * @param {Record<string, any>} type - The type definition object.
   * @param {string} key - The key in the data object to check.
   * @throws {Error} If the data type does not match the expected BigInt (BN) type.
   */
  isBN: (data, type, key) => {
    if (!isBigInt(data[key]))
      throw new Error(
        `Data and formatter mismatch on ${key}:${type[key]}, expected response data ${key}:${data[key]} to be BN instead it is ${typeof data[key]}`
      );
  },
  /**
   * Throws an error for unhandled formatter types.
   *
   * @param {Record<string, any>} data - The data object containing the key.
   * @param {Record<string, any>} type - The type definition object.
   * @param {string} key - The key in the data object to check.
   * @throws {Error} If the formatter encounters an unknown type.
   */
  unknown: (data, type, key) => {
    throw new Error(`Unhandled formatter type on ${key}:${type[key]} for data ${key}:${data[key]}`);
  }
};
function formatter(data, type, sameType) {
  return Object.entries(data).reduce(
    (acc, [key, value]) => {
      const elType = sameType ?? type[key];
      if (!(key in type) && !sameType) {
        acc[key] = value;
        return acc;
      }
      if (elType === "string") {
        if (Array.isArray(data[key])) {
          const arrayStr = formatter(
            data[key],
            data[key].map((_) => elType)
          );
          acc[key] = Object.values(arrayStr).join("");
          return acc;
        }
        guard.isBN(data, type, key);
        acc[key] = decodeShortString(value);
        return acc;
      }
      if (elType === "number") {
        guard.isBN(data, type, key);
        acc[key] = Number(value);
        return acc;
      }
      if (typeof elType === "function") {
        acc[key] = elType(value);
        return acc;
      }
      if (Array.isArray(elType)) {
        const arrayObj = formatter(data[key], elType, elType[0]);
        acc[key] = Object.values(arrayObj);
        return acc;
      }
      if (isObject2(elType)) {
        acc[key] = formatter(data[key], elType);
        return acc;
      }
      guard.unknown(data, type, key);
      return acc;
    },
    {}
  );
}
var CairoBytes31 = class _CairoBytes31 {
  static MAX_BYTE_SIZE = 31;
  data;
  static abiSelector = "core::bytes_31::bytes31";
  constructor(data) {
    _CairoBytes31.validate(data);
    const processedData = _CairoBytes31.__processData(data);
    this.data = new Uint8Array(_CairoBytes31.MAX_BYTE_SIZE);
    this.data.set(processedData, _CairoBytes31.MAX_BYTE_SIZE - processedData.length);
  }
  static __processData(data) {
    if (isString(data)) {
      return stringToUint8Array(data);
    }
    if (isBuffer(data)) {
      return new Uint8Array(data);
    }
    if (data instanceof Uint8Array) {
      return new Uint8Array(data);
    }
    throw new Error("Invalid input type for CairoBytes31. Expected string, Buffer, or Uint8Array");
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return uint8ArrayToBigInt(this.data);
  }
  decodeUtf8() {
    const cutoff = this.data.findIndex((x) => x > 0);
    const pruned = this.data.subarray(cutoff >= 0 ? cutoff : Infinity);
    return new TextDecoder().decode(pruned);
  }
  /**
   * @param padded flag for including leading zeros
   */
  toHexString(padded) {
    const hex = padded === "padded" ? buf2hex(this.data) : this.toBigInt().toString(16);
    return addHexPrefix(hex);
  }
  static validate(data) {
    const byteLength = _CairoBytes31.__processData(data).length;
    assert(
      byteLength <= this.MAX_BYTE_SIZE,
      `Data is too long: ${byteLength} bytes (max ${this.MAX_BYTE_SIZE} bytes)`
    );
  }
  static is(data) {
    try {
      _CairoBytes31.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoBytes31.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    return new _CairoBytes31(getNext(responseIterator));
  }
};
var ec_exports = {};
__export2(ec_exports, {
  starkCurve: () => esm_exports3,
  weierstrass: () => weierstrass_exports
});
function computePedersenHash(a, b) {
  return pedersen(BigInt(a), BigInt(b));
}
function computeHashOnElements2(data) {
  return [...data, data.length].reduce((x, y) => pedersen(BigInt(x), BigInt(y)), 0).toString();
}
var computePedersenHashOnElements = computeHashOnElements2;
var errorCodes = {
  FAILED_TO_RECEIVE_TXN: 1,
  NO_TRACE_AVAILABLE: 10,
  CONTRACT_NOT_FOUND: 20,
  ENTRYPOINT_NOT_FOUND: 21,
  BLOCK_NOT_FOUND: 24,
  INVALID_TXN_INDEX: 27,
  CLASS_HASH_NOT_FOUND: 28,
  TXN_HASH_NOT_FOUND: 29,
  PAGE_SIZE_TOO_BIG: 31,
  NO_BLOCKS: 32,
  INVALID_CONTINUATION_TOKEN: 33,
  TOO_MANY_KEYS_IN_FILTER: 34,
  CONTRACT_ERROR: 40,
  TRANSACTION_EXECUTION_ERROR: 41,
  STORAGE_PROOF_NOT_SUPPORTED: 42,
  CLASS_ALREADY_DECLARED: 51,
  INVALID_TRANSACTION_NONCE: 52,
  INSUFFICIENT_RESOURCES_FOR_VALIDATE: 53,
  INSUFFICIENT_ACCOUNT_BALANCE: 54,
  VALIDATION_FAILURE: 55,
  COMPILATION_FAILED: 56,
  CONTRACT_CLASS_SIZE_IS_TOO_LARGE: 57,
  NON_ACCOUNT: 58,
  DUPLICATE_TX: 59,
  COMPILED_CLASS_HASH_MISMATCH: 60,
  UNSUPPORTED_TX_VERSION: 61,
  UNSUPPORTED_CONTRACT_CLASS_VERSION: 62,
  UNEXPECTED_ERROR: 63,
  REPLACEMENT_TRANSACTION_UNDERPRICED: 64,
  FEE_BELOW_MINIMUM: 65,
  INVALID_SUBSCRIPTION_ID: 66,
  TOO_MANY_ADDRESSES_IN_FILTER: 67,
  TOO_MANY_BLOCKS_BACK: 68,
  COMPILATION_ERROR: 100,
  //
  INVALID_ADDRESS: 150,
  TOKEN_NOT_SUPPORTED: 151,
  INVALID_SIGNATURE: 153,
  MAX_AMOUNT_TOO_LOW: 154,
  CLASS_HASH_NOT_SUPPORTED: 155,
  PAYMASTER_TRANSACTION_EXECUTION_ERROR: 156,
  INVALID_TIME_BOUNDS: 157,
  INVALID_DEPLOYMENT_DATA: 158,
  INVALID_CLASS_HASH: 159,
  INVALID_ID: 160,
  UNKNOWN_ERROR: 163
};
var rpc_default = errorCodes;
function fixStack(target, fn = target.constructor) {
  const { captureStackTrace } = Error;
  captureStackTrace && captureStackTrace(target, fn);
}
function fixProto(target, prototype) {
  const { setPrototypeOf } = Object;
  setPrototypeOf ? setPrototypeOf(target, prototype) : target.__proto__ = prototype;
}
var CustomError = class extends Error {
  name;
  constructor(message) {
    super(message);
    Object.defineProperty(this, "name", {
      value: new.target.name,
      enumerable: false,
      configurable: true
    });
    fixProto(this, new.target.prototype);
    fixStack(this);
  }
};
var LibraryError = class extends CustomError {
};
var RpcError = class extends LibraryError {
  constructor(baseError, method, params) {
    super(`RPC: ${method} with params ${stringify2(params, null, 2)}

      ${baseError.code}: ${baseError.message}: ${stringify2(baseError.data)}`);
    this.baseError = baseError;
    this.request = { method, params };
  }
  request;
  get code() {
    return this.baseError.code;
  }
  /**
   * Verifies the underlying RPC error, also serves as a type guard for the _baseError_ property
   * @example
   * ```typescript
   * SomeError.isType('UNEXPECTED_ERROR');
   * ```
   */
  isType(typeName) {
    return rpc_default[typeName] === this.code;
  }
};
var buffer_default = config2.get("buffer") || typeof Buffer !== "undefined" && Buffer || typeof globalThis !== "undefined" && globalThis.Buffer || typeof window !== "undefined" && window.Buffer || typeof global !== "undefined" && global.Buffer || class {
  constructor() {
    throw new LibraryError(
      `Buffer not detected, use 'config.set("buffer", YourBufferPolyfill)' or polyfill or Node.js environment for Buffer support`
    );
  }
  static from(_data) {
    throw new LibraryError(
      `Buffer not detected, use 'config.set("buffer", YourBufferPolyfill)' or polyfill or Node.js environment for Buffer support`
    );
  }
  static isBuffer(obj) {
    const BufferImpl = config2.get("buffer") || typeof Buffer !== "undefined" && Buffer;
    return BufferImpl && BufferImpl.isBuffer && BufferImpl.isBuffer(obj);
  }
};
var CairoUint32 = class _CairoUint32 {
  data;
  static abiSelector = "core::u32::u32";
  constructor(data) {
    _CairoUint32.validate(data);
    this.data = _CairoUint32.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(bigIntToUint8Array(this.data));
  }
  toHexString() {
    return addHexPrefix(this.toBigInt().toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoUint32.__processData(data);
    assert(value >= 0n && value <= 2n ** 32n - 1n, "Value is out of u32 range [0, 2^32)");
  }
  static is(data) {
    try {
      _CairoUint32.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoUint32.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    return new _CairoUint32(getNext(responseIterator));
  }
};
var CairoByteArray = class _CairoByteArray {
  /**
   * entire dataset
   */
  data = [];
  /**
   * cairo specific implementation helper
   */
  pending_word;
  // felt
  /**
   * cairo specific implementation helper
   */
  pending_word_len;
  // u32
  static abiSelector = "core::byte_array::ByteArray";
  constructor(...arr) {
    if (arr.length === 3) {
      const [dataArg, pendingWord, pendingWordLen] = arr;
      assert(
        Array.isArray(dataArg) && pendingWord instanceof CairoFelt252 && pendingWordLen instanceof CairoUint32,
        "Invalid constructor parameters. Expected (CairoBytes31[], CairoFelt252, CairoUint32)"
      );
      this.data = dataArg;
      this.pending_word = pendingWord;
      this.pending_word_len = pendingWordLen;
      return;
    }
    const inData = arr[0];
    _CairoByteArray.validate(inData);
    const { data, pending_word, pending_word_len } = _CairoByteArray.__processData(inData);
    this.data = data;
    this.pending_word = pending_word;
    this.pending_word_len = pending_word_len;
  }
  static __processData(inData) {
    let fullData;
    if (inData instanceof Uint8Array) {
      fullData = inData;
    } else if (isBuffer(inData)) {
      fullData = new Uint8Array(inData);
    } else if (isString(inData)) {
      fullData = stringToUint8Array(inData);
    } else if (isBigInt(inData)) {
      fullData = bigIntToUint8Array(inData);
    } else if (isInteger2(inData)) {
      fullData = bigIntToUint8Array(BigInt(inData));
    } else {
      throw new Error("Invalid input type. Expected Uint8Array, Buffer, string, number, or bigint");
    }
    const CHUNK_SIZE = CairoBytes31.MAX_BYTE_SIZE;
    const completeChunks = Math.floor(fullData.length / CHUNK_SIZE);
    const remainderLength = fullData.length % CHUNK_SIZE;
    const data = [];
    let pending_word;
    let pending_word_len;
    for (let i = 0; i < completeChunks; i += 1) {
      const chunkStart = i * CHUNK_SIZE;
      const chunkEnd = chunkStart + CHUNK_SIZE;
      const chunk = fullData.slice(chunkStart, chunkEnd);
      data.push(new CairoBytes31(chunk));
    }
    if (remainderLength > 0) {
      const remainder = fullData.slice(completeChunks * CHUNK_SIZE);
      let hex = "0x";
      for (let i = 0; i < remainder.length; i += 1) {
        hex += remainder[i].toString(16).padStart(2, "0");
      }
      pending_word = new CairoFelt252(hex);
      pending_word_len = new CairoUint32(remainderLength);
    } else {
      pending_word = new CairoFelt252(0);
      pending_word_len = new CairoUint32(0);
    }
    return { data, pending_word, pending_word_len };
  }
  toApiRequest() {
    this.assertInitialized();
    return addCompiledFlag([
      this.data.length.toString(),
      ...this.data.flatMap((bytes31) => bytes31.toApiRequest()),
      ...this.pending_word.toApiRequest(),
      ...this.pending_word_len.toApiRequest()
    ]);
  }
  decodeUtf8() {
    const allBytes = concatenateArrayBuffer(this.toElements());
    return new TextDecoder().decode(allBytes);
  }
  toBigInt() {
    const allBytes = concatenateArrayBuffer(this.toElements());
    if (allBytes.length === 0) {
      return 0n;
    }
    let result = 0n;
    allBytes.forEach((byte) => {
      result = result * 256n + BigInt(byte);
    });
    return result;
  }
  toHexString() {
    const allBytes = concatenateArrayBuffer(this.toElements());
    const hexValue = allBytes.length === 0 ? "0" : buf2hex(allBytes);
    return addHexPrefix(hexValue);
  }
  toBuffer() {
    const allBytes = concatenateArrayBuffer(this.toElements());
    return buffer_default.from(allBytes);
  }
  /**
   * Compute the Pedersen hash of this ByteArray, following OpenZeppelin's `hash_byte_array` algorithm.
   *
   * Serializes the ByteArray to its felt252 components (data array length, each data chunk,
   * pending_word, pending_word_len), then chains Pedersen hash over all elements starting
   * from 0, and finalizes with the total element count.
   *
   * @returns {string} hex-string felt252 Pedersen hash of the ByteArray
   * @example
   * ```typescript
   * const ba = new CairoByteArray('Hello');
   * const result = ba.hash();
   * // result = 0x15d19ad651ffaf8e90a13938db2081fa3ff01de0712e00cbe69891bace66c51
   * ```
   */
  hash() {
    this.assertInitialized();
    const serialized = [
      addHexPrefix(this.data.length.toString(16)),
      ...this.data.flatMap((bytes31) => bytes31.toApiRequest()),
      ...this.pending_word.toApiRequest(),
      ...this.pending_word_len.toApiRequest()
    ];
    return computeHashOnElements2(serialized);
  }
  /**
   * returns an array of all the data chunks and the pending word
   * when concatenated, represents the original bytes sequence
   */
  toElements() {
    this.assertInitialized();
    const allChunks = this.data.flatMap((chunk) => chunk.data);
    const pendingLen = Number(this.pending_word_len.toBigInt());
    if (pendingLen) {
      const pending = new Uint8Array(pendingLen);
      const paddingDifference = pendingLen - this.pending_word.data.length;
      pending.set(this.pending_word.data, paddingDifference);
      allChunks.push(pending);
    }
    return allChunks;
  }
  /**
   * Private helper to check if the CairoByteArray is properly initialized
   */
  assertInitialized() {
    assert(
      this.data && this.pending_word !== void 0 && this.pending_word_len !== void 0,
      "CairoByteArray is not properly initialized"
    );
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(
      !Array.isArray(data) || data instanceof Uint8Array,
      "Invalid input: arrays are not supported, use Uint8Array"
    );
    assert(
      typeof data !== "object" || isBuffer(data) || data instanceof Uint8Array,
      "Invalid input for CairoByteArray: objects are not supported"
    );
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input for CairoByteArray: decimal numbers are not supported, only integers"
    );
    assert(
      !isNumber2(data) || data >= 0,
      "Invalid input for CairoByteArray: negative numbers are not supported"
    );
    assert(
      !isBigInt(data) || data >= 0n,
      "Invalid input for CairoByteArray: negative bigints are not supported"
    );
    assert(
      data instanceof Uint8Array || isBuffer(data) || isString(data) || isNumber2(data) || isBigInt(data),
      "Invalid input type. Expected Uint8Array, Buffer, string, number, or bigint"
    );
  }
  /**
   * Check if the provided data is a valid CairoByteArray
   *
   * @param data - The data to check
   * @returns True if the data is a valid CairoByteArray, false otherwise
   */
  static is(data) {
    try {
      _CairoByteArray.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoByteArray.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    const data = Array.from(
      { length: Number(getNext(responseIterator)) },
      () => CairoBytes31.factoryFromApiResponse(responseIterator)
    );
    const pending_word = CairoFelt252.factoryFromApiResponse(responseIterator);
    const pending_word_len = CairoUint32.factoryFromApiResponse(responseIterator);
    return new _CairoByteArray(data, pending_word, pending_word_len);
  }
};
var CairoUint8 = class _CairoUint8 {
  data;
  static abiSelector = "core::integer::u8";
  constructor(data) {
    _CairoUint8.validate(data);
    this.data = _CairoUint8.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(bigIntToUint8Array(this.data));
  }
  toHexString() {
    return addHexPrefix(this.toBigInt().toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoUint8.__processData(data);
    assert(
      value >= RANGE_U8.min && value <= RANGE_U8.max,
      `Value is out of u8 range [${RANGE_U8.min}, ${RANGE_U8.max}]`
    );
  }
  static is(data) {
    try {
      _CairoUint8.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoUint8.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    return new _CairoUint8(getNext(responseIterator));
  }
};
var CairoUint16 = class _CairoUint16 {
  data;
  static abiSelector = "core::integer::u16";
  constructor(data) {
    _CairoUint16.validate(data);
    this.data = _CairoUint16.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(bigIntToUint8Array(this.data));
  }
  toHexString() {
    return addHexPrefix(this.toBigInt().toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoUint16.__processData(data);
    assert(
      value >= RANGE_U16.min && value <= RANGE_U16.max,
      `Value is out of u16 range [${RANGE_U16.min}, ${RANGE_U16.max}]`
    );
  }
  static is(data) {
    try {
      _CairoUint16.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoUint16.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    return new _CairoUint16(getNext(responseIterator));
  }
};
var CairoUint64 = class _CairoUint64 {
  data;
  static abiSelector = "core::integer::u64";
  constructor(data) {
    _CairoUint64.validate(data);
    this.data = _CairoUint64.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(bigIntToUint8Array(this.data));
  }
  toHexString() {
    return addHexPrefix(this.toBigInt().toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoUint64.__processData(data);
    assert(
      value >= RANGE_U64.min && value <= RANGE_U64.max,
      `Value is out of u64 range [${RANGE_U64.min}, ${RANGE_U64.max}]`
    );
  }
  static is(data) {
    try {
      _CairoUint64.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoUint64.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    return new _CairoUint64(getNext(responseIterator));
  }
};
var CairoUint96 = class _CairoUint96 {
  data;
  static abiSelector = "core::integer::u96";
  constructor(data) {
    _CairoUint96.validate(data);
    this.data = _CairoUint96.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(bigIntToUint8Array(this.data));
  }
  toHexString() {
    return addHexPrefix(this.toBigInt().toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoUint96.__processData(data);
    assert(
      value >= RANGE_U96.min && value <= RANGE_U96.max,
      `Value is out of u96 range [${RANGE_U96.min}, ${RANGE_U96.max}]`
    );
  }
  static is(data) {
    try {
      _CairoUint96.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoUint96.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    return new _CairoUint96(getNext(responseIterator));
  }
};
var CairoUint128 = class _CairoUint128 {
  data;
  static abiSelector = "core::integer::u128";
  constructor(data) {
    _CairoUint128.validate(data);
    this.data = _CairoUint128.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(bigIntToUint8Array(this.data));
  }
  toHexString() {
    return addHexPrefix(this.toBigInt().toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoUint128.__processData(data);
    assert(
      value >= RANGE_U128.min && value <= RANGE_U128.max,
      `Value is out of u128 range [${RANGE_U128.min}, ${RANGE_U128.max}]`
    );
  }
  static is(data) {
    try {
      _CairoUint128.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoUint128.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    return new _CairoUint128(getNext(responseIterator));
  }
};
var CairoInt8 = class _CairoInt8 {
  data;
  static abiSelector = "core::integer::i8";
  constructor(data) {
    _CairoInt8.validate(data);
    this.data = _CairoInt8.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(
      bigIntToUint8Array(this.data >= 0n ? this.data : 256n + this.data)
    );
  }
  /**
   * For negative values field element representation as positive hex string.
   * @returns cairo field arithmetic hex string
   */
  toHexString() {
    const value = this.toBigInt();
    if (value < 0n) {
      const fieldElement = PRIME + value;
      return addHexPrefix(fieldElement.toString(16));
    }
    return addHexPrefix(value.toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoInt8.__processData(data);
    assert(
      value >= RANGE_I8.min && value <= RANGE_I8.max,
      `Value is out of i8 range [${RANGE_I8.min}, ${RANGE_I8.max}]`
    );
  }
  static is(data) {
    try {
      _CairoInt8.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoInt8.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    const response = getNext(responseIterator);
    const value = BigInt(response);
    const signedValue = value > PRIME / 2n ? value - PRIME : value;
    return new _CairoInt8(signedValue);
  }
};
var CairoInt16 = class _CairoInt16 {
  data;
  static abiSelector = "core::integer::i16";
  constructor(data) {
    _CairoInt16.validate(data);
    this.data = _CairoInt16.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(
      bigIntToUint8Array(this.data >= 0n ? this.data : 65536n + this.data)
    );
  }
  /**
   * For negative values field element representation as positive hex string.
   * @returns cairo field arithmetic hex string
   */
  toHexString() {
    const value = this.toBigInt();
    if (value < 0n) {
      const fieldElement = PRIME + value;
      return addHexPrefix(fieldElement.toString(16));
    }
    return addHexPrefix(value.toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoInt16.__processData(data);
    assert(
      value >= RANGE_I16.min && value <= RANGE_I16.max,
      `Value is out of i16 range [${RANGE_I16.min}, ${RANGE_I16.max}]`
    );
  }
  static is(data) {
    try {
      _CairoInt16.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoInt16.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    const response = getNext(responseIterator);
    const value = BigInt(response);
    const signedValue = value > PRIME / 2n ? value - PRIME : value;
    return new _CairoInt16(signedValue);
  }
};
var CairoInt32 = class _CairoInt32 {
  data;
  static abiSelector = "core::integer::i32";
  constructor(data) {
    _CairoInt32.validate(data);
    this.data = _CairoInt32.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(
      bigIntToUint8Array(this.data >= 0n ? this.data : 4294967296n + this.data)
    );
  }
  /**
   * For negative values field element representation as positive hex string.
   * @returns cairo field arithmetic hex string
   */
  toHexString() {
    const value = this.toBigInt();
    if (value < 0n) {
      const fieldElement = PRIME + value;
      return addHexPrefix(fieldElement.toString(16));
    }
    return addHexPrefix(value.toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoInt32.__processData(data);
    assert(
      value >= RANGE_I32.min && value <= RANGE_I32.max,
      `Value is out of i32 range [${RANGE_I32.min}, ${RANGE_I32.max}]`
    );
  }
  static is(data) {
    try {
      _CairoInt32.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoInt32.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    const response = getNext(responseIterator);
    const value = BigInt(response);
    const signedValue = value > PRIME / 2n ? value - PRIME : value;
    return new _CairoInt32(signedValue);
  }
};
var CairoInt64 = class _CairoInt64 {
  data;
  static abiSelector = "core::integer::i64";
  constructor(data) {
    _CairoInt64.validate(data);
    this.data = _CairoInt64.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(
      bigIntToUint8Array(this.data >= 0n ? this.data : 2n ** 64n + this.data)
    );
  }
  /**
   * For negative values field element representation as positive hex string.
   * @returns cairo field arithmetic hex string
   */
  toHexString() {
    const value = this.toBigInt();
    if (value < 0n) {
      const fieldElement = PRIME + value;
      return addHexPrefix(fieldElement.toString(16));
    }
    return addHexPrefix(value.toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoInt64.__processData(data);
    assert(
      value >= RANGE_I64.min && value <= RANGE_I64.max,
      `Value is out of i64 range [${RANGE_I64.min}, ${RANGE_I64.max}]`
    );
  }
  static is(data) {
    try {
      _CairoInt64.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoInt64.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    const response = getNext(responseIterator);
    const value = BigInt(response);
    const signedValue = value > PRIME / 2n ? value - PRIME : value;
    return new _CairoInt64(signedValue);
  }
};
var CairoInt128 = class _CairoInt128 {
  data;
  static abiSelector = "core::integer::i128";
  constructor(data) {
    _CairoInt128.validate(data);
    this.data = _CairoInt128.__processData(data);
  }
  static __processData(data) {
    if (isString(data) && isText(data)) {
      return utf8ToBigInt(data);
    }
    return BigInt(data);
  }
  toApiRequest() {
    return addCompiledFlag([BigInt(this.toHexString()).toString()]);
  }
  toBigInt() {
    return this.data;
  }
  decodeUtf8() {
    return new TextDecoder().decode(
      bigIntToUint8Array(this.data >= 0n ? this.data : 2n ** 128n + this.data)
    );
  }
  /**
   * For negative values field element representation as positive hex string.
   * @returns cairo field arithmetic hex string
   */
  toHexString() {
    const value = this.toBigInt();
    if (value < 0n) {
      const fieldElement = PRIME + value;
      return addHexPrefix(fieldElement.toString(16));
    }
    return addHexPrefix(value.toString(16));
  }
  static validate(data) {
    assert(data !== null && data !== void 0, "Invalid input: null or undefined");
    assert(!isObject2(data) && !Array.isArray(data), "Invalid input: objects are not supported");
    assert(
      !isNumber2(data) || Number.isInteger(data),
      "Invalid input: decimal numbers are not supported, only integers"
    );
    const value = _CairoInt128.__processData(data);
    assert(
      value >= RANGE_I128.min && value <= RANGE_I128.max,
      `Value is out of i128 range [${RANGE_I128.min}, ${RANGE_I128.max}]`
    );
  }
  static is(data) {
    try {
      _CairoInt128.validate(data);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Check if provided abi type is this data type
   */
  static isAbiType(abiType) {
    return abiType === _CairoInt128.abiSelector;
  }
  static factoryFromApiResponse(responseIterator) {
    const response = getNext(responseIterator);
    const value = BigInt(response);
    const signedValue = value > PRIME / 2n ? value - PRIME : value;
    return new _CairoInt128(signedValue);
  }
};
var hdParsingStrategy = {
  // TODO: provjeri svi request parseri stvaraju array, dali je to ok sa requstParserom
  request: {
    [CairoBytes31.abiSelector]: (val) => {
      return new CairoBytes31(val).toApiRequest();
    },
    [CairoByteArray.abiSelector]: (val) => {
      return new CairoByteArray(val).toApiRequest();
    },
    [CairoFelt252.abiSelector]: (val) => {
      return new CairoFelt252(val).toApiRequest();
    },
    [CairoUint256.abiSelector]: (val) => {
      return new CairoUint256(val).toApiRequest();
    },
    [CairoUint512.abiSelector]: (val) => {
      return new CairoUint512(val).toApiRequest();
    },
    [CairoUint8.abiSelector]: (val) => {
      return new CairoUint8(val).toApiRequest();
    },
    [CairoUint16.abiSelector]: (val) => {
      return new CairoUint16(val).toApiRequest();
    },
    [CairoUint64.abiSelector]: (val) => {
      return new CairoUint64(val).toApiRequest();
    },
    [CairoUint96.abiSelector]: (val) => {
      return new CairoUint96(val).toApiRequest();
    },
    [CairoUint128.abiSelector]: (val) => {
      return new CairoUint128(val).toApiRequest();
    },
    [CairoInt8.abiSelector]: (val) => {
      return new CairoInt8(val).toApiRequest();
    },
    [CairoInt16.abiSelector]: (val) => {
      return new CairoInt16(val).toApiRequest();
    },
    [CairoInt32.abiSelector]: (val) => {
      return new CairoInt32(val).toApiRequest();
    },
    [CairoInt64.abiSelector]: (val) => {
      return new CairoInt64(val).toApiRequest();
    },
    [CairoInt128.abiSelector]: (val) => {
      return new CairoInt128(val).toApiRequest();
    }
  },
  response: {
    [CairoBytes31.abiSelector]: (responseIterator) => {
      return CairoBytes31.factoryFromApiResponse(responseIterator).decodeUtf8();
    },
    [CairoByteArray.abiSelector]: (responseIterator) => {
      return CairoByteArray.factoryFromApiResponse(responseIterator).decodeUtf8();
    },
    [CairoFelt252.abiSelector]: (responseIterator) => {
      return CairoFelt252.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint256.abiSelector]: (responseIterator) => {
      return CairoUint256.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint512.abiSelector]: (responseIterator) => {
      return CairoUint512.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint8.abiSelector]: (responseIterator) => {
      return CairoUint8.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint16.abiSelector]: (responseIterator) => {
      return CairoUint16.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint64.abiSelector]: (responseIterator) => {
      return CairoUint64.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint96.abiSelector]: (responseIterator) => {
      return CairoUint96.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint128.abiSelector]: (responseIterator) => {
      return CairoUint128.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoInt8.abiSelector]: (responseIterator) => {
      return CairoInt8.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoInt16.abiSelector]: (responseIterator) => {
      return CairoInt16.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoInt32.abiSelector]: (responseIterator) => {
      return CairoInt32.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoInt64.abiSelector]: (responseIterator) => {
      return CairoInt64.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoInt128.abiSelector]: (responseIterator) => {
      return CairoInt128.factoryFromApiResponse(responseIterator).toBigInt();
    }
  }
};
var fastParsingStrategy = {
  request: {
    [CairoBytes31.abiSelector]: (val) => {
      return new CairoBytes31(val).toApiRequest();
    },
    [CairoByteArray.abiSelector]: (val) => {
      return new CairoByteArray(val).toApiRequest();
    },
    [CairoFelt252.abiSelector]: (val) => {
      return new CairoFelt252(val).toApiRequest();
    },
    [CairoUint256.abiSelector]: (val) => {
      return new CairoUint256(val).toApiRequest();
    },
    [CairoUint512.abiSelector]: (val) => {
      return new CairoUint512(val).toApiRequest();
    },
    [CairoUint8.abiSelector]: (val) => {
      return felt(val);
    },
    [CairoUint16.abiSelector]: (val) => {
      return felt(val);
    },
    [CairoUint64.abiSelector]: (val) => {
      return felt(val);
    },
    [CairoUint96.abiSelector]: (val) => {
      return felt(val);
    },
    [CairoUint128.abiSelector]: (val) => {
      return felt(val);
    },
    [CairoInt8.abiSelector]: (val) => {
      return new CairoInt8(val).toApiRequest();
    },
    [CairoInt16.abiSelector]: (val) => {
      return new CairoInt16(val).toApiRequest();
    },
    [CairoInt32.abiSelector]: (val) => {
      return new CairoInt32(val).toApiRequest();
    },
    [CairoInt64.abiSelector]: (val) => {
      return new CairoInt64(val).toApiRequest();
    },
    [CairoInt128.abiSelector]: (val) => {
      return new CairoInt128(val).toApiRequest();
    }
  },
  response: {
    [CairoBytes31.abiSelector]: (responseIterator) => {
      return CairoBytes31.factoryFromApiResponse(responseIterator).decodeUtf8();
    },
    [CairoByteArray.abiSelector]: (responseIterator) => {
      return CairoByteArray.factoryFromApiResponse(responseIterator).decodeUtf8();
    },
    [CairoFelt252.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoUint256.abiSelector]: (responseIterator) => {
      return CairoUint256.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint512.abiSelector]: (responseIterator) => {
      return CairoUint512.factoryFromApiResponse(responseIterator).toBigInt();
    },
    [CairoUint8.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoUint16.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoUint64.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoUint96.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoUint128.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoInt8.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoInt16.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoInt32.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoInt64.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    },
    [CairoInt128.abiSelector]: (responseIterator) => {
      return BigInt(getNext(responseIterator));
    }
  }
};
var AbiParser1 = class {
  abi;
  parsingStrategy;
  constructor(abi, parsingStrategy) {
    this.abi = abi;
    this.parsingStrategy = parsingStrategy || fastParsingStrategy;
  }
  getRequestParser(abiType) {
    if (this.parsingStrategy.request[abiType]) {
      return this.parsingStrategy.request[abiType];
    }
    throw new Error(`Parser for ${abiType} not found`);
  }
  getResponseParser(abiType) {
    if (this.parsingStrategy.response[abiType]) {
      return this.parsingStrategy.response[abiType];
    }
    throw new Error(`Parser for ${abiType} not found`);
  }
  /**
   * abi method inputs length without '_len' inputs
   * cairo 0 reducer
   * @param abiMethod FunctionAbi
   * @returns number
   */
  methodInputsLength(abiMethod) {
    return abiMethod.inputs.reduce((acc, input) => !isLen(input.name) ? acc + 1 : acc, 0);
  }
  /**
   * get method definition from abi
   * @param name string
   * @returns FunctionAbi | undefined
   */
  getMethod(name) {
    return this.abi.find((it) => it.name === name);
  }
  /**
   * Get Abi in legacy format
   * @returns Abi
   */
  getLegacyFormat() {
    return this.abi;
  }
};
var AbiParser2 = class {
  abi;
  parsingStrategy;
  constructor(abi, parsingStrategy) {
    this.abi = abi;
    this.parsingStrategy = parsingStrategy || fastParsingStrategy;
  }
  getRequestParser(abiType) {
    if (this.parsingStrategy.request[abiType]) {
      return this.parsingStrategy.request[abiType];
    }
    throw new Error(`Parser for ${abiType} not found`);
  }
  getResponseParser(abiType) {
    if (this.parsingStrategy.response[abiType]) {
      return this.parsingStrategy.response[abiType];
    }
    throw new Error(`Parser for ${abiType} not found`);
  }
  /**
   * abi method inputs length
   * @param abiMethod FunctionAbi
   * @returns number
   */
  methodInputsLength(abiMethod) {
    return abiMethod.inputs.length;
  }
  /**
   * get method definition from abi
   * @param name string
   * @returns FunctionAbi | undefined
   */
  getMethod(name) {
    const intf = this.abi.find(
      (it) => it.type === "interface"
    );
    return intf?.items?.find((it) => it.name === name);
  }
  /**
   * Get Abi in legacy format
   * @returns Abi
   */
  getLegacyFormat() {
    return this.abi.flatMap((it) => {
      return it.type === "interface" ? it.items : it;
    });
  }
};
function createAbiParser(abi, parsingStrategy) {
  const version = getAbiVersion(abi);
  if (version === 0 || version === 1) {
    return new AbiParser1(abi, parsingStrategy);
  }
  if (version === 2) {
    return new AbiParser2(abi, parsingStrategy);
  }
  throw Error(`Unsupported ABI version ${version}`);
}
function getAbiVersion(abi) {
  if (abi.find((it) => it.type === "interface")) return 2;
  if (isCairo1Abi(abi)) return 1;
  return 0;
}
function isNoConstructorValid(method, argsCalldata, abiMethod) {
  return method === "constructor" && !abiMethod && !argsCalldata.length;
}
function parseNamedTuple(namedTuple) {
  const name = namedTuple.substring(0, namedTuple.indexOf(":"));
  const type = namedTuple.substring(name.length + ":".length);
  return { name, type };
}
function parseSubTuple(s) {
  if (!s.includes("(")) return { subTuple: [], result: s };
  const subTuple = [];
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "(") {
      let counter = 1;
      const lBracket = i;
      i++;
      while (counter) {
        if (s[i] === ")") counter--;
        if (s[i] === "(") counter++;
        i++;
      }
      subTuple.push(s.substring(lBracket, i));
      result += " ";
      i--;
    } else {
      result += s[i];
    }
    i++;
  }
  return {
    subTuple,
    result
  };
}
function extractCairo0Tuple(type) {
  const cleanType = type.replace(/\s/g, "").slice(1, -1);
  const { subTuple, result } = parseSubTuple(cleanType);
  let recomposed = result.split(",").map((it) => {
    return subTuple.length ? it.replace(" ", subTuple.shift()) : it;
  });
  if (isTypeNamedTuple(type)) {
    recomposed = recomposed.reduce((acc, it) => {
      return acc.concat(parseNamedTuple(it));
    }, []);
  }
  return recomposed;
}
function getClosureOffset(input, open2, close) {
  for (let i = 0, counter = 0; i < input.length; i++) {
    if (input[i] === open2) {
      counter++;
    } else if (input[i] === close && --counter === 0) {
      return i;
    }
  }
  return Number.POSITIVE_INFINITY;
}
function extractCairo1Tuple(type) {
  const input = type.slice(1, -1);
  const result = [];
  let currentIndex = 0;
  let limitIndex;
  while (currentIndex < input.length) {
    switch (true) {
      // Tuple
      case input[currentIndex] === "(": {
        limitIndex = currentIndex + getClosureOffset(input.slice(currentIndex), "(", ")") + 1;
        break;
      }
      case (input.startsWith("core::result::Result::<", currentIndex) || input.startsWith("core::array::Array::<", currentIndex) || input.startsWith("core::option::Option::<", currentIndex)): {
        limitIndex = currentIndex + getClosureOffset(input.slice(currentIndex), "<", ">") + 1;
        break;
      }
      default: {
        const commaIndex = input.indexOf(",", currentIndex);
        limitIndex = commaIndex !== -1 ? commaIndex : Number.POSITIVE_INFINITY;
      }
    }
    result.push(input.slice(currentIndex, limitIndex));
    currentIndex = limitIndex + 2;
  }
  return result;
}
function extractTupleMemberTypes(type) {
  return isCairo1Type(type) ? extractCairo1Tuple(type) : extractCairo0Tuple(type);
}
var CairoFixedArray = class _CairoFixedArray {
  /**
   * JS array representing a Cairo fixed array.
   */
  content;
  /**
   * Cairo fixed array type.
   */
  arrayType;
  static parseFixedArrayType(type) {
    if (!type.startsWith("[") || !type.endsWith("]")) {
      return void 0;
    }
    const separator = type.lastIndexOf("; ");
    const itemType = type.slice(1, separator);
    const size = type.slice(separator + 2, -1);
    if (separator <= 1 || size.length === 0 || ![...size].every((char) => char >= "0" && char <= "9")) {
      return void 0;
    }
    return { itemType, size };
  }
  /**
   * Create an instance representing a Cairo fixed Array.
   * @param {any[]} content JS array representing a Cairo fixed array.
   * @param {string} arrayType Cairo fixed array type.
   */
  constructor(content, arrayType) {
    assert(
      _CairoFixedArray.isTypeFixedArray(arrayType),
      `The type ${arrayType} is not a Cairo fixed array. Needs [type; length].`
    );
    try {
      _CairoFixedArray.getFixedArrayType(arrayType);
    } catch {
      throw new Error(
        `The type ${arrayType} do not includes any content type. Needs [type; length].`
      );
    }
    let arraySize;
    try {
      arraySize = _CairoFixedArray.getFixedArraySize(arrayType);
    } catch {
      throw new Error(
        `The type ${arrayType} type do not includes any length. Needs [type; length].`
      );
    }
    assert(
      arraySize === content.length,
      `The ABI type ${arrayType} is expecting ${arraySize} items. ${content.length} items provided.`
    );
    this.content = content;
    this.arrayType = arrayType;
  }
  /**
   * Retrieves the array size from the given type string representing a Cairo fixed array.
   * @param {string} type - The Cairo fixed array type.
   * @returns {number} The array size.
   * @example
   * ```typescript
   * const result = CairoFixedArray.getFixedArraySize("[core::integer::u32; 8]");
   * // result = 8
   * ```
   */
  static getFixedArraySize(type) {
    const fixedArrayType = _CairoFixedArray.parseFixedArrayType(type);
    if (!fixedArrayType)
      throw new Error(`ABI type ${type} do not includes a valid number after ';' character.`);
    return Number(fixedArrayType.size);
  }
  /**
   * Retrieves the Cairo fixed array size from the CairoFixedArray instance.
   * @returns {number} The fixed array size.
   * @example
   * ```typescript
   * const fArray = new CairoFixedArray([10,20,30], "[core::integer::u32; 3]");
   * const result = fArray.getFixedArraySize();
   * // result = 3
   * ```
   */
  getFixedArraySize() {
    return _CairoFixedArray.getFixedArraySize(this.arrayType);
  }
  /**
   * Retrieve the Cairo content type from a Cairo fixed array type.
   * @param {string} type - The type string.
   * @returns {string} The fixed-array type.
   * @example
   * ```typescript
   * const result = CairoFixedArray.getFixedArrayType("[core::integer::u32; 8]");
   * // result = "core::integer::u32"
   * ```
   */
  static getFixedArrayType = (type) => {
    const fixedArrayType = _CairoFixedArray.parseFixedArrayType(type);
    if (!fixedArrayType) throw new Error(`ABI type ${type} do not includes a valid type of data.`);
    return fixedArrayType.itemType;
  };
  /**
   * Retrieve the Cairo content type of the Cairo fixed array.
   * @returns {string} The fixed-array content type.
   * @example
   * ```typescript
   * const fArray = new CairoFixedArray([10,20,30], "[core::integer::u32; 3]");
   * const result = fArray.getFixedArrayType();
   * // result = "core::integer::u32"
   * ```
   */
  getFixedArrayType() {
    return _CairoFixedArray.getFixedArrayType(this.arrayType);
  }
  /**
   * Create an object from a Cairo fixed array.
   * Be sure to have an array length conform to the ABI.
   * To be used with CallData.compile().
   * @param {Array<any>} input JS array representing a Cairo fixed array.
   * @returns {Object} a specific struct representing a fixed Array.
   * @example
   * ```typescript
   * const result = CairoFixedArray.compile([10,20,30]);
   * // result = { '0': 10, '1': 20, '2': 30 }
   * ```
   */
  static compile(input) {
    return input.reduce((acc, item, idx) => {
      acc[idx] = item;
      return acc;
    }, {});
  }
  /**
   * Generate an object from the Cairo fixed array instance.
   * To be used with CallData.compile().
   * @returns a specific struct representing a fixed array.
   * @example
   * ```typescript
   * const fArray = new CairoFixedArray([10,20,30], "[core::integer::u32; 3]");
   * const result = fArray.compile();
   * // result = { '0': 10, '1': 20, '2': 30 }
   * ```
   */
  compile() {
    return _CairoFixedArray.compile(this.content);
  }
  /**
   * Checks if the given Cairo type is a fixed-array type.
   * structure: [string; number]
   *
   * @param {string} type - The type to check.
   * @returns - `true` if the type is a fixed array type, `false` otherwise.
   * ```typescript
   * const result = CairoFixedArray.isTypeFixedArray("[core::integer::u32; 8]");
   * // result = true
   */
  static isTypeFixedArray(type) {
    return _CairoFixedArray.parseFixedArrayType(type) !== void 0;
  }
};
function errorU256(key) {
  return Error(
    `Your object includes the property : ${key}, containing an Uint256 object without the 'low' and 'high' keys.`
  );
}
function errorU512(key) {
  return Error(
    `Your object includes the property : ${key}, containing an Uint512 object without the 'limb0' to 'limb3' keys.`
  );
}
function orderPropsByAbi(unorderedObject, abiOfObject, structs, enums) {
  const orderInput = (unorderedItem, abiType) => {
    if (CairoFixedArray.isTypeFixedArray(abiType)) {
      return orderFixedArray(unorderedItem, abiType);
    }
    if (isTypeArray(abiType)) {
      return orderArray(unorderedItem, abiType);
    }
    if (isTypeEnum(abiType, enums)) {
      const abiObj = enums[abiType];
      return orderEnum(unorderedItem, abiObj);
    }
    if (isTypeTuple(abiType)) {
      return orderTuple(unorderedItem, abiType);
    }
    if (isTypeEthAddress(abiType)) {
      return unorderedItem;
    }
    if (isTypeNonZero(abiType)) {
      return unorderedItem;
    }
    if (CairoByteArray.isAbiType(abiType)) {
      return unorderedItem;
    }
    if (isTypeU96(abiType)) {
      return unorderedItem;
    }
    if (isTypeSecp256k1Point(abiType)) {
      return unorderedItem;
    }
    if (CairoUint256.isAbiType(abiType)) {
      const u256 = unorderedItem;
      if (typeof u256 !== "object") {
        return u256;
      }
      if (!("low" in u256 && "high" in u256)) {
        throw errorU256(abiType);
      }
      return { low: u256.low, high: u256.high };
    }
    if (CairoUint512.isAbiType(abiType)) {
      const u512 = unorderedItem;
      if (typeof u512 !== "object") {
        return u512;
      }
      if (!["limb0", "limb1", "limb2", "limb3"].every((key) => key in u512)) {
        throw errorU512(abiType);
      }
      return { limb0: u512.limb0, limb1: u512.limb1, limb2: u512.limb2, limb3: u512.limb3 };
    }
    if (isTypeStruct(abiType, structs)) {
      const abiOfStruct = structs[abiType].members;
      return orderStruct(unorderedItem, abiOfStruct);
    }
    return unorderedItem;
  };
  const orderStruct = (unorderedObject2, abiObject) => {
    const orderedObject2 = abiObject.reduce((orderedObject, abiParam) => {
      const setProperty = (value) => Object.defineProperty(orderedObject, abiParam.name, {
        enumerable: true,
        value: value ?? unorderedObject2[abiParam.name]
      });
      if (unorderedObject2[abiParam.name] === "undefined") {
        if (isCairo1Type(abiParam.type) || !isLen(abiParam.name)) {
          throw Error(`Your object needs a property with key : ${abiParam.name} .`);
        }
      }
      setProperty(orderInput(unorderedObject2[abiParam.name], abiParam.type));
      return orderedObject;
    }, {});
    return orderedObject2;
  };
  function orderArray(myArray, abiParam) {
    const typeInArray = getArrayType(abiParam);
    if (isString(myArray)) {
      return myArray;
    }
    return myArray.map((myElem) => orderInput(myElem, typeInArray));
  }
  function orderFixedArray(input, abiParam) {
    const typeInFixedArray = CairoFixedArray.getFixedArrayType(abiParam);
    const arraySize = CairoFixedArray.getFixedArraySize(abiParam);
    if (Array.isArray(input)) {
      if (arraySize !== input.length) {
        throw new Error(
          `ABI type ${abiParam}: array provided do not includes  ${arraySize} items. ${input.length} items provided.`
        );
      }
      return input.map((myElem) => orderInput(myElem, typeInFixedArray));
    }
    if (arraySize !== Object.keys(input).length) {
      throw new Error(
        `ABI type ${abiParam}: object provided do not includes  ${arraySize} properties. ${Object.keys(input).length} items provided.`
      );
    }
    return orderInput(input, typeInFixedArray);
  }
  function orderTuple(unorderedObject2, abiParam) {
    const typeList = extractTupleMemberTypes(abiParam);
    const orderedObject2 = typeList.reduce((orderedObject, abiTypeCairoX, index) => {
      const myObjKeys = Object.keys(unorderedObject2);
      const setProperty = (value) => Object.defineProperty(orderedObject, index.toString(), {
        enumerable: true,
        value: value ?? unorderedObject2[myObjKeys[index]]
      });
      const abiType = abiTypeCairoX?.type ? abiTypeCairoX.type : abiTypeCairoX;
      setProperty(orderInput(unorderedObject2[myObjKeys[index]], abiType));
      return orderedObject;
    }, {});
    return orderedObject2;
  }
  const orderEnum = (unorderedObject2, abiObject) => {
    if (isTypeResult(abiObject.name)) {
      const unorderedResult = unorderedObject2;
      const resultOkType = abiObject.name.substring(
        abiObject.name.indexOf("<") + 1,
        abiObject.name.lastIndexOf(",")
      );
      const resultErrType = abiObject.name.substring(
        abiObject.name.indexOf(",") + 1,
        abiObject.name.lastIndexOf(">")
      );
      if (unorderedResult.isOk()) {
        return new CairoResult(
          CairoResultVariant.Ok,
          orderInput(unorderedObject2.unwrap(), resultOkType)
        );
      }
      return new CairoResult(
        CairoResultVariant.Err,
        orderInput(unorderedObject2.unwrap(), resultErrType)
      );
    }
    if (isTypeOption(abiObject.name)) {
      const unorderedOption = unorderedObject2;
      const resultSomeType = abiObject.name.substring(
        abiObject.name.indexOf("<") + 1,
        abiObject.name.lastIndexOf(">")
      );
      if (unorderedOption.isSome()) {
        return new CairoOption(
          CairoOptionVariant.Some,
          orderInput(unorderedOption.unwrap(), resultSomeType)
        );
      }
      return new CairoOption(CairoOptionVariant.None, {});
    }
    const unorderedCustomEnum = unorderedObject2;
    const variants = Object.entries(unorderedCustomEnum.variant);
    const newEntries = variants.map((variant) => {
      if (isUndefined(variant[1])) {
        return variant;
      }
      const variantType = abiObject.type.substring(
        abiObject.type.lastIndexOf("<") + 1,
        abiObject.type.lastIndexOf(">")
      );
      if (variantType === "()") {
        return variant;
      }
      return [variant[0], orderInput(unorderedCustomEnum.unwrap(), variantType)];
    });
    return new CairoCustomEnum(Object.fromEntries(newEntries));
  };
  const finalOrderedObject = abiOfObject.reduce((orderedObject, abiParam) => {
    const setProperty = (value) => Object.defineProperty(orderedObject, abiParam.name, {
      enumerable: true,
      value
    });
    if (isLen(abiParam.name) && !isCairo1Type(abiParam.type)) {
      return orderedObject;
    }
    setProperty(orderInput(unorderedObject[abiParam.name], abiParam.type));
    return orderedObject;
  }, {});
  return finalOrderedObject;
}
function parseBaseTypes({
  type,
  val,
  parser
}) {
  switch (true) {
    case CairoUint256.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoUint512.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoUint8.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoUint16.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoUint64.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoUint96.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoUint128.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoInt8.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoInt16.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoInt32.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoInt64.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoInt128.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case CairoBytes31.isAbiType(type):
      return parser.getRequestParser(type)(val);
    case isTypeSecp256k1Point(type): {
      const pubKeyETH = removeHexPrefix(toHex(val)).padStart(128, "0");
      const pubKeyETHy = uint256(addHexPrefix(pubKeyETH.slice(-64)));
      const pubKeyETHx = uint256(addHexPrefix(pubKeyETH.slice(0, -64)));
      return [
        felt(pubKeyETHx.low),
        felt(pubKeyETHx.high),
        felt(pubKeyETHy.low),
        felt(pubKeyETHy.high)
      ];
    }
    default:
      return parser.getRequestParser(CairoFelt252.abiSelector)(val);
  }
}
function parseTuple(element, typeStr) {
  const memberTypes = extractTupleMemberTypes(typeStr);
  const elements = Object.values(element);
  if (elements.length !== memberTypes.length) {
    throw Error(
      `ParseTuple: provided and expected abi tuple size do not match.
      provided: ${elements}
      expected: ${memberTypes}`
    );
  }
  return memberTypes.map((it, dx) => {
    return {
      element: elements[dx],
      type: it.type ?? it
    };
  });
}
function parseCalldataValue({
  element,
  type,
  structs,
  enums,
  parser
}) {
  if (element === void 0) {
    throw Error(`Missing parameter for type ${type}`);
  }
  if (CairoFixedArray.isTypeFixedArray(type)) {
    const arrayType = CairoFixedArray.getFixedArrayType(type);
    let values = [];
    if (Array.isArray(element)) {
      const array = new CairoFixedArray(element, type);
      values = array.content;
    } else if (typeof element === "object") {
      values = Object.values(element);
      assert(
        values.length === CairoFixedArray.getFixedArraySize(type),
        `ABI type ${type}: object provided do not includes  ${CairoFixedArray.getFixedArraySize(type)} items. ${values.length} items provided.`
      );
    } else {
      throw new Error(`ABI type ${type}: not an Array representing a cairo.fixedArray() provided.`);
    }
    return values.reduce((acc, it) => {
      return acc.concat(
        parseCalldataValue({ element: it, type: arrayType, structs, enums, parser })
      );
    }, []);
  }
  if (Array.isArray(element)) {
    const result = [];
    result.push(felt(element.length));
    const arrayType = getArrayType(type);
    return element.reduce((acc, it) => {
      return acc.concat(
        parseCalldataValue({ element: it, type: arrayType, structs, enums, parser })
      );
    }, result);
  }
  if (CairoUint256.isAbiType(type)) {
    return parser.getRequestParser(type)(element);
  }
  if (CairoUint512.isAbiType(type)) {
    return parser.getRequestParser(type)(element);
  }
  if (structs[type] && structs[type].members.length) {
    if (isTypeEthAddress(type)) {
      return parseBaseTypes({ type, val: element, parser });
    }
    if (CairoByteArray.isAbiType(type)) {
      return parser.getRequestParser(type)(element);
    }
    const { members } = structs[type];
    const subElement = element;
    return members.reduce((acc, it) => {
      return acc.concat(
        parseCalldataValue({
          element: subElement[it.name],
          type: it.type,
          structs,
          enums,
          parser
        })
      );
    }, []);
  }
  if (isTypeTuple(type)) {
    const tupled = parseTuple(element, type);
    return tupled.reduce((acc, it) => {
      const parsedData = parseCalldataValue({
        element: it.element,
        type: it.type,
        structs,
        enums,
        parser
      });
      return acc.concat(parsedData);
    }, []);
  }
  if (isTypeEnum(type, enums)) {
    const { variants } = enums[type];
    if (isTypeOption(type)) {
      const myOption = element;
      if (myOption.isSome()) {
        const listTypeVariant2 = variants.find((variant) => variant.name === "Some");
        if (isUndefined(listTypeVariant2)) {
          throw Error(`Error in abi : Option has no 'Some' variant.`);
        }
        const typeVariantSome = listTypeVariant2.type;
        if (typeVariantSome === "()") {
          return CairoOptionVariant.Some.toString();
        }
        const parsedParameter2 = parseCalldataValue({
          element: myOption.unwrap(),
          type: typeVariantSome,
          structs,
          enums,
          parser
        });
        if (Array.isArray(parsedParameter2)) {
          return [CairoOptionVariant.Some.toString(), ...parsedParameter2];
        }
        return [CairoOptionVariant.Some.toString(), parsedParameter2];
      }
      return CairoOptionVariant.None.toString();
    }
    if (isTypeResult(type)) {
      const myResult = element;
      if (myResult.isOk()) {
        const listTypeVariant3 = variants.find((variant) => variant.name === "Ok");
        if (isUndefined(listTypeVariant3)) {
          throw Error(`Error in abi : Result has no 'Ok' variant.`);
        }
        const typeVariantOk = listTypeVariant3.type;
        if (typeVariantOk === "()") {
          return CairoResultVariant.Ok.toString();
        }
        const parsedParameter3 = parseCalldataValue({
          element: myResult.unwrap(),
          type: typeVariantOk,
          structs,
          enums,
          parser
        });
        if (Array.isArray(parsedParameter3)) {
          return [CairoResultVariant.Ok.toString(), ...parsedParameter3];
        }
        return [CairoResultVariant.Ok.toString(), parsedParameter3];
      }
      const listTypeVariant2 = variants.find((variant) => variant.name === "Err");
      if (isUndefined(listTypeVariant2)) {
        throw Error(`Error in abi : Result has no 'Err' variant.`);
      }
      const typeVariantErr = listTypeVariant2.type;
      if (typeVariantErr === "()") {
        return CairoResultVariant.Err.toString();
      }
      const parsedParameter2 = parseCalldataValue({
        element: myResult.unwrap(),
        type: typeVariantErr,
        structs,
        enums,
        parser
      });
      if (Array.isArray(parsedParameter2)) {
        return [CairoResultVariant.Err.toString(), ...parsedParameter2];
      }
      return [CairoResultVariant.Err.toString(), parsedParameter2];
    }
    const myEnum = element;
    const activeVariant = myEnum.activeVariant();
    const listTypeVariant = variants.find((variant) => variant.name === activeVariant);
    if (isUndefined(listTypeVariant)) {
      throw Error(`Not find in abi : Enum has no '${activeVariant}' variant.`);
    }
    const typeActiveVariant = listTypeVariant.type;
    const numActiveVariant = variants.findIndex((variant) => variant.name === activeVariant);
    if (typeActiveVariant === "()") {
      return numActiveVariant.toString();
    }
    const parsedParameter = parseCalldataValue({
      element: myEnum.unwrap(),
      type: typeActiveVariant,
      structs,
      enums,
      parser
    });
    if (Array.isArray(parsedParameter)) {
      return [numActiveVariant.toString(), ...parsedParameter];
    }
    return [numActiveVariant.toString(), parsedParameter];
  }
  if (isTypeNonZero(type)) {
    return parseBaseTypes({ type: getArrayType(type), val: element, parser });
  }
  if (typeof element === "object") {
    throw Error(`Parameter ${element} do not align with abi parameter ${type}`);
  }
  return parseBaseTypes({ type, val: element, parser });
}
function parseCalldataField({
  argsIterator,
  input,
  structs,
  enums,
  parser
}) {
  const { name, type } = input;
  let { value } = argsIterator.next();
  switch (true) {
    // Fixed array
    case CairoFixedArray.isTypeFixedArray(type):
      if (!Array.isArray(value) && !(typeof value === "object")) {
        throw Error(`ABI expected parameter ${name} to be an array or an object, got ${value}`);
      }
      return parseCalldataValue({ element: value, type: input.type, structs, enums, parser });
    // Normal Array
    case isTypeArray(type):
      if (!Array.isArray(value) && !isText(value)) {
        throw Error(`ABI expected parameter ${name} to be array or long string, got ${value}`);
      }
      if (isString(value)) {
        value = splitLongString(value);
      }
      return parseCalldataValue({ element: value, type: input.type, structs, enums, parser });
    case isTypeNonZero(type):
      return parseBaseTypes({ type: getArrayType(type), val: value, parser });
    case isTypeEthAddress(type):
      return parseBaseTypes({ type, val: value, parser });
    // Struct or Tuple
    case (isTypeStruct(type, structs) || isTypeTuple(type) || CairoUint256.isAbiType(type)):
      return parseCalldataValue({
        element: value,
        type,
        structs,
        enums,
        parser
      });
    // Enums
    case isTypeEnum(type, enums):
      return parseCalldataValue({
        element: value,
        type,
        structs,
        enums,
        parser
      });
    // Felt or unhandled
    default:
      return parseBaseTypes({ type, val: value, parser });
  }
}
function parseBaseTypes2(type, it, parser) {
  let temp;
  switch (true) {
    case isTypeBool(type):
      temp = it.next().value;
      return Boolean(BigInt(temp));
    case CairoUint256.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoUint512.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoUint8.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoUint16.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoUint64.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoUint96.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoUint128.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoInt8.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoInt16.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoInt32.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoInt64.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case CairoInt128.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case isTypeEthAddress(type):
      temp = it.next().value;
      return BigInt(temp);
    case CairoBytes31.isAbiType(type):
      return parser.getResponseParser(type)(it);
    case isTypeSecp256k1Point(type):
      const xLow = removeHexPrefix(it.next().value).padStart(32, "0");
      const xHigh = removeHexPrefix(it.next().value).padStart(32, "0");
      const yLow = removeHexPrefix(it.next().value).padStart(32, "0");
      const yHigh = removeHexPrefix(it.next().value).padStart(32, "0");
      const pubK = BigInt(addHexPrefix(xHigh + xLow + yHigh + yLow));
      return pubK;
    default:
      return parser.getResponseParser(CairoFelt252.abiSelector)(it);
  }
}
function parseResponseValue(responseIterator, element, parser, structs, enums) {
  if (element.type === "()") {
    return {};
  }
  if (CairoUint256.isAbiType(element.type)) {
    return parser.getResponseParser(element.type)(responseIterator);
  }
  if (CairoUint512.isAbiType(element.type)) {
    return parser.getResponseParser(element.type)(responseIterator);
  }
  if (CairoByteArray.isAbiType(element.type)) {
    return parser.getResponseParser(element.type)(responseIterator);
  }
  if (CairoFixedArray.isTypeFixedArray(element.type)) {
    const parsedDataArr = [];
    const el = { name: "", type: CairoFixedArray.getFixedArrayType(element.type) };
    const arraySize = CairoFixedArray.getFixedArraySize(element.type);
    while (parsedDataArr.length < arraySize) {
      parsedDataArr.push(parseResponseValue(responseIterator, el, parser, structs, enums));
    }
    return parsedDataArr;
  }
  if (isTypeArray(element.type)) {
    const parsedDataArr = [];
    const el = { name: "", type: getArrayType(element.type) };
    const len = BigInt(responseIterator.next().value);
    while (parsedDataArr.length < len) {
      parsedDataArr.push(parseResponseValue(responseIterator, el, parser, structs, enums));
    }
    return parsedDataArr;
  }
  if (isTypeNonZero(element.type)) {
    const el = { name: "", type: getArrayType(element.type) };
    return parseResponseValue(responseIterator, el, parser, structs, enums);
  }
  if (structs && element.type in structs && structs[element.type]) {
    if (isTypeEthAddress(element.type)) {
      return parseBaseTypes2(element.type, responseIterator, parser);
    }
    return structs[element.type].members.reduce((acc, el) => {
      acc[el.name] = parseResponseValue(responseIterator, el, parser, structs, enums);
      return acc;
    }, {});
  }
  if (enums && element.type in enums && enums[element.type]) {
    const variantNum = Number(responseIterator.next().value);
    const rawEnum = enums[element.type].variants.reduce((acc, variant, num) => {
      if (num === variantNum) {
        acc[variant.name] = parseResponseValue(
          responseIterator,
          { name: "", type: variant.type },
          parser,
          structs,
          enums
        );
        return acc;
      }
      acc[variant.name] = void 0;
      return acc;
    }, {});
    if (element.type.startsWith("core::option::Option")) {
      const content = variantNum === CairoOptionVariant.Some ? rawEnum.Some : void 0;
      return new CairoOption(variantNum, content);
    }
    if (element.type.startsWith("core::result::Result")) {
      let content;
      if (variantNum === CairoResultVariant.Ok) {
        content = rawEnum.Ok;
      } else {
        content = rawEnum.Err;
      }
      return new CairoResult(variantNum, content);
    }
    const customEnum = new CairoCustomEnum(rawEnum);
    return customEnum;
  }
  if (isTypeTuple(element.type)) {
    const memberTypes = extractTupleMemberTypes(element.type);
    return memberTypes.reduce((acc, it, idx) => {
      const name = it?.name ? it.name : idx;
      const type = it?.type ? it.type : it;
      const el = { name, type };
      acc[name] = parseResponseValue(responseIterator, el, parser, structs, enums);
      return acc;
    }, {});
  }
  if (isTypeArray(element.type)) {
    const parsedDataArr = [];
    const el = { name: "", type: getArrayType(element.type) };
    const len = BigInt(responseIterator.next().value);
    while (parsedDataArr.length < len) {
      parsedDataArr.push(parseResponseValue(responseIterator, el, parser, structs, enums));
    }
    return parsedDataArr;
  }
  return parseBaseTypes2(element.type, responseIterator, parser);
}
function responseParser({
  responseIterator,
  output,
  structs,
  enums,
  parsedResult,
  parser
}) {
  const { name, type } = output;
  let temp;
  switch (true) {
    case isLen(name):
      temp = responseIterator.next().value;
      return BigInt(temp);
    case (structs && type in structs || isTypeTuple(type)):
      return parseResponseValue(responseIterator, output, parser, structs, enums);
    case (enums && isTypeEnum(type, enums)):
      return parseResponseValue(responseIterator, output, parser, structs, enums);
    case CairoFixedArray.isTypeFixedArray(type):
      return parseResponseValue(responseIterator, output, parser, structs, enums);
    case isTypeArray(type):
      if (isCairo1Type(type)) {
        return parseResponseValue(responseIterator, output, parser, structs, enums);
      }
      const parsedDataArr = [];
      if (parsedResult && parsedResult[`${name}_len`]) {
        const arrLen = parsedResult[`${name}_len`];
        while (parsedDataArr.length < arrLen) {
          parsedDataArr.push(
            parseResponseValue(
              responseIterator,
              { name, type: output.type.replaceAll("*", "") },
              parser,
              structs,
              enums
            )
          );
        }
      }
      return parsedDataArr;
    case isTypeNonZero(type):
      return parseResponseValue(responseIterator, output, parser, structs, enums);
    default:
      return parseBaseTypes2(type, responseIterator, parser);
  }
}
var validateFelt = (parameter, input) => {
  assert(
    isString(parameter) || isNumber2(parameter) || isBigInt(parameter),
    `Validate: arg ${input.name} should be a felt typed as (String, Number or BigInt)`
  );
  if (isString(parameter) && !isHex2(parameter)) return;
  const param = BigInt(parameter.toString(10));
  assert(
    // from : https://github.com/starkware-libs/starknet-specs/blob/29bab650be6b1847c92d4461d4c33008b5e50b1a/api/starknet_api_openrpc.json#L1266
    param >= 0n && param <= 2n ** 252n - 1n,
    `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0, 2^252-1]`
  );
};
var validateUint = (parameter, input) => {
  if (isNumber2(parameter)) {
    assert(
      parameter <= Number.MAX_SAFE_INTEGER,
      "Validation: Parameter is too large to be typed as Number use (BigInt or String)"
    );
  }
  assert(
    isString(parameter) || isNumber2(parameter) || isBigInt(parameter) || isObject2(parameter) && "low" in parameter && "high" in parameter || isObject2(parameter) && ["limb0", "limb1", "limb2", "limb3"].every((key) => key in parameter),
    `Validate: arg ${input.name} of cairo type ${input.type} should be type (String, Number or BigInt), but is ${typeof parameter} ${parameter}.`
  );
  let param;
  switch (input.type) {
    case Uint.u256:
      param = new CairoUint256(parameter).toBigInt();
      break;
    case Uint.u512:
      param = new CairoUint512(parameter).toBigInt();
      break;
    default:
      param = toBigInt(parameter);
  }
  switch (input.type) {
    case Uint.u8:
      assert(
        param >= 0n && param <= 255n,
        `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0 - 255]`
      );
      break;
    case Uint.u16:
      assert(
        param >= 0n && param <= 65535n,
        `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0, 65535]`
      );
      break;
    case Uint.u32:
      assert(
        param >= 0n && param <= 4294967295n,
        `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0, 4294967295]`
      );
      break;
    case Uint.u64:
      assert(
        param >= 0n && param <= 2n ** 64n - 1n,
        `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0, 2^64-1]`
      );
      break;
    case Uint.u128:
      assert(
        param >= 0n && param <= 2n ** 128n - 1n,
        `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0, 2^128-1]`
      );
      break;
    case Uint.u256:
      assert(
        param >= 0n && param <= 2n ** 256n - 1n,
        `Validate: arg ${input.name} is ${input.type} should be in range 0 - 2^256-1`
      );
      break;
    case Uint.u512:
      assert(
        CairoUint512.is(param),
        `Validate: arg ${input.name} is ${input.type} should be in range 0 - 2^512-1`
      );
      break;
    case Literal.ClassHash:
      assert(
        // from : https://github.com/starkware-libs/starknet-specs/blob/29bab650be6b1847c92d4461d4c33008b5e50b1a/api/starknet_api_openrpc.json#L1670
        param >= 0n && param <= 2n ** 252n - 1n,
        `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0, 2^252-1]`
      );
      break;
    case Literal.ContractAddress:
      assert(
        // from : https://github.com/starkware-libs/starknet-specs/blob/29bab650be6b1847c92d4461d4c33008b5e50b1a/api/starknet_api_openrpc.json#L1245
        param >= 0n && param <= 2n ** 252n - 1n,
        `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0, 2^252-1]`
      );
      break;
    case Literal.Secp256k1Point: {
      assert(
        param >= 0n && param <= 2n ** 512n - 1n,
        `Validate: arg ${input.name} must be ${input.type} : a 512 bits number.`
      );
      break;
    }
    case Literal.U96: {
      assert(
        param >= 0n && param <= 2n ** 96n - 1n,
        `Validate: arg ${input.name} must be ${input.type} : a 96 bits number.`
      );
      break;
    }
    default:
      break;
  }
};
var validateBool = (parameter, input) => {
  assert(
    isBoolean(parameter),
    `Validate: arg ${input.name} of cairo type ${input.type} should be type (Boolean)`
  );
};
var validateStruct = (parameter, input, structs) => {
  if (input.type === Uint.u256 || input.type === Uint.u512) {
    validateUint(parameter, input);
    return;
  }
  if (isTypeEthAddress(input.type)) {
    assert(!isObject2(parameter), `EthAddress type is waiting a BigNumberish. Got "${parameter}"`);
    const param = BigInt(parameter.toString(10));
    assert(
      // from : https://github.com/starkware-libs/starknet-specs/blob/29bab650be6b1847c92d4461d4c33008b5e50b1a/api/starknet_api_openrpc.json#L1259
      param >= 0n && param <= 2n ** 160n - 1n,
      `Validate: arg ${input.name} cairo typed ${input.type} should be in range [0, 2^160-1]`
    );
    return;
  }
  assert(
    isObject2(parameter),
    `Validate: arg ${input.name} is cairo type struct (${input.type}), and should be defined as a js object (not array)`
  );
  structs[input.type].members.forEach(({ name }) => {
    assert(
      Object.keys(parameter).includes(name),
      `Validate: arg ${input.name} should have a property ${name}`
    );
  });
};
var validateEnum = (parameter, input) => {
  assert(
    isObject2(parameter),
    `Validate: arg ${input.name} is cairo type Enum (${input.type}), and should be defined as a js object (not array)`
  );
  const methodsKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(parameter));
  const keys = [...Object.getOwnPropertyNames(parameter), ...methodsKeys];
  if (isTypeOption(input.type) && keys.includes("isSome") && keys.includes("isNone")) {
    return;
  }
  if (isTypeResult(input.type) && keys.includes("isOk") && keys.includes("isErr")) {
    return;
  }
  if (keys.includes("variant") && keys.includes("activeVariant")) {
    return;
  }
  throw new Error(
    `Validate Enum: argument ${input.name}, type ${input.type}, value received "${parameter}", is not an Enum.`
  );
};
var validateTuple = (parameter, input) => {
  assert(isObject2(parameter), `Validate: arg ${input.name} should be a tuple (defined as object)`);
};
var validateArray = (parameterArray, input, structs, enums) => {
  const isNormalArray = isTypeArray(input.type);
  const baseType = isNormalArray ? getArrayType(input.type) : CairoFixedArray.getFixedArrayType(input.type);
  if (isNormalArray && isTypeFelt(baseType) && isLongText(parameterArray)) {
    return;
  }
  let parameter = [];
  if (isNormalArray) {
    assert(Array.isArray(parameterArray), `Validate: arg ${input.name} should be an Array`);
    parameter = parameterArray;
  } else {
    switch (true) {
      case Array.isArray(parameterArray):
        parameter = parameterArray;
        break;
      case typeof parameterArray === "object":
        parameter = Object.values(parameterArray);
        break;
      default:
        throw new Error(`Validate: arg ${input.name} should be an Array or an object.`);
    }
  }
  switch (true) {
    case isTypeFelt(baseType):
      parameter.forEach((param) => validateFelt(param, input));
      break;
    case isTypeTuple(baseType):
      parameter.forEach((it) => validateTuple(it, { name: input.name, type: baseType }));
      break;
    case isTypeArray(baseType):
      parameter.forEach(
        (param) => validateArray(param, { name: "", type: baseType }, structs, enums)
      );
      break;
    case isTypeStruct(baseType, structs):
      parameter.forEach(
        (it) => validateStruct(it, { name: input.name, type: baseType }, structs)
      );
      break;
    case isTypeEnum(baseType, enums):
      parameter.forEach((it) => validateEnum(it, { name: input.name, type: baseType }));
      break;
    case (isTypeUint(baseType) || isTypeLiteral(baseType)):
      parameter.forEach((param) => validateUint(param, { name: "", type: baseType }));
      break;
    case isTypeBool(baseType):
      parameter.forEach((param) => validateBool(param, input));
      break;
    default:
      throw new Error(
        `Validate Unhandled: argument ${input.name}, type ${input.type}, value ${parameter}`
      );
  }
};
var validateNonZero = (parameter, input) => {
  const baseType = getArrayType(input.type);
  assert(
    isTypeUint(baseType) && baseType !== CairoUint512.abiSelector || isTypeFelt(baseType),
    `Validate: ${input.name} type is not authorized for NonZero type.`
  );
  switch (true) {
    case isTypeFelt(baseType):
      validateFelt(parameter, input);
      assert(
        BigInt(parameter.toString(10)) > 0,
        "Validate: value 0 is not authorized in NonZero felt252 type."
      );
      break;
    case isTypeUint(baseType):
      validateUint(parameter, { name: "", type: baseType });
      switch (baseType) {
        case Uint.u256:
          assert(
            new CairoUint256(parameter).toBigInt() > 0,
            "Validate: value 0 is not authorized in NonZero uint256 type."
          );
          break;
        default:
          assert(
            toBigInt(parameter) > 0,
            "Validate: value 0 is not authorized in NonZero uint type."
          );
      }
      break;
    default:
      throw new Error(
        `Validate Unhandled: argument ${input.name}, type ${input.type}, value "${parameter}"`
      );
  }
};
function validateFields(abiMethod, args, structs, enums) {
  abiMethod.inputs.reduce((acc, input) => {
    const parameter = args[acc];
    switch (true) {
      case isLen(input.name):
        return acc;
      case isTypeFelt(input.type):
        validateFelt(parameter, input);
        break;
      case CairoBytes31.isAbiType(input.type):
        CairoBytes31.validate(parameter);
        break;
      case (isTypeUint(input.type) || isTypeLiteral(input.type)):
        validateUint(parameter, input);
        break;
      case isTypeBool(input.type):
        validateBool(parameter, input);
        break;
      case CairoByteArray.isAbiType(input.type):
        CairoByteArray.validate(parameter);
        break;
      case CairoInt8.isAbiType(input.type):
        CairoInt8.validate(parameter);
        break;
      case CairoInt16.isAbiType(input.type):
        CairoInt16.validate(parameter);
        break;
      case CairoInt32.isAbiType(input.type):
        CairoInt32.validate(parameter);
        break;
      case CairoInt64.isAbiType(input.type):
        CairoInt64.validate(parameter);
        break;
      case CairoInt128.isAbiType(input.type):
        CairoInt128.validate(parameter);
        break;
      case (isTypeArray(input.type) || CairoFixedArray.isTypeFixedArray(input.type)):
        validateArray(parameter, input, structs, enums);
        break;
      case isTypeStruct(input.type, structs):
        validateStruct(parameter, input, structs);
        break;
      case isTypeEnum(input.type, enums):
        validateEnum(parameter, input);
        break;
      case isTypeTuple(input.type):
        validateTuple(parameter, input);
        break;
      case isTypeNonZero(input.type):
        validateNonZero(parameter, input);
        break;
      default:
        throw new Error(
          `Validate Unhandled: argument ${input.name}, type ${input.type}, value ${parameter}`
        );
    }
    return acc + 1;
  }, 0);
}
var CallData = class _CallData {
  abi;
  parser;
  structs;
  enums;
  constructor(abi, parsingStrategy) {
    this.structs = _CallData.getAbiStruct(abi);
    this.enums = _CallData.getAbiEnum(abi);
    this.parser = createAbiParser(abi, parsingStrategy);
    this.abi = this.parser.getLegacyFormat();
  }
  /**
   * Validate arguments passed to the method as corresponding to the ones in the abi
   * @param type ValidateType - type of the method
   * @param method string - name of the method
   * @param args ArgsOrCalldata - arguments that are passed to the method
   */
  validate(type, method, args = []) {
    if (type !== ValidateType.DEPLOY) {
      const invocableFunctionNames = this.abi.filter((abi) => {
        if (abi.type !== "function") return false;
        const isView = abi.stateMutability === "view" || abi.state_mutability === "view";
        return type === ValidateType.INVOKE ? !isView : isView;
      }).map((abi) => abi.name);
      assert(
        invocableFunctionNames.includes(method),
        `${type === ValidateType.INVOKE ? "invocable" : "viewable"} method not found in abi`
      );
    }
    const abiMethod = this.abi.find(
      (abi) => type === ValidateType.DEPLOY ? abi.name === method && abi.type === "constructor" : abi.name === method && abi.type === "function"
    );
    if (isNoConstructorValid(method, args, abiMethod)) {
      return;
    }
    const inputsLength = this.parser.methodInputsLength(abiMethod);
    if (args.length !== inputsLength) {
      throw Error(
        `Invalid number of arguments, expected ${inputsLength} arguments, but got ${args.length}`
      );
    }
    validateFields(abiMethod, args, this.structs, this.enums);
  }
  /**
   * Compile contract callData with abi
   * Parse the calldata by using input fields from the abi for that method
   * @param method string - method name
   * @param argsCalldata RawArgs - arguments passed to the method. Can be an array of arguments (in the order of abi definition), or an object constructed in conformity with abi (in this case, the parameter can be in a wrong order).
   * @return Calldata - parsed arguments in format that contract is expecting
   * @example
   * ```typescript
   * const calldata = myCallData.compile("constructor", ["0x34a", [1, 3n]]);
   * ```
   * ```typescript
   * const calldata2 = myCallData.compile("constructor", {list:[1, 3n], balance:"0x34"}); // wrong order is valid
   * ```
   */
  compile(method, argsCalldata) {
    const abiMethod = this.abi.find((abiFunction) => abiFunction.name === method);
    if (isNoConstructorValid(method, argsCalldata, abiMethod)) {
      return [];
    }
    let args;
    if (Array.isArray(argsCalldata)) {
      args = argsCalldata;
    } else {
      const orderedObject = orderPropsByAbi(
        argsCalldata,
        abiMethod.inputs,
        this.structs,
        this.enums
      );
      args = Object.values(orderedObject);
      validateFields(abiMethod, args, this.structs, this.enums);
    }
    const argsIterator = args[Symbol.iterator]();
    const callArray = abiMethod.inputs.reduce(
      (acc, input) => isLen(input.name) && !isCairo1Type(input.type) ? acc : acc.concat(
        parseCalldataField({
          argsIterator,
          input,
          structs: this.structs,
          enums: this.enums,
          parser: this.parser
        })
      ),
      []
    );
    Object.defineProperty(callArray, "__compiled__", {
      enumerable: false,
      writable: false,
      value: true
    });
    return callArray;
  }
  /**
   * Compile contract callData without abi
   * @param rawArgs RawArgs representing cairo method arguments or string array of compiled data
   * @returns Calldata
   */
  static compile(rawArgs) {
    const createTree = (obj) => {
      const getEntries = (o, prefix = ".") => {
        const oe = Array.isArray(o) ? [o.length.toString(), ...o] : o;
        return Object.entries(oe).flatMap(([k, v]) => {
          let value = v;
          if (k === "entrypoint") value = getSelectorFromName(value);
          else if (isLongText(value)) value = byteArrayFromString(value);
          const kk = Array.isArray(oe) && k === "0" ? "$$len" : k;
          if (isBigInt(value)) return [[`${prefix}${kk}`, felt(value)]];
          if (Object(value) === value) {
            const methodsKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(value));
            const keys = [...Object.getOwnPropertyNames(value), ...methodsKeys];
            if (keys.includes("isSome") && keys.includes("isNone")) {
              const myOption = value;
              const variantNb = myOption.isSome() ? CairoOptionVariant.Some : CairoOptionVariant.None;
              if (myOption.isSome())
                return getEntries({ 0: variantNb, 1: myOption.unwrap() }, `${prefix}${kk}.`);
              return [[`${prefix}${kk}`, felt(variantNb)]];
            }
            if (keys.includes("isOk") && keys.includes("isErr")) {
              const myResult = value;
              const variantNb = myResult.isOk() ? CairoResultVariant.Ok : CairoResultVariant.Err;
              return getEntries({ 0: variantNb, 1: myResult.unwrap() }, `${prefix}${kk}.`);
            }
            if (keys.includes("variant") && keys.includes("activeVariant")) {
              const myEnum = value;
              const activeVariant = myEnum.activeVariant();
              const listVariants = Object.keys(myEnum.variant);
              const activeVariantNb = listVariants.findIndex(
                (variant) => variant === activeVariant
              );
              if (typeof myEnum.unwrap() === "object" && Object.keys(myEnum.unwrap()).length === 0) {
                return [[`${prefix}${kk}`, felt(activeVariantNb)]];
              }
              return getEntries({ 0: activeVariantNb, 1: myEnum.unwrap() }, `${prefix}${kk}.`);
            }
            return getEntries(value, `${prefix}${kk}.`);
          }
          return [[`${prefix}${kk}`, felt(value)]];
        });
      };
      const result = Object.fromEntries(getEntries(obj));
      return result;
    };
    let callTreeArray;
    if (!Array.isArray(rawArgs)) {
      const callTree = createTree(rawArgs);
      callTreeArray = Object.values(callTree);
    } else {
      const callObj = { ...rawArgs };
      const callTree = createTree(callObj);
      callTreeArray = Object.values(callTree);
    }
    Object.defineProperty(callTreeArray, "__compiled__", {
      enumerable: false,
      writable: false,
      value: true
    });
    return callTreeArray;
  }
  /**
   * Parse elements of the response array and structuring them into response object
   * @param method string - method name
   * @param response string[] - response from the method
   * @return Result - parsed response corresponding to the abi
   */
  parse(method, response) {
    const { outputs } = this.abi.find((abi) => abi.name === method);
    const responseIterator = response.flat()[Symbol.iterator]();
    const parsed = outputs.flat().reduce((acc, output, idx) => {
      const propName = output.name ?? idx;
      acc[propName] = responseParser({
        responseIterator,
        output,
        structs: this.structs,
        enums: this.enums,
        parsedResult: acc,
        parser: this.parser
      });
      if (acc[propName] && acc[`${propName}_len`]) {
        delete acc[`${propName}_len`];
      }
      return acc;
    }, {});
    return Object.keys(parsed).length === 1 && 0 in parsed ? parsed[0] : parsed;
  }
  /**
   * Format cairo method response data to native js values based on provided format schema
   * @param method string - cairo method name
   * @param response string[] - cairo method response
   * @param format object - formatter object schema
   * @returns Result - parsed and formatted response object
   */
  format(method, response, format) {
    const parsed = this.parse(method, response);
    return formatter(parsed, format);
  }
  /**
   * Helper to extract structs from abi
   * @param abi Abi
   * @returns AbiStructs - structs from abi
   */
  static getAbiStruct(abi) {
    return abi.filter((abiEntry) => abiEntry.type === "struct").reduce(
      (acc, abiEntry) => ({
        ...acc,
        [abiEntry.name]: abiEntry
      }),
      {}
    );
  }
  /**
   * Helper to extract enums from abi
   * @param abi Abi
   * @returns AbiEnums - enums from abi
   */
  static getAbiEnum(abi) {
    const fullEnumList = abi.filter((abiEntry) => abiEntry.type === "enum").reduce(
      (acc, abiEntry) => ({
        ...acc,
        [abiEntry.name]: abiEntry
      }),
      {}
    );
    delete fullEnumList["core::bool"];
    return fullEnumList;
  }
  /**
   * Helper: Compile HexCalldata | RawCalldata | RawArgs
   * @param rawCalldata HexCalldata | RawCalldata | RawArgs
   * @returns Calldata
   */
  static toCalldata(rawCalldata = []) {
    return _CallData.compile(rawCalldata);
  }
  /**
   * Helper: Convert raw to HexCalldata
   * @param raw HexCalldata | RawCalldata | RawArgs
   * @returns HexCalldata
   */
  static toHex(raw = []) {
    const calldata = _CallData.compile(raw);
    return calldata.map((it) => toHex(it));
  }
  /**
   * Parse the elements of a contract response and structure them into one or several Result.
   * In Cairo 0, arrays are not supported.
   * @param typeCairo string or string[] - Cairo type name, ex : "hello::hello::UserData"
   * @param response string[] - serialized data corresponding to typeCairo.
   * @return Result or Result[] - parsed response corresponding to typeData.
   * @example
   * const res2=helloCallData.decodeParameters("hello::hello::UserData",["0x123456","0x1"]);
   * result = { address: 1193046n, is_claimed: true }
   */
  decodeParameters(typeCairo, response) {
    const typeCairoArray = Array.isArray(typeCairo) ? typeCairo : [typeCairo];
    const responseIterator = response.flat()[Symbol.iterator]();
    const decodedArray = typeCairoArray.map(
      (typeParam) => responseParser({
        responseIterator,
        output: { name: "", type: typeParam },
        parser: this.parser,
        structs: this.structs,
        enums: this.enums
      })
    );
    return decodedArray.length === 1 ? decodedArray[0] : decodedArray;
  }
};
var hash_exports = {};
__export2(hash_exports, {
  COMPILED_CLASS_VERSION: () => COMPILED_CLASS_VERSION,
  blake2sHashMany: () => blake2sHashMany,
  calculateContractAddressFromHash: () => calculateContractAddressFromHash,
  calculateDeclareTransactionHash: () => calculateDeclareTransactionHash3,
  calculateDeployAccountTransactionHash: () => calculateDeployAccountTransactionHash3,
  calculateInvokeTransactionHash: () => calculateInvokeTransactionHash2,
  calculateL2MessageTxHash: () => calculateL2MessageTxHash,
  computeCompiledClassHash: () => computeCompiledClassHash,
  computeCompiledClassHashBlake: () => computeCompiledClassHashBlake,
  computeCompiledClassHashPoseidon: () => computeCompiledClassHashPoseidon,
  computeContractClassHash: () => computeContractClassHash,
  computeHashOnElements: () => computeHashOnElements2,
  computeHintedClassHash: () => computeHintedClassHash,
  computeLegacyContractClassHash: () => computeLegacyContractClassHash,
  computePedersenHash: () => computePedersenHash,
  computePedersenHashOnElements: () => computePedersenHashOnElements,
  computePoseidonHash: () => computePoseidonHash,
  computePoseidonHashOnElements: () => computePoseidonHashOnElements,
  computeSierraContractClassHash: () => computeSierraContractClassHash,
  encodeBuiltins: () => encodeBuiltins,
  flattenEntryPointData: () => flattenEntryPointData,
  formatSpaces: () => formatSpaces,
  getL1MessageHash: () => getL1MessageHash,
  getL2MessageHash: () => getL2MessageHash,
  getSelector: () => getSelector,
  getSelectorFromName: () => getSelectorFromName,
  hashByteCodeSegments: () => hashByteCodeSegments,
  hashByteCodeSegmentsBlake: () => hashByteCodeSegmentsBlake,
  keccakBn: () => keccakBn,
  nullSkipReplacer: () => nullSkipReplacer,
  poseidon: () => poseidon_exports,
  solidityUint256PackedKeccak256: () => solidityUint256PackedKeccak256,
  starknetKeccak: () => starknetKeccak
});
var v3_exports = {};
__export2(v3_exports, {
  calculateDeclareTransactionHash: () => calculateDeclareTransactionHash,
  calculateDeployAccountTransactionHash: () => calculateDeployAccountTransactionHash,
  calculateInvokeTransactionHash: () => calculateInvokeTransactionHash,
  calculateTransactionHashCommon: () => calculateTransactionHashCommon,
  encodeDataResourceBoundsL1: () => encodeDataResourceBoundsL1,
  encodeResourceBoundsL1: () => encodeResourceBoundsL1,
  encodeResourceBoundsL2: () => encodeResourceBoundsL2,
  hashDAMode: () => hashDAMode,
  hashFeeFieldV3B3: () => hashFeeFieldV3B3
});
var AToBI = (array) => array.map((it) => BigInt(it));
var DATA_AVAILABILITY_MODE_BITS = 32n;
var MAX_AMOUNT_BITS = 64n;
var MAX_PRICE_PER_UNIT_BITS = 128n;
var RESOURCE_VALUE_OFFSET = MAX_AMOUNT_BITS + MAX_PRICE_PER_UNIT_BITS;
var L1_GAS_NAME = BigInt(encodeShortString("L1_GAS"));
var L2_GAS_NAME = BigInt(encodeShortString("L2_GAS"));
var L1_DATA_GAS_NAME = BigInt(encodeShortString("L1_DATA"));
function hashDAMode(nonceDAMode, feeDAMode) {
  return (BigInt(nonceDAMode) << DATA_AVAILABILITY_MODE_BITS) + BigInt(feeDAMode);
}
function encodeResourceBoundsL1(bounds) {
  return (L1_GAS_NAME << RESOURCE_VALUE_OFFSET) + (bounds.l1_gas.max_amount << MAX_PRICE_PER_UNIT_BITS) + bounds.l1_gas.max_price_per_unit;
}
function encodeResourceBoundsL2(bounds) {
  return (L2_GAS_NAME << RESOURCE_VALUE_OFFSET) + (bounds.l2_gas.max_amount << MAX_PRICE_PER_UNIT_BITS) + bounds.l2_gas.max_price_per_unit;
}
function encodeDataResourceBoundsL1(bounds) {
  return (L1_DATA_GAS_NAME << RESOURCE_VALUE_OFFSET) + (bounds.l1_data_gas.max_amount << MAX_PRICE_PER_UNIT_BITS) + bounds.l1_data_gas.max_price_per_unit;
}
function hashFeeFieldV3B3(tip, bounds) {
  const L1Bound = encodeResourceBoundsL1(bounds);
  const L2Bound = encodeResourceBoundsL2(bounds);
  const L1Data = encodeDataResourceBoundsL1(bounds);
  return poseidonHashMany([BigInt(tip), L1Bound, L2Bound, L1Data]);
}
function calculateTransactionHashCommon(txHashPrefix, version, senderAddress, chainId, nonce, tip, paymasterData, nonceDataAvailabilityMode, feeDataAvailabilityMode, resourceBounds, additionalData = []) {
  const feeFieldHash = hashFeeFieldV3B3(tip, resourceBounds);
  const dAModeHash = hashDAMode(nonceDataAvailabilityMode, feeDataAvailabilityMode);
  const dataToHash = AToBI([
    txHashPrefix,
    version,
    senderAddress,
    feeFieldHash,
    poseidonHashMany(AToBI(paymasterData)),
    chainId,
    nonce,
    dAModeHash,
    ...AToBI(additionalData)
  ]);
  return toHex(poseidonHashMany(dataToHash));
}
function calculateDeployAccountTransactionHash(contractAddress, classHash, compiledConstructorCalldata, salt, version, chainId, nonce, nonceDataAvailabilityMode, feeDataAvailabilityMode, resourceBounds, tip, paymasterData) {
  return calculateTransactionHashCommon(
    _TransactionHashPrefix.DEPLOY_ACCOUNT,
    version,
    contractAddress,
    chainId,
    nonce,
    tip,
    paymasterData,
    nonceDataAvailabilityMode,
    feeDataAvailabilityMode,
    resourceBounds,
    [poseidonHashMany(AToBI(compiledConstructorCalldata)), classHash, salt]
  );
}
function calculateDeclareTransactionHash(classHash, compiledClassHash, senderAddress, version, chainId, nonce, accountDeploymentData, nonceDataAvailabilityMode, feeDataAvailabilityMode, resourceBounds, tip, paymasterData) {
  return calculateTransactionHashCommon(
    _TransactionHashPrefix.DECLARE,
    version,
    senderAddress,
    chainId,
    nonce,
    tip,
    AToBI(paymasterData),
    nonceDataAvailabilityMode,
    feeDataAvailabilityMode,
    resourceBounds,
    [poseidonHashMany(AToBI(accountDeploymentData)), classHash, compiledClassHash]
  );
}
function calculateInvokeTransactionHash(senderAddress, version, compiledCalldata, chainId, nonce, accountDeploymentData, nonceDataAvailabilityMode, feeDataAvailabilityMode, resourceBounds, tip, paymasterData, proofFacts) {
  const proofFactsAdditionalData = proofFacts?.length ? [poseidonHashMany(AToBI(proofFacts))] : [];
  return calculateTransactionHashCommon(
    _TransactionHashPrefix.INVOKE,
    version,
    senderAddress,
    chainId,
    nonce,
    tip,
    paymasterData,
    nonceDataAvailabilityMode,
    feeDataAvailabilityMode,
    resourceBounds,
    [
      poseidonHashMany(AToBI(accountDeploymentData)),
      poseidonHashMany(AToBI(compiledCalldata)),
      ...proofFactsAdditionalData
    ]
  );
}
var v2_exports = {};
__export2(v2_exports, {
  calculateDeclareTransactionHash: () => calculateDeclareTransactionHash2,
  calculateDeployAccountTransactionHash: () => calculateDeployAccountTransactionHash2,
  calculateL2MessageTxHash: () => calculateL2MessageTxHash,
  calculateTransactionHash: () => calculateTransactionHash,
  calculateTransactionHashCommon: () => calculateTransactionHashCommon2,
  computeHashOnElements: () => computeHashOnElements22
});
function computeHashOnElements22(data) {
  return [...data, data.length].reduce((x, y) => pedersen(toBigInt(x), toBigInt(y)), 0).toString();
}
function calculateTransactionHashCommon2(txHashPrefix, version, contractAddress, entryPointSelector, calldata, maxFee, chainId, additionalData = []) {
  const calldataHash = computeHashOnElements22(calldata);
  const dataToHash = [
    txHashPrefix,
    version,
    contractAddress,
    entryPointSelector,
    calldataHash,
    maxFee,
    chainId,
    ...additionalData
  ];
  return computeHashOnElements22(dataToHash);
}
function calculateDeclareTransactionHash2(classHash, senderAddress, version, maxFee, chainId, nonce, compiledClassHash) {
  return calculateTransactionHashCommon2(
    _TransactionHashPrefix.DECLARE,
    version,
    senderAddress,
    0,
    [classHash],
    maxFee,
    chainId,
    [nonce, ...compiledClassHash ? [compiledClassHash] : []]
  );
}
function calculateDeployAccountTransactionHash2(contractAddress, classHash, constructorCalldata, salt, version, maxFee, chainId, nonce) {
  const calldata = [classHash, salt, ...constructorCalldata];
  return calculateTransactionHashCommon2(
    _TransactionHashPrefix.DEPLOY_ACCOUNT,
    version,
    contractAddress,
    0,
    calldata,
    maxFee,
    chainId,
    [nonce]
  );
}
function calculateTransactionHash(contractAddress, version, calldata, maxFee, chainId, nonce) {
  return calculateTransactionHashCommon2(
    _TransactionHashPrefix.INVOKE,
    version,
    contractAddress,
    0,
    calldata,
    maxFee,
    chainId,
    [nonce]
  );
}
function calculateL2MessageTxHash(l1FromAddress, l2ToAddress, l2Selector, l2Calldata, l2ChainId, l1Nonce) {
  const payload = [l1FromAddress, ...l2Calldata];
  return calculateTransactionHashCommon2(
    _TransactionHashPrefix.L1_HANDLER,
    0,
    l2ToAddress,
    getSelector(l2Selector),
    payload,
    0,
    l2ChainId,
    [l1Nonce]
  );
}
function isV3InvokeTx(args) {
  return [api_exports3.ETransactionVersion.V3, api_exports3.ETransactionVersion.F3].includes(args.version);
}
function calculateInvokeTransactionHash2(args) {
  if (isV3InvokeTx(args)) {
    return calculateInvokeTransactionHash(
      args.senderAddress,
      args.version,
      args.compiledCalldata,
      args.chainId,
      args.nonce,
      args.accountDeploymentData,
      args.nonceDataAvailabilityMode,
      args.feeDataAvailabilityMode,
      args.resourceBounds,
      args.tip,
      args.paymasterData,
      args.proofFacts
    );
  }
  throw new Error("Invalid Tx version for hash calculation");
}
function isV3DeclareTx(args) {
  return [api_exports3.ETransactionVersion.V3, api_exports3.ETransactionVersion.F3].includes(args.version);
}
function calculateDeclareTransactionHash3(args) {
  if (isV3DeclareTx(args)) {
    return calculateDeclareTransactionHash(
      args.classHash,
      args.compiledClassHash,
      args.senderAddress,
      args.version,
      args.chainId,
      args.nonce,
      args.accountDeploymentData,
      args.nonceDataAvailabilityMode,
      args.feeDataAvailabilityMode,
      args.resourceBounds,
      args.tip,
      args.paymasterData
    );
  }
  throw new Error("Invalid Tx version for hash calculation");
}
function isV3DeployAccountTx(args) {
  return [api_exports3.ETransactionVersion.V3, api_exports3.ETransactionVersion.F3].includes(args.version);
}
function calculateDeployAccountTransactionHash3(args) {
  if (isV3DeployAccountTx(args)) {
    return calculateDeployAccountTransactionHash(
      args.contractAddress,
      args.classHash,
      args.compiledConstructorCalldata,
      args.salt,
      args.version,
      args.chainId,
      args.nonce,
      args.nonceDataAvailabilityMode,
      args.feeDataAvailabilityMode,
      args.resourceBounds,
      args.tip,
      args.paymasterData
    );
  }
  throw new Error("Invalid Tx version for hash calculation");
}
var COMPILED_CLASS_VERSION = "COMPILED_CLASS_V1";
function formatSpaces(json2) {
  let insideQuotes = false;
  const newString = [];
  for (const char of json2) {
    if (char === '"' && (newString.length > 0 && newString.slice(-1)[0] === "\\") === false) {
      insideQuotes = !insideQuotes;
    }
    if (insideQuotes) {
      newString.push(char);
    } else {
      newString.push(char === ":" ? ": " : char === "," ? ", " : char);
    }
  }
  return newString.join("");
}
function nullSkipReplacer(key, value) {
  if (key === "attributes" || key === "accessible_scopes") {
    return Array.isArray(value) && value.length === 0 ? void 0 : value;
  }
  if (key === "debug_info") {
    return null;
  }
  return value === null ? void 0 : value;
}
function encodeBuiltins(builtins) {
  return builtins.map((it) => BigInt(encodeShortString(it)));
}
function flattenEntryPointData(data, encodedBuiltinsArray) {
  return data.flatMap((it, index) => [
    BigInt(it.selector),
    BigInt(it.offset),
    ...encodedBuiltinsArray[index]
  ]);
}
function calculateContractAddressFromHash(salt, classHash, constructorCalldata, deployerAddress) {
  const compiledCalldata = CallData.compile(constructorCalldata);
  const constructorCalldataHash = computeHashOnElements2(compiledCalldata);
  const CONTRACT_ADDRESS_PREFIX = felt("0x535441524b4e45545f434f4e54524143545f41444452455353");
  const hash = computeHashOnElements2([
    CONTRACT_ADDRESS_PREFIX,
    deployerAddress,
    salt,
    classHash,
    constructorCalldataHash
  ]);
  return toHex(BigInt(hash) % ADDR_BOUND);
}
function computeHintedClassHash(compiledContract) {
  const { abi, program } = compiledContract;
  const contractClass = { abi, program };
  const serializedJson = formatSpaces(stringify2(contractClass, nullSkipReplacer));
  return addHexPrefix(keccak(utf8ToArray(serializedJson)).toString(16));
}
function computeLegacyContractClassHash(contract) {
  const compiledContract = isString(contract) ? parse2(contract) : contract;
  const apiVersion = toHex(API_VERSION);
  const externalEntryPointsHash = computeHashOnElements2(
    compiledContract.entry_points_by_type.EXTERNAL.flatMap((e) => [e.selector, e.offset])
  );
  const l1HandlerEntryPointsHash = computeHashOnElements2(
    compiledContract.entry_points_by_type.L1_HANDLER.flatMap((e) => [e.selector, e.offset])
  );
  const constructorEntryPointHash = computeHashOnElements2(
    compiledContract.entry_points_by_type.CONSTRUCTOR.flatMap((e) => [e.selector, e.offset])
  );
  const builtinsHash = computeHashOnElements2(
    compiledContract.program.builtins.map((s) => encodeShortString(s))
  );
  const hintedClassHash = computeHintedClassHash(compiledContract);
  const dataHash = computeHashOnElements2(compiledContract.program.data);
  return computeHashOnElements2([
    apiVersion,
    externalEntryPointsHash,
    l1HandlerEntryPointsHash,
    constructorEntryPointHash,
    builtinsHash,
    hintedClassHash,
    dataHash
  ]);
}
function computePoseidonHash(a, b) {
  return toHex(poseidonHash(BigInt(a), BigInt(b)));
}
function computePoseidonHashOnElements(data) {
  return toHex(poseidonHashMany(data.map((x) => BigInt(x))));
}
function hashBuiltins(builtins) {
  return poseidonHashMany(encodeBuiltins(builtins));
}
function hashEntryPoint(data) {
  const base = data.flatMap((it) => {
    return [BigInt(it.selector), BigInt(it.offset), hashBuiltins(it.builtins)];
  });
  return poseidonHashMany(base);
}
function hashByteCodeSegments(casm) {
  const byteCode = casm.bytecode.map((n) => BigInt(n));
  const bytecodeSegmentLengths = casm.bytecode_segment_lengths ?? [];
  let segmentStart = 0;
  const hashLeaves = bytecodeSegmentLengths.flatMap((len) => {
    const segment = byteCode.slice(segmentStart, segmentStart += len);
    return [BigInt(len), poseidonHashMany(segment)];
  });
  return 1n + poseidonHashMany(hashLeaves);
}
function computeCompiledClassHashPoseidon(casm) {
  const compiledClassVersion = BigInt(encodeShortString(COMPILED_CLASS_VERSION));
  const externalEntryPointsHash = hashEntryPoint(casm.entry_points_by_type.EXTERNAL);
  const l1Handlers = hashEntryPoint(casm.entry_points_by_type.L1_HANDLER);
  const constructor = hashEntryPoint(casm.entry_points_by_type.CONSTRUCTOR);
  const bytecode = casm.bytecode_segment_lengths ? hashByteCodeSegments(casm) : poseidonHashMany(casm.bytecode.map((it) => BigInt(it)));
  return toHex(
    poseidonHashMany([
      compiledClassVersion,
      externalEntryPointsHash,
      l1Handlers,
      constructor,
      bytecode
    ])
  );
}
function hashEntryPointSierra(data) {
  const base = data.flatMap((it) => {
    return [BigInt(it.selector), BigInt(it.function_idx)];
  });
  return poseidonHashMany(base);
}
function hashAbi(sierra) {
  const indentString = formatSpaces(stringify2(sierra.abi, null));
  return BigInt(addHexPrefix(keccak(utf8ToArray(indentString)).toString(16)));
}
function computeSierraContractClassHash(sierra) {
  const CONTRACT_CLASS_VERSION = "CONTRACT_CLASS_V0.1.0";
  const compiledClassVersion = BigInt(encodeShortString(CONTRACT_CLASS_VERSION));
  const externalEntryPointsHash = hashEntryPointSierra(sierra.entry_points_by_type.EXTERNAL);
  const l1Handlers = hashEntryPointSierra(sierra.entry_points_by_type.L1_HANDLER);
  const constructor = hashEntryPointSierra(sierra.entry_points_by_type.CONSTRUCTOR);
  const abiHash = hashAbi(sierra);
  const sierraProgram = poseidonHashMany(sierra.sierra_program.map((it) => BigInt(it)));
  return toHex(
    poseidonHashMany([
      compiledClassVersion,
      externalEntryPointsHash,
      l1Handlers,
      constructor,
      abiHash,
      sierraProgram
    ])
  );
}
function blakeHash(uint8Array) {
  return config2.get("blake")?.(uint8Array) || blake2s(uint8Array, { dkLen: 32 });
}
function blake2sHashMany(data) {
  const SMALL_THRESHOLD = 0x8000000000000000n;
  const BIG_MARKER = 2147483648;
  const u32Words = [];
  const buf = new ArrayBuffer(32);
  const feltView = new DataView(buf);
  for (const felt22 of data) {
    const u64_0 = felt22 & 0xffffffffffffffffn;
    const u64_1 = (felt22 & 0xffffffffffffffff0000000000000000n) >> 64n;
    const u64_2 = (felt22 & 0xffffffffffffffff00000000000000000000000000000000n) >> 128n;
    const u64_3 = (felt22 & 0xffffffffffffffff000000000000000000000000000000000000000000000000n) >> 192n;
    feltView.setBigUint64(0, u64_3, false);
    feltView.setBigUint64(8, u64_2, false);
    feltView.setBigUint64(16, u64_1, false);
    feltView.setBigUint64(24, u64_0, false);
    if (felt22 < SMALL_THRESHOLD) {
      const hi0 = feltView.getUint32(24, false);
      const lo0 = feltView.getUint32(28, false);
      u32Words.push(hi0, lo0);
    } else {
      const word0 = feltView.getUint32(0, false) | BIG_MARKER;
      const word1 = feltView.getUint32(4, false);
      const word2 = feltView.getUint32(8, false);
      const word3 = feltView.getUint32(12, false);
      const word4 = feltView.getUint32(16, false);
      const word5 = feltView.getUint32(20, false);
      const word6 = feltView.getUint32(24, false);
      const word7 = feltView.getUint32(28, false);
      u32Words.push(word0, word1, word2, word3, word4, word5, word6, word7);
    }
  }
  const bytes = new ArrayBuffer(u32Words.length * 4);
  const bytesView = new DataView(bytes);
  for (let i = 0; i < u32Words.length; i++) {
    bytesView.setUint32(i * 4, u32Words[i], true);
  }
  const hash = blakeHash(new Uint8Array(bytes));
  let hashBigInt = 0n;
  for (let i = 0; i < 32; i++) {
    hashBigInt |= BigInt(hash[i]) << BigInt(i * 8);
  }
  return hashBigInt % PRIME;
}
function hashBuiltinsBlake(builtins) {
  return blake2sHashMany(encodeBuiltins(builtins));
}
function hashEntryPointBlake(data) {
  const base = data.flatMap((it) => {
    return [BigInt(it.selector), BigInt(it.offset), hashBuiltinsBlake(it.builtins)];
  });
  return blake2sHashMany(base);
}
function bytecodeHashNodeBlake(iter, node) {
  if (typeof node === "number") {
    const data = [];
    for (let i = 0; i < node; i++) {
      const next = iter.next();
      if (next.done) throw new Error("Bytecode length mismatch");
      data.push(next.value);
    }
    return [node, blake2sHashMany(data)];
  }
  const innerNodes = node.map((child) => bytecodeHashNodeBlake(iter, child));
  const flatData = innerNodes.flatMap(([len, hash2]) => [BigInt(len), hash2]);
  const hash = blake2sHashMany(flatData) + 1n;
  const totalLen = innerNodes.reduce((sum, [len]) => sum + len, 0);
  return [totalLen, hash];
}
function hashByteCodeSegmentsBlake(casm) {
  const byteCode = casm.bytecode.map((n) => BigInt(n));
  const bytecodeSegmentLengths = casm.bytecode_segment_lengths;
  if (!bytecodeSegmentLengths) {
    return blake2sHashMany(byteCode);
  }
  const iter = byteCode[Symbol.iterator]();
  const [len, hash] = bytecodeHashNodeBlake(iter, bytecodeSegmentLengths);
  if (len !== byteCode.length) {
    throw new Error(`Bytecode length mismatch: expected ${byteCode.length}, got ${len}`);
  }
  return hash;
}
function computeCompiledClassHashBlake(casm) {
  const compiledClassVersion = BigInt(encodeShortString(COMPILED_CLASS_VERSION));
  const externalEntryPointsHash = hashEntryPointBlake(casm.entry_points_by_type.EXTERNAL);
  const l1Handlers = hashEntryPointBlake(casm.entry_points_by_type.L1_HANDLER);
  const constructor = hashEntryPointBlake(casm.entry_points_by_type.CONSTRUCTOR);
  const bytecode = hashByteCodeSegmentsBlake(casm);
  return toHex(
    blake2sHashMany([
      compiledClassVersion,
      externalEntryPointsHash,
      l1Handlers,
      constructor,
      bytecode
    ])
  );
}
function isV3Tx(details) {
  const version = details.version ? toHex(details.version) : ETransactionVersion6.V3;
  return version === ETransactionVersion6.V3 || version === ETransactionVersion6.F3;
}
function isVersion(expected, provided) {
  const expectedParts = expected.split(".");
  const providedParts = provided.split(".");
  return expectedParts.every((part, index) => part === "*" || part === providedParts[index]);
}
function isSupportedSpecVersion(version, options = { allowAnyPatchVersion: false }) {
  return Object.values(_SupportedRpcVersion).some(
    (v) => isVersion(options.allowAnyPatchVersion ? toAnyPatchVersion(v) : v, version)
  );
}
function toAnyPatchVersion(version) {
  const parts = version.split(".");
  if (parts.length < 3) {
    return version;
  }
  return `${parts[0]}.${parts[1]}.*`;
}
function toApiVersion(version) {
  const [major, minor] = version.replace(/^v/, "").split(".");
  return `v${major}_${minor}`;
}
function compareVersions(a, b) {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  const maxLen = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < maxLen; i += 1) {
    const aNum = aParts[i] || 0;
    const bNum = bParts[i] || 0;
    if (aNum > bNum) return 1;
    if (aNum < bNum) return -1;
  }
  return 0;
}
function computeContractClassHash(contract) {
  const compiledContract = isString(contract) ? parse2(contract) : contract;
  if ("sierra_program" in compiledContract) {
    return computeSierraContractClassHash(compiledContract);
  }
  return computeLegacyContractClassHash(compiledContract);
}
function computeCompiledClassHash(casm, starknetVersion = SN_VERSION_IMPLEMENTING_BLAKE_FOR_COMPILED_CLASS) {
  if (compareVersions(starknetVersion, SN_VERSION_IMPLEMENTING_BLAKE_FOR_COMPILED_CLASS) >= 0) {
    return computeCompiledClassHashBlake(casm);
  }
  return computeCompiledClassHashPoseidon(casm);
}
var stark_exports = {};
__export2(stark_exports, {
  ZeroFeeEstimate: () => ZeroFeeEstimate,
  compressProgram: () => compressProgram,
  decodeProof: () => decodeProof,
  decompressProgram: () => decompressProgram,
  encodeProof: () => encodeProof,
  formatSignature: () => formatSignature,
  getFullPublicKey: () => getFullPublicKey,
  getSharedSecret: () => getSharedSecret2,
  intDAM: () => intDAM,
  randomAddress: () => randomAddress,
  resourceBoundsToBigInt: () => resourceBoundsToBigInt,
  resourceBoundsToEstimateFeeResponse: () => resourceBoundsToEstimateFeeResponse,
  resourceBoundsToHexString: () => resourceBoundsToHexString,
  signatureToDecimalArray: () => signatureToDecimalArray,
  signatureToHexArray: () => signatureToHexArray,
  toFeeVersion: () => toFeeVersion,
  toOverheadOverallFee: () => toOverheadOverallFee,
  toOverheadResourceBounds: () => toOverheadResourceBounds,
  toTransactionVersion: () => toTransactionVersion,
  v3Details: () => v3Details,
  zeroResourceBounds: () => zeroResourceBounds
});
async function compressProgram(jsonProgram) {
  const stringified = isString(jsonProgram) ? jsonProgram : stringify2(jsonProgram);
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(stringified));
  writer.close();
  const compressedProgram = await new Response(stream.readable).arrayBuffer();
  return btoaUniversal(compressedProgram);
}
async function decompressProgram(base642) {
  if (Array.isArray(base642)) return base642;
  const compressed = atobUniversal(base642);
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(compressed));
  writer.close();
  const decompressed = await new Response(stream.readable).text();
  return parse2(decompressed);
}
function randomAddress() {
  const randomKeyPair = utils.randomPrivateKey();
  return getStarkKey(randomKeyPair);
}
function encodeProof(proof) {
  return btoaUniversal(new Uint32Array(proof).buffer);
}
function decodeProof(proofBase64) {
  const decoded = atobUniversal(proofBase64);
  const uint32Array = new Uint32Array(decoded.buffer);
  return Array.from(uint32Array);
}
function formatSignature(sig) {
  if (!sig) throw Error("formatSignature: provided signature is undefined");
  if (Array.isArray(sig)) {
    return sig.map((it) => toHex(it));
  }
  try {
    const { r, s } = sig;
    return [toHex(r), toHex(s)];
  } catch (e) {
    throw new Error("Signature need to be weierstrass.SignatureType or an array for custom");
  }
}
function signatureToDecimalArray(sig) {
  return bigNumberishArrayToDecimalStringArray(formatSignature(sig));
}
function signatureToHexArray(sig) {
  return bigNumberishArrayToHexadecimalStringArray(formatSignature(sig));
}
function getSharedSecret2(privateKey, fullPublicKey) {
  const privK = toHex(privateKey);
  const fullPubKHex = removeHexPrefix(toHex(fullPublicKey)).padStart(130, "0");
  if (fullPubKHex.length !== 130 || !fullPubKHex.startsWith("04")) {
    throw new Error(
      "fullPublicKey must be an uncompressed public key (starting with 04, 65 bytes total)"
    );
  }
  const sharedSecret = buf2hex(getSharedSecret(privK, fullPubKHex));
  return addHexPrefix(sharedSecret);
}
function zeroResourceBounds() {
  return toOverheadResourceBounds(ZeroFeeEstimate(), false);
}
function toOverheadResourceBounds(estimate, overhead = config2.get("resourceBoundsOverhead")) {
  return {
    l2_gas: {
      max_amount: addPercent(
        estimate.l2_gas_consumed,
        overhead !== false ? overhead.l2_gas.max_amount : 0
      ),
      max_price_per_unit: addPercent(
        estimate.l2_gas_price,
        overhead !== false ? overhead.l2_gas.max_price_per_unit : 0
      )
    },
    l1_gas: {
      max_amount: addPercent(
        estimate.l1_gas_consumed,
        overhead !== false ? overhead.l1_gas.max_amount : 0
      ),
      max_price_per_unit: addPercent(
        estimate.l1_gas_price,
        overhead !== false ? overhead.l1_gas.max_price_per_unit : 0
      )
    },
    l1_data_gas: {
      max_amount: addPercent(
        estimate.l1_data_gas_consumed,
        overhead !== false ? overhead.l1_data_gas.max_amount : 0
      ),
      max_price_per_unit: addPercent(
        estimate.l1_data_gas_price,
        overhead !== false ? overhead.l1_data_gas.max_price_per_unit : 0
      )
    }
  };
}
function resourceBoundsToEstimateFeeResponse(resourceBounds) {
  return {
    resourceBounds,
    /**
     * maximum overall fee for provided resource bounds
     */
    overall_fee: resourceBounds.l1_gas.max_amount * resourceBounds.l1_gas.max_price_per_unit + resourceBounds.l1_data_gas.max_amount * resourceBounds.l1_data_gas.max_price_per_unit + resourceBounds.l2_gas.max_amount * resourceBounds.l2_gas.max_price_per_unit,
    unit: "FRI"
  };
}
function toOverheadOverallFee(estimate, overhead = config2.get("resourceBoundsOverhead")) {
  return addPercent(estimate.l1_gas_consumed, overhead !== false ? overhead.l1_gas.max_amount : 0) * addPercent(
    estimate.l1_gas_price,
    overhead !== false ? overhead.l1_gas.max_price_per_unit : 0
  ) + addPercent(
    estimate.l1_data_gas_consumed,
    overhead !== false ? overhead.l1_data_gas.max_amount : 0
  ) * addPercent(
    estimate.l1_data_gas_price,
    overhead !== false ? overhead.l1_data_gas.max_price_per_unit : 0
  ) + addPercent(estimate.l2_gas_consumed, overhead !== false ? overhead.l2_gas.max_amount : 0) * addPercent(estimate.l2_gas_price, overhead !== false ? overhead.l2_gas.max_price_per_unit : 0);
}
function ZeroFeeEstimate() {
  return {
    l1_gas_consumed: "0",
    l1_gas_price: "0",
    l1_data_gas_consumed: "0",
    l1_data_gas_price: "0",
    l2_gas_consumed: "0",
    l2_gas_price: "0",
    overall_fee: "0",
    unit: "FRI"
  };
}
function intDAM(dam) {
  if (dam === EDataAvailabilityMode3.L1) return EDAMode3.L1;
  if (dam === EDataAvailabilityMode3.L2) return EDAMode3.L2;
  throw Error("EDAM conversion");
}
function toTransactionVersion(defaultVersion, providedVersion) {
  const version = providedVersion ? toHex(providedVersion) : toHex(defaultVersion);
  const validVersions = Object.values(ETransactionVersion34);
  if (!validVersions.includes(version)) {
    throw Error(
      `${providedVersion ? "providedVersion" : "defaultVersion"} ${version} is not ETransactionVersion`
    );
  }
  return version;
}
function toFeeVersion(providedVersion) {
  if (!providedVersion) return void 0;
  const version = toHex(providedVersion);
  if (version === ETransactionVersion6.V0) return ETransactionVersion6.F0;
  if (version === ETransactionVersion6.V1) return ETransactionVersion6.F1;
  if (version === ETransactionVersion6.V2) return ETransactionVersion6.F2;
  if (version === ETransactionVersion6.V3) return ETransactionVersion6.F3;
  throw Error(`toFeeVersion: ${version} is not supported`);
}
function v3Details(details) {
  return {
    tip: details.tip || 0,
    paymasterData: details.paymasterData || [],
    accountDeploymentData: details.accountDeploymentData || [],
    nonceDataAvailabilityMode: details.nonceDataAvailabilityMode || EDataAvailabilityMode3.L1,
    feeDataAvailabilityMode: details.feeDataAvailabilityMode || EDataAvailabilityMode3.L1,
    resourceBounds: details.resourceBounds ?? zeroResourceBounds(),
    proofFacts: details.proofFacts,
    proof: details.proof
  };
}
function getFullPublicKey(privateKey) {
  const privKey = toHex(privateKey);
  const fullPrivKey = addHexPrefix(buf2hex(getPublicKey(privKey, false)));
  return fullPrivKey;
}
function resourceBoundsToHexString(resourceBoundsBN) {
  const convertBigIntToHex = (obj) => {
    if (isBigInt(obj)) {
      return toHex(obj);
    }
    if (isObject2(obj)) {
      const result = {};
      Object.keys(obj).forEach((key) => {
        result[key] = convertBigIntToHex(obj[key]);
      });
      return result;
    }
    return obj;
  };
  return convertBigIntToHex(resourceBoundsBN);
}
function resourceBoundsToBigInt(resourceBounds) {
  const convertStringToBigInt = (obj) => {
    if (isString(obj)) {
      return BigInt(obj);
    }
    if (isObject2(obj)) {
      const result = {};
      Object.keys(obj).forEach((key) => {
        result[key] = convertStringToBigInt(obj[key]);
      });
      return result;
    }
    return obj;
  };
  return convertStringToBigInt(resourceBounds);
}
function isSierra(contract) {
  const compiledContract = isString(contract) ? parse2(contract) : contract;
  return "sierra_program" in compiledContract;
}
function extractContractHashes(payload, starknetVersion) {
  const response = { ...payload };
  if (isSierra(payload.contract)) {
    if (!payload.compiledClassHash && payload.casm) {
      response.compiledClassHash = computeCompiledClassHash(payload.casm, starknetVersion);
    }
    if (!response.compiledClassHash)
      throw new Error(
        "Extract compiledClassHash failed, provide (CairoAssembly).casm file or compiledClassHash"
      );
  }
  response.classHash = payload.classHash ?? computeContractClassHash(payload.contract);
  if (!response.classHash)
    throw new Error("Extract classHash failed, provide (CompiledContract).json file or classHash");
  return response;
}
var eth_exports = {};
__export2(eth_exports, {
  ethRandomPrivateKey: () => ethRandomPrivateKey,
  validateAndParseEthAddress: () => validateAndParseEthAddress
});
function ethRandomPrivateKey() {
  return sanitizeHex(buf2hex(secp256k1.utils.randomPrivateKey()));
}
function validateAndParseEthAddress(address) {
  assertInRange(address, ZERO, 2n ** 160n - 1n, "Ethereum Address ");
  const result = addHexPrefix(removeHexPrefix(toHex(address)).padStart(40, "0"));
  assert(Boolean(result.match(/^(0x)?[0-9a-f]{40}$/)), "Invalid Ethereum Address Format");
  return result;
}
var fetch_default = typeof globalThis !== "undefined" && typeof globalThis.fetch !== "undefined" && globalThis.fetch.bind(globalThis) || typeof window !== "undefined" && typeof window.fetch !== "undefined" && window.fetch.bind(window) || typeof global !== "undefined" && typeof global.fetch !== "undefined" && global.fetch.bind(global) || (() => {
  throw new LibraryError(
    "'fetch()' not detected, use the 'baseFetch' constructor parameter to set it"
  );
});
var provider_exports = {};
__export2(provider_exports, {
  Block: () => Block,
  createSierraContractClass: () => createSierraContractClass,
  extractAbi: () => extractAbi,
  getDefaultNodeUrl: () => getDefaultNodeUrl,
  getDefaultNodes: () => getDefaultNodes,
  getSupportedRpcVersions: () => getSupportedRpcVersions,
  parseContract: () => parseContract,
  validBlockTags: () => validBlockTags,
  wait: () => wait
});
function wait(delay) {
  return new Promise((res) => {
    setTimeout(res, delay);
  });
}
async function createSierraContractClass(contract) {
  const result = { ...contract };
  delete result.sierra_program_debug_info;
  result.abi = formatSpaces(stringify2(contract.abi));
  result.sierra_program = formatSpaces(stringify2(contract.sierra_program));
  result.sierra_program = await compressProgram(result.sierra_program);
  return result;
}
async function parseContract(contract) {
  const parsedContract = isString(contract) ? parse2(contract) : contract;
  if (!isSierra(contract)) {
    return {
      ...parsedContract,
      ..."program" in parsedContract && {
        program: await compressProgram(parsedContract.program)
      }
    };
  }
  return await createSierraContractClass(parsedContract);
}
function extractAbi(contract) {
  return isString(contract.abi) ? parse2(contract.abi) : contract.abi;
}
var getDefaultNodeUrl = (networkName, rpcVersion) => {
  logger.info("Using default public node url, please provide nodeUrl in provider options!");
  const rpcNodes = getDefaultNodes(rpcVersion ?? config2.get("rpcVersion"));
  const nodes = rpcNodes[networkName ?? _NetworkName.SN_SEPOLIA];
  const randIdx = Math.floor(Math.random() * nodes.length);
  return nodes[randIdx];
};
function getDefaultNodes(rpcVersion) {
  const apiVersion = toApiVersion(rpcVersion);
  return Object.fromEntries(
    Object.entries(RPC_DEFAULT_NODES).map(([key, urls]) => [
      key,
      urls.map((url2) => `${url2}${apiVersion}`)
    ])
  );
}
function getSupportedRpcVersions() {
  return [...new Set(Object.values(_SupportedRpcVersion))];
}
var validBlockTags = Object.values(BlockTag);
var Block = class {
  /**
   * @param {BlockIdentifier} hash if not null, contains the block hash
   */
  hash = null;
  /**
   * @param {BlockIdentifier} number if not null, contains the block number
   */
  number = null;
  /**
   * @param {BlockIdentifier} tag if not null, contains "pre_confirmed" or "latest"
   */
  tag = null;
  setIdentifier(__identifier) {
    if (isString(__identifier)) {
      if (isDecimalString2(__identifier)) {
        this.number = parseInt(__identifier, 10);
      } else if (isHex2(__identifier)) {
        this.hash = __identifier;
      } else if (validBlockTags.includes(__identifier)) {
        this.tag = __identifier;
      } else {
        throw TypeError(`Block identifier unmanaged: ${__identifier}`);
      }
    } else if (isBigInt(__identifier)) {
      this.hash = toHex(__identifier);
    } else if (isNumber2(__identifier)) {
      this.number = __identifier;
    } else {
      this.tag = BlockTag.LATEST;
    }
    if (isNumber2(this.number) && this.number < 0) {
      throw TypeError(`Block number (${this.number}) can't be negative`);
    }
  }
  /**
   * Create a Block instance
   * @param {BlockIdentifier} _identifier  hex string and BigInt are detected as block hashes.
   * decimal string and number are detected as block numbers.
   * text string are detected as block tag.
   * null is considered as a 'latest' block tag.
   */
  constructor(_identifier) {
    this.setIdentifier(_identifier);
  }
  // TODO: fix any
  /**
   * @returns {any} the identifier as a string
   * @example
   * ```typescript
   * const result = new provider.Block(123456n).queryIdentifier;
   * // result = "blockHash=0x1e240"
   * ```
   */
  get queryIdentifier() {
    if (this.number !== null) {
      return `blockNumber=${this.number}`;
    }
    if (this.hash !== null) {
      return `blockHash=${this.hash}`;
    }
    return `blockNumber=${this.tag}`;
  }
  // TODO: fix any
  /**
   * @returns {any} the identifier as an object
   * @example
   * ```typescript
   * const result = new provider.Block(56789).identifier;
   * // result = { block_number: 56789 }
   * ```
   */
  get identifier() {
    if (this.number !== null) {
      return { block_number: this.number };
    }
    if (this.hash !== null) {
      return { block_hash: this.hash };
    }
    return this.tag;
  }
  /**
   * change the identifier of an existing Block instance
   * @example
   * ```typescript
   * const myBlock = new provider.Block("latest");
   * myBlock.identifier ="0x3456789abc";
   * const result = myBlock.identifier;
   * // result = { block_hash: '0x3456789abc' }
   * ```
   */
  set identifier(_identifier) {
    this.setIdentifier(_identifier);
  }
  valueOf = () => this.number;
  toString = () => this.hash;
};
var transaction_exports = {};
__export2(transaction_exports, {
  fromCallsToExecuteCalldata: () => fromCallsToExecuteCalldata,
  fromCallsToExecuteCalldata_cairo1: () => fromCallsToExecuteCalldata_cairo1,
  getCompiledCalldata: () => getCompiledCalldata,
  getExecuteCalldata: () => getExecuteCalldata,
  getVersionsByType: () => getVersionsByType,
  transformCallsToMulticallArrays: () => transformCallsToMulticallArrays
});
function getCompiledCalldata(constructorArguments, callback) {
  if (Array.isArray(constructorArguments) && "__compiled__" in constructorArguments)
    return constructorArguments;
  if (Array.isArray(constructorArguments) && Array.isArray(constructorArguments[0]) && "__compiled__" in constructorArguments[0])
    return constructorArguments[0];
  return callback();
}
var transformCallsToMulticallArrays = (calls) => {
  const callArray = [];
  const calldata = [];
  calls.forEach((call) => {
    const data = CallData.compile(call.calldata || []);
    callArray.push({
      to: toBigInt(call.contractAddress).toString(10),
      selector: toBigInt(getSelectorFromName(call.entrypoint)).toString(10),
      data_offset: calldata.length.toString(),
      data_len: data.length.toString()
    });
    calldata.push(...data);
  });
  return {
    callArray,
    calldata: CallData.compile({ calldata })
  };
};
var fromCallsToExecuteCalldata = (calls) => {
  const { callArray, calldata } = transformCallsToMulticallArrays(calls);
  const compiledCalls = CallData.compile({ callArray });
  return [...compiledCalls, ...calldata];
};
var fromCallsToExecuteCalldata_cairo1 = (calls) => {
  const orderCalls = calls.map((call) => ({
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    calldata: Array.isArray(call.calldata) && "__compiled__" in call.calldata ? call.calldata : CallData.compile(call.calldata)
    // RawArgsObject | RawArgsArray type
  }));
  return CallData.compile({ orderCalls });
};
var getExecuteCalldata = (calls, cairoVersion = "0") => {
  if (cairoVersion === "1") {
    return fromCallsToExecuteCalldata_cairo1(calls);
  }
  return fromCallsToExecuteCalldata(calls);
};
function getVersionsByType(versionType) {
  return versionType === "fee" ? {
    v3: ETransactionVersion6.F3
  } : { v3: ETransactionVersion6.V3 };
}
var RpcChannel = class {
  id = "RPC090";
  /**
   * RPC specification version this Channel class implements
   */
  channelSpecVersion = _SupportedRpcVersion.v0_9_0;
  nodeUrl;
  headers;
  requestId;
  blockIdentifier;
  retries;
  waitMode;
  // behave like web2 rpc and return when tx is processed
  chainId;
  /**
   * RPC specification version of the connected node
   */
  specVersion;
  transactionRetryIntervalFallback;
  batchClient;
  baseFetch;
  constructor(optionsOrProvider) {
    const {
      baseFetch,
      batch,
      blockIdentifier,
      chainId,
      headers,
      nodeUrl,
      retries,
      specVersion,
      transactionRetryIntervalFallback,
      waitMode
    } = optionsOrProvider || {};
    if (Object.values(_NetworkName).includes(nodeUrl)) {
      this.nodeUrl = getDefaultNodeUrl(nodeUrl, this.channelSpecVersion);
    } else if (nodeUrl) {
      this.nodeUrl = nodeUrl;
    } else {
      this.nodeUrl = getDefaultNodeUrl(void 0, this.channelSpecVersion);
    }
    const channelDefaults = config2.get("channelDefaults");
    this.baseFetch = baseFetch || config2.get("fetch") || fetch_default;
    this.blockIdentifier = blockIdentifier ?? channelDefaults.options.blockIdentifier;
    this.chainId = chainId;
    this.headers = { ...channelDefaults.options.headers, ...headers };
    this.retries = retries ?? channelDefaults.options.retries;
    this.specVersion = specVersion;
    this.transactionRetryIntervalFallback = transactionRetryIntervalFallback ?? channelDefaults.options.transactionRetryIntervalFallback;
    this.waitMode = waitMode ?? false;
    this.requestId = 0;
    if (isNumber2(batch)) {
      this.batchClient = new BatchClient({
        nodeUrl: this.nodeUrl,
        headers: this.headers,
        interval: batch,
        baseFetch: this.baseFetch,
        rpcMethods: {}
        // Type information only, not used at runtime
      });
    }
    logger.debug("Using Channel", this.id);
  }
  readSpecVersion() {
    return this.specVersion;
  }
  get transactionRetryIntervalDefault() {
    return this.transactionRetryIntervalFallback ?? 5e3;
  }
  setChainId(chainId) {
    this.chainId = chainId;
  }
  fetch(method, params, id = 0) {
    const rpcRequestBody = {
      id,
      jsonrpc: "2.0",
      method,
      ...params && { params }
    };
    return this.baseFetch(this.nodeUrl, {
      method: "POST",
      body: stringify2(rpcRequestBody),
      headers: this.headers
    });
  }
  errorHandler(method, params, rpcError, otherError) {
    if (rpcError) {
      throw new RpcError(rpcError, method, params);
    }
    if (otherError instanceof LibraryError) {
      throw otherError;
    }
    if (otherError) {
      throw Error(otherError.message);
    }
  }
  async fetchEndpoint(method, params) {
    try {
      let error;
      let result;
      if (this.batchClient) {
        ({ error, result } = await this.batchClient.fetch(method, params, this.requestId += 1));
      } else {
        const rawResult = await this.fetch(method, params, this.requestId += 1);
        ({ error, result } = await rawResult.json());
      }
      this.errorHandler(method, params, error);
      if (result === void 0) {
        throw new LibraryError(
          `RPC: '${method}' returned an empty response (no result and no error). The node reply is malformed or not a valid JSON-RPC response.`
        );
      }
      return result;
    } catch (error) {
      this.errorHandler(method, params, error?.response?.data, error);
      throw error;
    }
  }
  async getChainId() {
    this.chainId ??= await this.fetchEndpoint("starknet_chainId");
    return this.chainId;
  }
  /**
   * fetch rpc node specVersion
   * @example this.specVersion = "0.9.0"
   */
  getSpecVersion() {
    return this.fetchEndpoint("starknet_specVersion");
  }
  /**
   * fetch if undefined else just return this.specVersion
   * @example this.specVersion = "0.9.0"
   */
  async setUpSpecVersion() {
    if (!this.specVersion) {
      const unknownSpecVersion = await this.fetchEndpoint("starknet_specVersion");
      if (!isVersion(this.channelSpecVersion, unknownSpecVersion)) {
        logger.error(SYSTEM_MESSAGES.channelVersionMismatch, {
          channelId: this.id,
          channelSpecVersion: this.channelSpecVersion,
          nodeSpecVersion: this.specVersion
        });
      }
      if (!isSupportedSpecVersion(unknownSpecVersion)) {
        throw new LibraryError(`${SYSTEM_MESSAGES.unsupportedSpecVersion}, channelId: ${this.id}`);
      }
      this.specVersion = unknownSpecVersion;
    }
    return this.specVersion;
  }
  // TODO: New Method add test
  /**
   * Given an l1 tx hash, returns the associated l1_handler tx hashes and statuses for all L1 -> L2 messages sent by the l1 transaction, ordered by the l1 tx sending order
   */
  getMessagesStatus(txHash) {
    const transaction_hash = toHex(txHash);
    return this.fetchEndpoint("starknet_getMessagesStatus", {
      transaction_hash
    });
  }
  // TODO: New Method add test
  getStorageProof(classHashes = [], contractAddresses = [], contractsStorageKeys = [], blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    const class_hashes = bigNumberishArrayToHexadecimalStringArray(classHashes);
    const contract_addresses = bigNumberishArrayToHexadecimalStringArray(contractAddresses);
    return this.fetchEndpoint("starknet_getStorageProof", {
      block_id,
      class_hashes,
      contract_addresses,
      contracts_storage_keys: contractsStorageKeys
    });
  }
  // TODO: New Method add test
  getCompiledCasm(classHash) {
    const class_hash = toHex(classHash);
    return this.fetchEndpoint("starknet_getCompiledCasm", {
      class_hash
    });
  }
  getNonceForAddress(contractAddress, blockIdentifier = this.blockIdentifier) {
    const contract_address = toHex(contractAddress);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getNonce", {
      contract_address,
      block_id
    });
  }
  /**
   * Helper method to get the starknet version from the block, default latest block
   * @returns Starknet version
   */
  async getStarknetVersion(blockIdentifier = this.blockIdentifier) {
    const block = await this.getBlockWithTxHashes(blockIdentifier);
    return block.starknet_version;
  }
  /**
   * Get the most recent accepted block hash and number
   */
  getBlockLatestAccepted() {
    return this.fetchEndpoint("starknet_blockHashAndNumber");
  }
  /**
   * Get the most recent accepted block number
   * redundant use getBlockLatestAccepted();
   * @returns Number of the latest block
   */
  getBlockNumber() {
    return this.fetchEndpoint("starknet_blockNumber");
  }
  getBlockWithTxHashes(blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getBlockWithTxHashes", { block_id });
  }
  getBlockWithTxs(blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getBlockWithTxs", { block_id });
  }
  getBlockWithReceipts(blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getBlockWithReceipts", { block_id });
  }
  getBlockStateUpdate(blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getStateUpdate", { block_id });
  }
  getBlockTransactionsTraces(blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_traceBlockTransactions", { block_id });
  }
  getBlockTransactionCount(blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getBlockTransactionCount", { block_id });
  }
  getTransactionByHash(txHash) {
    const transaction_hash = toHex(txHash);
    return this.fetchEndpoint("starknet_getTransactionByHash", {
      transaction_hash
    });
  }
  getTransactionByBlockIdAndIndex(blockIdentifier, index) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getTransactionByBlockIdAndIndex", { block_id, index });
  }
  getTransactionReceipt(txHash) {
    const transaction_hash = toHex(txHash);
    return this.fetchEndpoint("starknet_getTransactionReceipt", { transaction_hash });
  }
  getTransactionTrace(txHash) {
    const transaction_hash = toHex(txHash);
    return this.fetchEndpoint("starknet_traceTransaction", { transaction_hash });
  }
  /**
   * Get the status of a transaction
   */
  getTransactionStatus(transactionHash) {
    const transaction_hash = toHex(transactionHash);
    return this.fetchEndpoint("starknet_getTransactionStatus", { transaction_hash });
  }
  /**
   * @param invocations AccountInvocations
   * @param simulateTransactionOptions blockIdentifier and flags to skip validation and fee charge<br/>
   * - blockIdentifier<br/>
   * - skipValidate (default true)<br/>
   * - skipFeeCharge (default true)<br/>
   */
  async simulateTransaction(invocations, simulateTransactionOptions = {}) {
    const channelDefaults = config2.get("channelDefaults");
    const methodDefaults = channelDefaults.methods.simulateTransaction || {};
    const {
      blockIdentifier = this.blockIdentifier,
      skipValidate = methodDefaults.skipValidate,
      skipFeeCharge = methodDefaults.skipFeeCharge
    } = simulateTransactionOptions;
    const block_id = new Block(blockIdentifier).identifier;
    const simulationFlags = [];
    if (skipValidate) simulationFlags.push(ESimulationFlag.SKIP_VALIDATE);
    if (skipFeeCharge) simulationFlags.push(ESimulationFlag.SKIP_FEE_CHARGE);
    return this.fetchEndpoint("starknet_simulateTransactions", {
      block_id,
      transactions: await Promise.all(invocations.map((it) => this.buildTransaction(it))),
      simulation_flags: simulationFlags
    });
  }
  async waitForTransaction(txHash, options) {
    const transactionHash = toHex(txHash);
    let retries = options?.retries ?? this.retries;
    let lifeCycleRetries = options?.lifeCycleRetries ?? 3;
    let onchain = false;
    let isErrorState = false;
    const retryInterval = options?.retryInterval ?? this.transactionRetryIntervalDefault;
    const errorStates = options?.errorStates ?? [];
    const successStates = options?.successStates ?? [
      // RPC.ETransactionExecutionStatus.SUCCEEDED, // UDC  on SUCCEEDED + pre_confirmed had no proper events to parse UDC
      ETransactionFinalityStatus.ACCEPTED_ON_L2,
      ETransactionFinalityStatus.ACCEPTED_ON_L1
    ];
    const errorMessages = {
      [ETransactionStatus.RECEIVED]: SYSTEM_MESSAGES.txEvictedFromMempool,
      [ETransactionStatus.PRE_CONFIRMED]: SYSTEM_MESSAGES.consensusFailed,
      [ETransactionStatus.CANDIDATE]: SYSTEM_MESSAGES.txFailsBlockBuildingValidation
    };
    const txLife = [];
    let txStatus;
    while (!onchain) {
      await wait(retryInterval);
      try {
        txStatus = await this.getTransactionStatus(transactionHash);
        txLife.push(txStatus.finality_status);
        const executionStatus = txStatus.execution_status;
        const finalityStatus = txStatus.finality_status;
        if (!finalityStatus) {
          const error = new Error("waiting for transaction status");
          throw error;
        }
        if (errorStates.includes(executionStatus) || errorStates.includes(finalityStatus)) {
          const message = `${executionStatus}: ${finalityStatus}`;
          const error = new Error(message);
          error.response = txStatus;
          isErrorState = true;
          throw error;
        } else if (successStates.includes(executionStatus) || successStates.includes(finalityStatus)) {
          onchain = true;
        }
      } catch (error) {
        if (error instanceof Error && isErrorState) {
          throw error;
        }
        if (error instanceof RpcError && error.isType("TXN_HASH_NOT_FOUND")) {
          logger.info("txLife: ", txLife);
          const errorMessage = errorMessages[txLife.at(-1)];
          if (errorMessage && lifeCycleRetries <= 0) {
            throw new Error(errorMessage);
          }
          lifeCycleRetries -= 1;
        }
        if (retries <= 0) {
          throw new Error(`waitForTransaction timed-out with retries ${this.retries}`);
        }
      }
      retries -= 1;
    }
    let txReceipt = null;
    while (txReceipt === null) {
      try {
        txReceipt = await this.getTransactionReceipt(transactionHash);
      } catch (error) {
        if (retries <= 0) {
          throw new Error(`waitForTransaction timed-out with retries ${this.retries}`);
        }
      }
      retries -= 1;
      await wait(retryInterval);
    }
    return txReceipt;
  }
  getStorageAt(contractAddress, key, blockIdentifier = this.blockIdentifier) {
    const contract_address = toHex(contractAddress);
    const parsedKey = toStorageKey(key);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getStorageAt", {
      contract_address,
      key: parsedKey,
      block_id
    });
  }
  getClassHashAt(contractAddress, blockIdentifier = this.blockIdentifier) {
    const contract_address = toHex(contractAddress);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getClassHashAt", {
      block_id,
      contract_address
    });
  }
  getClass(classHash, blockIdentifier = this.blockIdentifier) {
    const class_hash = toHex(classHash);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getClass", {
      class_hash,
      block_id
    });
  }
  getClassAt(contractAddress, blockIdentifier = this.blockIdentifier) {
    const contract_address = toHex(contractAddress);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getClassAt", {
      block_id,
      contract_address
    });
  }
  async getEstimateFee(invocations, options = {}) {
    const channelDefaults = config2.get("channelDefaults");
    const methodDefaults = channelDefaults.methods.getEstimateFee || {};
    const { blockIdentifier = this.blockIdentifier, skipValidate = methodDefaults.skipValidate } = options;
    const block_id = new Block(blockIdentifier).identifier;
    const flags = {
      simulation_flags: skipValidate ? [ESimulationFlag.SKIP_VALIDATE] : []
    };
    return this.fetchEndpoint("starknet_estimateFee", {
      request: await Promise.all(invocations.map((it) => this.buildTransaction(it, "fee"))),
      block_id,
      ...flags
    });
  }
  async invoke(functionInvocation, details) {
    const transaction = await this.buildTransaction(
      {
        type: api_exports3.ETransactionType.INVOKE,
        ...functionInvocation,
        ...details
      },
      "transaction"
    );
    const promise = this.fetchEndpoint("starknet_addInvokeTransaction", {
      invoke_transaction: transaction
    });
    return this.waitMode ? this.waitForTransaction((await promise).transaction_hash) : promise;
  }
  async invokeSignedTx(transaction) {
    const promise = this.fetchEndpoint("starknet_addInvokeTransaction", {
      invoke_transaction: transaction
    });
    return this.waitMode ? this.waitForTransaction((await promise).transaction_hash) : promise;
  }
  async declare(declareTransaction, details) {
    const transaction = await this.buildTransaction(
      {
        type: api_exports3.ETransactionType.DECLARE,
        ...declareTransaction,
        ...details
      },
      "transaction"
    );
    const promise = this.fetchEndpoint("starknet_addDeclareTransaction", {
      declare_transaction: transaction
    });
    return this.waitMode ? this.waitForTransaction((await promise).transaction_hash) : promise;
  }
  async deployAccount(deployAccountTransaction, details) {
    const transaction = await this.buildTransaction(
      {
        type: api_exports3.ETransactionType.DEPLOY_ACCOUNT,
        ...deployAccountTransaction,
        ...details
      },
      "transaction"
    );
    const promise = this.fetchEndpoint("starknet_addDeployAccountTransaction", {
      deploy_account_transaction: transaction
    });
    return this.waitMode ? this.waitForTransaction((await promise).transaction_hash) : promise;
  }
  callContract(call, blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_call", {
      request: {
        contract_address: call.contractAddress,
        entry_point_selector: getSelectorFromName(call.entrypoint),
        calldata: CallData.toHex(call.calldata)
      },
      block_id
    });
  }
  /**
   * NEW: Estimate the fee for a message from L1
   * @param message Message From L1
   */
  estimateMessageFee(message, blockIdentifier = this.blockIdentifier) {
    const { from_address, to_address, entry_point_selector, payload } = message;
    const formattedMessage = {
      from_address: validateAndParseEthAddress(from_address),
      to_address: toHex(to_address),
      entry_point_selector: getSelector(entry_point_selector),
      payload: getHexStringArray(payload)
    };
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_estimateMessageFee", {
      message: formattedMessage,
      block_id
    });
  }
  /**
   * Returns an object about the sync status, or false if the node is not synching
   * @returns Object with the stats data
   */
  getSyncingStats() {
    return this.fetchEndpoint("starknet_syncing");
  }
  /**
   * Returns all events matching the given filter
   * @returns events and the pagination of the events
   */
  getEvents(eventFilter) {
    return this.fetchEndpoint("starknet_getEvents", { filter: eventFilter });
  }
  // Generic buildTransaction that automatically narrows return type based on input
  async buildTransaction(invocation, versionType) {
    const defaultVersions = getVersionsByType(versionType);
    assert(isV3Tx(invocation), SYSTEM_MESSAGES.legacyTxRPC08Message);
    assert(
      versionType !== "transaction" || isRPC08Plus_ResourceBoundsBN(invocation.resourceBounds),
      SYSTEM_MESSAGES.SWOldV3
    );
    const details = {
      signature: signatureToHexArray(invocation.signature),
      nonce: toHex(invocation.nonce),
      resource_bounds: resourceBoundsToHexString(invocation.resourceBounds),
      tip: toHex(invocation.tip),
      paymaster_data: invocation.paymasterData.map((it) => toHex(it)),
      nonce_data_availability_mode: invocation.nonceDataAvailabilityMode,
      fee_data_availability_mode: invocation.feeDataAvailabilityMode,
      account_deployment_data: invocation.accountDeploymentData.map((it) => toHex(it)),
      version: toTransactionVersion(defaultVersions.v3, invocation.version)
    };
    if (invocation.type === api_exports3.ETransactionType.INVOKE) {
      const btx = {
        type: ETransactionType.INVOKE,
        sender_address: invocation.contractAddress,
        calldata: CallData.toHex(invocation.calldata),
        ...details
      };
      return btx;
    }
    if (invocation.type === api_exports3.ETransactionType.DECLARE) {
      assert(isSierra(invocation.contract), "Declaring non Sierra contract using RPC 0.9");
      const btx = {
        type: invocation.type,
        contract_class: {
          ...invocation.contract,
          sierra_program: await decompressProgram(invocation.contract.sierra_program)
        },
        compiled_class_hash: invocation.compiledClassHash || "",
        sender_address: invocation.senderAddress,
        ...details
      };
      return btx;
    }
    if (invocation.type === api_exports3.ETransactionType.DEPLOY_ACCOUNT) {
      const { account_deployment_data, ...restDetails } = details;
      const btx = {
        type: invocation.type,
        constructor_calldata: CallData.toHex(invocation.constructorCalldata || []),
        class_hash: toHex(invocation.classHash),
        contract_address_salt: toHex(invocation.addressSalt || 0),
        ...restDetails
      };
      return btx;
    }
    throw Error("RPC buildTransaction received unknown TransactionType");
  }
};
var rpc_0_10_2_exports = {};
__export2(rpc_0_10_2_exports, {
  RpcChannel: () => RpcChannel2
});
var RpcChannel2 = class {
  id = "RPC0.10.2";
  /**
   * RPC specification version this Channel class implements
   */
  channelSpecVersion = _SupportedRpcVersion.v0_10_2;
  nodeUrl;
  headers;
  requestId;
  blockIdentifier;
  retries;
  waitMode;
  // behave like web2 rpc and return when tx is processed
  chainId;
  /**
   * RPC specification version of the connected node
   */
  specVersion;
  transactionRetryIntervalFallback;
  batchClient;
  baseFetch;
  constructor(optionsOrProvider) {
    const {
      baseFetch,
      batch,
      blockIdentifier,
      chainId,
      headers,
      nodeUrl,
      retries,
      specVersion,
      transactionRetryIntervalFallback,
      waitMode
    } = optionsOrProvider || {};
    if (Object.values(_NetworkName).includes(nodeUrl)) {
      this.nodeUrl = getDefaultNodeUrl(nodeUrl, this.channelSpecVersion);
    } else if (nodeUrl) {
      this.nodeUrl = nodeUrl;
    } else {
      this.nodeUrl = getDefaultNodeUrl(void 0, this.channelSpecVersion);
    }
    const channelDefaults = config2.get("channelDefaults");
    this.baseFetch = baseFetch || config2.get("fetch") || fetch_default;
    this.blockIdentifier = blockIdentifier ?? channelDefaults.options.blockIdentifier;
    this.chainId = chainId;
    this.headers = { ...channelDefaults.options.headers, ...headers };
    this.retries = retries ?? channelDefaults.options.retries;
    this.specVersion = specVersion;
    this.transactionRetryIntervalFallback = transactionRetryIntervalFallback ?? channelDefaults.options.transactionRetryIntervalFallback;
    this.waitMode = waitMode ?? false;
    this.requestId = 0;
    if (isNumber2(batch)) {
      this.batchClient = new BatchClient({
        nodeUrl: this.nodeUrl,
        headers: this.headers,
        interval: batch,
        baseFetch: this.baseFetch,
        rpcMethods: {}
        // Type information only, not used at runtime
      });
    }
    logger.debug("Using Channel", this.id);
  }
  readSpecVersion() {
    return this.specVersion;
  }
  get transactionRetryIntervalDefault() {
    return this.transactionRetryIntervalFallback ?? 5e3;
  }
  setChainId(chainId) {
    this.chainId = chainId;
  }
  fetch(method, params, id = 0) {
    const rpcRequestBody = {
      id,
      jsonrpc: "2.0",
      method,
      ...params && { params }
    };
    return this.baseFetch(this.nodeUrl, {
      method: "POST",
      body: stringify2(rpcRequestBody),
      headers: this.headers
    });
  }
  errorHandler(method, params, rpcError, otherError) {
    if (rpcError) {
      throw new RpcError(rpcError, method, params);
    }
    if (otherError instanceof LibraryError) {
      throw otherError;
    }
    if (otherError) {
      throw Error(otherError.message);
    }
  }
  async fetchEndpoint(method, params) {
    try {
      let error;
      let result;
      if (this.batchClient) {
        ({ error, result } = await this.batchClient.fetch(method, params, this.requestId += 1));
      } else {
        const rawResult = await this.fetch(method, params, this.requestId += 1);
        ({ error, result } = await rawResult.json());
      }
      this.errorHandler(method, params, error);
      if (result === void 0) {
        throw new LibraryError(
          `RPC: '${method}' returned an empty response (no result and no error). The node reply is malformed or not a valid JSON-RPC response.`
        );
      }
      return result;
    } catch (error) {
      this.errorHandler(method, params, error?.response?.data, error);
      throw error;
    }
  }
  async getChainId() {
    this.chainId ??= await this.fetchEndpoint("starknet_chainId");
    return this.chainId;
  }
  /**
   * fetch rpc node specVersion
   * @example this.specVersion = "0.9.0"
   */
  getSpecVersion() {
    return this.fetchEndpoint("starknet_specVersion");
  }
  /**
   * fetch if undefined else just return this.specVersion
   * @example this.specVersion = "0.9.0"
   */
  async setUpSpecVersion() {
    if (!this.specVersion) {
      const unknownSpecVersion = await this.fetchEndpoint("starknet_specVersion");
      if (!isVersion("0.10", unknownSpecVersion)) {
        logger.error(SYSTEM_MESSAGES.channelVersionMismatch, {
          channelId: this.id,
          channelSpecVersion: this.channelSpecVersion,
          nodeSpecVersion: this.specVersion
        });
      }
      if (!isSupportedSpecVersion(unknownSpecVersion)) {
        throw new LibraryError(`${SYSTEM_MESSAGES.unsupportedSpecVersion}, channelId: ${this.id}`);
      }
      this.specVersion = unknownSpecVersion;
    }
    return this.specVersion;
  }
  // TODO: New Method add test
  /**
   * Given an l1 tx hash, returns the associated l1_handler tx hashes and statuses for all L1 -> L2 messages sent by the l1 transaction, ordered by the l1 tx sending order
   */
  getMessagesStatus(txHash) {
    const transaction_hash = toHex(txHash);
    return this.fetchEndpoint("starknet_getMessagesStatus", {
      transaction_hash
    });
  }
  // TODO: New Method add test
  getStorageProof(classHashes = [], contractAddresses = [], contractsStorageKeys = [], blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    const class_hashes = bigNumberishArrayToHexadecimalStringArray(classHashes);
    const contract_addresses = bigNumberishArrayToHexadecimalStringArray(contractAddresses);
    return this.fetchEndpoint("starknet_getStorageProof", {
      block_id,
      class_hashes,
      contract_addresses,
      contracts_storage_keys: contractsStorageKeys
    });
  }
  // TODO: New Method add test
  getCompiledCasm(classHash) {
    const class_hash = toHex(classHash);
    return this.fetchEndpoint("starknet_getCompiledCasm", {
      class_hash
    });
  }
  getNonceForAddress(contractAddress, blockIdentifier = this.blockIdentifier) {
    const contract_address = toHex(contractAddress);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getNonce", {
      contract_address,
      block_id
    });
  }
  /**
   * Helper method to get the starknet version from the block, default latest block
   * @returns Starknet version
   */
  async getStarknetVersion(blockIdentifier = this.blockIdentifier) {
    const block = await this.getBlockWithTxHashes(blockIdentifier);
    return block.starknet_version;
  }
  /**
   * Get the most recent accepted block hash and number
   */
  getBlockLatestAccepted() {
    return this.fetchEndpoint("starknet_blockHashAndNumber");
  }
  /**
   * Get the most recent accepted block number
   * redundant use getBlockLatestAccepted();
   * @returns Number of the latest block
   */
  getBlockNumber() {
    return this.fetchEndpoint("starknet_blockNumber");
  }
  getBlockWithTxHashes(blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getBlockWithTxHashes", { block_id });
  }
  /**
   * Get block information with full transactions
   * @param blockIdentifier - block identifier
   * @param options - optional flags
   *  - includeProofFacts - include proof facts in the response (RPC 0.10.1+)
   */
  getBlockWithTxs(blockIdentifier = this.blockIdentifier, options) {
    const block_id = new Block(blockIdentifier).identifier;
    const response_flags = options?.includeProofFacts ? [ETxnResponseFlag2.INCLUDE_PROOF_FACTS] : void 0;
    return this.fetchEndpoint("starknet_getBlockWithTxs", {
      block_id,
      ...response_flags && { response_flags }
    });
  }
  /**
   * Get block information with transaction receipts
   * @param blockIdentifier - block identifier
   * @param options - optional flags
   *  - includeProofFacts - include proof facts in the response (RPC 0.10.1+)
   */
  getBlockWithReceipts(blockIdentifier = this.blockIdentifier, options) {
    const block_id = new Block(blockIdentifier).identifier;
    const response_flags = options?.includeProofFacts ? [ETxnResponseFlag2.INCLUDE_PROOF_FACTS] : void 0;
    return this.fetchEndpoint("starknet_getBlockWithReceipts", {
      block_id,
      ...response_flags && { response_flags }
    });
  }
  getBlockStateUpdate(blockIdentifier = this.blockIdentifier, contractAddresses) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getStateUpdate", {
      block_id,
      ...contractAddresses && {
        contract_addresses: contractAddresses.map((addr) => toHex(addr))
      }
    });
  }
  /**
   * Get transaction traces for all transactions in a block
   * @param blockIdentifier - block identifier
   * @param options - optional flags
   *  - returnInitialReads - include initial storage reads in traces (RPC 0.10.1+)
   */
  getBlockTransactionsTraces(blockIdentifier = this.blockIdentifier, options) {
    const block_id = new Block(blockIdentifier).identifier;
    const trace_flags = options?.returnInitialReads ? [ETraceFlag2.RETURN_INITIAL_READS] : void 0;
    return this.fetchEndpoint("starknet_traceBlockTransactions", {
      block_id,
      ...trace_flags && { trace_flags }
    });
  }
  getBlockTransactionCount(blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getBlockTransactionCount", { block_id });
  }
  /**
   * Get transaction by hash
   * @param txHash - transaction hash
   * @param options - optional flags
   *  - includeProofFacts - include proof facts in the response (RPC 0.10.1+)
   */
  getTransactionByHash(txHash, options) {
    const transaction_hash = toHex(txHash);
    const response_flags = options?.includeProofFacts ? [ETxnResponseFlag2.INCLUDE_PROOF_FACTS] : void 0;
    return this.fetchEndpoint("starknet_getTransactionByHash", {
      transaction_hash,
      ...response_flags && { response_flags }
    });
  }
  /**
   * Get transaction by block identifier and index
   * @param blockIdentifier - block identifier
   * @param index - transaction index in the block
   * @param options - optional flags
   *  - includeProofFacts - include proof facts in the response (RPC 0.10.1+)
   */
  getTransactionByBlockIdAndIndex(blockIdentifier, index, options) {
    const block_id = new Block(blockIdentifier).identifier;
    const response_flags = options?.includeProofFacts ? [ETxnResponseFlag2.INCLUDE_PROOF_FACTS] : void 0;
    return this.fetchEndpoint("starknet_getTransactionByBlockIdAndIndex", {
      block_id,
      index,
      ...response_flags && { response_flags }
    });
  }
  getTransactionReceipt(txHash) {
    const transaction_hash = toHex(txHash);
    return this.fetchEndpoint("starknet_getTransactionReceipt", { transaction_hash });
  }
  getTransactionTrace(txHash) {
    const transaction_hash = toHex(txHash);
    return this.fetchEndpoint("starknet_traceTransaction", { transaction_hash });
  }
  /**
   * Get the status of a transaction
   */
  getTransactionStatus(transactionHash) {
    const transaction_hash = toHex(transactionHash);
    return this.fetchEndpoint("starknet_getTransactionStatus", { transaction_hash });
  }
  /**
   * @param invocations AccountInvocations
   * @param simulateTransactionOptions blockIdentifier and flags to skip validation and fee charge<br/>
   * - blockIdentifier<br/>
   * - skipValidate (default true)<br/>
   * - skipFeeCharge (default true)<br/>
   * - returnInitialReads (default false) - include initial storage reads in trace (RPC 0.10.1+)<br/>
   */
  async simulateTransaction(invocations, simulateTransactionOptions = {}) {
    const channelDefaults = config2.get("channelDefaults");
    const methodDefaults = channelDefaults.methods.simulateTransaction || {};
    const {
      blockIdentifier = this.blockIdentifier,
      skipValidate = methodDefaults.skipValidate,
      skipFeeCharge = methodDefaults.skipFeeCharge,
      returnInitialReads
    } = simulateTransactionOptions;
    const block_id = new Block(blockIdentifier).identifier;
    const simulationFlags = [];
    if (skipValidate) simulationFlags.push(ESimulationFlag3.SKIP_VALIDATE);
    if (skipFeeCharge) simulationFlags.push(ESimulationFlag3.SKIP_FEE_CHARGE);
    const trace_flags = returnInitialReads ? [ETraceFlag2.RETURN_INITIAL_READS] : void 0;
    return this.fetchEndpoint("starknet_simulateTransactions", {
      block_id,
      transactions: await Promise.all(invocations.map((it) => this.buildTransaction(it))),
      simulation_flags: simulationFlags,
      ...trace_flags && { trace_flags }
    });
  }
  async waitForTransaction(txHash, options) {
    const transactionHash = toHex(txHash);
    let retries = options?.retries ?? this.retries;
    let lifeCycleRetries = options?.lifeCycleRetries ?? 3;
    let onchain = false;
    let isErrorState = false;
    const retryInterval = options?.retryInterval ?? this.transactionRetryIntervalDefault;
    const errorStates = options?.errorStates ?? [];
    const successStates = options?.successStates ?? [
      // RPC.ETransactionExecutionStatus.SUCCEEDED, // UDC  on SUCCEEDED + pre_confirmed had no proper events to parse UDC
      ETransactionFinalityStatus3.ACCEPTED_ON_L2,
      ETransactionFinalityStatus3.ACCEPTED_ON_L1
    ];
    const errorMessages = {
      [ETransactionStatus3.RECEIVED]: SYSTEM_MESSAGES.txEvictedFromMempool,
      [ETransactionStatus3.PRE_CONFIRMED]: SYSTEM_MESSAGES.consensusFailed,
      [ETransactionStatus3.CANDIDATE]: SYSTEM_MESSAGES.txFailsBlockBuildingValidation
    };
    const txLife = [];
    let txStatus;
    while (!onchain) {
      await wait(retryInterval);
      try {
        txStatus = await this.getTransactionStatus(transactionHash);
        txLife.push(txStatus.finality_status);
        const executionStatus = txStatus.execution_status;
        const finalityStatus = txStatus.finality_status;
        if (!finalityStatus) {
          const error = new Error("waiting for transaction status");
          throw error;
        }
        if (errorStates.includes(executionStatus) || errorStates.includes(finalityStatus)) {
          const message = `${executionStatus}: ${finalityStatus}`;
          const error = new Error(message);
          error.response = txStatus;
          isErrorState = true;
          throw error;
        } else if (successStates.includes(executionStatus) || successStates.includes(finalityStatus)) {
          onchain = true;
        }
      } catch (error) {
        if (error instanceof Error && isErrorState) {
          throw error;
        }
        if (error instanceof RpcError && error.isType("TXN_HASH_NOT_FOUND")) {
          logger.info("txLife: ", txLife);
          const errorMessage = errorMessages[txLife.at(-1)];
          if (errorMessage && lifeCycleRetries <= 0) {
            throw new Error(errorMessage);
          }
          lifeCycleRetries -= 1;
        }
        if (retries <= 0) {
          throw new Error(`waitForTransaction timed-out with retries ${this.retries}`);
        }
      }
      retries -= 1;
    }
    let txReceipt = null;
    while (txReceipt === null) {
      try {
        txReceipt = await this.getTransactionReceipt(transactionHash);
      } catch (error) {
        if (retries <= 0) {
          throw new Error(`waitForTransaction timed-out with retries ${this.retries}`);
        }
      }
      retries -= 1;
      await wait(retryInterval);
    }
    return txReceipt;
  }
  getStorageAt(contractAddress, key, blockIdentifier = this.blockIdentifier, responseFlags) {
    const contract_address = toHex(contractAddress);
    const parsedKey = toStorageKey(key);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getStorageAt", {
      contract_address,
      key: parsedKey,
      block_id,
      ...responseFlags && { response_flags: responseFlags }
    });
  }
  getClassHashAt(contractAddress, blockIdentifier = this.blockIdentifier) {
    const contract_address = toHex(contractAddress);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getClassHashAt", {
      block_id,
      contract_address
    });
  }
  getClass(classHash, blockIdentifier = this.blockIdentifier) {
    const class_hash = toHex(classHash);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getClass", {
      class_hash,
      block_id
    });
  }
  getClassAt(contractAddress, blockIdentifier = this.blockIdentifier) {
    const contract_address = toHex(contractAddress);
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_getClassAt", {
      block_id,
      contract_address
    });
  }
  async getEstimateFee(invocations, options = {}) {
    const channelDefaults = config2.get("channelDefaults");
    const methodDefaults = channelDefaults.methods.getEstimateFee || {};
    const { blockIdentifier = this.blockIdentifier, skipValidate = methodDefaults.skipValidate } = options;
    const block_id = new Block(blockIdentifier).identifier;
    const flags = {
      simulation_flags: skipValidate ? [ESimulationFlag3.SKIP_VALIDATE] : []
    };
    return this.fetchEndpoint("starknet_estimateFee", {
      request: await Promise.all(invocations.map((it) => this.buildTransaction(it, "fee"))),
      block_id,
      ...flags
    });
  }
  async invoke(functionInvocation, details) {
    const transaction = await this.buildTransaction(
      {
        type: api_exports3.ETransactionType.INVOKE,
        ...functionInvocation,
        ...details
      },
      "transaction"
    );
    const promise = this.fetchEndpoint("starknet_addInvokeTransaction", {
      invoke_transaction: transaction
    });
    return this.waitMode ? this.waitForTransaction((await promise).transaction_hash) : promise;
  }
  async invokeSignedTx(transaction) {
    const promise = this.fetchEndpoint("starknet_addInvokeTransaction", {
      invoke_transaction: transaction
    });
    return this.waitMode ? this.waitForTransaction((await promise).transaction_hash) : promise;
  }
  async declare(declareTransaction, details) {
    const transaction = await this.buildTransaction(
      {
        type: api_exports3.ETransactionType.DECLARE,
        ...declareTransaction,
        ...details
      },
      "transaction"
    );
    const promise = this.fetchEndpoint("starknet_addDeclareTransaction", {
      declare_transaction: transaction
    });
    return this.waitMode ? this.waitForTransaction((await promise).transaction_hash) : promise;
  }
  async deployAccount(deployAccountTransaction, details) {
    const transaction = await this.buildTransaction(
      {
        type: api_exports3.ETransactionType.DEPLOY_ACCOUNT,
        ...deployAccountTransaction,
        ...details
      },
      "transaction"
    );
    const promise = this.fetchEndpoint("starknet_addDeployAccountTransaction", {
      deploy_account_transaction: transaction
    });
    return this.waitMode ? this.waitForTransaction((await promise).transaction_hash) : promise;
  }
  callContract(call, blockIdentifier = this.blockIdentifier) {
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_call", {
      request: {
        contract_address: call.contractAddress,
        entry_point_selector: getSelectorFromName(call.entrypoint),
        calldata: CallData.toHex(call.calldata)
      },
      block_id
    });
  }
  /**
   * NEW: Estimate the fee for a message from L1
   * @param message Message From L1
   */
  estimateMessageFee(message, blockIdentifier = this.blockIdentifier) {
    const { from_address, to_address, entry_point_selector, payload } = message;
    const formattedMessage = {
      from_address: validateAndParseEthAddress(from_address),
      to_address: toHex(to_address),
      entry_point_selector: getSelector(entry_point_selector),
      payload: getHexStringArray(payload)
    };
    const block_id = new Block(blockIdentifier).identifier;
    return this.fetchEndpoint("starknet_estimateMessageFee", {
      message: formattedMessage,
      block_id
    });
  }
  /**
   * Returns an object about the sync status, or false if the node is not synching
   * @returns Object with the stats data
   */
  getSyncingStats() {
    return this.fetchEndpoint("starknet_syncing");
  }
  /**
   * Returns all events matching the given filter
   * @returns events and the pagination of the events
   */
  getEvents(eventFilter) {
    return this.fetchEndpoint("starknet_getEvents", { filter: eventFilter });
  }
  // Generic buildTransaction that automatically narrows return type based on input
  async buildTransaction(invocation, versionType) {
    const defaultVersions = getVersionsByType(versionType);
    assert(isV3Tx(invocation), SYSTEM_MESSAGES.legacyTxRPC08Message);
    assert(
      versionType !== "transaction" || isRPC08Plus_ResourceBoundsBN(invocation.resourceBounds),
      SYSTEM_MESSAGES.SWOldV3
    );
    const details = {
      signature: signatureToHexArray(invocation.signature),
      nonce: toHex(invocation.nonce),
      resource_bounds: resourceBoundsToHexString(invocation.resourceBounds),
      tip: toHex(invocation.tip),
      paymaster_data: invocation.paymasterData.map((it) => toHex(it)),
      nonce_data_availability_mode: invocation.nonceDataAvailabilityMode,
      fee_data_availability_mode: invocation.feeDataAvailabilityMode,
      account_deployment_data: invocation.accountDeploymentData.map((it) => toHex(it)),
      version: toTransactionVersion(defaultVersions.v3, invocation.version)
    };
    if (invocation.type === api_exports3.ETransactionType.INVOKE) {
      const btx = {
        type: ETransactionType3.INVOKE,
        sender_address: invocation.contractAddress,
        calldata: CallData.toHex(invocation.calldata),
        ...details,
        ...invocation.proofFacts && invocation.proofFacts.length > 0 && {
          proof_facts: invocation.proofFacts.map((it) => toHex(it))
        },
        ...invocation.proof && {
          proof: invocation.proof
        }
      };
      return btx;
    }
    if (invocation.type === api_exports3.ETransactionType.DECLARE) {
      assert(isSierra(invocation.contract), "Declaring non Sierra contract using RPC 0.9");
      const btx = {
        type: invocation.type,
        contract_class: {
          ...invocation.contract,
          sierra_program: await decompressProgram(invocation.contract.sierra_program)
        },
        compiled_class_hash: invocation.compiledClassHash || "",
        sender_address: invocation.senderAddress,
        ...details
      };
      return btx;
    }
    if (invocation.type === api_exports3.ETransactionType.DEPLOY_ACCOUNT) {
      const { account_deployment_data, ...restDetails } = details;
      const btx = {
        type: invocation.type,
        constructor_calldata: CallData.toHex(invocation.constructorCalldata || []),
        class_hash: toHex(invocation.classHash),
        contract_address_salt: toHex(invocation.addressSalt || 0),
        ...restDetails
      };
      return btx;
    }
    throw Error("RPC buildTransaction received unknown TransactionType");
  }
};
var rpc_0_10_3_exports = {};
__export2(rpc_0_10_3_exports, {
  RpcChannel: () => RpcChannel3
});
var RpcChannel3 = class extends RpcChannel2 {
  id = "RPC0.10.3";
  channelSpecVersion = _SupportedRpcVersion.v0_10_3;
};
var ws_default = typeof WebSocket !== "undefined" && WebSocket || typeof globalThis !== "undefined" && globalThis.WebSocket || typeof window !== "undefined" && window.WebSocket && window.WebSocket.bind(window) || typeof global !== "undefined" && global.WebSocket || class {
  constructor() {
    throw new LibraryError(
      "WebSocket module not detected, use the 'websocket' constructor parameter to set a compatible connection"
    );
  }
};
var RPCResponseParser = class {
  resourceBoundsOverhead;
  constructor(resourceBoundsOverhead) {
    this.resourceBoundsOverhead = resourceBoundsOverhead;
  }
  parseGetBlockResponse(res) {
    return res;
  }
  parseTransactionReceipt(res) {
    return res;
  }
  parseFeeEstimateBulkResponse(res) {
    return res.map((val) => ({
      resourceBounds: toOverheadResourceBounds(val, this.resourceBoundsOverhead),
      overall_fee: toOverheadOverallFee(val, this.resourceBoundsOverhead),
      unit: val.unit
    }));
  }
  parseSimulateTransactionResponse(res) {
    const mapTransactions = (transactions) => transactions.map((it) => ({
      transaction_trace: it.transaction_trace,
      resourceBounds: toOverheadResourceBounds(it.fee_estimation, this.resourceBoundsOverhead),
      overall_fee: toOverheadOverallFee(it.fee_estimation, this.resourceBoundsOverhead),
      unit: it.fee_estimation.unit
    }));
    const isArray = Array.isArray(res);
    return {
      simulated_transactions: mapTransactions(isArray ? res : res.simulated_transactions),
      ...!isArray && { initial_reads: res.initial_reads }
    };
  }
  parseContractClassResponse(res) {
    return {
      ...res,
      abi: isString(res.abi) ? JSON.parse(res.abi) : res.abi
    };
  }
  parseL1GasPriceResponse(res) {
    return res.l1_gas_price.price_in_wei;
  }
  parseStorageResponse(res) {
    if (typeof res === "string") {
      return { value: res, last_update_block: 0 };
    }
    return res;
  }
};
function isV3TransactionWithTip(tx) {
  return tx.version === "0x3" && "tip" in tx && isString(tx.tip) && (tx.type === "INVOKE" || tx.type === "DECLARE" || tx.type === "DEPLOY_ACCOUNT");
}
function isBatchingEnabled(provider2) {
  const channel = provider2.channel;
  return !!channel.batchClient;
}
function extractTipsFromBlock(blockData, includeZeroTips = true) {
  return blockData.transactions.filter(isV3TransactionWithTip).map((tx) => BigInt(tx.tip)).filter((tip) => includeZeroTips || tip > 0n);
}
function createZeroTipEstimate(blocksAnalyzed, transactionsTipsFound) {
  return {
    minTip: 0n,
    maxTip: 0n,
    averageTip: 0n,
    medianTip: 0n,
    modeTip: 0n,
    recommendedTip: 0n,
    p90Tip: 0n,
    p95Tip: 0n,
    metrics: {
      blocksAnalyzed,
      transactionsTipsFound
    }
  };
}
function calculatePercentile(sortedArray, percentile) {
  const index = percentile / 100 * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedArray[lower];
  }
  const weight = index - lower;
  const lowerValue = sortedArray[lower];
  const upperValue = sortedArray[upper];
  const diff = upperValue - lowerValue;
  const weightedDiff = diff * BigInt(Math.round(weight * 1e3)) / 1000n;
  return lowerValue + weightedDiff;
}
function calculateTipStats(tips) {
  assert(tips.length > 0, "Cannot calculate statistics from empty tip array");
  const minTip = tips.reduce((min, tip) => tip < min ? tip : min, RANGE_FELT.max);
  const maxTip = tips.reduce((max, tip) => tip > max ? tip : max, 0n);
  const sumTip = tips.reduce((sum, tip) => sum + tip, 0n);
  const averageTip = sumTip / BigInt(tips.length);
  const sortedTips = [...tips].sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  const midIndex = Math.floor(sortedTips.length / 2);
  let medianTip;
  if (sortedTips.length % 2 === 0) {
    medianTip = (sortedTips[midIndex - 1] + sortedTips[midIndex]) / 2n;
  } else {
    medianTip = sortedTips[midIndex];
  }
  const tipCounts = /* @__PURE__ */ new Map();
  tips.forEach((tip) => {
    tipCounts.set(tip, (tipCounts.get(tip) || 0) + 1);
  });
  const { modeTip } = Array.from(tipCounts.entries()).reduce(
    (acc, [tip, count]) => {
      if (count > acc.maxCount || count === acc.maxCount && tip < acc.modeTip) {
        return { maxCount: count, modeTip: tip };
      }
      return acc;
    },
    { maxCount: 0, modeTip: 0n }
  );
  const p90Tip = calculatePercentile(sortedTips, 90);
  const p95Tip = calculatePercentile(sortedTips, 95);
  const recommendedTip = medianTip;
  return { minTip, maxTip, averageTip, medianTip, modeTip, recommendedTip, p90Tip, p95Tip };
}
async function getStartingBlockNumber(provider2, blockIdentifier) {
  try {
    const blockData = await provider2.getBlockWithTxs(blockIdentifier);
    if (isNumber2(blockData.block_number)) {
      return blockData.block_number;
    }
    const latestBlock = await provider2.getBlockLatestAccepted();
    return latestBlock.block_number;
  } catch (error) {
    throw new LibraryError(
      `Failed to determine starting block number: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
async function fetchBlockSafely(provider2, blockNumber) {
  try {
    return await provider2.getBlockWithTxs(blockNumber);
  } catch (error) {
    logger.warn(`Failed to fetch block ${blockNumber}:`, error);
    return null;
  }
}
function generateBlockNumbers(startingBlockNumber, maxBlocks) {
  const oldestBlockNumber = Math.max(0, startingBlockNumber - maxBlocks + 1);
  const blockCount = startingBlockNumber - oldestBlockNumber + 1;
  return Array.from({ length: blockCount }, (_, index) => startingBlockNumber - index);
}
async function fetchBlocksInParallel(provider2, blockNumbers) {
  const fetchPromises = blockNumbers.map(async (blockNumber) => {
    try {
      return await provider2.getBlockWithTxs(blockNumber);
    } catch (error) {
      logger.warn(`Failed to fetch block ${blockNumber} in parallel:`, error);
      return null;
    }
  });
  return Promise.all(fetchPromises);
}
async function getTipStatsParallel(provider2, blockIdentifier, options) {
  const { maxBlocks = 3, minTxsNecessary = 10, includeZeroTips = true } = options;
  try {
    const startingBlockNumber = await getStartingBlockNumber(provider2, blockIdentifier);
    const blockNumbers = generateBlockNumbers(startingBlockNumber, maxBlocks);
    const blocks = await fetchBlocksInParallel(provider2, blockNumbers);
    const allTips = blocks.filter((blockData) => blockData !== null).flatMap((blockData) => extractTipsFromBlock(blockData, includeZeroTips));
    const analyzedBlocks = blocks.filter((b) => b !== null).length;
    if (allTips.length < minTxsNecessary) {
      logger.warn(
        `Insufficient transaction data: found ${allTips.length} V3 transactions with tips in ${analyzedBlocks} blocks (block range: ${Math.max(0, startingBlockNumber - maxBlocks + 1)}-${startingBlockNumber}). Required: ${minTxsNecessary} transactions. Consider reducing minTxsNecessary or increasing maxBlocks.`
      );
      return createZeroTipEstimate(analyzedBlocks, allTips);
    }
    const tipStats = calculateTipStats(allTips);
    return {
      ...tipStats,
      metrics: {
        blocksAnalyzed: analyzedBlocks,
        transactionsTipsFound: allTips
      }
    };
  } catch (error) {
    throw new LibraryError(
      `Failed to analyze tip statistics (parallel): ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
async function getTipStatsSequential(provider2, blockIdentifier, options) {
  const { maxBlocks = 3, minTxsNecessary = 10, includeZeroTips = true } = options;
  try {
    const startingBlockNumber = await getStartingBlockNumber(provider2, blockIdentifier);
    const blockNumbers = generateBlockNumbers(startingBlockNumber, maxBlocks);
    const allTips = [];
    let blocksAnalyzed = 0;
    for (const blockNumber of blockNumbers) {
      const blockData = await fetchBlockSafely(provider2, blockNumber);
      if (blockData) {
        blocksAnalyzed += 1;
        const tips = extractTipsFromBlock(blockData, includeZeroTips);
        allTips.push(...tips);
        if (allTips.length >= minTxsNecessary) {
          break;
        }
      }
    }
    if (allTips.length < minTxsNecessary) {
      logger.warn(
        `Insufficient transaction data: found ${allTips.length} V3 transactions with tips in ${blocksAnalyzed} blocks (block range: ${Math.max(0, startingBlockNumber - maxBlocks + 1)}-${startingBlockNumber}). Required: ${minTxsNecessary} transactions. Consider reducing minTxsNecessary or increasing maxBlocks.`
      );
      return createZeroTipEstimate(blocksAnalyzed, allTips);
    }
    const tipStats = calculateTipStats(allTips);
    return {
      ...tipStats,
      metrics: {
        blocksAnalyzed,
        transactionsTipsFound: allTips
      }
    };
  } catch (error) {
    throw new LibraryError(
      `Failed to analyze tip statistics (sequential): ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
async function getTipStatsFromBlocks(provider2, blockIdentifier = BlockTag.LATEST, options = {}) {
  const { maxBlocks = 3, minTxsNecessary = 10 } = options;
  assert(Number.isInteger(maxBlocks), "maxBlocks parameter must be an integer");
  assert(maxBlocks >= 1, "maxBlocks parameter must be greater than or equal to 1");
  assert(maxBlocks <= 100, "maxBlocks parameter must be less than or equal to 100 for performance");
  assert(Number.isInteger(minTxsNecessary), "minTxsNecessary parameter must be an integer");
  assert(minTxsNecessary >= 1, "minTxsNecessary parameter must be greater than or equal to 1");
  if (isBatchingEnabled(provider2)) {
    return getTipStatsParallel(provider2, blockIdentifier, options);
  }
  return getTipStatsSequential(provider2, blockIdentifier, options);
}
var ReceiptTx = class _ReceiptTx {
  statusReceipt;
  value;
  constructor(receipt) {
    Object.assign(this, receipt);
    const [statusReceipt, value] = _ReceiptTx.isSuccess(receipt) ? ["SUCCEEDED", receipt] : _ReceiptTx.isReverted(receipt) ? ["REVERTED", receipt] : ["ERROR", new Error("Unknown response type")];
    Object.defineProperties(this, {
      statusReceipt: {
        value: statusReceipt,
        writable: false,
        enumerable: false,
        configurable: false
      },
      value: {
        value,
        writable: false,
        enumerable: false,
        configurable: false
      },
      match: {
        value(callbacks) {
          return statusReceipt in callbacks ? callbacks[statusReceipt](value) : callbacks._();
        },
        writable: false,
        enumerable: false,
        configurable: false
      },
      isSuccess: {
        value: () => statusReceipt === "SUCCEEDED",
        writable: false,
        enumerable: false,
        configurable: false
      },
      isReverted: {
        value: () => statusReceipt === "REVERTED",
        writable: false,
        enumerable: false,
        configurable: false
      },
      isError: {
        value: () => statusReceipt === "ERROR",
        writable: false,
        enumerable: false,
        configurable: false
      }
    });
  }
  match;
  isSuccess;
  isReverted;
  isError;
  static isSuccess(transactionReceipt) {
    return transactionReceipt.execution_status === TransactionExecutionStatus.SUCCEEDED;
  }
  static isReverted(transactionReceipt) {
    return transactionReceipt.execution_status === TransactionExecutionStatus.REVERTED;
  }
};
var RECEIPT_CONFIG = {
  [TransactionExecutionStatus.SUCCEEDED]: {
    statusReceipt: "SUCCEEDED",
    getBaseData: (receipt) => receipt,
    getValue: (receipt) => receipt
  },
  [TransactionExecutionStatus.REVERTED]: {
    statusReceipt: "REVERTED",
    getBaseData: (receipt) => receipt,
    getValue: (receipt) => receipt
  }
};
function createTransactionReceipt(receipt) {
  const config22 = RECEIPT_CONFIG[receipt.execution_status];
  let obj;
  if (config22) {
    const { statusReceipt, getBaseData, getValue } = config22;
    const value = getValue(receipt);
    obj = {
      ...getBaseData(receipt),
      statusReceipt,
      value,
      match(callbacks) {
        return statusReceipt in callbacks ? callbacks[statusReceipt](value) : callbacks._();
      },
      // @ts-ignore - docs
      isSuccess() {
        return statusReceipt === "SUCCEEDED";
      },
      // @ts-ignore - docs
      isReverted() {
        return statusReceipt === "REVERTED";
      },
      // @ts-ignore - docs
      isError() {
        return false;
      }
    };
  } else {
    const errorValue = new Error("Unknown response type");
    obj = {
      statusReceipt: "ERROR",
      value: errorValue,
      match(callbacks) {
        return "ERROR" in callbacks ? callbacks.ERROR(errorValue) : callbacks._();
      },
      // @ts-ignore - docs
      isSuccess() {
        return false;
      },
      // @ts-ignore - docs
      isReverted() {
        return false;
      },
      // @ts-ignore - docs
      isError() {
        return true;
      }
    };
  }
  Object.setPrototypeOf(obj, ReceiptTx.prototype);
  Object.defineProperty(obj, "constructor", {
    value: ReceiptTx,
    writable: false,
    enumerable: false,
    configurable: false
  });
  return obj;
}
var typedData_exports = {};
__export2(typedData_exports, {
  encodeData: () => encodeData,
  encodeType: () => encodeType,
  encodeValue: () => encodeValue,
  getDependencies: () => getDependencies,
  getMessageHash: () => getMessageHash,
  getStructHash: () => getStructHash,
  getTypeHash: () => getTypeHash,
  isMerkleTreeType: () => isMerkleTreeType,
  prepareSelector: () => prepareSelector,
  validateTypedData: () => validateTypedData,
  verifyMessage: () => verifyMessage
});
var merkle_exports = {};
__export2(merkle_exports, {
  MerkleTree: () => MerkleTree,
  proofMerklePath: () => proofMerklePath
});
var MerkleTree = class _MerkleTree {
  leaves;
  branches = [];
  root;
  hashMethod;
  /**
   * Create a Merkle tree
   *
   * @param leafHashes hex-string array
   * @param hashMethod hash method to use, default: Pedersen
   * @returns created Merkle tree
   * @example
   * ```typescript
   * const leaves = ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7'];
   * const tree = new MerkleTree(leaves);
   * // tree = {
   * //   branches: [['0x5bb9440e2...', '0x262697b88...', ...], ['0x38118a340...', ...], ...],
   * //   leaves: ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7'],
   * //   root: '0x7f748c75e5bdb7ae28013f076b8ab650c4e01d3530c6e5ab665f9f1accbe7d4',
   * //   hashMethod: [Function computePedersenHash],
   * // }
   * ```
   */
  constructor(leafHashes, hashMethod = computePedersenHash) {
    this.hashMethod = hashMethod;
    this.leaves = leafHashes;
    this.root = this.build(leafHashes);
  }
  /** @ignore */
  build(leaves) {
    if (leaves.length === 1) {
      return leaves[0];
    }
    if (leaves.length !== this.leaves.length) {
      this.branches.push(leaves);
    }
    const newLeaves = [];
    for (let i = 0; i < leaves.length; i += 2) {
      if (i + 1 === leaves.length) {
        newLeaves.push(_MerkleTree.hash(leaves[i], "0x0", this.hashMethod));
      } else {
        newLeaves.push(_MerkleTree.hash(leaves[i], leaves[i + 1], this.hashMethod));
      }
    }
    return this.build(newLeaves);
  }
  /**
   * Calculate hash from ordered a and b, Pedersen hash default
   *
   * @param a first value
   * @param b second value
   * @param hashMethod hash method to use, default: Pedersen
   * @returns result of the hash function
   * @example
   * ```typescript
   * const result1 = MerkleTree.hash('0xabc', '0xdef');
   * // result1 = '0x484f029da7914ada038b1adf67fc83632364a3ebc2cd9349b41ab61626d9e82'
   *
   * const customHashMethod = (a, b) => `custom_${a}_${b}`;
   * const result2 = MerkleTree.hash('0xabc', '0xdef', customHashMethod);
   * // result2 = 'custom_2748_3567'
   * ```
   */
  static hash(a, b, hashMethod = computePedersenHash) {
    const [aSorted, bSorted] = [BigInt(a), BigInt(b)].sort((x, y) => x >= y ? 1 : -1);
    return hashMethod(aSorted, bSorted);
  }
  /**
   * Calculates the merkle membership proof path
   *
   * @param leaf hex-string
   * @param branch hex-string array
   * @param hashPath hex-string array
   * @returns collection of merkle proof hex-string hashes
   * @example
   * ```typescript
   * const leaves = ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7'];
   * const tree = new MerkleTree(leaves);
   * const result = tree.getProof('0x3');
   * // result = [
   * //   '0x4',
   * //   '0x5bb9440e27889a364bcb678b1f679ecd1347acdedcbf36e83494f857cc58026',
   * //   '0x8c0e46dd2df9aaf3a8ebfbc25408a582ad7fa7171f0698ddbbc5130b4b4e60',
   * // ]
   * ```
   */
  getProof(leaf, branch = this.leaves, hashPath = []) {
    const index = branch.indexOf(leaf);
    if (index === -1) {
      throw new Error("leaf not found");
    }
    if (branch.length === 1) {
      return hashPath;
    }
    const isLeft = index % 2 === 0;
    const neededBranch = (isLeft ? branch[index + 1] : branch[index - 1]) ?? "0x0";
    const newHashPath = [...hashPath, neededBranch];
    const currentBranchLevelIndex = this.leaves.length === branch.length ? -1 : this.branches.findIndex((b) => b.length === branch.length);
    const nextBranch = this.branches[currentBranchLevelIndex + 1] ?? [this.root];
    return this.getProof(
      _MerkleTree.hash(isLeft ? leaf : neededBranch, isLeft ? neededBranch : leaf, this.hashMethod),
      nextBranch,
      newHashPath
    );
  }
};
function proofMerklePath(root, leaf, path, hashMethod = computePedersenHash) {
  if (path.length === 0) {
    return root === leaf;
  }
  const [next, ...rest] = path;
  return proofMerklePath(root, MerkleTree.hash(leaf, next, hashMethod), rest, hashMethod);
}
var presetTypes = {
  u256: JSON.parse('[{ "name": "low", "type": "u128" }, { "name": "high", "type": "u128" }]'),
  TokenAmount: JSON.parse(
    '[{ "name": "token_address", "type": "ContractAddress" }, { "name": "amount", "type": "u256" }]'
  ),
  NftId: JSON.parse(
    '[{ "name": "collection_address", "type": "ContractAddress" }, { "name": "token_id", "type": "u256" }]'
  )
};
var revisionConfiguration = {
  [api_exports3.TypedDataRevision.ACTIVE]: {
    domain: "StarknetDomain",
    hashMethod: computePoseidonHashOnElements,
    hashMerkleMethod: computePoseidonHash,
    escapeTypeString: (s) => `"${s}"`,
    presetTypes
  },
  [api_exports3.TypedDataRevision.LEGACY]: {
    domain: "StarkNetDomain",
    hashMethod: computePedersenHashOnElements,
    hashMerkleMethod: computePedersenHash,
    escapeTypeString: (s) => s,
    presetTypes: {}
  }
};
function assertRange(data, type, { min, max }) {
  const value = BigInt(data);
  assert(value >= min && value <= max, `${value} (${type}) is out of bounds [${min}, ${max}]`);
}
function identifyRevision({ types, domain }) {
  if (revisionConfiguration[api_exports3.TypedDataRevision.ACTIVE].domain in types && domain.revision?.toString() === api_exports3.TypedDataRevision.ACTIVE)
    return api_exports3.TypedDataRevision.ACTIVE;
  if (revisionConfiguration[api_exports3.TypedDataRevision.LEGACY].domain in types && (domain.revision ?? api_exports3.TypedDataRevision.LEGACY) === api_exports3.TypedDataRevision.LEGACY)
    return api_exports3.TypedDataRevision.LEGACY;
  return void 0;
}
function getHex(value) {
  try {
    return toHex(value);
  } catch (e) {
    if (isString(value)) {
      return toHex(encodeShortString(value));
    }
    throw new Error(`Invalid BigNumberish: ${value}`);
  }
}
function validateTypedData(data) {
  const typedData = data;
  return Boolean(
    typedData.message && typedData.primaryType && typedData.types && identifyRevision(typedData)
  );
}
function prepareSelector(selector) {
  return isHex2(selector) ? selector : getSelectorFromName(selector);
}
function isMerkleTreeType(type) {
  return type.type === "merkletree";
}
function getDependencies(types, type, dependencies = [], contains = "", revision = api_exports3.TypedDataRevision.LEGACY) {
  let dependencyTypes = [type];
  if (type[type.length - 1] === "*") {
    dependencyTypes = [type.slice(0, -1)];
  } else if (revision === api_exports3.TypedDataRevision.ACTIVE) {
    if (type === "enum") {
      dependencyTypes = [contains];
    } else if (type.match(/^\(.*\)$/)) {
      dependencyTypes = type.slice(1, -1).split(",").map((depType) => depType[depType.length - 1] === "*" ? depType.slice(0, -1) : depType);
    }
  }
  return dependencyTypes.filter((t) => !dependencies.includes(t) && types[t]).reduce(
    // This comment prevents prettier from rolling everything here into a single line.
    (p, depType) => [
      ...p,
      ...[
        depType,
        ...types[depType].reduce(
          (previous, t) => [
            ...previous,
            ...getDependencies(types, t.type, previous, t.contains, revision).filter(
              (dependency) => !previous.includes(dependency)
            )
          ],
          []
        )
      ].filter((dependency) => !p.includes(dependency))
    ],
    []
  );
}
function getMerkleTreeType(types, ctx) {
  if (ctx.parent && ctx.key) {
    const parentType = types[ctx.parent];
    const merkleType = parentType.find((t) => t.name === ctx.key);
    const isMerkleTree = isMerkleTreeType(merkleType);
    if (!isMerkleTree) {
      throw new Error(`${ctx.key} is not a merkle tree`);
    }
    if (merkleType.contains.endsWith("*")) {
      throw new Error(`Merkle tree contain property must not be an array but was given ${ctx.key}`);
    }
    return merkleType.contains;
  }
  return "raw";
}
function encodeType(types, type, revision = api_exports3.TypedDataRevision.LEGACY) {
  const allTypes = revision === api_exports3.TypedDataRevision.ACTIVE ? { ...types, ...revisionConfiguration[revision].presetTypes } : types;
  const [primary, ...dependencies] = getDependencies(
    allTypes,
    type,
    void 0,
    void 0,
    revision
  );
  const newTypes = !primary ? [] : [primary, ...dependencies.sort()];
  const esc = revisionConfiguration[revision].escapeTypeString;
  return newTypes.map((dependency) => {
    const dependencyElements = allTypes[dependency].map((t) => {
      const targetType = t.type === "enum" && revision === api_exports3.TypedDataRevision.ACTIVE ? t.contains : t.type;
      const typeString = targetType.match(/^\(.*\)$/) ? `(${targetType.slice(1, -1).split(",").map((e) => e ? esc(e) : e).join(",")})` : esc(targetType);
      return `${esc(t.name)}:${typeString}`;
    });
    return `${esc(dependency)}(${dependencyElements})`;
  }).join("");
}
function getTypeHash(types, type, revision = api_exports3.TypedDataRevision.LEGACY) {
  return getSelectorFromName(encodeType(types, type, revision));
}
function encodeValue(types, type, data, ctx = {}, revision = api_exports3.TypedDataRevision.LEGACY) {
  if (types[type]) {
    return [type, getStructHash(types, type, data, revision)];
  }
  if (revisionConfiguration[revision].presetTypes[type]) {
    return [
      type,
      getStructHash(
        revisionConfiguration[revision].presetTypes,
        type,
        data,
        revision
      )
    ];
  }
  if (type.endsWith("*")) {
    const hashes = data.map(
      (entry) => encodeValue(types, type.slice(0, -1), entry, void 0, revision)[1]
    );
    return [type, revisionConfiguration[revision].hashMethod(hashes)];
  }
  switch (type) {
    case "enum": {
      if (revision === api_exports3.TypedDataRevision.ACTIVE) {
        const [variantKey, variantData] = Object.entries(data)[0];
        const parentType = types[ctx.parent].find((t) => t.name === ctx.key);
        const enumType = types[parentType.contains];
        const variantType = enumType.find((t) => t.name === variantKey);
        const variantIndex = enumType.indexOf(variantType);
        const encodedSubtypes = variantType.type.slice(1, -1).split(",").map((subtype, index) => {
          if (!subtype) return subtype;
          const subtypeData = variantData[index];
          return encodeValue(types, subtype, subtypeData, void 0, revision)[1];
        });
        return [
          type,
          revisionConfiguration[revision].hashMethod([variantIndex, ...encodedSubtypes])
        ];
      }
      return [type, getHex(data)];
    }
    case "merkletree": {
      const merkleTreeType = getMerkleTreeType(types, ctx);
      const structHashes = data.map((struct) => {
        return encodeValue(types, merkleTreeType, struct, void 0, revision)[1];
      });
      const { root } = new MerkleTree(
        structHashes,
        revisionConfiguration[revision].hashMerkleMethod
      );
      return ["felt", root];
    }
    case "selector": {
      return ["felt", prepareSelector(data)];
    }
    case "string": {
      if (revision === api_exports3.TypedDataRevision.ACTIVE) {
        const byteArray = byteArrayFromString(data);
        const elements = [
          byteArray.data.length,
          ...byteArray.data,
          byteArray.pending_word,
          byteArray.pending_word_len
        ];
        return [type, revisionConfiguration[revision].hashMethod(elements)];
      }
      return [type, getHex(data)];
    }
    case "i128": {
      if (revision === api_exports3.TypedDataRevision.ACTIVE) {
        const value = BigInt(data);
        assertRange(value, type, RANGE_I128);
        return [type, getHex(value < 0n ? PRIME + value : value)];
      }
      return [type, getHex(data)];
    }
    case "timestamp":
    case "u128": {
      if (revision === api_exports3.TypedDataRevision.ACTIVE) {
        assertRange(data, type, RANGE_U128);
      }
      return [type, getHex(data)];
    }
    case "felt":
    case "shortstring": {
      if (revision === api_exports3.TypedDataRevision.ACTIVE) {
        assertRange(getHex(data), type, RANGE_FELT);
      }
      return [type, getHex(data)];
    }
    case "ClassHash":
    case "ContractAddress": {
      if (revision === api_exports3.TypedDataRevision.ACTIVE) {
        assertRange(data, type, RANGE_FELT);
      }
      return [type, getHex(data)];
    }
    case "bool": {
      if (revision === api_exports3.TypedDataRevision.ACTIVE) {
        assert(isBoolean(data), `Type mismatch for ${type} ${data}`);
      }
      return [type, getHex(data)];
    }
    default: {
      if (revision === api_exports3.TypedDataRevision.ACTIVE) {
        throw new Error(`Unsupported type: ${type}`);
      }
      return [type, getHex(data)];
    }
  }
}
function encodeData(types, type, data, revision = api_exports3.TypedDataRevision.LEGACY) {
  const targetType = types[type] ?? revisionConfiguration[revision].presetTypes[type];
  const [returnTypes, values] = targetType.reduce(
    ([ts, vs], field) => {
      if (data[field.name] === void 0 || data[field.name] === null && field.type !== "enum") {
        throw new Error(`Cannot encode data: missing data for '${field.name}'`);
      }
      const value = data[field.name];
      const ctx = { parent: type, key: field.name };
      const [t, encodedValue] = encodeValue(types, field.type, value, ctx, revision);
      return [
        [...ts, t],
        [...vs, encodedValue]
      ];
    },
    [["felt"], [getTypeHash(types, type, revision)]]
  );
  return [returnTypes, values];
}
function getStructHash(types, type, data, revision = api_exports3.TypedDataRevision.LEGACY) {
  return revisionConfiguration[revision].hashMethod(encodeData(types, type, data, revision)[1]);
}
function getMessageHash(typedData, accountAddress) {
  if (!validateTypedData(typedData)) {
    throw new Error("Typed data does not match JSON schema");
  }
  const revision = identifyRevision(typedData);
  const { domain, hashMethod } = revisionConfiguration[revision];
  const message = [
    encodeShortString("StarkNet Message"),
    getStructHash(typedData.types, domain, typedData.domain, revision),
    accountAddress,
    getStructHash(typedData.types, typedData.primaryType, typedData.message, revision)
  ];
  return hashMethod(message);
}
function verifyMessage(message, signature, fullPublicKey, accountAddress) {
  const isTypedData = validateTypedData(message);
  if (!isBigNumberish(message) && !isTypedData) {
    throw new Error("message has a wrong format.");
  }
  if (isTypedData && accountAddress === void 0) {
    throw new Error(
      "When providing a TypedData in message parameter, the accountAddress parameter has to be provided."
    );
  }
  if (isTypedData && !isBigNumberish(accountAddress)) {
    throw new Error("accountAddress shall be a BigNumberish");
  }
  const messageHash = isTypedData ? getMessageHash(message, accountAddress) : toHex(message);
  const sign2 = Array.isArray(signature) ? new Signature(BigInt(signature[0]), BigInt(signature[1])) : signature;
  const fullPubKey = toHex(fullPublicKey);
  const isValid = verify(sign2, messageHash, fullPubKey);
  return isValid;
}
async function verifyMessageInStarknet(provider2, message, signature, accountAddress, signatureVerificationFunctionName, signatureVerificationResponse) {
  const isTypedData = validateTypedData(message);
  if (!isBigNumberish(message) && !isTypedData) {
    throw new Error("message has a wrong format.");
  }
  if (!isBigNumberish(accountAddress)) {
    throw new Error("accountAddress shall be a BigNumberish");
  }
  const messageHash = isTypedData ? getMessageHash(message, accountAddress) : toHex(message);
  const knownSigVerificationFName = signatureVerificationFunctionName ? [signatureVerificationFunctionName] : ["isValidSignature", "is_valid_signature"];
  const knownSignatureResponse = signatureVerificationResponse || {
    okResponse: [
      // any non-nok response is true
    ],
    nokResponse: [
      "0x0",
      // Devnet
      "0x00"
      // OpenZeppelin 0.7.0 to 0.9.0 invalid signature
    ],
    error: [
      "argent/invalid-signature",
      "0x617267656e742f696e76616c69642d7369676e6174757265",
      // ArgentX 0.3.0 to 0.3.1
      "is invalid, with respect to the public key",
      "0x697320696e76616c6964",
      // OpenZeppelin until 0.6.1, Braavos 0.0.11
      "INVALID_SIG",
      "0x494e56414c49445f534947"
      // Braavos 1.0.0
    ]
  };
  let error;
  for (const SigVerificationFName of knownSigVerificationFName) {
    try {
      const resp = await provider2.callContract({
        contractAddress: toHex(accountAddress),
        entrypoint: SigVerificationFName,
        calldata: CallData.compile({
          hash: toBigInt(messageHash).toString(),
          signature: formatSignature(signature)
        })
      });
      if (knownSignatureResponse.nokResponse.includes(resp[0].toString())) {
        return false;
      }
      if (knownSignatureResponse.okResponse.length === 0 || knownSignatureResponse.okResponse.includes(resp[0].toString())) {
        return true;
      }
      throw Error("signatureVerificationResponse Error: response is not part of known responses");
    } catch (err) {
      if (knownSignatureResponse.error.some(
        (errMessage) => err.message.includes(errMessage)
      )) {
        return false;
      }
      error = err;
    }
  }
  throw Error(`Signature verification Error: ${error}`);
}
async function getGasPrices(channel, blockIdentifier = channel.blockIdentifier) {
  const bl = await channel.getBlockWithTxHashes(blockIdentifier);
  return {
    l1DataGasPrice: BigInt(bl.l1_data_gas_price.price_in_fri),
    l1GasPrice: BigInt(bl.l1_gas_price.price_in_fri),
    l2GasPrice: BigInt(bl.l2_gas_price.price_in_fri)
  };
}
var PluginManager = class {
  registeredPlugins = /* @__PURE__ */ new Map();
  providerHooksList = [];
  accountHooksList = [];
  get plugins() {
    return this.registeredPlugins;
  }
  /**
   * Install a plugin on a Provider instance.
   * Calls `plugin.extend()` and assigns returned methods to the target.
   * Registers provider-level hooks.
   */
  installOnProvider(plugin, target) {
    if (this.registeredPlugins.has(plugin.name)) {
      return;
    }
    this.registeredPlugins.set(plugin.name, plugin);
    if (plugin.extend) {
      const methods = plugin.extend(target);
      if (methods) {
        Object.assign(target, methods);
      }
    }
    if (plugin.hooks) {
      this.providerHooksList.push(plugin.hooks);
    }
  }
  /**
   * Install a plugin on an Account instance.
   * Calls `plugin.accountExtend()` if available, otherwise falls back to `plugin.extend()`.
   * Registers both provider-level and account-level hooks.
   */
  installOnAccount(plugin, target) {
    if (this.registeredPlugins.has(plugin.name)) {
      return;
    }
    this.registeredPlugins.set(plugin.name, plugin);
    const extendFn = plugin.accountExtend ?? plugin.extend;
    if (extendFn) {
      const methods = extendFn(target);
      if (methods) {
        Object.assign(target, methods);
      }
    }
    if (plugin.hooks) {
      this.providerHooksList.push(plugin.hooks);
    }
    if (plugin.accountHooks) {
      this.accountHooksList.push(plugin.accountHooks);
    }
  }
  /**
   * Run a provider-level hook across all registered plugins.
   * Hooks are chained: each hook can modify the context for the next.
   */
  runProviderHook(hookName, context) {
    let current = context;
    this.providerHooksList.forEach((hooks) => {
      const hookFn = hooks[hookName];
      if (hookFn) {
        const result = hookFn(current);
        if (result !== void 0 && result !== null) {
          current = result;
        }
      }
    });
    return current;
  }
  /**
   * Run an account-level hook across all registered plugins.
   * "before" hooks are chained; "after" hooks are fire-and-forget.
   */
  runAccountHook(hookName, context) {
    let current = context;
    this.accountHooksList.forEach((hooks) => {
      const hookFn = hooks[hookName];
      if (hookFn) {
        const result = hookFn(current);
        if (result !== void 0 && result !== null) {
          current = result;
        }
      }
    });
    return current;
  }
  hasPlugin(name) {
    return this.registeredPlugins.has(name);
  }
};
var starknetId_exports = {};
__export2(starknetId_exports, {
  StarknetIdContract: () => StarknetIdContract,
  StarknetIdIdentityContract: () => StarknetIdIdentityContract,
  StarknetIdMulticallContract: () => StarknetIdMulticallContract,
  StarknetIdPfpContract: () => StarknetIdPfpContract,
  StarknetIdPopContract: () => StarknetIdPopContract,
  StarknetIdVerifierContract: () => StarknetIdVerifierContract,
  dynamicCallData: () => dynamicCallData,
  dynamicFelt: () => dynamicFelt,
  execution: () => execution,
  getStarknetIdContract: () => getStarknetIdContract,
  getStarknetIdIdentityContract: () => getStarknetIdIdentityContract,
  getStarknetIdMulticallContract: () => getStarknetIdMulticallContract,
  getStarknetIdPfpContract: () => getStarknetIdPfpContract,
  getStarknetIdPopContract: () => getStarknetIdPopContract,
  getStarknetIdVerifierContract: () => getStarknetIdVerifierContract,
  isStarkDomain: () => isStarkDomain,
  useDecoded: () => useDecoded,
  useEncoded: () => useEncoded
});
var basicAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789-";
var basicSizePlusOne = BigInt(basicAlphabet.length + 1);
var bigAlphabet = "\u8FD9\u6765";
var basicAlphabetSize = BigInt(basicAlphabet.length);
var bigAlphabetSize = BigInt(bigAlphabet.length);
var bigAlphabetSizePlusOne = BigInt(bigAlphabet.length + 1);
function extractStars(str) {
  let k = 0;
  while (str.endsWith(bigAlphabet[bigAlphabet.length - 1])) {
    str = str.substring(0, str.length - 1);
    k += 1;
  }
  return [str, k];
}
function useDecoded(encoded) {
  let decoded = "";
  encoded.forEach((subdomain) => {
    while (subdomain !== ZERO) {
      const code = subdomain % basicSizePlusOne;
      subdomain /= basicSizePlusOne;
      if (code === BigInt(basicAlphabet.length)) {
        const nextSubdomain = subdomain / bigAlphabetSizePlusOne;
        if (nextSubdomain === ZERO) {
          const code2 = subdomain % bigAlphabetSizePlusOne;
          subdomain = nextSubdomain;
          if (code2 === ZERO) decoded += basicAlphabet[0];
          else decoded += bigAlphabet[Number(code2) - 1];
        } else {
          const code2 = subdomain % bigAlphabetSize;
          decoded += bigAlphabet[Number(code2)];
          subdomain /= bigAlphabetSize;
        }
      } else decoded += basicAlphabet[Number(code)];
    }
    const [str, k] = extractStars(decoded);
    if (k)
      decoded = str + (k % 2 === 0 ? bigAlphabet[bigAlphabet.length - 1].repeat(k / 2 - 1) + bigAlphabet[0] + basicAlphabet[1] : bigAlphabet[bigAlphabet.length - 1].repeat((k - 1) / 2 + 1));
    decoded += ".";
  });
  if (!decoded) {
    return decoded;
  }
  return decoded.concat("stark");
}
function useEncoded(decoded) {
  let encoded = BigInt(0);
  let multiplier = BigInt(1);
  if (decoded.endsWith(bigAlphabet[0] + basicAlphabet[1])) {
    const [str, k] = extractStars(decoded.substring(0, decoded.length - 2));
    decoded = str + bigAlphabet[bigAlphabet.length - 1].repeat(2 * (k + 1));
  } else {
    const [str, k] = extractStars(decoded);
    if (k) decoded = str + bigAlphabet[bigAlphabet.length - 1].repeat(1 + 2 * (k - 1));
  }
  for (let i = 0; i < decoded.length; i += 1) {
    const char = decoded[i];
    const index = basicAlphabet.indexOf(char);
    const bnIndex = BigInt(basicAlphabet.indexOf(char));
    if (index !== -1) {
      if (i === decoded.length - 1 && decoded[i] === basicAlphabet[0]) {
        encoded += multiplier * basicAlphabetSize;
        multiplier *= basicSizePlusOne;
        multiplier *= basicSizePlusOne;
      } else {
        encoded += multiplier * bnIndex;
        multiplier *= basicSizePlusOne;
      }
    } else if (bigAlphabet.indexOf(char) !== -1) {
      encoded += multiplier * basicAlphabetSize;
      multiplier *= basicSizePlusOne;
      const newid = (i === decoded.length - 1 ? 1 : 0) + bigAlphabet.indexOf(char);
      encoded += multiplier * BigInt(newid);
      multiplier *= bigAlphabetSize;
    }
  }
  return encoded;
}
var StarknetIdContract = {
  MAINNET: "0x6ac597f8116f886fa1c97a23fa4e08299975ecaf6b598873ca6792b9bbfb678",
  TESTNET_SEPOLIA: "0x154bc2e1af9260b9e66af0e9c46fc757ff893b3ff6a85718a810baf1474"
};
function getStarknetIdContract(chainId) {
  switch (chainId) {
    case _StarknetChainId.SN_MAIN:
      return StarknetIdContract.MAINNET;
    case _StarknetChainId.SN_SEPOLIA:
      return StarknetIdContract.TESTNET_SEPOLIA;
    default:
      throw new Error("Starknet.id is not yet deployed on this network");
  }
}
var StarknetIdIdentityContract = {
  MAINNET: "0x05dbdedc203e92749e2e746e2d40a768d966bd243df04a6b712e222bc040a9af",
  TESTNET_SEPOLIA: "0x3697660a0981d734780731949ecb2b4a38d6a58fc41629ed611e8defda"
};
function getStarknetIdIdentityContract(chainId) {
  switch (chainId) {
    case _StarknetChainId.SN_MAIN:
      return StarknetIdIdentityContract.MAINNET;
    case _StarknetChainId.SN_SEPOLIA:
      return StarknetIdIdentityContract.TESTNET_SEPOLIA;
    default:
      throw new Error("Starknet.id verifier contract is not yet deployed on this network");
  }
}
var StarknetIdMulticallContract = "0x034ffb8f4452df7a613a0210824d6414dbadcddce6c6e19bf4ddc9e22ce5f970";
function getStarknetIdMulticallContract(chainId) {
  switch (chainId) {
    case _StarknetChainId.SN_MAIN:
      return StarknetIdMulticallContract;
    case _StarknetChainId.SN_SEPOLIA:
      return StarknetIdMulticallContract;
    default:
      throw new Error("Starknet.id multicall contract is not yet deployed on this network");
  }
}
var StarknetIdVerifierContract = {
  MAINNET: "0x07d14dfd8ee95b41fce179170d88ba1f0d5a512e13aeb232f19cfeec0a88f8bf",
  TESTNET_SEPOLIA: "0x60B94fEDe525f815AE5E8377A463e121C787cCCf3a36358Aa9B18c12c4D566"
};
function getStarknetIdVerifierContract(chainId) {
  switch (chainId) {
    case _StarknetChainId.SN_MAIN:
      return StarknetIdVerifierContract.MAINNET;
    case _StarknetChainId.SN_SEPOLIA:
      return StarknetIdVerifierContract.TESTNET_SEPOLIA;
    default:
      throw new Error("Starknet.id verifier contract is not yet deployed on this network");
  }
}
var StarknetIdPfpContract = {
  MAINNET: "0x070aaa20ec4a46da57c932d9fd89ca5e6bb9ca3188d3df361a32306aff7d59c7",
  TESTNET_SEPOLIA: "0x9e7bdb8dabd02ea8cfc23b1d1c5278e46490f193f87516ed5ff2dfec02"
};
function getStarknetIdPfpContract(chainId) {
  switch (chainId) {
    case _StarknetChainId.SN_MAIN:
      return StarknetIdPfpContract.MAINNET;
    case _StarknetChainId.SN_SEPOLIA:
      return StarknetIdPfpContract.TESTNET_SEPOLIA;
    default:
      throw new Error(
        "Starknet.id profile picture verifier contract is not yet deployed on this network"
      );
  }
}
var StarknetIdPopContract = {
  MAINNET: "0x0293eb2ba9862f762bd3036586d5755a782bd22e6f5028320f1d0405fd47bff4",
  TESTNET_SEPOLIA: "0x15ae88ae054caa74090b89025c1595683f12edf7a4ed2ad0274de3e1d4a"
};
function getStarknetIdPopContract(chainId) {
  switch (chainId) {
    case _StarknetChainId.SN_MAIN:
      return StarknetIdPopContract.MAINNET;
    case _StarknetChainId.SN_SEPOLIA:
      return StarknetIdPopContract.TESTNET_SEPOLIA;
    default:
      throw new Error(
        "Starknet.id proof of personhood verifier contract is not yet deployed on this network"
      );
  }
}
function execution(staticEx, ifEqual = void 0, ifNotEqual = void 0) {
  return new CairoCustomEnum({
    Static: staticEx,
    IfEqual: ifEqual ? tuple(ifEqual[0], ifEqual[1], ifEqual[2]) : void 0,
    IfNotEqual: ifNotEqual ? tuple(ifNotEqual[0], ifNotEqual[1], ifNotEqual[2]) : void 0
  });
}
function dynamicFelt(hardcoded, reference = void 0) {
  return new CairoCustomEnum({
    Hardcoded: hardcoded,
    Reference: reference ? tuple(reference[0], reference[1]) : void 0
  });
}
function dynamicCallData(hardcoded, reference = void 0, arrayReference = void 0) {
  return new CairoCustomEnum({
    Hardcoded: hardcoded,
    Reference: reference ? tuple(reference[0], reference[1]) : void 0,
    ArrayReference: arrayReference ? tuple(arrayReference[0], arrayReference[1]) : void 0
  });
}
function isStarkDomain(domain) {
  const starkSuffix = ".stark";
  if (!domain.endsWith(starkSuffix)) {
    return false;
  }
  const name = domain.slice(0, -starkSuffix.length);
  if (name.length === 0) {
    return false;
  }
  return name.split(".").every((label) => {
    return label.length > 0 && label.length <= 48 && [...label].every((char) => {
      return char >= "a" && char <= "z" || char >= "0" && char <= "9" || char === "-";
    });
  });
}
var StarknetIdImpl = class {
  static async getStarkName(provider2, address, StarknetIdContract2) {
    const chainId = await provider2.getChainId();
    const contract = StarknetIdContract2 ?? getStarknetIdContract(chainId);
    try {
      const hexDomain = await provider2.callContract({
        contractAddress: contract,
        entrypoint: "address_to_domain",
        calldata: CallData.compile({
          address,
          hint: []
        })
      });
      const decimalDomain = hexDomain.map((element) => BigInt(element)).slice(1);
      const stringDomain = useDecoded(decimalDomain);
      if (!stringDomain) {
        throw Error("Starkname not found");
      }
      return stringDomain;
    } catch (e) {
      if (e instanceof Error && e.message === "Starkname not found") {
        throw e;
      }
      throw Error("Could not get stark name");
    }
  }
  static async getAddressFromStarkName(provider2, name, StarknetIdContract2) {
    const starkName = name.endsWith(".stark") ? name : `${name}.stark`;
    if (!isStarkDomain(starkName)) {
      throw new Error("Invalid domain, must be a valid .stark domain");
    }
    const chainId = await provider2.getChainId();
    const contract = StarknetIdContract2 ?? getStarknetIdContract(chainId);
    try {
      const encodedDomain = starkName.replace(".stark", "").split(".").map((part) => useEncoded(part).toString(10));
      const addressData = await provider2.callContract({
        contractAddress: contract,
        entrypoint: "domain_to_address",
        calldata: CallData.compile({ domain: encodedDomain, hint: [] })
      });
      return addressData[0];
    } catch {
      throw Error("Could not get address from stark name");
    }
  }
  static async getStarkProfile(provider2, address, StarknetIdContract2, StarknetIdIdentityContract2, StarknetIdVerifierContract2, StarknetIdPfpContract2, StarknetIdPopContract2, StarknetIdMulticallContract2) {
    const chainId = await provider2.getChainId();
    const contract = StarknetIdContract2 ?? getStarknetIdContract(chainId);
    const identityContract = StarknetIdIdentityContract2 ?? getStarknetIdIdentityContract(chainId);
    const verifierContract = StarknetIdVerifierContract2 ?? getStarknetIdVerifierContract(chainId);
    const pfpContract = StarknetIdPfpContract2 ?? getStarknetIdPfpContract(chainId);
    const popContract = StarknetIdPopContract2 ?? getStarknetIdPopContract(chainId);
    const multicallAddress = StarknetIdMulticallContract2 ?? getStarknetIdMulticallContract(chainId);
    try {
      const calls = [
        {
          execution: execution({}),
          to: dynamicCallData(contract),
          selector: dynamicCallData(getSelectorFromName("address_to_domain")),
          calldata: [dynamicCallData(address), dynamicCallData("0")]
        },
        {
          execution: execution({}),
          to: dynamicFelt(contract),
          selector: dynamicFelt(getSelectorFromName("domain_to_id")),
          calldata: [dynamicCallData(void 0, void 0, [0, 0])]
        },
        {
          execution: execution({}),
          to: dynamicFelt(identityContract),
          selector: dynamicFelt(getSelectorFromName("get_verifier_data")),
          calldata: [
            dynamicCallData(void 0, [1, 0]),
            dynamicCallData(encodeShortString("twitter")),
            dynamicCallData(verifierContract),
            dynamicCallData("0")
          ]
        },
        {
          execution: execution({}),
          to: dynamicFelt(identityContract),
          selector: dynamicFelt(getSelectorFromName("get_verifier_data")),
          calldata: [
            dynamicCallData(void 0, [1, 0]),
            dynamicCallData(encodeShortString("github")),
            dynamicCallData(verifierContract),
            dynamicCallData("0")
          ]
        },
        {
          execution: execution({}),
          to: dynamicFelt(identityContract),
          selector: dynamicFelt(getSelectorFromName("get_verifier_data")),
          calldata: [
            dynamicCallData(void 0, [1, 0]),
            dynamicCallData(encodeShortString("discord")),
            dynamicCallData(verifierContract),
            dynamicCallData("0")
          ]
        },
        {
          execution: execution({}),
          to: dynamicFelt(identityContract),
          selector: dynamicFelt(getSelectorFromName("get_verifier_data")),
          calldata: [
            dynamicCallData(void 0, [1, 0]),
            dynamicCallData(encodeShortString("proof_of_personhood")),
            dynamicCallData(popContract),
            dynamicCallData("0")
          ]
        },
        // PFP
        {
          execution: execution({}),
          to: dynamicFelt(identityContract),
          selector: dynamicFelt(getSelectorFromName("get_verifier_data")),
          calldata: [
            dynamicCallData(void 0, [1, 0]),
            dynamicCallData(encodeShortString("nft_pp_contract")),
            dynamicCallData(pfpContract),
            dynamicCallData("0")
          ]
        },
        {
          execution: execution({}),
          to: dynamicFelt(identityContract),
          selector: dynamicFelt(getSelectorFromName("get_extended_verifier_data")),
          calldata: [
            dynamicCallData(void 0, [1, 0]),
            dynamicCallData(encodeShortString("nft_pp_id")),
            dynamicCallData("2"),
            dynamicCallData(pfpContract),
            dynamicCallData("0")
          ]
        },
        {
          execution: execution(void 0, void 0, [6, 0, 0]),
          to: dynamicFelt(void 0, [6, 0]),
          selector: dynamicFelt(getSelectorFromName("tokenURI")),
          calldata: [dynamicCallData(void 0, [7, 1]), dynamicCallData(void 0, [7, 2])]
        }
      ];
      const data = await provider2.callContract({
        contractAddress: multicallAddress,
        entrypoint: "aggregate",
        calldata: CallData.compile({
          calls
        })
      });
      if (Array.isArray(data)) {
        const size = parseInt(data[0], 16);
        const finalArray = [];
        let index = 1;
        for (let i = 0; i < size; i += 1) {
          if (index < data.length) {
            const subArraySize = parseInt(data[index], 16);
            index += 1;
            const subArray = data.slice(index, index + subArraySize);
            finalArray.push(subArray);
            index += subArraySize;
          } else {
            break;
          }
        }
        const name = useDecoded(finalArray[0].slice(1).map((hexString) => BigInt(hexString)));
        const twitter = finalArray[2][0] !== "0x0" ? BigInt(finalArray[2][0]).toString() : void 0;
        const github = finalArray[3][0] !== "0x0" ? BigInt(finalArray[3][0]).toString() : void 0;
        const discord = finalArray[4][0] !== "0x0" ? BigInt(finalArray[4][0]).toString() : void 0;
        const proofOfPersonhood = finalArray[5][0] === "0x1";
        const profilePictureMetadata = data[0] === "0x9" ? finalArray[8].slice(1).map((val) => decodeShortString(val)).join("") : void 0;
        const profilePicture = profilePictureMetadata || `https://starknet.id/api/identicons/${BigInt(finalArray[1][0]).toString()}`;
        return {
          name,
          twitter,
          github,
          discord,
          proofOfPersonhood,
          profilePicture
        };
      }
      throw Error("Error while calling aggregate function");
    } catch (e) {
      if (e instanceof Error) {
        throw e;
      }
      throw Error("Could not get user stark profile data from address");
    }
  }
};
function starknetId() {
  return {
    name: "starknet-id",
    extend(provider2) {
      return {
        getStarkName: (address, contract) => StarknetIdImpl.getStarkName(provider2, address, contract),
        getAddressFromStarkName: (name, contract) => StarknetIdImpl.getAddressFromStarkName(provider2, name, contract),
        getStarkProfile: (address, contract, identityContract, verifierContract, pfpContract, popContract, multicallContract) => StarknetIdImpl.getStarkProfile(
          provider2,
          address,
          contract,
          identityContract,
          verifierContract,
          pfpContract,
          popContract,
          multicallContract
        )
      };
    },
    accountExtend(account2) {
      return {
        getStarkName: (address, contract) => StarknetIdImpl.getStarkName(account2.provider, address ?? account2.address, contract),
        getAddressFromStarkName: (name, contract) => StarknetIdImpl.getAddressFromStarkName(account2.provider, name, contract),
        getStarkProfile: (address, contract, identityContract, verifierContract, pfpContract, popContract, multicallContract) => StarknetIdImpl.getStarkProfile(
          account2.provider,
          address,
          contract,
          identityContract,
          verifierContract,
          pfpContract,
          popContract,
          multicallContract
        )
      };
    }
  };
}
function isBrotherDomain(domain) {
  return domain.endsWith(".brother");
}
function encodeBrotherDomain(domain) {
  const brotherName = domain.endsWith(".brother") ? domain.replace(".brother", "") : domain;
  return useEncoded(brotherName);
}
function decodeBrotherDomain(encoded) {
  const decoded = useDecoded([encoded]);
  if (decoded.endsWith(".stark")) {
    return decoded.replace(".stark", ".brother");
  }
  return decoded ? `${decoded}.brother` : decoded;
}
function getBrotherIdContract(chainId) {
  switch (chainId) {
    case _StarknetChainId.SN_MAIN:
      return "0x0212f1c57700f5a3913dd11efba540196aad4cf67772f7090c62709dd804fa74";
    default:
      return "0x0212f1c57700f5a3913dd11efba540196aad4cf67772f7090c62709dd804fa74";
  }
}
var BrotherIdImpl = class {
  static async getBrotherName(provider2, address, BrotherIdContract) {
    const chainId = await provider2.getChainId();
    const contract = BrotherIdContract ?? getBrotherIdContract(chainId);
    try {
      const primaryDomain = await provider2.callContract({
        contractAddress: contract,
        entrypoint: "getPrimary",
        calldata: CallData.compile({
          user: address
        })
      });
      if (!primaryDomain[0] || primaryDomain[0] === "0x0") {
        throw Error("Brother name not found");
      }
      const encodedDomain = BigInt(primaryDomain[0]);
      return decodeBrotherDomain(encodedDomain);
    } catch (e) {
      if (e instanceof Error && e.message === "Brother name not found") {
        throw e;
      }
      throw Error("Could not get brother name");
    }
  }
  static async getAddressFromBrotherName(provider2, name, BrotherIdContract) {
    const brotherName = name.endsWith(".brother") ? name : `${name}.brother`;
    if (!isBrotherDomain(brotherName)) {
      throw new Error("Invalid domain, must be a valid .brother domain");
    }
    const chainId = await provider2.getChainId();
    const contract = BrotherIdContract ?? getBrotherIdContract(chainId);
    try {
      const domainDetails = await provider2.callContract({
        contractAddress: contract,
        entrypoint: "get_details_by_domain",
        calldata: CallData.compile({
          domain: encodeBrotherDomain(brotherName)
        })
      });
      if (!domainDetails[0] || domainDetails[1] === "0x0") {
        throw Error("Could not get address from brother name");
      }
      return domainDetails[1];
    } catch {
      throw Error("Could not get address from brother name");
    }
  }
  static async getBrotherProfile(provider2, address, BrotherIdContract) {
    const chainId = await provider2.getChainId();
    const contract = BrotherIdContract ?? getBrotherIdContract(chainId);
    try {
      const primaryDomain = await provider2.callContract({
        contractAddress: contract,
        entrypoint: "getPrimary",
        calldata: CallData.compile({
          user: address
        })
      });
      if (!primaryDomain[0] || primaryDomain[0] === "0x0") {
        throw Error("Brother profile not found");
      }
      const encodedDomain = BigInt(primaryDomain[0]);
      const decodedDomain = decodeBrotherDomain(encodedDomain);
      const domain = decodedDomain.replace(".brother", "");
      const domainDetails = await provider2.callContract({
        contractAddress: contract,
        entrypoint: "get_details_by_domain",
        calldata: CallData.compile({
          domain: encodeBrotherDomain(domain)
        })
      });
      return {
        name: domain,
        resolver: domainDetails[1],
        tokenId: domainDetails[2],
        expiryDate: parseInt(domainDetails[3], 16),
        lastTransferTime: parseInt(domainDetails[4], 16)
      };
    } catch (e) {
      if (e instanceof Error && e.message === "Brother profile not found") {
        throw e;
      }
      throw Error("Could not get brother profile");
    }
  }
};
function brotherId() {
  return {
    name: "brother-id",
    extend(provider2) {
      return {
        getBrotherName: (address, contract) => BrotherIdImpl.getBrotherName(provider2, address, contract),
        getAddressFromBrotherName: (name, contract) => BrotherIdImpl.getAddressFromBrotherName(provider2, name, contract),
        getBrotherProfile: (address, contract) => BrotherIdImpl.getBrotherProfile(provider2, address, contract)
      };
    }
  };
}
var FastExecuteImpl = class _FastExecuteImpl {
  /**
   * Wait for transaction with polling-optimized confirmation
   * Only available on RPC 0.9+, requires PRE_CONFIRMED block identifier
   */
  static async fastWaitForTransaction(provider2, txHash, address, initNonceBN, options) {
    const initNonce = BigInt(initNonceBN);
    let retries = options?.retries ?? 50;
    const retryInterval = options?.retryInterval ?? 500;
    const errorStates = ["REVERTED"];
    const successStates = ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1", "PRE_CONFIRMED"];
    const start = (/* @__PURE__ */ new Date()).getTime();
    while (retries > 0) {
      await wait(retryInterval);
      const txStatus = await provider2.getTransactionStatus(txHash);
      logger.info(
        `fastWaitForTransaction: ${retries} retries left, status: ${JSON.stringify(txStatus)}, elapsed: ${((/* @__PURE__ */ new Date()).getTime() - start) / 1e3}s.`
      );
      const executionStatus = txStatus.execution_status ?? "";
      const finalityStatus = txStatus.finality_status;
      if (errorStates.includes(executionStatus)) {
        const message = `${executionStatus}: ${finalityStatus}`;
        const error = new Error(message);
        error.response = txStatus;
        throw error;
      } else if (successStates.includes(finalityStatus)) {
        let currentNonce = initNonce;
        while (currentNonce === initNonce && retries > 0) {
          currentNonce = BigInt(await provider2.getNonceForAddress(address, BlockTag.PRE_CONFIRMED));
          logger.info(
            `fastWaitForTransaction: checking new nonce ${currentNonce}, initial was ${initNonce}, elapsed: ${((/* @__PURE__ */ new Date()).getTime() - start) / 1e3}s.`
          );
          if (currentNonce !== initNonce) {
            return true;
          }
          await wait(retryInterval);
          retries -= 1;
        }
        return false;
      }
      retries -= 1;
    }
    return false;
  }
  /**
   * Execute transaction with fast confirmation waiting
   * Combines execute() with optimized polling for next transaction
   */
  static async fastExecute(account2, transactions, transactionsDetail = {}, waitDetail = {}) {
    const { channel } = account2.provider;
    assert(
      channel.blockIdentifier === BlockTag.PRE_CONFIRMED,
      "Provider needs to be initialized with `pre_confirmed` blockIdentifier option."
    );
    const initNonce = BigInt(
      transactionsDetail.nonce ?? await account2.provider.getNonceForAddress(account2.address, BlockTag.PRE_CONFIRMED)
    );
    const details = { ...transactionsDetail, nonce: initNonce };
    const resultTx = await account2.execute(transactions, details);
    const isReady = await _FastExecuteImpl.fastWaitForTransaction(
      account2.provider,
      resultTx.transaction_hash,
      account2.address,
      initNonce,
      waitDetail
    );
    return { txResult: resultTx, isReady };
  }
};
function fastExecute() {
  return {
    name: "fast-execute",
    extend(provider2) {
      return {
        fastWaitForTransaction: (txHash, address, initNonce, options) => FastExecuteImpl.fastWaitForTransaction(provider2, txHash, address, initNonce, options)
      };
    },
    accountExtend(account2) {
      return {
        fastExecute: (transactions, details, waitDetail) => FastExecuteImpl.fastExecute(account2, transactions, details, waitDetail)
      };
    }
  };
}
var defaultPlugins = [
  starknetId(),
  brotherId(),
  fastExecute()
];
var RpcProvider = class {
  responseParser;
  channel;
  /** @internal Plugin management infrastructure */
  pluginManager;
  constructor(optionsOrProvider) {
    this.pluginManager = new PluginManager();
    if (optionsOrProvider && "channel" in optionsOrProvider) {
      this.channel = optionsOrProvider.channel;
      this.responseParser = "responseParser" in optionsOrProvider ? optionsOrProvider.responseParser : new RPCResponseParser();
      if ("pluginManager" in optionsOrProvider) {
        const sourceManager = optionsOrProvider.pluginManager;
        Array.from(sourceManager.plugins.values()).forEach((plugin) => {
          this.pluginManager.installOnProvider(plugin, this);
        });
      }
    } else {
      const options = optionsOrProvider;
      if (options && options.specVersion) {
        if (isVersion("0.9", options.specVersion)) {
          this.channel = new rpc_0_9_0_exports.RpcChannel({ ...options, waitMode: false });
        } else if (isVersion("0.10", options.specVersion)) {
          this.channel = new rpc_0_10_3_exports.RpcChannel({ ...options, waitMode: false });
        } else throw new Error(`unsupported channel for spec version: ${options.specVersion}`);
      } else if (isVersion("0.9", config2.get("rpcVersion"))) {
        this.channel = new rpc_0_9_0_exports.RpcChannel({ ...options, waitMode: false });
      } else if (isVersion("0.10", config2.get("rpcVersion"))) {
        this.channel = new rpc_0_10_3_exports.RpcChannel({ ...options, waitMode: false });
      } else throw new Error("unable to define spec version for channel");
      this.responseParser = new RPCResponseParser(options?.resourceBoundsOverhead);
      const plugins = options?.plugins === false ? [] : options?.plugins ?? defaultPlugins;
      plugins.forEach((plugin) => {
        this.pluginManager.installOnProvider(plugin, this);
      });
    }
  }
  /**
   * auto configure channel based on provided node
   * leave space for other async before constructor
   */
  // NOTE: the generic T and 'this' reference are used so that the expanded class is generated when a mixin is applied
  static async create(optionsOrProvider) {
    const channel = new rpc_0_9_0_exports.RpcChannel({ ...optionsOrProvider });
    const spec = await channel.getSpecVersion();
    if (!isSupportedSpecVersion(spec)) {
      logger.warn(`Using incompatible node spec version ${spec}`);
    }
    if (isVersion("0.9", spec)) {
      return new this({
        ...optionsOrProvider,
        specVersion: _SupportedRpcVersion.v0_9_0
      });
    }
    if (isVersion("0.10", spec)) {
      return new this({
        ...optionsOrProvider,
        specVersion: _SupportedRpcVersion.v0_10_3
      });
    }
    throw new LibraryError(
      `Provided RPC node specification version ${spec} is not compatible with the SDK. SDK supported RPC versions ${Object.keys(_SupportedRpcVersion).toString()}`
    );
  }
  /**
   * Install a plugin at runtime. Returns the instance typed with plugin methods.
   *
   * @example
   * ```typescript
   * const provider = new RpcProvider({ nodeUrl: '...' })
   *   .use(myPlugin());
   * provider.myMethod(); // typed
   * ```
   */
  use(plugin) {
    this.pluginManager.installOnProvider(plugin, this);
    return this;
  }
  async fetch(method, params, id = 0) {
    const hookResult = this.pluginManager.runProviderHook("beforeRequest", { method, params });
    const finalMethod = hookResult?.method ?? method;
    const finalParams = hookResult?.params ?? params;
    const result = await this.channel.fetch(finalMethod, finalParams, id);
    const afterResult = this.pluginManager.runProviderHook("afterRequest", {
      method: finalMethod,
      params: finalParams,
      result
    });
    return afterResult ?? result;
  }
  async getChainId() {
    return this.channel.getChainId();
  }
  readSpecVersion() {
    return this.channel.readSpecVersion();
  }
  async getSpecVersion() {
    return this.channel.getSpecVersion();
  }
  setUpSpecVersion() {
    return this.channel.setUpSpecVersion();
  }
  async getStarknetVersion(blockIdentifier) {
    return this.channel.getStarknetVersion(blockIdentifier);
  }
  async getNonceForAddress(contractAddress, blockIdentifier) {
    return this.channel.getNonceForAddress(contractAddress, blockIdentifier);
  }
  async getBlock(blockIdentifier) {
    return this.channel.getBlockWithTxHashes(blockIdentifier).then(this.responseParser.parseGetBlockResponse);
  }
  async getBlockLatestAccepted() {
    return this.channel.getBlockLatestAccepted();
  }
  async getBlockNumber() {
    return this.channel.getBlockNumber();
  }
  async getBlockWithTxHashes(blockIdentifier) {
    return this.channel.getBlockWithTxHashes(blockIdentifier);
  }
  async getBlockWithTxs(blockIdentifier, options) {
    if (this.channel instanceof rpc_0_10_2_exports.RpcChannel) {
      return this.channel.getBlockWithTxs(blockIdentifier, options);
    }
    return this.channel.getBlockWithTxs(blockIdentifier);
  }
  async waitForBlock(blockIdentifier = BlockTag.LATEST, retryInterval = 5e3) {
    if (blockIdentifier === BlockTag.LATEST) return;
    const currentBlock = await this.getBlockNumber();
    const targetBlock = blockIdentifier === BlockTag.PRE_CONFIRMED ? currentBlock + 1 : Number(toHex(blockIdentifier));
    if (targetBlock <= currentBlock) return;
    const { retries } = this.channel;
    let retriesCount = retries;
    let isTargetBlock = false;
    while (!isTargetBlock) {
      const currBlock = await this.getBlockNumber();
      if (currBlock >= targetBlock) {
        isTargetBlock = true;
      } else {
        await wait(retryInterval);
      }
      retriesCount -= 1;
      if (retriesCount <= 0) {
        throw new Error(`waitForBlock() timed-out after ${retries} tries.`);
      }
    }
  }
  async getL1GasPrice(blockIdentifier) {
    return this.channel.getBlockWithTxHashes(blockIdentifier).then(this.responseParser.parseL1GasPriceResponse);
  }
  /**
   * Get the gas prices related to a block.
   * @param {BlockIdentifier} [blockIdentifier = this.identifier]
   * @returns {Promise<GasPrices>} an object with l1DataGasPrice, l1GasPrice, l2GasPrice properties (all bigint type).
   * @example
   * ```ts
   * const result = await myProvider.getGasPrices();
   * // result = { l1DataGasPrice: 3039n, l1GasPrice: 55590341542890n, l2GasPrice: 8441845008n }
   * ```
   */
  async getGasPrices(blockIdentifier = this.channel.blockIdentifier) {
    return getGasPrices(this.channel, blockIdentifier);
  }
  async getL1MessageHash(l2TxHash) {
    const transaction = await this.channel.getTransactionByHash(l2TxHash);
    assert(transaction.type === "L1_HANDLER", "This L2 transaction is not a L1 message.");
    const { calldata, contract_address, entry_point_selector, nonce } = transaction;
    const params = [
      calldata[0],
      contract_address,
      nonce,
      entry_point_selector,
      calldata.length - 1,
      ...calldata.slice(1)
    ];
    return solidityUint256PackedKeccak256(params);
  }
  async getBlockWithReceipts(blockIdentifier, options) {
    if (this.channel instanceof rpc_0_10_2_exports.RpcChannel) {
      return this.channel.getBlockWithReceipts(blockIdentifier, options);
    }
    return this.channel.getBlockWithReceipts(blockIdentifier);
  }
  getStateUpdate = this.getBlockStateUpdate;
  async getBlockStateUpdate(blockIdentifier, contractAddresses) {
    return this.channel.getBlockStateUpdate(blockIdentifier, contractAddresses);
  }
  async getBlockTransactionsTraces(blockIdentifier, options) {
    if (this.channel instanceof rpc_0_10_2_exports.RpcChannel) {
      return this.channel.getBlockTransactionsTraces(blockIdentifier, options);
    }
    return this.channel.getBlockTransactionsTraces(blockIdentifier);
  }
  async getBlockTransactionCount(blockIdentifier) {
    return this.channel.getBlockTransactionCount(blockIdentifier);
  }
  async getTransaction(txHash, options) {
    return this.getTransactionByHash(txHash, options);
  }
  async getTransactionByHash(txHash, options) {
    if (this.channel instanceof rpc_0_10_2_exports.RpcChannel) {
      return this.channel.getTransactionByHash(txHash, options);
    }
    return this.channel.getTransactionByHash(txHash);
  }
  async getTransactionByBlockIdAndIndex(blockIdentifier, index, options) {
    if (this.channel instanceof rpc_0_10_2_exports.RpcChannel) {
      return this.channel.getTransactionByBlockIdAndIndex(blockIdentifier, index, options);
    }
    return this.channel.getTransactionByBlockIdAndIndex(blockIdentifier, index);
  }
  async getTransactionReceipt(txHash) {
    const txReceiptWoHelper = await this.channel.getTransactionReceipt(txHash);
    const txReceiptWoHelperModified = this.responseParser.parseTransactionReceipt(txReceiptWoHelper);
    return createTransactionReceipt(txReceiptWoHelperModified);
  }
  async getTransactionTrace(txHash) {
    return this.channel.getTransactionTrace(txHash);
  }
  async getTransactionStatus(transactionHash) {
    return this.channel.getTransactionStatus(transactionHash);
  }
  async getSimulateTransaction(invocations, options) {
    return this.channel.simulateTransaction(invocations, options).then((r) => this.responseParser.parseSimulateTransactionResponse(r));
  }
  async waitForTransaction(txHash, options) {
    const receiptWoHelper = await this.channel.waitForTransaction(
      txHash,
      options
    );
    return createTransactionReceipt(receiptWoHelper);
  }
  async getStorageAt(contractAddress, key, blockIdentifier, responseFlags) {
    const result = await this.channel.getStorageAt(
      contractAddress,
      key,
      blockIdentifier,
      responseFlags
    );
    return this.responseParser.parseStorageResponse(result);
  }
  async getClassHashAt(contractAddress, blockIdentifier) {
    return this.channel.getClassHashAt(contractAddress, blockIdentifier);
  }
  async getClassByHash(classHash) {
    return this.getClass(classHash);
  }
  async getClass(classHash, blockIdentifier) {
    return this.channel.getClass(classHash, blockIdentifier).then(this.responseParser.parseContractClassResponse);
  }
  async getClassAt(contractAddress, blockIdentifier) {
    return this.channel.getClassAt(contractAddress, blockIdentifier).then(this.responseParser.parseContractClassResponse);
  }
  async getContractVersion(contractAddress, classHash, {
    blockIdentifier = this.channel.blockIdentifier,
    compiler = true
  } = {}) {
    let contractClass;
    if (contractAddress) {
      contractClass = await this.getClassAt(contractAddress, blockIdentifier);
    } else if (classHash) {
      contractClass = await this.getClass(classHash, blockIdentifier);
    } else {
      throw Error("getContractVersion require contractAddress or classHash");
    }
    if (isSierra(contractClass)) {
      if (compiler) {
        const abiTest = getAbiContractVersion(contractClass.abi);
        return { cairo: "1", compiler: abiTest.compiler };
      }
      return { cairo: "1", compiler: void 0 };
    }
    return { cairo: "0", compiler: "0" };
  }
  async getInvokeEstimateFee(invocation, details, blockIdentifier, skipValidate) {
    return (await this.getEstimateFeeBulk(
      [{ type: api_exports3.ETransactionType.INVOKE, ...invocation, ...details }],
      { blockIdentifier, skipValidate }
    ))[0];
  }
  async getDeclareEstimateFee(invocation, details, blockIdentifier, skipValidate) {
    return (await this.getEstimateFeeBulk(
      [{ type: api_exports3.ETransactionType.DECLARE, ...invocation, ...details }],
      { blockIdentifier, skipValidate }
    ))[0];
  }
  async getDeployAccountEstimateFee(invocation, details, blockIdentifier, skipValidate) {
    return (await this.getEstimateFeeBulk(
      [{ type: api_exports3.ETransactionType.DEPLOY_ACCOUNT, ...invocation, ...details }],
      { blockIdentifier, skipValidate }
    ))[0];
  }
  async getEstimateFeeBulk(invocations, options) {
    return this.channel.getEstimateFee(invocations, options).then((r) => this.responseParser.parseFeeEstimateBulkResponse(r));
  }
  async invokeFunction(functionInvocation, details) {
    return this.channel.invoke(functionInvocation, details);
  }
  /**
   * Submit a pre-signed INVOKE_TXN_V3 transaction to the network.
   *
   * Broadcasts a transaction previously built and signed by `Account.getSignedTransaction()`.
   * Fees are already included in the signed transaction and will not be re-estimated.
   *
   * @param transaction - A fully signed `RPC.INVOKE_TXN_V3` object, as returned by `Account.getSignedTransaction()`
   *
   * @returns The transaction hash if `waitMode` is disabled (default), or the transaction receipt if `waitMode` is enabled.
   *
   * @remarks
   * - The transaction must be signed before calling this method ; use `Account.getSignedTransaction()` to produce it.
   * - Resubmitting the same signed transaction (same nonce) will be rejected by the network.
   * - If `waitMode` is enabled on the provider, this method waits for the transaction to be included in a block before returning.
   *
   * @example
   * ```typescript
   * const signedTx = await account.getSignedTransaction([
   *   { contractAddress: erc20Address, entrypoint: 'transfer', calldata: [recipient, amount, 0] }
   * ]);
   * // inspect or store signedTx, then submit when ready:
   * const { transaction_hash } = await provider.invokeSignedTx(signedTx);
   * await provider.waitForTransaction(transaction_hash);
   * ```
   */
  async invokeSignedTx(transaction) {
    return this.channel.invokeSignedTx(transaction);
  }
  async declareContract(transaction, details) {
    return this.channel.declare(transaction, details);
  }
  async deployAccountContract(transaction, details) {
    return this.channel.deployAccount(transaction, details);
  }
  async callContract(call, blockIdentifier) {
    return this.channel.callContract(call, blockIdentifier);
  }
  async estimateMessageFee(message, blockIdentifier) {
    return this.channel.estimateMessageFee(message, blockIdentifier);
  }
  async getSyncingStats() {
    return this.channel.getSyncingStats();
  }
  async getEvents(eventFilter) {
    if (this.channel instanceof rpc_0_10_2_exports.RpcChannel) {
      return this.channel.getEvents(eventFilter);
    }
    if (this.channel instanceof rpc_0_9_0_exports.RpcChannel) {
      return this.channel.getEvents(eventFilter);
    }
    throw new Error("Unsupported channel type");
  }
  async verifyMessageInStarknet(message, signature, accountAddress, signatureVerificationFunctionName, signatureVerificationResponse) {
    return verifyMessageInStarknet(
      this,
      message,
      signature,
      accountAddress,
      signatureVerificationFunctionName,
      signatureVerificationResponse
    );
  }
  async isClassDeclared(contractClassIdentifier, blockIdentifier) {
    let classHash;
    if (!contractClassIdentifier.classHash && "contract" in contractClassIdentifier) {
      const hashes = extractContractHashes(
        contractClassIdentifier,
        await this.channel.getStarknetVersion()
      );
      classHash = hashes.classHash;
    } else if (contractClassIdentifier.classHash) {
      classHash = contractClassIdentifier.classHash;
    } else {
      throw Error("contractClassIdentifier type not satisfied");
    }
    try {
      const result = await this.getClass(classHash, blockIdentifier);
      return result instanceof Object;
    } catch (error) {
      if (error instanceof LibraryError) {
        return false;
      }
      throw error;
    }
  }
  async prepareInvocations(invocations) {
    const bulk = [];
    for (const invocation of invocations) {
      if (invocation.type === api_exports3.ETransactionType.DECLARE) {
        const isDeclared = await this.isClassDeclared(
          "payload" in invocation ? invocation.payload : invocation
        );
        if (!isDeclared) {
          bulk.unshift(invocation);
        }
      } else {
        bulk.push(invocation);
      }
    }
    return bulk;
  }
  async getL1MessagesStatus(transactionHash) {
    return this.channel.getMessagesStatus(transactionHash);
  }
  async getStorageProof(classHashes, contractAddresses, contractsStorageKeys, blockIdentifier) {
    return this.channel.getStorageProof(
      classHashes,
      contractAddresses,
      contractsStorageKeys,
      blockIdentifier
    );
  }
  async getCompiledCasm(classHash) {
    return this.channel.getCompiledCasm(classHash);
  }
  async getEstimateTip(blockIdentifier, options = {}) {
    return getTipStatsFromBlocks(this, blockIdentifier, options);
  }
};
var Signer = class {
  pk;
  constructor(pk = utils.randomPrivateKey()) {
    this.pk = pk instanceof Uint8Array ? buf2hex(pk) : toHex(pk);
  }
  async getPubKey() {
    return getStarkKey(this.pk);
  }
  async signMessage(typedData, accountAddress) {
    const msgHash = getMessageHash(typedData, accountAddress);
    return this.signRaw(msgHash);
  }
  async signTransaction(transactions, details) {
    const compiledCalldata = getExecuteCalldata(transactions, details.cairoVersion);
    let msgHash;
    if (Object.values(api_exports3.ETransactionVersion3).includes(details.version)) {
      const det = details;
      msgHash = calculateInvokeTransactionHash2({
        ...det,
        senderAddress: det.walletAddress,
        compiledCalldata,
        version: det.version,
        nonceDataAvailabilityMode: intDAM(det.nonceDataAvailabilityMode),
        feeDataAvailabilityMode: intDAM(det.feeDataAvailabilityMode)
      });
    } else {
      throw Error("unsupported signTransaction version");
    }
    return this.signRaw(msgHash);
  }
  async signDeployAccountTransaction(details) {
    const compiledConstructorCalldata = CallData.compile(details.constructorCalldata);
    let msgHash;
    if (Object.values(api_exports3.ETransactionVersion3).includes(details.version)) {
      const det = details;
      msgHash = calculateDeployAccountTransactionHash3({
        ...det,
        salt: det.addressSalt,
        compiledConstructorCalldata,
        version: det.version,
        nonceDataAvailabilityMode: intDAM(det.nonceDataAvailabilityMode),
        feeDataAvailabilityMode: intDAM(det.feeDataAvailabilityMode)
      });
    } else {
      throw Error("unsupported signDeployAccountTransaction version");
    }
    return this.signRaw(msgHash);
  }
  async signDeclareTransaction(details) {
    let msgHash;
    if (Object.values(api_exports3.ETransactionVersion3).includes(details.version)) {
      const det = details;
      msgHash = calculateDeclareTransactionHash3({
        ...det,
        version: det.version,
        nonceDataAvailabilityMode: intDAM(det.nonceDataAvailabilityMode),
        feeDataAvailabilityMode: intDAM(det.feeDataAvailabilityMode)
      });
    } else {
      throw Error("unsupported signDeclareTransaction version");
    }
    return this.signRaw(msgHash);
  }
  async signRaw(msgHash) {
    return sign(msgHash, this.pk);
  }
};
var uint256_exports = {};
__export2(uint256_exports, {
  bnToUint256: () => bnToUint256,
  isUint256: () => isUint256,
  uint256ToBN: () => uint256ToBN
});
function uint256ToBN(uint2562) {
  return new CairoUint256(uint2562).toBigInt();
}
function isUint256(bn) {
  return CairoUint256.is(bn);
}
function bnToUint256(bn) {
  return new CairoUint256(bn).toUint256HexString();
}
var outsideExecution_exports = {};
__export2(outsideExecution_exports, {
  buildExecuteFromOutsideCall: () => buildExecuteFromOutsideCall,
  buildExecuteFromOutsideCallData: () => buildExecuteFromOutsideCallData,
  getOutsideCall: () => getOutsideCall,
  getTypedData: () => getTypedData,
  toOutsideCallV2: () => toOutsideCallV2
});
function toOutsideCallV2(call) {
  if ("calldata_len" in call) {
    return {
      To: call.to,
      Selector: call.selector,
      Calldata: call.calldata
    };
  }
  return call;
}
function getOutsideCall(call) {
  const callData = call.calldata ?? [];
  const callDataCompiled = Array.isArray(callData) ? callData : CallData.compile(callData);
  return {
    to: call.contractAddress,
    selector: getSelectorFromName(call.entrypoint),
    calldata: callDataCompiled
  };
}
function callToTypedData(call, version) {
  const outsideCall = getOutsideCall(call);
  if (version === "1") {
    return {
      ...outsideCall,
      calldata_len: outsideCall.calldata.length,
      calldata: outsideCall.calldata
    };
  }
  return {
    To: outsideCall.to,
    Selector: outsideCall.selector,
    Calldata: outsideCall.calldata
  };
}
function getDomain(chainId, version) {
  return {
    name: "Account.execute_from_outside",
    version,
    chainId,
    ...version === "2" ? { revision: "1" } : {}
  };
}
function getTypedData(chainId, options, nonce, myCalls, version) {
  if (version === "1") {
    return {
      types: OutsideExecutionTypesV1,
      primaryType: "OutsideExecution",
      domain: getDomain(chainId, version),
      message: {
        ...options,
        nonce,
        calls_len: myCalls.length,
        calls: myCalls.map((call) => callToTypedData(call, version))
      }
    };
  }
  return {
    types: OutsideExecutionTypesV2,
    primaryType: "OutsideExecution",
    domain: getDomain(chainId, version),
    message: {
      Caller: options.caller,
      Nonce: nonce,
      "Execute After": options.execute_after,
      "Execute Before": options.execute_before,
      Calls: myCalls.map((call) => callToTypedData(call, version))
    }
  };
}
function buildExecuteFromOutsideCallData(outsideTransaction) {
  const execution2 = outsideTransaction.outsideExecution;
  const formattedSignature = formatSignature(outsideTransaction.signature);
  return CallData.compile({
    outside_execution: execution2,
    signature: formattedSignature
  });
}
function buildExecuteFromOutsideCall(outsideTransaction) {
  const myOutsideTransactions = Array.isArray(outsideTransaction) ? outsideTransaction : [outsideTransaction];
  const multiCall = myOutsideTransactions.map((outsideTx) => {
    let entrypoint;
    if (outsideTx.version === OutsideExecutionVersion.V1) {
      entrypoint = "execute_from_outside";
    } else if (outsideTx.version === OutsideExecutionVersion.V2) {
      entrypoint = "execute_from_outside_v2";
    } else {
      throw new Error("Unsupported OutsideExecution version");
    }
    return {
      contractAddress: toHex(outsideTx.signerAddress),
      entrypoint,
      calldata: buildExecuteFromOutsideCallData(outsideTx)
    };
  });
  return multiCall;
}
var src5_exports = {};
__export2(src5_exports, {
  supportsInterface: () => supportsInterface
});
async function supportsInterface(provider2, contractAddress, interfaceId) {
  const call = {
    contractAddress: toHex(contractAddress),
    entrypoint: "supports_interface",
    calldata: [toHex(interfaceId)]
  };
  try {
    const resp = await provider2.callContract(call);
    return BigInt(resp[0]) !== 0n;
  } catch {
    return false;
  }
}
var paymaster_exports = {};
__export2(paymaster_exports, {
  assertCallsAreStrictlyEqual: () => assertCallsAreStrictlyEqual,
  assertPaymasterTransactionSafety: () => assertPaymasterTransactionSafety,
  getDefaultPaymasterNodeUrl: () => getDefaultPaymasterNodeUrl
});
var getDefaultPaymasterNodeUrl = (networkName, mute = false) => {
  if (!mute) {
    logger.info("Using default public node url, please provide nodeUrl in provider options!");
  }
  const nodes = PAYMASTER_RPC_NODES[networkName ?? _NetworkName.SN_SEPOLIA];
  const randIdx = Math.floor(Math.random() * nodes.length);
  return nodes[randIdx];
};
var assertGasFeeFromUnsafeCalls = (unsafeCalls, fees) => {
  const unsafeCall = toOutsideCallV2(unsafeCalls[unsafeCalls.length - 1]);
  const unsafeGasTokenCalldata = CallData.toCalldata(unsafeCall.Calldata);
  const unsafeGasTokenValue = unsafeGasTokenCalldata[1];
  assert(
    BigInt(unsafeGasTokenValue) === BigInt(fees),
    "Gas token value is not equal to the provided gas fees"
  );
};
var assertGasTokenFromUnsafeCalls = (unsafeCalls, gasToken) => {
  const unsafeCall = toOutsideCallV2(unsafeCalls[unsafeCalls.length - 1]);
  assert(
    BigInt(unsafeCall.To) === BigInt(gasToken),
    "Gas token address is not equal to the provided gas token"
  );
};
function assertCallsAreStrictlyEqual(originalCalls, unsafeCalls) {
  const baseError = "Provided calls are not strictly equal to the returned calls";
  assert(
    unsafeCalls.length - 1 === originalCalls.length,
    `${baseError}: Expected ${originalCalls.length + 1} calls, got ${unsafeCalls.length}`
  );
  for (let callIndex = 0; callIndex < originalCalls.length; callIndex += 1) {
    const originalCall = originalCalls[callIndex];
    const unsafeCall = toOutsideCallV2(unsafeCalls[callIndex]);
    const normalizeAddress = (address) => {
      return toBigInt(address).toString(16).toLowerCase();
    };
    const originalAddress = normalizeAddress(originalCall.contractAddress);
    const unsafeAddress = normalizeAddress(unsafeCall.To);
    assert(
      originalAddress === unsafeAddress,
      `${baseError}: Contract address mismatch at call ${callIndex}. Expected: ${originalCall.contractAddress}, Got: ${unsafeCall.To}`
    );
    assert(
      getSelectorFromName(originalCall.entrypoint) === unsafeCall.Selector,
      `${baseError}: Entrypoint mismatch at call ${callIndex}. Expected: ${originalCall.entrypoint}, Got: ${unsafeCall.Selector}`
    );
    const originalCalldata = CallData.toCalldata(originalCall.calldata);
    const unsafeCalldata = CallData.toCalldata(unsafeCall.Calldata);
    assert(
      originalCalldata.length === unsafeCalldata.length,
      `${baseError}: Calldata length mismatch at call ${callIndex}. Expected length: ${originalCalldata.length}, Got length: ${unsafeCalldata.length}`
    );
    for (let dataIndex = 0; dataIndex < originalCalldata.length; dataIndex += 1) {
      const originalValue = BigInt(originalCalldata[dataIndex]);
      const unsafeValue = BigInt(unsafeCalldata[dataIndex]);
      assert(
        originalValue === unsafeValue,
        `${baseError}: Calldata value mismatch at call ${callIndex}, parameter ${dataIndex}. Expected: ${originalCalldata[dataIndex]}, Got: ${unsafeCalldata[dataIndex]}`
      );
    }
  }
}
var assertPaymasterTransactionSafety = (preparedTransaction, calls, paymasterDetails, maxFeeInGasToken) => {
  if (paymasterDetails.feeMode.mode !== "sponsored") {
    if (preparedTransaction.type === "invoke" || preparedTransaction.type === "deploy_and_invoke") {
      const unsafeCalls = "calls" in preparedTransaction.typed_data.message ? preparedTransaction.typed_data.message.calls : preparedTransaction.typed_data.message.Calls;
      assertCallsAreStrictlyEqual(calls, unsafeCalls);
      assertGasTokenFromUnsafeCalls(unsafeCalls, paymasterDetails.feeMode.gasToken);
      if (maxFeeInGasToken) {
        assert(
          preparedTransaction.fee.suggested_max_fee_in_gas_token <= maxFeeInGasToken,
          "Gas token price is too high"
        );
        assertGasFeeFromUnsafeCalls(
          unsafeCalls,
          preparedTransaction.fee.suggested_max_fee_in_gas_token
        );
      }
    }
  }
};
var convertCalls = (calls) => calls.map((call) => ({
  to: call.contractAddress,
  selector: getSelectorFromName(call.entrypoint),
  calldata: CallData.toHex(call.calldata)
}));
var convertFeeMode = (feeMode) => {
  if (feeMode.mode === "sponsored") {
    return { mode: "sponsored" };
  }
  return { mode: "default", gas_token: feeMode.gasToken };
};
var convertFEE_MODE = (feeMode) => {
  if (feeMode.mode === "sponsored") {
    return { mode: "sponsored" };
  }
  return { mode: "default", gasToken: feeMode.gas_token };
};
var convertTimeBounds = (timeBounds) => timeBounds ? {
  execute_after: timeBounds.executeAfter || 1,
  // If executeAfter is not provided, set it to 1, meaning the transaction can be executed immediately
  execute_before: timeBounds.executeBefore
} : void 0;
var convertTIME_BOUNDS = (timeBounds) => timeBounds ? {
  executeAfter: timeBounds.execute_after,
  executeBefore: timeBounds.execute_before
} : void 0;
var convertEXECUTION_PARAMETERS = (parameters) => ({
  version: parameters.version,
  feeMode: convertFEE_MODE(parameters.fee_mode),
  timeBounds: convertTIME_BOUNDS(parameters.time_bounds)
});
var defaultOptions = {
  headers: { "Content-Type": "application/json" }
};
var PaymasterRpc = class _PaymasterRpc {
  nodeUrl;
  headers;
  baseFetch;
  requestId;
  constructor(options) {
    if (options instanceof _PaymasterRpc) {
      this.nodeUrl = options.nodeUrl;
      this.headers = { ...defaultOptions.headers, ...options.headers };
      this.baseFetch = options.baseFetch;
      this.requestId = options.requestId;
      return;
    }
    if (options && "nodeUrl" in options && "headers" in options && "baseFetch" in options) {
      this.nodeUrl = options.nodeUrl ?? getDefaultPaymasterNodeUrl(void 0);
      this.headers = { ...defaultOptions.headers, ...options.headers };
      this.baseFetch = options.baseFetch ?? fetch_default;
      this.requestId = 0;
      return;
    }
    const { nodeUrl, headers, baseFetch } = options || {};
    if (nodeUrl && Object.values(_NetworkName).includes(nodeUrl)) {
      this.nodeUrl = getDefaultPaymasterNodeUrl(nodeUrl, options?.mute);
    } else if (nodeUrl) {
      this.nodeUrl = nodeUrl;
    } else {
      this.nodeUrl = getDefaultPaymasterNodeUrl(void 0, options?.mute);
    }
    this.baseFetch = baseFetch ?? fetch_default;
    this.headers = { ...defaultOptions.headers, ...headers };
    this.requestId = 0;
  }
  fetch(method, params, id = 0) {
    const rpcRequestBody = {
      id,
      jsonrpc: "2.0",
      method,
      ...params && { params }
    };
    return this.baseFetch(this.nodeUrl, {
      method: "POST",
      body: stringify2(rpcRequestBody),
      headers: this.headers
    });
  }
  errorHandler(method, params, rpcError, otherError) {
    if (rpcError) {
      throw new RpcError(rpcError, method, params);
    }
    if (otherError instanceof LibraryError) {
      throw otherError;
    }
    if (otherError) {
      throw Error(otherError.message);
    }
  }
  async fetchEndpoint(method, params) {
    try {
      this.requestId += 1;
      const rawResult = await this.fetch(method, params, this.requestId);
      const { error, result } = await rawResult.json();
      this.errorHandler(method, params, error);
      return result;
    } catch (error) {
      this.errorHandler(method, params, error?.response?.data, error);
      throw error;
    }
  }
  async isAvailable() {
    return this.fetchEndpoint("paymaster_isAvailable");
  }
  async buildTransaction(transaction, parameters) {
    let userTransaction;
    switch (transaction.type) {
      case "invoke":
        userTransaction = {
          ...transaction,
          invoke: {
            user_address: transaction.invoke.userAddress,
            calls: convertCalls(transaction.invoke.calls)
          }
        };
        break;
      case "deploy_and_invoke":
        userTransaction = {
          ...transaction,
          invoke: {
            user_address: transaction.invoke.userAddress,
            calls: convertCalls(transaction.invoke.calls)
          }
        };
        break;
      case "deploy":
      default:
        userTransaction = transaction;
        break;
    }
    const executionParameters = {
      version: parameters.version,
      fee_mode: convertFeeMode(parameters.feeMode),
      time_bounds: convertTimeBounds(parameters.timeBounds)
    };
    const response = await this.fetchEndpoint("paymaster_buildTransaction", {
      transaction: userTransaction,
      parameters: executionParameters
    });
    const fee = {
      gas_token_price_in_strk: BigInt(response.fee.gas_token_price_in_strk),
      estimated_fee_in_strk: BigInt(response.fee.estimated_fee_in_strk),
      estimated_fee_in_gas_token: BigInt(response.fee.estimated_fee_in_gas_token),
      suggested_max_fee_in_strk: BigInt(response.fee.suggested_max_fee_in_strk),
      suggested_max_fee_in_gas_token: BigInt(response.fee.suggested_max_fee_in_gas_token)
    };
    switch (response.type) {
      case "invoke":
        return {
          type: "invoke",
          typed_data: response.typed_data,
          parameters: convertEXECUTION_PARAMETERS(response.parameters),
          fee
        };
      case "deploy_and_invoke":
        return {
          type: "deploy_and_invoke",
          deployment: response.deployment,
          typed_data: response.typed_data,
          parameters: convertEXECUTION_PARAMETERS(response.parameters),
          fee
        };
      case "deploy":
      default:
        return {
          type: "deploy",
          deployment: response.deployment,
          parameters: convertEXECUTION_PARAMETERS(response.parameters),
          fee
        };
    }
  }
  async executeTransaction(transaction, parameters) {
    let user_transaction;
    switch (transaction.type) {
      case "invoke":
        user_transaction = {
          ...transaction,
          invoke: {
            user_address: transaction.invoke.userAddress,
            typed_data: transaction.invoke.typedData,
            signature: signatureToHexArray(transaction.invoke.signature)
          }
        };
        break;
      case "deploy_and_invoke":
        user_transaction = {
          ...transaction,
          invoke: {
            user_address: transaction.invoke.userAddress,
            typed_data: transaction.invoke.typedData,
            signature: signatureToHexArray(transaction.invoke.signature)
          }
        };
        break;
      case "deploy":
      default:
        user_transaction = transaction;
        break;
    }
    const executionParameters = {
      version: parameters.version,
      fee_mode: convertFeeMode(parameters.feeMode),
      time_bounds: convertTimeBounds(parameters.timeBounds)
    };
    return this.fetchEndpoint("paymaster_executeTransaction", {
      transaction: user_transaction,
      parameters: executionParameters
    });
  }
  async getSupportedTokens() {
    return this.fetchEndpoint("paymaster_getSupportedTokens").then(
      (tokens) => tokens.map((token) => ({
        token_address: token.token_address,
        decimals: token.decimals,
        priceInStrk: BigInt(token.price_in_strk)
      }))
    );
  }
};
var Deployer = class {
  address;
  entryPoint;
  constructor(address, entryPoint) {
    this.address = address ?? UDC.ADDRESS;
    this.entryPoint = entryPoint ?? UDC.ENTRYPOINT;
  }
  buildDeployerCall(payload, address) {
    const params = [].concat(payload).map((it) => {
      const {
        classHash,
        salt,
        unique = true,
        // not_from_zero on v.2.0.0 but same function. When false v.1 address != v.2 address
        constructorCalldata = [],
        abi
      } = it;
      const compiledConstructorCallData = getCompiledCalldata(constructorCalldata, () => {
        if (abi) {
          const calldataClass = new CallData(abi);
          const rawArgs = Object.values(constructorCalldata);
          calldataClass.validate(ValidateType.DEPLOY, "constructor", rawArgs);
          return calldataClass.compile("constructor", rawArgs);
        }
        return CallData.compile(constructorCalldata);
      });
      const deploySalt = salt ?? randomAddress();
      return {
        call: {
          contractAddress: toHex(this.address),
          entrypoint: this.entryPoint,
          calldata: [
            classHash,
            deploySalt,
            toCairoBool(unique),
            compiledConstructorCallData.length,
            ...compiledConstructorCallData
          ]
        },
        address: calculateContractAddressFromHash(
          unique ? pedersen(address, deploySalt) : deploySalt,
          classHash,
          compiledConstructorCallData,
          unique ? this.address : 0
        )
      };
    });
    return {
      calls: params.map((it) => it.call),
      addresses: params.map((it) => it.address)
    };
  }
  parseDeployerEvent(txReceipt) {
    if (!txReceipt.events?.length) {
      throw new Error("Deployer emitted event is empty");
    }
    const event = txReceipt.events.find(
      (it) => toHex(it.from_address) === toHex(this.address)
    ) || {
      data: []
    };
    return {
      transaction_hash: txReceipt.transaction_hash,
      contract_address: event.data[0],
      address: event.data[0],
      deployer: event.data[1],
      unique: event.data[2],
      classHash: event.data[3],
      calldata_len: event.data[4],
      calldata: event.data.slice(5, 5 + parseInt(event.data[4], 16)),
      salt: event.data[event.data.length - 1]
    };
  }
};
var defaultDeployer = new Deployer(UDC.ADDRESS, UDC.ENTRYPOINT);
var legacyDeployer = new Deployer(LegacyUDC.ADDRESS, LegacyUDC.ENTRYPOINT);
var Account = class {
  provider;
  signer;
  address;
  cairoVersion;
  transactionVersion;
  paymaster;
  deployer;
  defaultTipType;
  /** @internal Account-level plugin management */
  accountPluginManager;
  constructor(options) {
    const {
      provider: provider2,
      address,
      signer,
      cairoVersion,
      transactionVersion,
      paymaster,
      defaultTipType
    } = options;
    this.provider = provider2 instanceof RpcProvider ? provider2 : new RpcProvider(provider2);
    this.address = address.toLowerCase();
    this.signer = isString(signer) || signer instanceof Uint8Array ? new Signer(signer) : signer;
    if (cairoVersion) {
      this.cairoVersion = cairoVersion.toString();
    }
    this.transactionVersion = transactionVersion ?? config2.get("transactionVersion");
    this.paymaster = paymaster ? new PaymasterRpc(paymaster) : new PaymasterRpc({ mute: true });
    this.deployer = options.deployer ?? defaultDeployer;
    this.defaultTipType = defaultTipType ?? config2.get("defaultTipType");
    this.accountPluginManager = new PluginManager();
    const plugins = options.plugins === false ? [] : options.plugins ?? defaultPlugins;
    plugins.forEach((plugin) => {
      this.accountPluginManager.installOnAccount(plugin, this);
    });
    logger.debug("Account setup", {
      transactionVersion: this.transactionVersion,
      cairoVersion: this.cairoVersion,
      channel: this.provider.channel.id
    });
  }
  async getNonce(blockIdentifier) {
    return this.provider.getNonceForAddress(this.address, blockIdentifier);
  }
  async getNonceSafe(nonce) {
    try {
      return toBigInt(nonce ?? await this.getNonce());
    } catch (error) {
      return 0n;
    }
  }
  /**
   * Retrieves the Cairo version from the network and sets `cairoVersion` if not already set in the constructor.
   * @param classHash if provided detects Cairo version from classHash, otherwise from the account address
   */
  async getCairoVersion(classHash) {
    if (!this.cairoVersion) {
      const { cairo } = classHash ? await this.provider.getContractVersion(void 0, classHash) : await this.provider.getContractVersion(this.address);
      this.cairoVersion = cairo;
    }
    return this.cairoVersion;
  }
  // TODO: TT Cairo version is still needed for invoke on existing contracts
  async estimateInvokeFee(calls, details = {}) {
    const invocations = [{ type: api_exports3.ETransactionType.INVOKE, payload: [calls].flat() }];
    const estimateBulk = await this.estimateFeeBulk(invocations, details);
    return estimateBulk[0];
  }
  async estimateDeclareFee(payload, details = {}) {
    assert(
      isSierra(payload.contract),
      "Declare fee estimation is not supported for Cairo0 contracts"
    );
    const invocations = [
      {
        type: api_exports3.ETransactionType.DECLARE,
        payload: extractContractHashes(payload, await this.provider.channel.getStarknetVersion())
      }
    ];
    const estimateBulk = await this.estimateFeeBulk(invocations, details);
    return estimateBulk[0];
  }
  async estimateAccountDeployFee({
    classHash,
    addressSalt = 0,
    constructorCalldata = [],
    contractAddress
  }, details = {}) {
    const compiledCalldata = CallData.compile(constructorCalldata);
    const contractAddressFinal = contractAddress ?? calculateContractAddressFromHash(addressSalt, classHash, compiledCalldata, 0);
    const invocations = [
      {
        type: api_exports3.ETransactionType.DEPLOY_ACCOUNT,
        payload: {
          classHash,
          constructorCalldata: compiledCalldata,
          addressSalt,
          contractAddress: contractAddressFinal
        }
      }
    ];
    const estimateBulk = await this.estimateFeeBulk(invocations, details);
    return estimateBulk[0];
  }
  async estimateDeployFee(payload, details = {}) {
    const { calls } = this.deployer.buildDeployerCall(payload, this.address);
    return this.estimateInvokeFee(calls, details);
  }
  async estimateFeeBulk(invocations, details = {}) {
    if (!invocations.length) throw TypeError("Invocations should be non-empty array");
    if (details.resourceBounds)
      return [resourceBoundsToEstimateFeeResponse(details.resourceBounds)];
    const { nonce, blockIdentifier, version, skipValidate } = details;
    const detailsWithTip = await this.resolveDetailsWithTip(details);
    const accountInvocations = await this.accountInvocationsFactory(invocations, {
      ...v3Details(detailsWithTip),
      versions: [
        toTransactionVersion(
          toFeeVersion(this.transactionVersion) || ETransactionVersion34.F3,
          version
        )
        // sierra
      ],
      nonce,
      blockIdentifier,
      skipValidate
    });
    return this.provider.getEstimateFeeBulk(accountInvocations, {
      blockIdentifier,
      skipValidate
    });
  }
  async simulateTransaction(invocations, details = {}) {
    if (!invocations.length) throw TypeError("Invocations should be non-empty array");
    const {
      nonce,
      blockIdentifier,
      skipValidate = true,
      skipExecute,
      returnInitialReads,
      version: providedVersion
    } = details;
    const detailsWithTip = await this.resolveDetailsWithTip(details);
    const accountInvocations = await this.accountInvocationsFactory(invocations, {
      ...v3Details(detailsWithTip),
      versions: [this.resolveTransactionVersion(providedVersion)],
      nonce,
      blockIdentifier,
      skipValidate
    });
    return this.provider.getSimulateTransaction(accountInvocations, {
      blockIdentifier,
      skipValidate,
      skipExecute,
      returnInitialReads
    });
  }
  /**
   * Shared preparation logic for execute() and buildExecute().
   * Runs hooks, estimates fees, and builds accountInvocations.
   * @private
   */
  async prepareInvoke(transactions, transactionsDetail = {}) {
    const hookResult = this.accountPluginManager.runAccountHook("beforeExecute", {
      calls: transactions,
      details: transactionsDetail
    });
    const hookedTransactions = hookResult?.calls ?? transactions;
    const hookedDetails = hookResult?.details ?? transactionsDetail;
    const calls = [hookedTransactions].flat();
    const detailsWithTip = await this.resolveDetailsWithTip(hookedDetails);
    const { resourceBounds: providedResourceBounds } = hookedDetails;
    let resourceBounds = providedResourceBounds;
    if (!resourceBounds) {
      const estimateResponse = await this.estimateInvokeFee(calls, detailsWithTip);
      resourceBounds = estimateResponse.resourceBounds;
    }
    const accountInvocations = await this.accountInvocationsFactory(
      [{ type: api_exports3.ETransactionType.INVOKE, payload: calls }],
      {
        ...v3Details(detailsWithTip),
        resourceBounds,
        versions: [this.resolveTransactionVersion(hookedDetails.version)],
        nonce: hookedDetails.nonce,
        skipValidate: false
      }
    );
    return {
      invocation: accountInvocations[0],
      hookedTransactions,
      hookedDetails,
      detailsWithTip
    };
  }
  async execute(transactions, transactionsDetail = {}) {
    const { invocation, hookedTransactions, hookedDetails, detailsWithTip } = await this.prepareInvoke(transactions, transactionsDetail);
    const result = await this.provider.invokeFunction(
      {
        contractAddress: invocation.contractAddress,
        calldata: invocation.calldata,
        signature: invocation.signature,
        ...hookedDetails.proofFacts && { proofFacts: hookedDetails.proofFacts },
        ...hookedDetails.proof && { proof: hookedDetails.proof }
      },
      {
        ...v3Details(detailsWithTip),
        resourceBounds: invocation.resourceBounds,
        nonce: invocation.nonce,
        version: invocation.version
      }
    );
    this.accountPluginManager.runAccountHook("afterExecute", {
      calls: hookedTransactions,
      result
    });
    return result;
  }
  /**
   * Build a signed INVOKE_TXN_V3 transaction without submitting it to the network.
   *
   * Produces a fully signed transaction object that can be inspected, stored,
   * or submitted later via `provider.channel.sendTransaction()`.
   * Main usage is to send a virtual transaction to a proof server.
   * Fees are estimated automatically if not provided.
   *
   * @param transactions - Single call or array of calls to include in the transaction
   * @param transactionsDetail - Transaction execution options
   * @returns A fully signed `RPC.INVOKE_TXN_V3` object, ready to broadcast
   *
   * @remarks
   * - Unlike `execute()`, this method does **not** submit the transaction ; the account nonce is unchanged after the call.
   * - The `afterExecute` plugin hook is intentionally **not** triggered.
   * - The returned object can be broadcast with `provider.channel.sendTransaction()`.
   *
   * @example
   * ```typescript
   * const signedTx = await account.getSignedTransaction(
   *   { contractAddress: erc20Address, entrypoint: 'transfer', calldata: [recipient, amount, 0] }
   * );
   * ```
   */
  async getSignedTransaction(transactions, transactionsDetail = {}) {
    const { invocation, hookedDetails, detailsWithTip } = await this.prepareInvoke(
      transactions,
      transactionsDetail
    );
    return this.provider.channel.buildTransaction(
      {
        type: api_exports3.ETransactionType.INVOKE,
        contractAddress: invocation.contractAddress,
        calldata: invocation.calldata,
        signature: invocation.signature,
        ...hookedDetails.proofFacts && { proofFacts: hookedDetails.proofFacts },
        ...hookedDetails.proof && { proof: hookedDetails.proof },
        ...v3Details(detailsWithTip),
        resourceBounds: invocation.resourceBounds,
        nonce: invocation.nonce,
        version: invocation.version
      },
      "transaction"
    );
  }
  /**
   * First check if contract is already declared, if not declare it
   * If contract already declared returned transaction_hash is ''.
   * Method will pass even if contract is already declared
   * @param transactionsDetail (optional)
   */
  async declareIfNot(payload, transactionsDetail = {}) {
    const declareContractPayload = extractContractHashes(
      payload,
      await this.provider.channel.getStarknetVersion()
    );
    try {
      await this.provider.getClassByHash(declareContractPayload.classHash);
    } catch (error) {
      return this.declare(payload, transactionsDetail);
    }
    return {
      transaction_hash: "",
      class_hash: declareContractPayload.classHash
    };
  }
  async declare(payload, details = {}) {
    assert(isSierra(payload.contract), SYSTEM_MESSAGES.declareNonSierra);
    const declareContractPayload = extractContractHashes(
      payload,
      await this.provider.channel.getStarknetVersion()
    );
    const detailsWithTip = await this.resolveDetailsWithTip(details);
    const { resourceBounds: providedResourceBounds } = details;
    let resourceBounds = providedResourceBounds;
    if (!resourceBounds) {
      const estimateResponse = await this.estimateDeclareFee(payload, detailsWithTip);
      resourceBounds = estimateResponse.resourceBounds;
    }
    const accountInvocations = await this.accountInvocationsFactory(
      [{ type: api_exports3.ETransactionType.DECLARE, payload: declareContractPayload }],
      {
        ...v3Details(detailsWithTip),
        resourceBounds,
        versions: [this.resolveTransactionVersion(details.version)],
        nonce: details.nonce,
        skipValidate: false
      }
    );
    const declaration = accountInvocations[0];
    return this.provider.declareContract(
      {
        senderAddress: declaration.senderAddress,
        signature: declaration.signature,
        contract: declaration.contract,
        compiledClassHash: declaration.compiledClassHash
      },
      {
        ...v3Details(detailsWithTip),
        nonce: declaration.nonce,
        resourceBounds: declaration.resourceBounds,
        version: declaration.version
      }
    );
  }
  async deploy(payload, details = {}) {
    const { calls, addresses } = this.deployer.buildDeployerCall(payload, this.address);
    const invokeResponse = await this.execute(calls, details);
    return {
      ...invokeResponse,
      contract_address: addresses
    };
  }
  async deployContract(payload, details = {}) {
    const deployTx = await this.deploy(payload, details);
    const txReceipt = await this.provider.waitForTransaction(deployTx.transaction_hash, details);
    return this.deployer.parseDeployerEvent(
      txReceipt
    );
  }
  async declareAndDeploy(payload, details = {}) {
    let declare = await this.declareIfNot(payload, details);
    if (declare.transaction_hash !== "") {
      const tx = await this.provider.waitForTransaction(declare.transaction_hash, details);
      declare = { ...declare, ...tx };
    }
    const deploy = await this.deployContract(
      { ...payload, classHash: declare.class_hash },
      details
    );
    return { declare: { ...declare }, deploy };
  }
  deploySelf = this.deployAccount;
  async deployAccount({
    classHash,
    constructorCalldata = [],
    addressSalt = 0,
    contractAddress: providedContractAddress
  }, details = {}) {
    const compiledCalldata = CallData.compile(constructorCalldata);
    const contractAddress = providedContractAddress ?? calculateContractAddressFromHash(addressSalt, classHash, compiledCalldata, 0);
    const detailsWithTip = await this.resolveDetailsWithTip(details);
    const { resourceBounds: providedResourceBounds } = details;
    let resourceBounds = providedResourceBounds;
    if (!resourceBounds) {
      const estimateResponse = await this.estimateAccountDeployFee(
        {
          classHash,
          constructorCalldata,
          addressSalt,
          contractAddress
        },
        detailsWithTip
      );
      resourceBounds = estimateResponse.resourceBounds;
    }
    const accountInvocations = await this.accountInvocationsFactory(
      [
        {
          type: api_exports3.ETransactionType.DEPLOY_ACCOUNT,
          payload: {
            classHash,
            constructorCalldata: compiledCalldata,
            addressSalt,
            contractAddress
          }
        }
      ],
      {
        ...v3Details(detailsWithTip),
        resourceBounds,
        versions: [this.resolveTransactionVersion(details.version)],
        nonce: ZERO,
        // DEPLOY_ACCOUNT always uses nonce 0
        skipValidate: false
      }
    );
    const deployment = accountInvocations[0];
    return this.provider.deployAccountContract(
      {
        classHash: deployment.classHash,
        addressSalt: deployment.addressSalt,
        constructorCalldata: deployment.constructorCalldata,
        signature: deployment.signature
      },
      {
        ...v3Details(detailsWithTip),
        nonce: deployment.nonce,
        resourceBounds: deployment.resourceBounds,
        version: deployment.version
      }
    );
  }
  async signMessage(typedData) {
    const hookResult = this.accountPluginManager.runAccountHook("beforeSign", { typedData });
    const finalTypedData = hookResult?.typedData ?? typedData;
    const signature = await this.signer.signMessage(finalTypedData, this.address);
    this.accountPluginManager.runAccountHook("afterSign", {
      typedData: finalTypedData,
      signature
    });
    return signature;
  }
  async hashMessage(typedData) {
    return getMessageHash(typedData, this.address);
  }
  /**
   * Verify if an account is compatible with SNIP-9 outside execution, and with which version of this standard.
   * @returns {OutsideExecutionVersion} Not compatible, V1, V2.
   * @example
   * ```typescript
   * const result = myAccount.getSnip9Version();
   * // result = "V1"
   * ```
   */
  async getSnip9Version() {
    if (await supportsInterface(this.provider, this.address, SNIP9_V2_INTERFACE_ID)) {
      return OutsideExecutionVersion.V2;
    }
    if (await supportsInterface(this.provider, this.address, SNIP9_V1_INTERFACE_ID)) {
      return OutsideExecutionVersion.V1;
    }
    return OutsideExecutionVersion.UNSUPPORTED;
  }
  /**
   * Verify if a SNIP-9 nonce has not yet been used by the account.
   * @param {BigNumberish} nonce SNIP-9 nonce to test.
   * @returns  {boolean} true if SNIP-9 nonce not yet used.
   * @example
   * ```typescript
   * const result = myAccount.isValidSnip9Nonce(1234);
   * // result = true
   * ```
   */
  async isValidSnip9Nonce(nonce) {
    try {
      const call = {
        contractAddress: this.address,
        entrypoint: "is_valid_outside_execution_nonce",
        calldata: [toHex(nonce)]
      };
      const resp = await this.provider.callContract(call);
      return BigInt(resp[0]) !== 0n;
    } catch (error) {
      throw new Error(`Failed to check if nonce is valid: ${error}`);
    }
  }
  /**
   * Outside transaction needs a specific SNIP-9 nonce, that we get in this function.
   * A SNIP-9 nonce can be any number not yet used ; no ordering is needed.
   * @returns  {string} an Hex string of a SNIP-9 nonce.
   * @example
   * ```typescript
   * const result = myAccount.getSnip9Nonce();
   * // result = "0x28a612590dbc36927933c8ee0f357eee639c8b22b3d3aa86949eed3ada4ac55"
   * ```
   */
  async getSnip9Nonce() {
    const nonce = randomAddress();
    const isValidNonce = await this.isValidSnip9Nonce(nonce);
    if (!isValidNonce) {
      return this.getSnip9Nonce();
    }
    return nonce;
  }
  /**
   * Creates an object containing transaction(s) that can be executed by an other account with` Account.executeFromOutside()`, called Outside Transaction.
   * @param {OutsideExecutionOptions} options Parameters of the transaction(s).
   * @param {AllowArray<Call>} calls Transaction(s) to execute.
   * @param {OutsideExecutionVersion} [version] SNIP-9 version of the Account that creates the outside transaction.
   * @param {BigNumberish} [nonce] Outside Nonce.
   * @returns {OutsideTransaction} and object that can be used in `Account.executeFromOutside()`
   * @example
   * ```typescript
   * const now_seconds = Math.floor(Date.now() / 1000);
   * const callOptions: OutsideExecutionOptions = {
      caller: executorAccount.address, execute_after: now_seconds - 3600, execute_before: now_seconds + 3600 };
   * const call1: Call = { contractAddress: ethAddress, entrypoint: 'transfer', calldata: {
   *     recipient: recipientAccount.address, amount: cairo.uint256(100) } };
   * const outsideTransaction1: OutsideTransaction = await signerAccount.getOutsideTransaction(callOptions, call3);
   * // result = {
   * // outsideExecution: {
   * // caller: '0x64b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691',
   * // nonce: '0x28a612590dbc36927933c8ee0f357eee639c8b22b3d3aa86949eed3ada4ac55',
   * // execute_after: 1723650229, execute_before: 1723704229, calls: [[Object]] },
   * // signature: Signature {
   * // r: 67518627037915514985321278857825384106482999609634873287406612756843916814n,
   * // s: 737198738569840639192844101690009498983611654458636624293579534560862067709n, recovery: 0 },
   * // signerAddress: '0x655f8fd7c4013c07cf12a92184aa6c314d181443913e21f7e209a18f0c78492',
   * // version: '2'
   * // }
   * ```
   */
  async getOutsideTransaction(options, calls, version, nonce) {
    if (!isHex2(options.caller) && options.caller !== "ANY_CALLER") {
      throw new Error(`The caller ${options.caller} is not valid.`);
    }
    const codedCaller = isHex2(options.caller) ? options.caller : OutsideExecutionCallerAny;
    const myCalls = [calls].flat();
    const supportedVersion = version ?? await this.getSnip9Version();
    if (!supportedVersion) {
      throw new Error("This account is not handling outside transactions.");
    }
    const myNonce = nonce ? toHex(nonce) : await this.getSnip9Nonce();
    const message = getTypedData(
      await this.provider.getChainId(),
      {
        caller: codedCaller,
        execute_after: options.execute_after,
        execute_before: options.execute_before
      },
      myNonce,
      myCalls,
      supportedVersion
    );
    const sign2 = await this.signMessage(message);
    const toExecute = {
      caller: codedCaller,
      nonce: myNonce,
      execute_after: options.execute_after,
      execute_before: options.execute_before,
      calls: myCalls.map(getOutsideCall)
    };
    return {
      outsideExecution: toExecute,
      signature: sign2,
      signerAddress: this.address,
      version: supportedVersion
    };
  }
  /**
   * An account B executes a transaction that has been signed by an account A.
   * Fees are paid by B.
   * @param {AllowArray<OutsideTransaction>} outsideTransaction the signed transaction generated by `Account.getOutsideTransaction()`.
   * @param {UniversalDetails} [opts] same options than `Account.execute()`.
   * @returns {InvokeFunctionResponse} same response than `Account.execute()`.
   * @example
   * ```typescript
   * const outsideTransaction1: OutsideTransaction = await signerAccount.getOutsideTransaction(callOptions, call1);
   * const outsideTransaction2: OutsideTransaction = await signerAccount.getOutsideTransaction(callOptions4, call4);
   * const result = await myAccount.executeFromOutside([
      outsideTransaction1,
      outsideTransaction2,
    ]);
   * // result = { transaction_hash: '0x11233...`}
   * ```
   */
  async executeFromOutside(outsideTransaction, opts) {
    const multiCall = buildExecuteFromOutsideCall(outsideTransaction);
    return this.execute(multiCall, opts);
  }
  /*
   * Support methods
   */
  /**
   * Helper method to resolve details with tip estimation
   * @private
   */
  async resolveDetailsWithTip(details) {
    return {
      ...details,
      tip: details.tip ?? (await this.provider.getEstimateTip())[this.defaultTipType]
    };
  }
  /**
   * Helper method to resolve transaction version
   * @private
   */
  resolveTransactionVersion(providedVersion) {
    return toTransactionVersion(
      this.transactionVersion || ETransactionVersion34.V3,
      providedVersion
    );
  }
  async buildInvocation(call, details) {
    const calldata = getExecuteCalldata(call, await this.getCairoVersion());
    const signature = !details.skipValidate ? await this.signer.signTransaction(call, details) : [];
    return {
      ...v3Details(details),
      contractAddress: this.address,
      calldata,
      signature
    };
  }
  async buildDeclarePayload(payload, details) {
    const { classHash, contract, compiledClassHash } = extractContractHashes(
      payload,
      await this.provider.channel.getStarknetVersion()
    );
    const compressedCompiledContract = await parseContract(contract);
    assert(
      !isUndefined(compiledClassHash) && (details.version === ETransactionVersion34.F3 || details.version === ETransactionVersion34.V3),
      "V3 Transaction work with Cairo1 Contracts and require compiledClassHash"
    );
    const signature = !details.skipValidate ? await this.signer.signDeclareTransaction({
      ...details,
      ...v3Details(details),
      classHash,
      compiledClassHash,
      senderAddress: details.walletAddress
    }) : [];
    return {
      senderAddress: details.walletAddress,
      signature,
      contract: compressedCompiledContract,
      compiledClassHash
    };
  }
  async buildAccountDeployPayload({
    classHash,
    addressSalt = 0,
    constructorCalldata = [],
    contractAddress: providedContractAddress
  }, details) {
    const compiledCalldata = CallData.compile(constructorCalldata);
    const contractAddress = providedContractAddress ?? calculateContractAddressFromHash(addressSalt, classHash, compiledCalldata, 0);
    const signature = !details.skipValidate ? await this.signer.signDeployAccountTransaction({
      ...details,
      ...v3Details(details),
      classHash,
      contractAddress,
      addressSalt,
      constructorCalldata: compiledCalldata
    }) : [];
    return {
      ...v3Details(details),
      classHash,
      addressSalt,
      constructorCalldata: compiledCalldata,
      signature
    };
  }
  async accountInvocationsFactory(invocations, details) {
    const { nonce, blockIdentifier, skipValidate = true } = details;
    const safeNonce = await this.getNonceSafe(nonce);
    const chainId = await this.provider.getChainId();
    const versions = details.versions.map((it) => toTransactionVersion(it));
    const tx0Payload = "payload" in invocations[0] ? invocations[0].payload : invocations[0];
    const cairoVersion = invocations[0].type === api_exports3.ETransactionType.DEPLOY_ACCOUNT ? await this.getCairoVersion(tx0Payload.classHash) : await this.getCairoVersion();
    return Promise.all(
      [].concat(invocations).map(async (transaction, index) => {
        const txPayload = "payload" in transaction ? transaction.payload : transaction;
        const signerDetails = {
          ...v3Details(details),
          walletAddress: this.address,
          nonce: toBigInt(Number(safeNonce) + index),
          chainId,
          cairoVersion,
          version: versions[0],
          skipValidate
        };
        const common = {
          type: transaction.type,
          nonce: toBigInt(Number(safeNonce) + index),
          blockIdentifier,
          version: versions[0]
        };
        if (transaction.type === api_exports3.ETransactionType.INVOKE) {
          const payload = await this.buildInvocation(
            [].concat(txPayload),
            signerDetails
          );
          return {
            ...common,
            ...payload,
            ...signerDetails
          };
        }
        if (transaction.type === api_exports3.ETransactionType.DEPLOY) {
          const { calls } = this.deployer.buildDeployerCall(txPayload, this.address);
          const payload = await this.buildInvocation(calls, signerDetails);
          return {
            ...common,
            ...payload,
            ...signerDetails,
            type: api_exports3.ETransactionType.INVOKE
          };
        }
        if (transaction.type === api_exports3.ETransactionType.DECLARE) {
          assert(
            isSierra(txPayload.contract),
            "Declare fee estimation is not supported for Cairo0 contracts"
          );
          const payload = await this.buildDeclarePayload(txPayload, signerDetails);
          return {
            ...common,
            ...payload,
            ...signerDetails
          };
        }
        if (transaction.type === api_exports3.ETransactionType.DEPLOY_ACCOUNT) {
          const payload = await this.buildAccountDeployPayload(txPayload, signerDetails);
          return {
            ...common,
            ...payload,
            ...signerDetails
          };
        }
        throw Error(`accountInvocationsFactory: unsupported transaction type: ${transaction}`);
      })
    );
  }
  /*
   * SNIP-29 Paymaster
   */
  async buildPaymasterTransaction(calls, paymasterDetails) {
    if (!paymasterDetails.deploymentData) {
      const snip9Version = await this.getSnip9Version();
      if (snip9Version === OutsideExecutionVersion.UNSUPPORTED) {
        throw Error("Account is not compatible with SNIP-9");
      }
    }
    const parameters = {
      version: "0x1",
      feeMode: paymasterDetails.feeMode,
      timeBounds: paymasterDetails.timeBounds
    };
    let transaction;
    if (paymasterDetails.deploymentData) {
      if (calls.length > 0) {
        transaction = {
          type: "deploy_and_invoke",
          invoke: { userAddress: this.address, calls },
          deployment: paymasterDetails.deploymentData
        };
      } else {
        transaction = {
          type: "deploy",
          deployment: paymasterDetails.deploymentData
        };
      }
    } else {
      transaction = {
        type: "invoke",
        invoke: { userAddress: this.address, calls }
      };
    }
    return this.paymaster.buildTransaction(transaction, parameters);
  }
  async estimatePaymasterTransactionFee(calls, paymasterDetails) {
    const preparedTransaction = await this.buildPaymasterTransaction(calls, paymasterDetails);
    return preparedTransaction.fee;
  }
  async preparePaymasterTransaction(preparedTransaction) {
    let transaction;
    switch (preparedTransaction.type) {
      case "deploy_and_invoke": {
        const signature = await this.signMessage(preparedTransaction.typed_data);
        transaction = {
          type: "deploy_and_invoke",
          invoke: {
            userAddress: this.address,
            typedData: preparedTransaction.typed_data,
            signature: signatureToHexArray(signature)
          },
          deployment: preparedTransaction.deployment
        };
        break;
      }
      case "invoke": {
        const signature = await this.signMessage(preparedTransaction.typed_data);
        transaction = {
          type: "invoke",
          invoke: {
            userAddress: this.address,
            typedData: preparedTransaction.typed_data,
            signature: signatureToHexArray(signature)
          }
        };
        break;
      }
      case "deploy": {
        transaction = {
          type: "deploy",
          deployment: preparedTransaction.deployment
        };
        break;
      }
      default:
        throw Error("Invalid transaction type");
    }
    return transaction;
  }
  async executePaymasterTransaction(calls, paymasterDetails, maxFeeInGasToken) {
    const preparedTransaction = await this.buildPaymasterTransaction(calls, paymasterDetails);
    assertPaymasterTransactionSafety(
      preparedTransaction,
      calls,
      paymasterDetails,
      maxFeeInGasToken
    );
    const transaction = await this.preparePaymasterTransaction(preparedTransaction);
    return this.paymaster.executeTransaction(transaction, preparedTransaction.parameters).then((response) => ({ transaction_hash: response.transaction_hash }));
  }
};
var connect_exports = {};
__export2(connect_exports, {
  addDeclareTransaction: () => addDeclareTransaction,
  addInvokeTransaction: () => addInvokeTransaction,
  addStarknetChain: () => addStarknetChain,
  deploymentData: () => deploymentData,
  getPermissions: () => getPermissions,
  onAccountChange: () => onAccountChange,
  onNetworkChanged: () => onNetworkChanged,
  requestAccounts: () => requestAccounts,
  requestChainId: () => requestChainId,
  signMessage: () => signMessage,
  supportedSpecs: () => supportedSpecs,
  supportedWalletApi: () => supportedWalletApi,
  switchStarknetChain: () => switchStarknetChain,
  watchAsset: () => watchAsset
});
function requestAccounts(swo, silent_mode = false) {
  return swo.request({
    type: "wallet_requestAccounts",
    params: { silent_mode }
  });
}
function getPermissions(swo) {
  return swo.request({ type: "wallet_getPermissions" });
}
function watchAsset(swo, asset) {
  return swo.request({ type: "wallet_watchAsset", params: asset });
}
function addStarknetChain(swo, chain2) {
  return swo.request({ type: "wallet_addStarknetChain", params: chain2 });
}
function switchStarknetChain(swo, chainId) {
  return swo.request({
    type: "wallet_switchStarknetChain",
    params: { chainId }
  });
}
function requestChainId(swo) {
  return swo.request({ type: "wallet_requestChainId" });
}
function deploymentData(swo) {
  return swo.request({ type: "wallet_deploymentData" });
}
function addInvokeTransaction(swo, params) {
  return swo.request({ type: "wallet_addInvokeTransaction", params });
}
function addDeclareTransaction(swo, params) {
  return swo.request({ type: "wallet_addDeclareTransaction", params });
}
function signMessage(swo, typedData) {
  return swo.request({ type: "wallet_signTypedData", params: typedData });
}
function supportedSpecs(swo) {
  return swo.request({ type: "wallet_supportedSpecs" });
}
function supportedWalletApi(swo) {
  return swo.request({ type: "wallet_supportedWalletApi" });
}
function onAccountChange(swo, callback) {
  swo.on("accountsChanged", callback);
}
function onNetworkChanged(swo, callback) {
  swo.on("networkChanged", callback);
}
var connectV5_exports = {};
__export2(connectV5_exports, {
  addDeclareTransaction: () => addDeclareTransaction2,
  addInvokeTransaction: () => addInvokeTransaction2,
  addStarknetChain: () => addStarknetChain2,
  deploymentData: () => deploymentData2,
  getPermissions: () => getPermissions2,
  requestAccounts: () => requestAccounts2,
  requestChainId: () => requestChainId2,
  signMessage: () => signMessage2,
  standardConnect: () => standardConnect,
  subscribeWalletEvent: () => subscribeWalletEvent,
  supportedSpecs: () => supportedSpecs2,
  supportedWalletApi: () => supportedWalletApi2,
  switchStarknetChain: () => switchStarknetChain2,
  watchAsset: () => watchAsset2
});
function standardConnect(walletWSF, silent_mode = false) {
  return walletWSF.features["standard:connect"].connect({ silent: silent_mode });
}
function requestAccounts2(walletWSF, silent_mode = false) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_requestAccounts",
    params: { silent_mode }
  });
}
function getPermissions2(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_getPermissions" });
}
function watchAsset2(walletWSF, asset) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_watchAsset",
    params: asset
  });
}
function addStarknetChain2(walletWSF, chain2) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_addStarknetChain",
    params: chain2
  });
}
function switchStarknetChain2(walletWSF, chainId) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_switchStarknetChain",
    params: { chainId }
  });
}
function requestChainId2(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_requestChainId" });
}
function deploymentData2(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_deploymentData" });
}
function addInvokeTransaction2(walletWSF, params) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_addInvokeTransaction",
    params
  });
}
function addDeclareTransaction2(walletWSF, params) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_addDeclareTransaction",
    params
  });
}
function signMessage2(walletWSF, typedData) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_signTypedData",
    params: typedData
  });
}
function supportedSpecs2(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_supportedSpecs" });
}
function supportedWalletApi2(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_supportedWalletApi" });
}
function subscribeWalletEvent(walletWSF, callback) {
  return walletWSF.features["standard:events"].on("change", callback);
}
var connectV6_exports = {};
__export2(connectV6_exports, {
  addDeclareTransaction: () => addDeclareTransaction3,
  addInvokeTransaction: () => addInvokeTransaction3,
  addStarknetChain: () => addStarknetChain3,
  deploymentData: () => deploymentData3,
  getPermissions: () => getPermissions3,
  requestAccounts: () => requestAccounts3,
  requestChainId: () => requestChainId3,
  signMessage: () => signMessage3,
  standardConnect: () => standardConnect2,
  strk20Balances: () => strk20Balances,
  strk20InvokeTransaction: () => strk20InvokeTransaction,
  strk20PrepareInvoke: () => strk20PrepareInvoke,
  subscribeWalletEvent: () => subscribeWalletEvent2,
  supportedSpecs: () => supportedSpecs3,
  supportedWalletApi: () => supportedWalletApi3,
  switchStarknetChain: () => switchStarknetChain3,
  watchAsset: () => watchAsset3
});
function standardConnect2(walletWSF, silent_mode = false) {
  return walletWSF.features["standard:connect"].connect({ silent: silent_mode });
}
function requestAccounts3(walletWSF, silent_mode = false) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_requestAccounts",
    params: { silent_mode }
  });
}
function getPermissions3(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_getPermissions" });
}
function watchAsset3(walletWSF, asset) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_watchAsset",
    params: asset
  });
}
function addStarknetChain3(walletWSF, chain2) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_addStarknetChain",
    params: chain2
  });
}
function switchStarknetChain3(walletWSF, chainId, silent_mode = false) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_switchStarknetChain",
    params: { chainId, silent_mode }
  });
}
function requestChainId3(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_requestChainId" });
}
function deploymentData3(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_deploymentData" });
}
function addInvokeTransaction3(walletWSF, params) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_addInvokeTransaction",
    params
  });
}
function addDeclareTransaction3(walletWSF, params) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_addDeclareTransaction",
    params
  });
}
function signMessage3(walletWSF, typedData) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_signTypedData",
    params: typedData
  });
}
function supportedSpecs3(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_supportedSpecs" });
}
function supportedWalletApi3(walletWSF) {
  return walletWSF.features["starknet:walletApi"].request({ type: "wallet_supportedWalletApi" });
}
function subscribeWalletEvent2(walletWSF, callback) {
  return walletWSF.features["standard:events"].on("change", callback);
}
function strk20Balances(walletWSF, tokens) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_strk20Balances",
    params: { tokens }
  });
}
function strk20PrepareInvoke(walletWSF, actions, simulate) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_strk20PrepareInvoke",
    params: { actions, simulate }
  });
}
function strk20InvokeTransaction(walletWSF, actions) {
  return walletWSF.features["starknet:walletApi"].request({
    type: "wallet_strk20InvokeTransaction",
    params: { actions }
  });
}
var events_exports = {};
__export2(events_exports, {
  addGetByPathMethod: () => addGetByPathMethod,
  filterEventsByAddress: () => filterEventsByAddress,
  getAbiEvents: () => getAbiEvents,
  getEmittedEvents: () => getEmittedEvents,
  isAbiEvent: () => isAbiEvent,
  parseEvents: () => parseEvents
});
function isAbiEvent(object) {
  return object.type === "event";
}
function getCairo0AbiEvents(abi) {
  return abi.filter((abiEntry) => abiEntry.type === "event").reduce((acc, abiEntry) => {
    const entryName = abiEntry.name;
    const abiEntryMod = { ...abiEntry };
    abiEntryMod.name = entryName;
    return {
      ...acc,
      [addHexPrefix(keccak(utf8ToArray(entryName)).toString(16))]: abiEntryMod
    };
  }, {});
}
function getCairo1AbiEvents(abi) {
  const abiEventsStructs = abi.filter((obj) => isAbiEvent(obj) && obj.kind === "struct");
  const abiEventsEnums = abi.filter((obj) => isAbiEvent(obj) && obj.kind === "enum");
  const abiEventsData = abiEventsStructs.reduce((acc, event) => {
    let nameList = [];
    let { name } = event;
    let flat = false;
    const findName = (variant) => variant.type === name;
    while (true) {
      const eventEnum = abiEventsEnums.find((eventE) => eventE.variants.some(findName));
      if (isUndefined(eventEnum)) break;
      const variant = eventEnum.variants.find(findName);
      nameList.unshift(variant.name);
      if (variant.kind === "flat") flat = true;
      name = eventEnum.name;
    }
    if (nameList.length === 0) {
      throw new Error("inconsistency in ABI events definition.");
    }
    if (flat) nameList = [nameList[nameList.length - 1]];
    const final = nameList.pop();
    let result = {
      [addHexPrefix(keccak(utf8ToArray(final)).toString(16))]: event
    };
    while (nameList.length > 0) {
      result = {
        [addHexPrefix(keccak(utf8ToArray(nameList.pop())).toString(16))]: result
      };
    }
    result = { ...result };
    return mergeAbiEvents(acc, result);
  }, {});
  return abiEventsData;
}
function getAbiEvents(abi) {
  return isCairo1Abi(abi) ? getCairo1AbiEvents(abi) : getCairo0AbiEvents(abi);
}
function mergeAbiEvents(target, source) {
  const output = { ...target };
  if (isObject2(target) && isObject2(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject2(source[key])) {
        if (!(key in target)) Object.assign(output, { [key]: source[key] });
        else
          output[key] = mergeAbiEvents(
            target[key],
            source[key]
          );
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}
function parseEvents(providerReceivedEvents, abiEvents, abiStructs, abiEnums, parser) {
  const ret = providerReceivedEvents.reduce((acc, recEvent) => {
    const eventKeys = [...recEvent.keys];
    const eventData = [...recEvent.data];
    let abiEvent = abiEvents[eventKeys.shift() ?? 0];
    if (!abiEvent) {
      return acc;
    }
    while (!abiEvent.name) {
      const hashName = eventKeys.shift();
      assert(!!hashName, 'Not enough data in "keys" property of this event.');
      abiEvent = abiEvent[hashName];
    }
    const { from_address: _from, keys: _keys, data: _data, ...eventMetadata } = recEvent;
    const parsedEvent = eventMetadata;
    const eventName = abiEvent.name;
    parsedEvent[eventName] = {};
    const keysIter = eventKeys[Symbol.iterator]();
    const dataIter = eventData[Symbol.iterator]();
    const abiEventKeys = abiEvent.members?.filter((it) => it.kind === "key") || abiEvent.keys;
    const abiEventData = abiEvent.members?.filter((it) => it.kind === "data") || abiEvent.data;
    const parsedEventData = parsedEvent[eventName];
    abiEventKeys.forEach((key) => {
      parsedEventData[key.name] = responseParser({
        responseIterator: keysIter,
        output: key,
        structs: abiStructs,
        enums: abiEnums,
        parser,
        parsedResult: parsedEventData
      });
    });
    abiEventData.forEach((data) => {
      parsedEventData[data.name] = responseParser({
        responseIterator: dataIter,
        output: data,
        structs: abiStructs,
        enums: abiEnums,
        parser,
        parsedResult: parsedEventData
      });
    });
    acc.push(parsedEvent);
    return acc;
  }, []);
  return ret;
}
function addGetByPathMethod(parsedEvents) {
  Object.defineProperty(parsedEvents, "getByPath", {
    value: (path) => {
      const event = parsedEvents.find((ev) => Object.keys(ev).some((key) => key.includes(path)));
      const eventKey = Object.keys(event || {}).find((key) => key.includes(path));
      return eventKey && event ? event[eventKey] : null;
    },
    writable: false,
    enumerable: false,
    configurable: false
  });
  return parsedEvents;
}
function getEmittedEvents(receipt, contractAddress) {
  if (!receipt.events) return [];
  const eventsToEnrich = contractAddress ? filterEventsByAddress(receipt.events, contractAddress) : receipt.events;
  return eventsToEnrich.map((event) => ({
    ...event,
    transaction_hash: receipt.transaction_hash,
    block_hash: receipt.block_hash,
    block_number: receipt.block_number
  }));
}
function filterEventsByAddress(events, contractAddress) {
  if (!events) return [];
  return events.filter((event) => toHex(event.from_address) === toHex(contractAddress));
}
var export_TypedDataRevision = api_exports3.TypedDataRevision;

// packages/domain/src/settlement-privacy.ts
function rejectPublicSettlement() {
  throw new Error("Confidential settlement is required. The earlier RFQ route exposes trade amounts and assets and is disabled. Use the confidential escrow when your wallet and network support it.");
}

// node_modules/@hpke/common/esm/src/errors.js
var HpkeError = class extends Error {
  constructor(e) {
    let message;
    if (e instanceof Error) {
      message = e.message;
    } else if (typeof e === "string") {
      message = e;
    } else {
      message = "";
    }
    super(message);
    this.name = this.constructor.name;
  }
};
var InvalidParamError = class extends HpkeError {
};
var SerializeError = class extends HpkeError {
};
var DeserializeError = class extends HpkeError {
};
var EncapError = class extends HpkeError {
};
var DecapError = class extends HpkeError {
};
var ExportError = class extends HpkeError {
};
var SealError = class extends HpkeError {
};
var OpenError = class extends HpkeError {
};
var MessageLimitReachedError = class extends HpkeError {
};
var DeriveKeyPairError = class extends HpkeError {
};
var NotSupportedError = class extends HpkeError {
};

// node_modules/@hpke/common/esm/_dnt.shims.js
var dntGlobals = {};
var dntGlobalThis = createMergeProxy(globalThis, dntGlobals);
function createMergeProxy(baseObj, extObj) {
  return new Proxy(baseObj, {
    get(_target, prop, _receiver) {
      if (prop in extObj) {
        return extObj[prop];
      } else {
        return baseObj[prop];
      }
    },
    set(_target, prop, value) {
      if (prop in extObj) {
        delete extObj[prop];
      }
      baseObj[prop] = value;
      return true;
    },
    deleteProperty(_target, prop) {
      let success = false;
      if (prop in extObj) {
        delete extObj[prop];
        success = true;
      }
      if (prop in baseObj) {
        delete baseObj[prop];
        success = true;
      }
      return success;
    },
    ownKeys(_target) {
      const baseKeys = Reflect.ownKeys(baseObj);
      const extKeys = Reflect.ownKeys(extObj);
      const extKeysSet = new Set(extKeys);
      return [...baseKeys.filter((k) => !extKeysSet.has(k)), ...extKeys];
    },
    defineProperty(_target, prop, desc) {
      if (prop in extObj) {
        delete extObj[prop];
      }
      Reflect.defineProperty(baseObj, prop, desc);
      return true;
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (prop in extObj) {
        return Reflect.getOwnPropertyDescriptor(extObj, prop);
      } else {
        return Reflect.getOwnPropertyDescriptor(baseObj, prop);
      }
    },
    has(_target, prop) {
      return prop in extObj || prop in baseObj;
    }
  });
}

// node_modules/@hpke/common/esm/src/algorithm.js
async function loadSubtleCrypto() {
  if (dntGlobalThis !== void 0 && globalThis.crypto !== void 0) {
    return globalThis.crypto.subtle;
  }
  try {
    const { webcrypto: webcrypto3 } = await import("crypto");
    return webcrypto3.subtle;
  } catch (e) {
    throw new NotSupportedError(e);
  }
}
var NativeAlgorithm = class {
  constructor() {
    Object.defineProperty(this, "_api", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
  }
  async _setup() {
    if (this._api !== void 0) {
      return;
    }
    this._api = await loadSubtleCrypto();
  }
};

// node_modules/@hpke/common/esm/src/identifiers.js
var Mode = {
  Base: 0,
  Psk: 1,
  Auth: 2,
  AuthPsk: 3
};
var KemId = {
  NotAssigned: 0,
  DhkemP256HkdfSha256: 16,
  DhkemP384HkdfSha384: 17,
  DhkemP521HkdfSha512: 18,
  DhkemSecp256k1HkdfSha256: 19,
  DhkemX25519HkdfSha256: 32,
  DhkemX448HkdfSha512: 33,
  HybridkemX25519Kyber768: 48,
  MlKem512: 64,
  MlKem768: 65,
  MlKem1024: 66,
  XWing: 25722
};
var KdfId = {
  HkdfSha256: 1,
  HkdfSha384: 2,
  HkdfSha512: 3,
  Sha3256: 4,
  Sha3384: 5,
  Sha3512: 6,
  Shake128: 16,
  Shake256: 17,
  TurboShake128: 18,
  TurboShake256: 19
};
var AeadId = {
  Aes128Gcm: 1,
  Aes256Gcm: 2,
  Chacha20Poly1305: 3,
  ExportOnly: 65535
};

// node_modules/@hpke/common/esm/src/consts.js
var INPUT_LENGTH_LIMIT = 8192;
var INFO_LENGTH_LIMIT = 268435456;
var MINIMUM_PSK_LENGTH = 32;
var EMPTY = /* @__PURE__ */ new Uint8Array(0);
var BYTE_TO_BIGINT_256 = /* @__PURE__ */ (() => {
  const out = new Array(256);
  let i = 0;
  let value = 0n;
  while (i < 256) {
    out[i] = value;
    i++;
    value += 1n;
  }
  return out;
})();

// node_modules/@hpke/common/esm/src/interfaces/kemInterface.js
var SUITE_ID_HEADER_KEM = /* @__PURE__ */ new Uint8Array([
  75,
  69,
  77,
  0,
  0
]);

// node_modules/@hpke/common/esm/src/kdfs/hkdf.js
var HPKE_VERSION = /* @__PURE__ */ new Uint8Array([
  72,
  80,
  75,
  69,
  45,
  118,
  49
]);
function toUint8Array(input) {
  return new Uint8Array(toArrayBuffer(input));
}
function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice().buffer;
  }
  return new Uint8Array(input).slice().buffer;
}
var HkdfNative = class extends NativeAlgorithm {
  constructor() {
    super();
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: KdfId.HkdfSha256
    });
    Object.defineProperty(this, "hashSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "_suiteId", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: EMPTY
    });
    Object.defineProperty(this, "algHash", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        name: "HMAC",
        hash: "SHA-256",
        length: 256
      }
    });
  }
  init(suiteId) {
    this._suiteId = suiteId;
  }
  buildLabeledIkm(label, ikm) {
    this._checkInit();
    const ret = new Uint8Array(7 + this._suiteId.byteLength + label.byteLength + ikm.byteLength);
    ret.set(HPKE_VERSION, 0);
    ret.set(this._suiteId, 7);
    ret.set(label, 7 + this._suiteId.byteLength);
    ret.set(ikm, 7 + this._suiteId.byteLength + label.byteLength);
    return ret;
  }
  buildLabeledInfo(label, info, len) {
    this._checkInit();
    const ret = new Uint8Array(9 + this._suiteId.byteLength + label.byteLength + info.byteLength);
    ret.set(new Uint8Array([0, len]), 0);
    ret.set(HPKE_VERSION, 2);
    ret.set(this._suiteId, 9);
    ret.set(label, 9 + this._suiteId.byteLength);
    ret.set(info, 9 + this._suiteId.byteLength + label.byteLength);
    return ret;
  }
  async extract(salt, ikm) {
    await this._setup();
    const saltBuf = salt.byteLength === 0 ? new ArrayBuffer(this.hashSize) : toArrayBuffer(salt);
    if (saltBuf.byteLength !== this.hashSize) {
      throw new InvalidParamError("The salt length must be the same as the hashSize");
    }
    const ikmBuf = toArrayBuffer(ikm);
    const key = await this._api.importKey("raw", saltBuf, this.algHash, false, [
      "sign"
    ]);
    return await this._api.sign("HMAC", key, ikmBuf);
  }
  async expand(prk, info, len) {
    await this._setup();
    const prkBuf = toArrayBuffer(prk);
    const key = await this._api.importKey("raw", prkBuf, this.algHash, false, [
      "sign"
    ]);
    const okm = new ArrayBuffer(len);
    const okmBytes = new Uint8Array(okm);
    let prev = EMPTY;
    const mid = toUint8Array(info);
    const tail = new Uint8Array(1);
    if (len > 255 * this.hashSize) {
      throw new Error("Entropy limit reached");
    }
    const tmp = new Uint8Array(this.hashSize + mid.length + 1);
    for (let i = 1, cur = 0; cur < okmBytes.length; i++) {
      tail[0] = i;
      tmp.set(prev, 0);
      tmp.set(mid, prev.length);
      tmp.set(tail, prev.length + mid.length);
      prev = new Uint8Array(await this._api.sign("HMAC", key, tmp.slice(0, prev.length + mid.length + 1)));
      if (okmBytes.length - cur >= prev.length) {
        okmBytes.set(prev, cur);
        cur += prev.length;
      } else {
        okmBytes.set(prev.slice(0, okmBytes.length - cur), cur);
        cur += okmBytes.length - cur;
      }
    }
    return okm;
  }
  async extractAndExpand(salt, ikm, info, len) {
    await this._setup();
    const ikmBuf = toArrayBuffer(ikm);
    const baseKey = await this._api.importKey("raw", ikmBuf, "HKDF", false, ["deriveBits"]);
    return await this._api.deriveBits({
      name: "HKDF",
      hash: this.algHash.hash,
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info)
    }, baseKey, len * 8);
  }
  async labeledExtract(salt, label, ikm) {
    return await this.extract(salt, this.buildLabeledIkm(label, ikm));
  }
  async labeledExpand(prk, label, info, len) {
    return await this.expand(prk, this.buildLabeledInfo(label, info, len), len);
  }
  _checkInit() {
    if (this._suiteId === EMPTY) {
      throw new Error("Not initialized. Call init()");
    }
  }
};
var HkdfSha256Native = class extends HkdfNative {
  constructor() {
    super(...arguments);
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: KdfId.HkdfSha256
    });
    Object.defineProperty(this, "hashSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "algHash", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        name: "HMAC",
        hash: "SHA-256",
        length: 256
      }
    });
  }
};

// node_modules/@hpke/common/esm/src/utils/misc.js
var isCryptoKeyPair = (x) => typeof x === "object" && x !== null && typeof x.privateKey === "object" && typeof x.publicKey === "object";
function i2Osp(n, w) {
  if (w <= 0) {
    throw new Error("i2Osp: too small size");
  }
  if (n >= 256 ** w) {
    throw new Error("i2Osp: too large integer");
  }
  const ret = new Uint8Array(w);
  for (let i = 0; i < w && n; i++) {
    ret[w - (i + 1)] = n % 256;
    n = Math.floor(n / 256);
  }
  return ret;
}
function concat(a, b) {
  const ret = new Uint8Array(a.length + b.length);
  ret.set(a, 0);
  ret.set(b, a.length);
  return ret;
}
function base64UrlToBytes(v) {
  const base642 = v.replace(/-/g, "+").replace(/_/g, "/");
  const byteString = atob(base642);
  const ret = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ret[i] = byteString.charCodeAt(i);
  }
  return ret;
}
function xor(a, b) {
  if (a.byteLength !== b.byteLength) {
    throw new Error("xor: different length inputs");
  }
  const buf = new Uint8Array(a.byteLength);
  for (let i = 0; i < a.byteLength; i++) {
    buf[i] = a[i] ^ b[i];
  }
  return buf;
}

// node_modules/@hpke/common/esm/src/kems/dhkem.js
var LABEL_EAE_PRK = /* @__PURE__ */ new Uint8Array([
  101,
  97,
  101,
  95,
  112,
  114,
  107
]);
var LABEL_SHARED_SECRET = /* @__PURE__ */ new Uint8Array([
  115,
  104,
  97,
  114,
  101,
  100,
  95,
  115,
  101,
  99,
  114,
  101,
  116
]);
function concat3(a, b, c) {
  const ret = new Uint8Array(a.length + b.length + c.length);
  ret.set(a, 0);
  ret.set(b, a.length);
  ret.set(c, a.length + b.length);
  return ret;
}
var Dhkem = class {
  constructor(id, prim, kdf) {
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "secretSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "encSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "publicKeySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "privateKeySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "_prim", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_kdf", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.id = id;
    this._prim = prim;
    this._kdf = kdf;
    const suiteId = new Uint8Array(SUITE_ID_HEADER_KEM);
    suiteId.set(i2Osp(this.id, 2), 3);
    this._kdf.init(suiteId);
  }
  async serializePublicKey(key) {
    return await this._prim.serializePublicKey(key);
  }
  async deserializePublicKey(key) {
    return await this._prim.deserializePublicKey(toArrayBuffer(key));
  }
  async serializePrivateKey(key) {
    return await this._prim.serializePrivateKey(key);
  }
  async deserializePrivateKey(key) {
    return await this._prim.deserializePrivateKey(toArrayBuffer(key));
  }
  async importKey(format, key, isPublic = true) {
    return await this._prim.importKey(format, key, isPublic);
  }
  async generateKeyPair() {
    return await this._prim.generateKeyPair();
  }
  async deriveKeyPair(ikm) {
    const rawIkm = toArrayBuffer(ikm);
    if (rawIkm.byteLength > INPUT_LENGTH_LIMIT) {
      throw new InvalidParamError("Too long ikm");
    }
    return await this._prim.deriveKeyPair(rawIkm);
  }
  async encap(params) {
    let ke;
    if (params.ekm === void 0) {
      ke = await this.generateKeyPair();
    } else if (isCryptoKeyPair(params.ekm)) {
      ke = params.ekm;
    } else {
      ke = await this.deriveKeyPair(params.ekm);
    }
    const enc = await this._prim.serializePublicKey(ke.publicKey);
    const pkrm = await this._prim.serializePublicKey(params.recipientPublicKey);
    try {
      let dh;
      if (params.senderKey === void 0) {
        dh = new Uint8Array(await this._prim.dh(ke.privateKey, params.recipientPublicKey));
      } else {
        const sks = isCryptoKeyPair(params.senderKey) ? params.senderKey.privateKey : params.senderKey;
        const dh1 = new Uint8Array(await this._prim.dh(ke.privateKey, params.recipientPublicKey));
        const dh2 = new Uint8Array(await this._prim.dh(sks, params.recipientPublicKey));
        dh = concat(dh1, dh2);
      }
      let kemContext;
      if (params.senderKey === void 0) {
        kemContext = concat(new Uint8Array(enc), new Uint8Array(pkrm));
      } else {
        const pks = isCryptoKeyPair(params.senderKey) ? params.senderKey.publicKey : await this._prim.derivePublicKey(params.senderKey);
        const pksm = await this._prim.serializePublicKey(pks);
        kemContext = concat3(new Uint8Array(enc), new Uint8Array(pkrm), new Uint8Array(pksm));
      }
      const sharedSecret = await this._generateSharedSecret(dh, kemContext);
      return {
        enc,
        sharedSecret
      };
    } catch (e) {
      throw new EncapError(e);
    }
  }
  async decap(params) {
    const enc = toArrayBuffer(params.enc);
    const pke = await this._prim.deserializePublicKey(enc);
    const skr = isCryptoKeyPair(params.recipientKey) ? params.recipientKey.privateKey : params.recipientKey;
    const pkr = isCryptoKeyPair(params.recipientKey) ? params.recipientKey.publicKey : await this._prim.derivePublicKey(params.recipientKey);
    const pkrm = await this._prim.serializePublicKey(pkr);
    try {
      let dh;
      if (params.senderPublicKey === void 0) {
        dh = new Uint8Array(await this._prim.dh(skr, pke));
      } else {
        const dh1 = new Uint8Array(await this._prim.dh(skr, pke));
        const dh2 = new Uint8Array(await this._prim.dh(skr, params.senderPublicKey));
        dh = concat(dh1, dh2);
      }
      let kemContext;
      if (params.senderPublicKey === void 0) {
        kemContext = concat(new Uint8Array(enc), new Uint8Array(pkrm));
      } else {
        const pksm = await this._prim.serializePublicKey(params.senderPublicKey);
        kemContext = new Uint8Array(enc.byteLength + pkrm.byteLength + pksm.byteLength);
        kemContext.set(new Uint8Array(enc), 0);
        kemContext.set(new Uint8Array(pkrm), enc.byteLength);
        kemContext.set(new Uint8Array(pksm), enc.byteLength + pkrm.byteLength);
      }
      return await this._generateSharedSecret(dh, kemContext);
    } catch (e) {
      throw new DecapError(e);
    }
  }
  async _generateSharedSecret(dh, kemContext) {
    const labeledIkm = this._kdf.buildLabeledIkm(LABEL_EAE_PRK, dh);
    const labeledInfo = this._kdf.buildLabeledInfo(LABEL_SHARED_SECRET, kemContext, this.secretSize);
    return await this._kdf.extractAndExpand(EMPTY, labeledIkm, labeledInfo, this.secretSize);
  }
};

// node_modules/@hpke/common/esm/src/interfaces/dhkemPrimitives.js
var KEM_USAGES = ["deriveBits"];
var LABEL_DKP_PRK = /* @__PURE__ */ new Uint8Array([
  100,
  107,
  112,
  95,
  112,
  114,
  107
]);

// node_modules/@hpke/common/esm/src/utils/bignum.js
var Bignum = class {
  constructor(size) {
    Object.defineProperty(this, "_num", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._num = new Uint8Array(size);
  }
  val() {
    return this._num;
  }
  reset() {
    this._num.fill(0);
  }
  set(src) {
    if (src.length !== this._num.length) {
      throw new Error("Bignum.set: invalid argument");
    }
    this._num.set(src);
  }
  isZero() {
    for (let i = 0; i < this._num.length; i++) {
      if (this._num[i] !== 0) {
        return false;
      }
    }
    return true;
  }
  lessThan(v) {
    if (v.length !== this._num.length) {
      throw new Error("Bignum.lessThan: invalid argument");
    }
    for (let i = 0; i < this._num.length; i++) {
      if (this._num[i] < v[i]) {
        return true;
      }
      if (this._num[i] > v[i]) {
        return false;
      }
    }
    return false;
  }
};

// node_modules/@hpke/common/esm/src/kems/dhkemPrimitives/ec.js
var LABEL_CANDIDATE = /* @__PURE__ */ new Uint8Array([
  99,
  97,
  110,
  100,
  105,
  100,
  97,
  116,
  101
]);
var ORDER_P_256 = /* @__PURE__ */ new Uint8Array([
  255,
  255,
  255,
  255,
  0,
  0,
  0,
  0,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  188,
  230,
  250,
  173,
  167,
  23,
  158,
  132,
  243,
  185,
  202,
  194,
  252,
  99,
  37,
  81
]);
var ORDER_P_384 = /* @__PURE__ */ new Uint8Array([
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  199,
  99,
  77,
  129,
  244,
  55,
  45,
  223,
  88,
  26,
  13,
  178,
  72,
  176,
  167,
  122,
  236,
  236,
  25,
  106,
  204,
  197,
  41,
  115
]);
var ORDER_P_521 = /* @__PURE__ */ new Uint8Array([
  1,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  250,
  81,
  134,
  135,
  131,
  191,
  47,
  150,
  107,
  127,
  204,
  1,
  72,
  247,
  9,
  165,
  208,
  59,
  181,
  201,
  184,
  137,
  156,
  71,
  174,
  187,
  111,
  183,
  30,
  145,
  56,
  100,
  9
]);
var PKCS8_ALG_ID_P_256 = /* @__PURE__ */ new Uint8Array([
  48,
  65,
  2,
  1,
  0,
  48,
  19,
  6,
  7,
  42,
  134,
  72,
  206,
  61,
  2,
  1,
  6,
  8,
  42,
  134,
  72,
  206,
  61,
  3,
  1,
  7,
  4,
  39,
  48,
  37,
  2,
  1,
  1,
  4,
  32
]);
var PKCS8_ALG_ID_P_384 = /* @__PURE__ */ new Uint8Array([
  48,
  78,
  2,
  1,
  0,
  48,
  16,
  6,
  7,
  42,
  134,
  72,
  206,
  61,
  2,
  1,
  6,
  5,
  43,
  129,
  4,
  0,
  34,
  4,
  55,
  48,
  53,
  2,
  1,
  1,
  4,
  48
]);
var PKCS8_ALG_ID_P_521 = /* @__PURE__ */ new Uint8Array([
  48,
  96,
  2,
  1,
  0,
  48,
  16,
  6,
  7,
  42,
  134,
  72,
  206,
  61,
  2,
  1,
  6,
  5,
  43,
  129,
  4,
  0,
  35,
  4,
  73,
  48,
  71,
  2,
  1,
  1,
  4,
  66
]);
var EC_P_256_PARAMS = {
  p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
  b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
  gx: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
  gy: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
  coordinateSize: 32
};
var EC_P_384_PARAMS = {
  p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffffn,
  b: 0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aefn,
  gx: 0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7n,
  gy: 0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5fn,
  coordinateSize: 48
};
var EC_P_521_PARAMS = {
  p: (1n << 521n) - 1n,
  b: 0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00n,
  gx: 0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66n,
  gy: 0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650n,
  coordinateSize: 66
};
function mod3(a, p) {
  const r = a % p;
  return r >= 0n ? r : r + p;
}
function modPow(base, exponent, p) {
  let result = 1n;
  let b = mod3(base, p);
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = mod3(result * b, p);
    }
    b = mod3(b * b, p);
    e >>= 1n;
  }
  return result;
}
function modSqrt(rhs, p) {
  const y = modPow(rhs, p + 1n >> 2n, p);
  if (mod3(y * y, p) !== mod3(rhs, p)) {
    throw new Error("Invalid ECDH point");
  }
  return y;
}
function bytesToBigInt(bytes) {
  let v = 0n;
  for (const b of bytes) {
    v = v << 8n | BYTE_TO_BIGINT_256[b];
  }
  return v;
}
function bigIntToBytes(v, len) {
  const out = new Uint8Array(len);
  let n = v;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  if (n !== 0n) {
    throw new Error("Invalid coordinate length");
  }
  return out;
}
function buildRawUncompressedPublicKey(x, y, coordinateSize) {
  const out = new Uint8Array(1 + coordinateSize * 2);
  out[0] = 4;
  out.set(bigIntToBytes(x, coordinateSize), 1);
  out.set(bigIntToBytes(y, coordinateSize), 1 + coordinateSize);
  return out;
}
var Ec = class extends NativeAlgorithm {
  constructor(kem, hkdf) {
    super();
    Object.defineProperty(this, "_hkdf", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_alg", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_nPk", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_nSk", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_nDh", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_order", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_bitmask", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_pkcs8AlgId", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_curveParams", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._hkdf = hkdf;
    switch (kem) {
      case KemId.DhkemP256HkdfSha256:
        this._alg = { name: "ECDH", namedCurve: "P-256" };
        this._nPk = 65;
        this._nSk = 32;
        this._nDh = 32;
        this._order = ORDER_P_256;
        this._bitmask = 255;
        this._pkcs8AlgId = PKCS8_ALG_ID_P_256;
        this._curveParams = EC_P_256_PARAMS;
        break;
      case KemId.DhkemP384HkdfSha384:
        this._alg = { name: "ECDH", namedCurve: "P-384" };
        this._nPk = 97;
        this._nSk = 48;
        this._nDh = 48;
        this._order = ORDER_P_384;
        this._bitmask = 255;
        this._pkcs8AlgId = PKCS8_ALG_ID_P_384;
        this._curveParams = EC_P_384_PARAMS;
        break;
      default:
        this._alg = { name: "ECDH", namedCurve: "P-521" };
        this._nPk = 133;
        this._nSk = 66;
        this._nDh = 66;
        this._order = ORDER_P_521;
        this._bitmask = 1;
        this._pkcs8AlgId = PKCS8_ALG_ID_P_521;
        this._curveParams = EC_P_521_PARAMS;
        break;
    }
  }
  async serializePublicKey(key) {
    await this._setup();
    try {
      return await this._api.exportKey("raw", key);
    } catch (e) {
      throw new SerializeError(e);
    }
  }
  async deserializePublicKey(key) {
    await this._setup();
    try {
      return await this._importRawKey(toArrayBuffer(key), true);
    } catch (e) {
      throw new DeserializeError(e);
    }
  }
  async serializePrivateKey(key) {
    await this._setup();
    try {
      const jwk = await this._api.exportKey("jwk", key);
      if (!("d" in jwk)) {
        throw new Error("Not private key");
      }
      return base64UrlToBytes(jwk["d"]).buffer;
    } catch (e) {
      throw new SerializeError(e);
    }
  }
  async deserializePrivateKey(key) {
    await this._setup();
    try {
      return await this._importRawKey(toArrayBuffer(key), false);
    } catch (e) {
      throw new DeserializeError(e);
    }
  }
  async importKey(format, key, isPublic) {
    await this._setup();
    try {
      if (format === "raw") {
        return await this._importRawKey(key, isPublic);
      }
      if (key instanceof ArrayBuffer) {
        throw new Error("Invalid jwk key format");
      }
      return await this._importJWK(key, isPublic);
    } catch (e) {
      throw new DeserializeError(e);
    }
  }
  async generateKeyPair() {
    await this._setup();
    try {
      return await this._api.generateKey(this._alg, true, KEM_USAGES);
    } catch (e) {
      throw new NotSupportedError(e);
    }
  }
  async deriveKeyPair(ikm) {
    await this._setup();
    try {
      const rawIkm = toArrayBuffer(ikm);
      const dkpPrk = await this._hkdf.labeledExtract(EMPTY, LABEL_DKP_PRK, new Uint8Array(rawIkm));
      const bn = new Bignum(this._nSk);
      for (let counter = 0; bn.isZero() || !bn.lessThan(this._order); counter++) {
        if (counter > 255) {
          throw new Error("Faild to derive a key pair");
        }
        const bytes = new Uint8Array(await this._hkdf.labeledExpand(dkpPrk, LABEL_CANDIDATE, i2Osp(counter, 1), this._nSk));
        bytes[0] = bytes[0] & this._bitmask;
        bn.set(bytes);
      }
      const sk = await this._deserializePkcs8Key(bn.val());
      bn.reset();
      return {
        privateKey: sk,
        publicKey: await this.derivePublicKey(sk)
      };
    } catch (e) {
      throw new DeriveKeyPairError(e);
    }
  }
  async derivePublicKey(key) {
    await this._setup();
    try {
      const jwk = await this._api.exportKey("jwk", key);
      delete jwk["d"];
      delete jwk["key_ops"];
      return await this._api.importKey("jwk", jwk, this._alg, true, []);
    } catch {
      try {
        return await this._derivePublicKeyWithoutJwkExport(key);
      } catch (e) {
        throw new DeserializeError(e);
      }
    }
  }
  async dh(sk, pk) {
    try {
      await this._setup();
      const bits = await this._api.deriveBits({
        name: "ECDH",
        public: pk
      }, sk, this._nDh * 8);
      return bits;
    } catch (e) {
      throw new SerializeError(e);
    }
  }
  async _importRawKey(key, isPublic) {
    if (isPublic && key.byteLength !== this._nPk) {
      throw new Error("Invalid public key for the ciphersuite");
    }
    if (!isPublic && key.byteLength !== this._nSk) {
      throw new Error("Invalid private key for the ciphersuite");
    }
    if (isPublic) {
      return await this._api.importKey("raw", key, this._alg, true, []);
    }
    return await this._deserializePkcs8Key(new Uint8Array(key));
  }
  async _importJWK(key, isPublic) {
    if (typeof key.crv === "undefined" || key.crv !== this._alg.namedCurve) {
      throw new Error(`Invalid crv: ${key.crv}`);
    }
    if (isPublic) {
      if (typeof key.d !== "undefined") {
        throw new Error("Invalid key: `d` should not be set");
      }
      return await this._api.importKey("jwk", key, this._alg, true, []);
    }
    if (typeof key.d === "undefined") {
      throw new Error("Invalid key: `d` not found");
    }
    return await this._api.importKey("jwk", key, this._alg, true, KEM_USAGES);
  }
  async _deserializePkcs8Key(k) {
    const pkcs8Key = new Uint8Array(this._pkcs8AlgId.length + k.length);
    pkcs8Key.set(this._pkcs8AlgId, 0);
    pkcs8Key.set(k, this._pkcs8AlgId.length);
    return await this._api.importKey("pkcs8", pkcs8Key, this._alg, true, KEM_USAGES);
  }
  async _derivePublicKeyWithoutJwkExport(key) {
    const basePointRaw = buildRawUncompressedPublicKey(this._curveParams.gx, this._curveParams.gy, this._curveParams.coordinateSize);
    const basePoint = await this._api.importKey("raw", basePointRaw.buffer, this._alg, true, []);
    const xBytes = new Uint8Array(await this._api.deriveBits({
      name: "ECDH",
      public: basePoint
    }, key, this._nDh * 8));
    const p = this._curveParams.p;
    const x = bytesToBigInt(xBytes);
    const rhs = mod3(modPow(x, 3n, p) - 3n * x + this._curveParams.b, p);
    let y = modSqrt(rhs, p);
    if ((y & 1n) === 1n) {
      y = p - y;
    }
    const pubRaw = buildRawUncompressedPublicKey(x, y, this._curveParams.coordinateSize);
    return await this._api.importKey("raw", pubRaw.buffer, this._alg, true, []);
  }
};

// node_modules/@hpke/common/esm/src/interfaces/aeadEncryptionContext.js
var AEAD_USAGES = ["encrypt", "decrypt"];

// node_modules/@hpke/common/esm/src/utils/noble.js
function isBytes8(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber6(n, title = "") {
  if (!Number.isSafeInteger(n) || n < 0) {
    const prefix = title && `"${title}" `;
    throw new Error(`${prefix}expected integer >0, got ${n}`);
  }
}
function abytes8(value, length, title = "") {
  const bytes = isBytes8(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function aexists5(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished) {
    throw new Error("Hash#digest() has already been called");
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
var _endianTestBuffer = /* @__PURE__ */ new Uint32Array([287454020]);
var _endianTestBytes = /* @__PURE__ */ new Uint8Array(_endianTestBuffer.buffer);
var isLE3 = _endianTestBytes[0] === 68;

// node_modules/@hpke/common/esm/src/hash/hash.js
function ahash3(h) {
  if (typeof h !== "function" || typeof h.create !== "function") {
    throw new Error("Hash must wrapped by utils.createHasher");
  }
  anumber6(h.outputLen);
  anumber6(h.blockLen);
}

// node_modules/@hpke/common/esm/src/hash/hmac.js
var _HMAC = class {
  constructor(hash, key) {
    Object.defineProperty(this, "oHash", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "iHash", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "blockLen", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "outputLen", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "finished", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: false
    });
    Object.defineProperty(this, "destroyed", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: false
    });
    ahash3(hash);
    abytes8(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function") {
      throw new Error("Expected instance of class which extends utils.Hash");
    }
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
  update(buf) {
    aexists5(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists5(this);
    abytes8(out, this.outputLen, "output");
    this.finished = true;
    this.iHash.digestInto(out);
    this.oHash.update(out);
    this.oHash.digestInto(out);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac3 = (hash, key, message) => new _HMAC(hash, key).update(message).digest();
hmac3.create = (hash, key) => new _HMAC(hash, key);

// node_modules/@hpke/common/esm/src/hash/u64.js
var U32_MASK643 = 0xffffffffn;
var _32n3 = 32n;
function fromBig3(n, le = false) {
  if (le) {
    return { h: Number(n & U32_MASK643), l: Number(n >> _32n3 & U32_MASK643) };
  }
  return {
    h: Number(n >> _32n3 & U32_MASK643) | 0,
    l: Number(n & U32_MASK643) | 0
  };
}
function split3(lst, le = false) {
  const len = lst.length;
  const Ah = new Uint32Array(len);
  const Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig3(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}

// node_modules/@hpke/common/esm/src/hash/sha3.js
var _0n12 = 0n;
var _1n12 = 1n;
var _2n10 = 2n;
var _7n3 = 7n;
var _256n3 = 256n;
var _0x71n3 = 0x71n;
var SHA3_PI3 = [];
var SHA3_ROTL3 = [];
var _SHA3_IOTA3 = [];
for (let round = 0, R = _1n12, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI3.push(2 * (5 * y + x));
  SHA3_ROTL3.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n12;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n12 ^ (R >> _7n3) * _0x71n3) % _256n3;
    if (R & _2n10)
      t ^= _1n12 << (_1n12 << BigInt(j)) - _1n12;
  }
  _SHA3_IOTA3.push(t);
}
var IOTAS = split3(_SHA3_IOTA3, true);
var SHA3_IOTA_H3 = IOTAS[0];
var SHA3_IOTA_L3 = IOTAS[1];

// node_modules/@hpke/common/esm/src/curve/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */

// node_modules/@hpke/common/esm/src/curve/montgomery.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */

// node_modules/@hpke/core/esm/src/aeads/aesGcm.js
var AesGcmContext = class extends NativeAlgorithm {
  constructor(key) {
    super();
    Object.defineProperty(this, "_rawKey", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_key", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._rawKey = toArrayBuffer(key);
  }
  async seal(iv, data, aad2) {
    await this._setupKey();
    const alg = {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad2)
    };
    const ct = await this._api.encrypt(alg, this._key, toArrayBuffer(data));
    return ct;
  }
  async open(iv, data, aad2) {
    await this._setupKey();
    const alg = {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad2)
    };
    const pt = await this._api.decrypt(alg, this._key, toArrayBuffer(data));
    return pt;
  }
  async _setupKey() {
    if (this._key !== void 0) {
      return;
    }
    await this._setup();
    const key = await this._importKey(this._rawKey);
    new Uint8Array(this._rawKey).fill(0);
    this._key = key;
    return;
  }
  async _importKey(key) {
    return await this._api.importKey("raw", key, { name: "AES-GCM" }, true, AEAD_USAGES);
  }
};
var Aes128Gcm = class {
  constructor() {
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: AeadId.Aes128Gcm
    });
    Object.defineProperty(this, "keySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 16
    });
    Object.defineProperty(this, "nonceSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 12
    });
    Object.defineProperty(this, "tagSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 16
    });
  }
  createEncryptionContext(key) {
    return new AesGcmContext(key);
  }
};
var Aes256Gcm = class extends Aes128Gcm {
  constructor() {
    super(...arguments);
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: AeadId.Aes256Gcm
    });
    Object.defineProperty(this, "keySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "nonceSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 12
    });
    Object.defineProperty(this, "tagSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 16
    });
  }
};

// node_modules/@hpke/core/esm/src/utils/emitNotSupported.js
function emitNotSupported() {
  return new Promise((_resolve, reject) => {
    reject(new NotSupportedError("Not supported"));
  });
}

// node_modules/@hpke/core/esm/src/exporterContext.js
var LABEL_SEC = new Uint8Array([115, 101, 99]);
var ExporterContextImpl = class {
  constructor(api, kdf, exporterSecret) {
    Object.defineProperty(this, "_api", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "exporterSecret", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_kdf", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._api = api;
    this._kdf = kdf;
    this.exporterSecret = exporterSecret;
  }
  async seal(_data, _aad) {
    return await emitNotSupported();
  }
  async open(_data, _aad) {
    return await emitNotSupported();
  }
  async export(exporterContext, len) {
    const rawExporterContext = toArrayBuffer(exporterContext);
    if (rawExporterContext.byteLength > INPUT_LENGTH_LIMIT) {
      throw new InvalidParamError("Too long exporter context");
    }
    try {
      return await this._kdf.labeledExpand(this.exporterSecret, LABEL_SEC, new Uint8Array(rawExporterContext), len);
    } catch (e) {
      throw new ExportError(e);
    }
  }
};
var RecipientExporterContextImpl = class extends ExporterContextImpl {
};
var SenderExporterContextImpl = class extends ExporterContextImpl {
  constructor(api, kdf, exporterSecret, enc) {
    super(api, kdf, exporterSecret);
    Object.defineProperty(this, "enc", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.enc = enc;
    return;
  }
};

// node_modules/@hpke/core/esm/src/encryptionContext.js
var EncryptionContextImpl = class extends ExporterContextImpl {
  constructor(api, kdf, params) {
    super(api, kdf, params.exporterSecret);
    Object.defineProperty(this, "_aead", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_nK", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_nN", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_nT", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_ctx", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    if (params.key === void 0 || params.baseNonce === void 0 || params.seq === void 0) {
      throw new Error("Required parameters are missing");
    }
    this._aead = params.aead;
    this._nK = this._aead.keySize;
    this._nN = this._aead.nonceSize;
    this._nT = this._aead.tagSize;
    const key = this._aead.createEncryptionContext(params.key);
    this._ctx = {
      key,
      baseNonce: params.baseNonce,
      seq: params.seq
    };
  }
  computeNonce(k) {
    const seqBytes = i2Osp(k.seq, k.baseNonce.byteLength);
    return xor(k.baseNonce, seqBytes).buffer;
  }
  incrementSeq(k) {
    if (k.seq > Number.MAX_SAFE_INTEGER) {
      throw new MessageLimitReachedError("Message limit reached");
    }
    k.seq += 1;
    return;
  }
};

// node_modules/@hpke/core/esm/src/mutex.js
var __classPrivateFieldGet = function(receiver, state2, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state2.get(receiver);
};
var __classPrivateFieldSet = function(receiver, state2, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state2.set(receiver, value), value;
};
var _Mutex_locked;
var Mutex = class {
  constructor() {
    _Mutex_locked.set(this, Promise.resolve());
  }
  async lock() {
    let releaseLock;
    const nextLock = new Promise((resolve2) => {
      releaseLock = resolve2;
    });
    const previousLock = __classPrivateFieldGet(this, _Mutex_locked, "f");
    __classPrivateFieldSet(this, _Mutex_locked, nextLock, "f");
    await previousLock;
    return releaseLock;
  }
};
_Mutex_locked = /* @__PURE__ */ new WeakMap();

// node_modules/@hpke/core/esm/src/recipientContext.js
var __classPrivateFieldGet2 = function(receiver, state2, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state2.get(receiver);
};
var __classPrivateFieldSet2 = function(receiver, state2, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state2.set(receiver, value), value;
};
var _RecipientContextImpl_mutex;
var RecipientContextImpl = class extends EncryptionContextImpl {
  constructor() {
    super(...arguments);
    _RecipientContextImpl_mutex.set(this, void 0);
  }
  async open(data, aad2 = EMPTY.buffer) {
    __classPrivateFieldSet2(this, _RecipientContextImpl_mutex, __classPrivateFieldGet2(this, _RecipientContextImpl_mutex, "f") ?? new Mutex(), "f");
    const release = await __classPrivateFieldGet2(this, _RecipientContextImpl_mutex, "f").lock();
    let pt;
    try {
      pt = await this._ctx.key.open(this.computeNonce(this._ctx), toArrayBuffer(data), toArrayBuffer(aad2));
    } catch (e) {
      throw new OpenError(e);
    } finally {
      release();
    }
    this.incrementSeq(this._ctx);
    return pt;
  }
};
_RecipientContextImpl_mutex = /* @__PURE__ */ new WeakMap();

// node_modules/@hpke/core/esm/src/senderContext.js
var __classPrivateFieldGet3 = function(receiver, state2, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state2.get(receiver);
};
var __classPrivateFieldSet3 = function(receiver, state2, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state2.set(receiver, value), value;
};
var _SenderContextImpl_mutex;
var SenderContextImpl = class extends EncryptionContextImpl {
  constructor(api, kdf, params, enc) {
    super(api, kdf, params);
    Object.defineProperty(this, "enc", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    _SenderContextImpl_mutex.set(this, void 0);
    this.enc = enc;
  }
  async seal(data, aad2 = EMPTY.buffer) {
    __classPrivateFieldSet3(this, _SenderContextImpl_mutex, __classPrivateFieldGet3(this, _SenderContextImpl_mutex, "f") ?? new Mutex(), "f");
    const release = await __classPrivateFieldGet3(this, _SenderContextImpl_mutex, "f").lock();
    let ct;
    try {
      ct = await this._ctx.key.seal(this.computeNonce(this._ctx), toArrayBuffer(data), toArrayBuffer(aad2));
    } catch (e) {
      throw new SealError(e);
    } finally {
      release();
    }
    this.incrementSeq(this._ctx);
    return ct;
  }
};
_SenderContextImpl_mutex = /* @__PURE__ */ new WeakMap();

// node_modules/@hpke/core/esm/src/cipherSuiteNative.js
var LABEL_BASE_NONCE = new Uint8Array([
  98,
  97,
  115,
  101,
  95,
  110,
  111,
  110,
  99,
  101
]);
var LABEL_EXP = new Uint8Array([101, 120, 112]);
var LABEL_INFO_HASH = new Uint8Array([
  105,
  110,
  102,
  111,
  95,
  104,
  97,
  115,
  104
]);
var LABEL_KEY = new Uint8Array([107, 101, 121]);
var LABEL_PSK_ID_HASH = new Uint8Array([
  112,
  115,
  107,
  95,
  105,
  100,
  95,
  104,
  97,
  115,
  104
]);
var LABEL_SECRET = new Uint8Array([115, 101, 99, 114, 101, 116]);
var SUITE_ID_HEADER_HPKE = new Uint8Array([
  72,
  80,
  75,
  69,
  0,
  0,
  0,
  0,
  0,
  0
]);
var CipherSuiteNative = class extends NativeAlgorithm {
  /**
   * @param params A set of parameters for building a cipher suite.
   *
   * If the error occurred, throws {@link InvalidParamError}.
   *
   * @throws {@link InvalidParamError}
   */
  constructor(params) {
    super();
    Object.defineProperty(this, "_kem", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_kdf", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_aead", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_suiteId", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    if (typeof params.kem === "number") {
      throw new InvalidParamError("KemId cannot be used");
    }
    this._kem = params.kem;
    if (typeof params.kdf === "number") {
      throw new InvalidParamError("KdfId cannot be used");
    }
    this._kdf = params.kdf;
    if (typeof params.aead === "number") {
      throw new InvalidParamError("AeadId cannot be used");
    }
    this._aead = params.aead;
    this._suiteId = new Uint8Array(SUITE_ID_HEADER_HPKE);
    this._suiteId.set(i2Osp(this._kem.id, 2), 4);
    this._suiteId.set(i2Osp(this._kdf.id, 2), 6);
    this._suiteId.set(i2Osp(this._aead.id, 2), 8);
    this._kdf.init(this._suiteId);
  }
  /**
   * Gets the KEM context of the ciphersuite.
   */
  get kem() {
    return this._kem;
  }
  /**
   * Gets the KDF context of the ciphersuite.
   */
  get kdf() {
    return this._kdf;
  }
  /**
   * Gets the AEAD context of the ciphersuite.
   */
  get aead() {
    return this._aead;
  }
  /**
   * Creates an encryption context for a sender.
   *
   * If the error occurred, throws {@link DecapError} | {@link ValidationError}.
   *
   * @param params A set of parameters for the sender encryption context.
   * @returns A sender encryption context.
   * @throws {@link EncapError}, {@link ValidationError}
   */
  async createSenderContext(params) {
    this._validateInputLength(params);
    await this._setup();
    const dh = await this._kem.encap(params);
    let mode2;
    if (params.psk !== void 0) {
      mode2 = params.senderKey !== void 0 ? Mode.AuthPsk : Mode.Psk;
    } else {
      mode2 = params.senderKey !== void 0 ? Mode.Auth : Mode.Base;
    }
    return await this._keyScheduleS(mode2, dh.sharedSecret, dh.enc, params);
  }
  /**
   * Creates an encryption context for a recipient.
   *
   * If the error occurred, throws {@link DecapError}
   * | {@link DeserializeError} | {@link ValidationError}.
   *
   * @param params A set of parameters for the recipient encryption context.
   * @returns A recipient encryption context.
   * @throws {@link DecapError}, {@link DeserializeError}, {@link ValidationError}
   */
  async createRecipientContext(params) {
    this._validateInputLength(params);
    await this._setup();
    const sharedSecret = await this._kem.decap(params);
    let mode2;
    if (params.psk !== void 0) {
      mode2 = params.senderPublicKey !== void 0 ? Mode.AuthPsk : Mode.Psk;
    } else {
      mode2 = params.senderPublicKey !== void 0 ? Mode.Auth : Mode.Base;
    }
    return await this._keyScheduleR(mode2, sharedSecret, params);
  }
  /**
   * Encrypts a message to a recipient.
   *
   * If the error occurred, throws `EncapError` | `MessageLimitReachedError` | `SealError` | `ValidationError`.
   *
   * @param params A set of parameters for building a sender encryption context.
   * @param pt A plain text as bytes to be encrypted.
   * @param aad Additional authenticated data as bytes fed by an application.
   * @returns A cipher text and an encapsulated key as bytes.
   * @throws {@link EncapError}, {@link MessageLimitReachedError}, {@link SealError}, {@link ValidationError}
   */
  async seal(params, pt, aad2 = EMPTY.buffer) {
    const ctx = await this.createSenderContext(params);
    return {
      ct: await ctx.seal(pt, aad2),
      enc: ctx.enc
    };
  }
  /**
   * Decrypts a message from a sender.
   *
   * If the error occurred, throws `DecapError` | `DeserializeError` | `OpenError` | `ValidationError`.
   *
   * @param params A set of parameters for building a recipient encryption context.
   * @param ct An encrypted text as bytes to be decrypted.
   * @param aad Additional authenticated data as bytes fed by an application.
   * @returns A decrypted plain text as bytes.
   * @throws {@link DecapError}, {@link DeserializeError}, {@link OpenError}, {@link ValidationError}
   */
  async open(params, ct, aad2 = EMPTY.buffer) {
    const ctx = await this.createRecipientContext(params);
    return await ctx.open(ct, aad2);
  }
  // private verifyPskInputs(mode: Mode, params: KeyScheduleParams) {
  //   const gotPsk = (params.psk !== undefined);
  //   const gotPskId = (params.psk !== undefined && params.psk.id.byteLength > 0);
  //   if (gotPsk !== gotPskId) {
  //     throw new Error('Inconsistent PSK inputs');
  //   }
  //   if (gotPsk && (mode === Mode.Base || mode === Mode.Auth)) {
  //     throw new Error('PSK input provided when not needed');
  //   }
  //   if (!gotPsk && (mode === Mode.Psk || mode === Mode.AuthPsk)) {
  //     throw new Error('Missing required PSK input');
  //   }
  //   return;
  // }
  async _keySchedule(mode2, sharedSecret, params) {
    const pskId = params.psk === void 0 ? EMPTY : toUint8Array(params.psk.id);
    const pskIdHash = await this._kdf.labeledExtract(EMPTY, LABEL_PSK_ID_HASH, pskId);
    const info = params.info === void 0 ? EMPTY : toUint8Array(params.info);
    const infoHash = await this._kdf.labeledExtract(EMPTY, LABEL_INFO_HASH, info);
    const keyScheduleContext = new Uint8Array(1 + pskIdHash.byteLength + infoHash.byteLength);
    keyScheduleContext.set(new Uint8Array([mode2]), 0);
    keyScheduleContext.set(new Uint8Array(pskIdHash), 1);
    keyScheduleContext.set(new Uint8Array(infoHash), 1 + pskIdHash.byteLength);
    const psk = params.psk === void 0 ? EMPTY : toUint8Array(params.psk.key);
    const ikm = this._kdf.buildLabeledIkm(LABEL_SECRET, psk);
    const exporterSecretInfo = this._kdf.buildLabeledInfo(LABEL_EXP, keyScheduleContext, this._kdf.hashSize);
    const exporterSecret = await this._kdf.extractAndExpand(sharedSecret, ikm, exporterSecretInfo, this._kdf.hashSize);
    if (this._aead.id === AeadId.ExportOnly) {
      return { aead: this._aead, exporterSecret };
    }
    const keyInfo = this._kdf.buildLabeledInfo(LABEL_KEY, keyScheduleContext, this._aead.keySize);
    const key = await this._kdf.extractAndExpand(sharedSecret, ikm, keyInfo, this._aead.keySize);
    const baseNonceInfo = this._kdf.buildLabeledInfo(LABEL_BASE_NONCE, keyScheduleContext, this._aead.nonceSize);
    const baseNonce = await this._kdf.extractAndExpand(sharedSecret, ikm, baseNonceInfo, this._aead.nonceSize);
    return {
      aead: this._aead,
      exporterSecret,
      key,
      baseNonce: new Uint8Array(baseNonce),
      seq: 0
    };
  }
  async _keyScheduleS(mode2, sharedSecret, enc, params) {
    const res = await this._keySchedule(mode2, sharedSecret, params);
    if (res.key === void 0) {
      return new SenderExporterContextImpl(this._api, this._kdf, res.exporterSecret, enc);
    }
    return new SenderContextImpl(this._api, this._kdf, res, enc);
  }
  async _keyScheduleR(mode2, sharedSecret, params) {
    const res = await this._keySchedule(mode2, sharedSecret, params);
    if (res.key === void 0) {
      return new RecipientExporterContextImpl(this._api, this._kdf, res.exporterSecret);
    }
    return new RecipientContextImpl(this._api, this._kdf, res);
  }
  _validateInputLength(params) {
    if (params.info !== void 0 && params.info.byteLength > INFO_LENGTH_LIMIT) {
      throw new InvalidParamError("Too long info");
    }
    if (params.psk !== void 0) {
      if (params.psk.key.byteLength < MINIMUM_PSK_LENGTH) {
        throw new InvalidParamError(`PSK must have at least ${MINIMUM_PSK_LENGTH} bytes`);
      }
      if (params.psk.key.byteLength > INPUT_LENGTH_LIMIT) {
        throw new InvalidParamError("Too long psk.key");
      }
      if (params.psk.id.byteLength > INPUT_LENGTH_LIMIT) {
        throw new InvalidParamError("Too long psk.id");
      }
    }
    return;
  }
};

// node_modules/@hpke/core/esm/src/kems/dhkemNative.js
var DhkemP256HkdfSha256Native = class extends Dhkem {
  constructor() {
    const kdf = new HkdfSha256Native();
    const prim = new Ec(KemId.DhkemP256HkdfSha256, kdf);
    super(KemId.DhkemP256HkdfSha256, prim, kdf);
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: KemId.DhkemP256HkdfSha256
    });
    Object.defineProperty(this, "secretSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "encSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 65
    });
    Object.defineProperty(this, "publicKeySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 65
    });
    Object.defineProperty(this, "privateKeySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
  }
};

// node_modules/@hpke/core/esm/src/native.js
var CipherSuite = class extends CipherSuiteNative {
};
var DhkemP256HkdfSha256 = class extends DhkemP256HkdfSha256Native {
};
var HkdfSha256 = class extends HkdfSha256Native {
};

// node_modules/@hpke/core/esm/src/kems/dhkemPrimitives/x25519.js
var PKCS8_ALG_ID_X25519 = new Uint8Array([
  48,
  46,
  2,
  1,
  0,
  48,
  5,
  6,
  3,
  43,
  101,
  110,
  4,
  34,
  4,
  32
]);

// node_modules/@hpke/core/esm/src/kems/dhkemPrimitives/x448.js
var PKCS8_ALG_ID_X448 = new Uint8Array([
  48,
  70,
  2,
  1,
  0,
  48,
  5,
  6,
  3,
  43,
  101,
  111,
  4,
  58,
  4,
  56
]);

// packages/domain/src/digest256.ts
var U128_LIMIT = 1n << 128n;

// packages/domain/src/index.ts
var STARKNET_FELT_LIMIT = 2n ** 251n;
var STARKNET_U128_LIMIT = 2n ** 128n;

// packages/private-intents/src/protocol.ts
var MAX_U256 = (1n << 256n) - 1n;
var MAX_DIRECTORY_LIFETIME_SECONDS = 366 * 24 * 60 * 60;
var MAX_RFQ_LIFETIME_SECONDS = 24 * 60 * 60;
var MAX_ENVELOPE_LIFETIME_SECONDS = 60 * 60;
var MAX_RESERVATION_LIFETIME_SECONDS = 24 * 60 * 60;
var MAX_DIRECTORY_PUBLICATION_LEAD_SECONDS = 24 * 60 * 60;

// packages/private-intents/src/hpke.ts
var RFQ_PADDING_BUCKETS = Object.freeze([512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]);
var RFQ_HPKE_AEAD_TAG_BYTES = 16;
var RFQ_FRAME_LENGTH_BYTES = 2;
var encoder = new TextEncoder();
function createRfqHpkeSuite() {
  return new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm()
  });
}
function encodeBase64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decodeBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("HPKE input is malformed.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("HPKE input is malformed.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64url(bytes) !== value) throw new Error("HPKE input must use canonical unpadded base64url.");
  return bytes;
}
function padRfqPlaintext(canonical, bucketBytes) {
  if (!RFQ_PADDING_BUCKETS.includes(bucketBytes)) throw new Error("HPKE padding bucket is not reviewed.");
  const payload = encoder.encode(canonical);
  const plaintextBytes = bucketBytes - RFQ_HPKE_AEAD_TAG_BYTES;
  if (payload.length > plaintextBytes - RFQ_FRAME_LENGTH_BYTES || payload.length > 65535) throw new Error("RFQ does not fit a reviewed HPKE padding bucket.");
  const frame = new Uint8Array(plaintextBytes);
  new DataView(frame.buffer).setUint16(0, payload.length, false);
  frame.set(payload, RFQ_FRAME_LENGTH_BYTES);
  return frame;
}
function unpadRfqPlaintext(frame) {
  if (frame.length < RFQ_FRAME_LENGTH_BYTES) throw new Error("HPKE plaintext framing is invalid.");
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(0, false);
  if (length > frame.length - RFQ_FRAME_LENGTH_BYTES) throw new Error("HPKE plaintext framing is invalid.");
  for (const byte of frame.subarray(RFQ_FRAME_LENGTH_BYTES + length)) if (byte !== 0) throw new Error("HPKE plaintext padding is invalid.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(RFQ_FRAME_LENGTH_BYTES, RFQ_FRAME_LENGTH_BYTES + length));
  } catch {
    throw new Error("HPKE plaintext encoding is invalid.");
  }
}

// packages/private-intents/src/starknet-maker.ts
var encoder2 = new TextEncoder();
var DOMAIN = "app20/starknet-maker/v1";
var FIELD = (1n << 251n) + 17n * (1n << 192n) + 1n;
function felt2(value) {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value) || BigInt(value) <= 0n || BigInt(value) >= FIELD) throw new Error("Invalid nonzero felt.");
  return `0x${BigInt(value).toString(16)}`;
}
function amount(value) {
  if (!/^[1-9][0-9]{0,38}$/.test(value) || BigInt(value) >= 1n << 128n) throw new Error("Amount must be a positive u128 in base units.");
  return BigInt(value);
}
function validateTerms(value) {
  if (felt2(value.sellToken) === felt2(value.buyToken)) throw new Error("Choose two different tokens.");
  amount(value.sellAmount);
  amount(value.minBuyAmount);
}
function aad(scope, direction) {
  if (!Number.isSafeInteger(scope.revision) || scope.revision <= 0 || !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt <= 0) throw new Error("Invalid request scope.");
  return encoder2.encode(JSON.stringify([DOMAIN, direction, felt2(scope.chainId), felt2(scope.book), felt2(scope.id), felt2(scope.maker), felt2(scope.taker), scope.revision, scope.expiresAt]));
}
async function publicKey(jwk) {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y || jwk.d) throw new Error("Expected a public P-256 key.");
  return crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, { name: "ECDH", namedCurve: "P-256" }, true, []);
}
function packBytes(bytes) {
  if (bytes.length < 1 || bytes.length > 4096) throw new Error("Encrypted payload exceeds the chain limit.");
  const values = [`0x${bytes.length.toString(16)}`];
  for (let offset = 0; offset < bytes.length; offset += 31) {
    values.push(`0x${Array.from(bytes.subarray(offset, offset + 31), (b) => b.toString(16).padStart(2, "0")).join("")}`);
  }
  return values;
}
function unpackBytes(values) {
  const length = Number(BigInt(values[0] ?? "0"));
  if (!Number.isSafeInteger(length) || length < 1 || length > 4096 || values.length !== 1 + Math.ceil(length / 31)) throw new Error("Malformed encrypted payload.");
  const out = new Uint8Array(length);
  for (let i = 1; i < values.length; i++) {
    const size = Math.min(31, length - (i - 1) * 31);
    const value = BigInt(values[i]);
    if (value < 0n || value >= 1n << BigInt(size * 8)) throw new Error("Noncanonical encrypted payload.");
    const hex = value.toString(16).padStart(size * 2, "0");
    out.set(Uint8Array.from(hex.match(/../g), (x) => parseInt(x, 16)), (i - 1) * 31);
  }
  return out;
}
async function seal(scope, direction, body, recipient) {
  const canonical = JSON.stringify(body);
  const size = encoder2.encode(canonical).length;
  const bucket = [512, 1024, 2048].find((n) => size <= n - 18);
  if (!bucket) throw new Error("Quote request is too large.");
  const result = await createRfqHpkeSuite().seal({ recipientPublicKey: recipient, info: encoder2.encode(DOMAIN) }, padRfqPlaintext(canonical, bucket), aad(scope, direction));
  return packBytes(new Uint8Array([1, ...new Uint8Array(result.enc), ...new Uint8Array(result.ct)]));
}
async function open(scope, direction, payload, recipientKey) {
  const bytes = unpackBytes(payload);
  if (bytes[0] !== 1 || bytes[1] !== 4 || ![578, 1090, 2114].includes(bytes.length)) throw new Error("Unsupported encrypted envelope.");
  const plain = await createRfqHpkeSuite().open({ recipientKey, enc: bytes.slice(1, 66).buffer, info: encoder2.encode(DOMAIN) }, bytes.slice(66).buffer, aad(scope, direction));
  return JSON.parse(unpadRfqPlaintext(new Uint8Array(plain)));
}
async function decodeRequest(body) {
  if (!body || typeof body !== "object") throw new Error("Invalid request.");
  const v = body;
  validateTerms(v);
  await publicKey(v.replyKey);
  return { sellToken: felt2(v.sellToken), buyToken: felt2(v.buyToken), sellAmount: v.sellAmount, minBuyAmount: v.minBuyAmount, replyKey: v.replyKey, ...v.settlementCommitment ? { settlementCommitment: felt2(v.settlementCommitment) } : {} };
}
function responseCall(scope, payload) {
  aad(scope, "quote");
  unpackBytes(payload);
  return { contractAddress: felt2(scope.book), entrypoint: "respond", calldata: [felt2(scope.id), String(payload.length), ...payload] };
}
function keyCoordinates(jwk) {
  if (!jwk.x || !jwk.y || jwk.d) throw new Error("Expected public key.");
  return [jwk.x, jwk.y].flatMap((coordinate) => {
    const bytes = decodeBase64url(coordinate);
    if (bytes.length !== 32) throw new Error("Invalid coordinate.");
    const n = BigInt(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`);
    return [(n & (1n << 128n) - 1n).toString(), (n >> 128n).toString()];
  });
}
function coordinatesKey(values) {
  if (values.length !== 4) throw new Error("Invalid key length.");
  const coordinates = [0, 2].map((i) => {
    const lo = BigInt(values[i]), hi = BigInt(values[i + 1]);
    if (lo < 0n || hi < 0n || lo >= 1n << 128n || hi >= 1n << 128n) throw new Error("Invalid key limbs.");
    const hex = (lo + (hi << 128n)).toString(16).padStart(64, "0");
    return encodeBase64url(Uint8Array.from(hex.match(/../g), (x) => parseInt(x, 16)));
  });
  return { kty: "EC", crv: "P-256", x: coordinates[0], y: coordinates[1] };
}

// packages/maker-node/src/response-limits.ts
function validateResponseLimits(limits) {
  for (const [value, max] of [[limits.maxActiveReservations ?? 20, 1e3], [limits.responseCooldownSeconds ?? 60, 3600], [limits.reservationCooldownSeconds ?? 1200, 86400]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error("Invalid maker response limits.");
  }
}
function canRespond(limits, recent, taker, now, firm, activeReservations) {
  validateResponseLimits(limits);
  if (firm && activeReservations >= (limits.maxActiveReservations ?? 20)) return false;
  const previous = recent[felt2(taker)];
  if (!previous) return true;
  if (firm && !previous.firm) return true;
  return now - previous.at >= (previous.firm ? limits.reservationCooldownSeconds ?? 1200 : limits.responseCooldownSeconds ?? 60);
}

// packages/maker-node/src/starknet-pricing.ts
function validateMarket(market) {
  validateTerms({ ...market, sellAmount: market.maxSellAmount, minBuyAmount: market.maxBuyAmount });
  amount(market.numerator);
  amount(market.denominator);
  if (!Number.isSafeInteger(market.spreadBps) || market.spreadBps < 0 || market.spreadBps >= 1e4 || !Number.isSafeInteger(market.validUntil) || market.validUntil <= 0) throw new Error("Invalid operator price policy.");
}
function priceRequest(terms, markets, now, requestExpiry, ttlSeconds = 120) {
  validateTerms(terms);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) throw new Error("Quote TTL must be between 60 and 3600 seconds.");
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(requestExpiry) || requestExpiry <= now) return void 0;
  for (const market of markets) {
    validateMarket(market);
    if (felt2(market.sellToken) !== felt2(terms.sellToken) || felt2(market.buyToken) !== felt2(terms.buyToken) || market.validUntil <= now) continue;
    if (amount(terms.sellAmount) > amount(market.maxSellAmount)) continue;
    const receive = amount(terms.sellAmount) * amount(market.numerator) * BigInt(1e4 - market.spreadBps) / (amount(market.denominator) * 10000n);
    if (receive < amount(terms.minBuyAmount) || receive > amount(market.maxBuyAmount) || receive >= 1n << 128n) continue;
    return { kind: "indicative", buyAmount: receive.toString(), expiresAt: Math.min(now + ttlSeconds, requestExpiry, market.validUntil) };
  }
  return void 0;
}

// src/lib/starknet-maker-client.ts
async function verifyMakerBook(provider2, config4) {
  if (!Number.isSafeInteger(config4.fromBlock) || config4.fromBlock < 0) throw new Error("Invalid maker deployment block.");
  if (felt2(await provider2.getChainId()) !== felt2(config4.chainId)) throw new Error("Maker book network does not match.");
  const head = await provider2.getBlockWithTxHashes("latest");
  if (!("block_hash" in head) || !head.block_hash || !("block_number" in head)) throw new Error("Confirmed block unavailable.");
  const block = head.block_hash;
  if (felt2(await provider2.getClassHashAt(config4.address, block)) !== felt2(config4.classHash)) throw new Error("Maker book contract does not match the pinned deployment.");
  return { block, number: head.block_number, timestamp: head.timestamp };
}
async function verifySettlement(provider2, config4, deployment, requireOutputNotes = true) {
  const head = await verifyMakerBook(provider2, config4);
  const [classHash, poolClassHash, pool, book, blocked] = await Promise.all([
    provider2.getClassHashAt(deployment.address, head.block),
    requireOutputNotes ? provider2.getClassHashAt(deployment.pool, head.block) : Promise.resolve(deployment.poolClassHash),
    provider2.callContract({ contractAddress: deployment.address, entrypoint: "pool", calldata: [] }, head.block),
    provider2.callContract({ contractAddress: deployment.address, entrypoint: "book", calldata: [] }, head.block),
    requireOutputNotes ? provider2.callContract({ contractAddress: deployment.pool, entrypoint: "is_open_note_depositor_blocked", calldata: [deployment.address] }, head.block) : Promise.resolve(["0x0"])
  ]);
  if (felt2(classHash) !== felt2(deployment.classHash) || felt2(poolClassHash) !== felt2(deployment.poolClassHash) || felt2(pool[0]) !== felt2(deployment.pool) || felt2(book[0]) !== felt2(config4.address)) throw new Error("Settlement deployment or privacy pool does not match its pinned configuration.");
  if (blocked.length !== 1 || BigInt(blocked[0]) !== 0n) throw new Error("The privacy pool does not currently accept output notes from this settlement contract.");
  return head;
}

// scripts/starknet-maker.mjs
var [configPath, mode = "--check"] = process.argv.slice(2);
if (["--register", "--run", "--fund"].includes(mode)) rejectPublicSettlement();
if (configPath === "--init-key") {
  if (!mode || mode.startsWith("--")) throw new Error("Usage: node app20-maker.mjs --init-key ./maker-key.json");
  const path = resolve(mode);
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const fd = openSync(path, "wx", 384);
  try {
    writeFileSync(fd, JSON.stringify(privateJwk) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  console.log("Private key saved locally with owner-only permissions. Paste only this PUBLIC key into maker setup:");
  console.log(JSON.stringify(publicJwk));
  process.exit(0);
}
if (!configPath || !["--check", "--register", "--run", "--deactivate", "--fund", "--withdraw", "--release", "--reconcile"].includes(mode)) {
  console.error("Usage: npm run maker -- operator.json [--check|--register|--run|--deactivate|--fund|--withdraw|--release|--reconcile]");
  process.exit(1);
}
var config3 = JSON.parse(readFileSync(resolve(configPath), "utf8"));
var url = new URL(config3.rpcUrl);
if (url.username || url.password || url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Use an HTTPS Starknet RPC, or loopback for development.");
felt2(config3.account);
felt2(config3.address);
felt2(config3.classHash);
felt2(config3.chainId);
if (!Array.isArray(config3.markets)) throw new Error("Expected operator markets.");
config3.markets.forEach(validateMarket);
validateResponseLimits(config3);
if (!Number.isSafeInteger(config3.maxResponses) || config3.maxResponses < 1 || config3.maxResponses > 1e3) throw new Error("Set maxResponses between 1 and 1000 per run.");
if (!/^[1-9][0-9]*$/.test(config3.maxFeePerTransaction) || !/^[1-9][0-9]*$/.test(config3.maxTotalFees)) throw new Error("Set positive STRK base-unit fee caps.");
var provider = new RpcProvider({ nodeUrl: config3.rpcUrl });
var verifyConfigSettlement = () => verifySettlement(provider, config3, config3.settlement, !["--withdraw", "--release", "--reconcile", "--deactivate"].includes(mode));
await verifyMakerBook(provider, config3);
if (config3.settlement) await verifyConfigSettlement();
if (mode === "--check") {
  console.log(`Deployment and pricing configuration verified. No signing key loaded; no transaction sent. ${config3.settlement ? "Funded private settlement configured." : "Indicative quoting only; no settlement configured."}`);
  process.exit(0);
}
var signingKey = process.env.APP20_MAKER_SIGNING_KEY;
if (!signingKey && mode !== "--reconcile") throw new Error("Set APP20_MAKER_SIGNING_KEY for this operator account.");
var account = signingKey ? new Account({ provider, address: config3.account, signer: signingKey, cairoVersion: "1" }) : void 0;
var statePath = resolve(config3.stateFile);
mkdirSync(dirname(statePath), { recursive: true, mode: 448 });
var lock = openSync(`${statePath}.lock`, "wx", 384);
var state;
try {
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { scope: [felt2(config3.chainId), felt2(config3.address), felt2(config3.account)].join("/"), cursor: config3.fromBlock, spent: "0", pending: null, reservations: [], settlement: config3.settlement?.address ?? null };
  }
  if (state.scope !== [felt2(config3.chainId), felt2(config3.address), felt2(config3.account)].join("/") || !Number.isSafeInteger(state.cursor) || state.cursor < config3.fromBlock || !/^[0-9]+$/.test(state.spent)) throw new Error("Maker state does not match this account/deployment.");
  if ((state.settlement ?? null) !== (config3.settlement?.address ?? null)) throw new Error("Use a separate state file for a different settlement deployment.");
  state.reservations ??= [];
  state.recentResponses ??= {};
  if (!Array.isArray(state.reservations)) throw new Error("Invalid reservation state.");
  if (state.pending && mode !== "--reconcile") throw new Error("An earlier transaction is unresolved. Reconcile it on Starknet before clearing pending state; do not blindly resend.");
  const save = () => {
    const fd = openSync(`${statePath}.next`, "w", 384);
    try {
      writeFileSync(fd, `${JSON.stringify(state)}
`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(`${statePath}.next`, statePath);
    const dir = openSync(dirname(statePath), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  };
  const send = async (input, reservationId) => {
    const calls = Array.isArray(input) ? input : [input];
    if (config3.settlement) await verifyConfigSettlement();
    await verifyMakerBook(provider, config3);
    const estimate = await account.estimateInvokeFee(calls, { tip: 0n });
    const bounds = estimate.resourceBounds;
    const cap = Object.values(bounds).reduce((sum, resource) => sum + BigInt(resource.max_amount) * BigInt(resource.max_price_per_unit), 0n);
    if (cap > BigInt(config3.maxFeePerTransaction) || cap + BigInt(state.spent) > BigInt(config3.maxTotalFees)) throw new Error("Operator gas budget reached.");
    state.pending = { entrypoints: calls.map((call) => call.entrypoint), hash: null, reservationId };
    state.spent = (BigInt(state.spent) + cap).toString();
    save();
    const tx = await account.execute(calls, { resourceBounds: bounds, tip: 0n });
    state.pending.hash = tx.transaction_hash;
    save();
    const receipt = await provider.waitForTransaction(tx.transaction_hash, { retryInterval: url.protocol === "http:" ? 100 : 5e3 });
    if (receipt.isReverted()) throw new Error("Maker transaction reverted; inspect the saved hash.");
    if (reservationId && !state.reservations.includes(reservationId)) state.reservations.push(reservationId);
    state.pending = null;
    save();
    console.log(`Confirmed ${calls.map((call) => call.entrypoint).join(" + ")}: ${tx.transaction_hash}`);
  };
  async function releaseReservations() {
    if (!config3.settlement) return;
    for (const id of [...state.reservations]) {
      const head = await verifyConfigSettlement();
      const quote = await provider.callContract({ contractAddress: config3.settlement.address, entrypoint: "quote", calldata: [id] }, head.block);
      const status = Number(BigInt(quote[7]));
      if (status === 1 && Number(BigInt(quote[6])) <= head.timestamp) await send({ contractAddress: config3.settlement.address, entrypoint: "release_expired", calldata: [id] });
      else if (status === 1) continue;
      state.reservations = state.reservations.filter((value) => value !== id);
      save();
    }
  }
  if (mode === "--reconcile") {
    if (!state.pending) {
      console.log("No pending transaction.");
    } else {
      if (!state.pending.hash) throw new Error("No transaction hash was returned. Inspect account activity before resolving this state manually.");
      const receipt = await provider.getTransactionReceipt(state.pending.hash);
      if (!receipt.isSuccess() && !receipt.isReverted()) throw new Error("The transaction is not final enough to reconcile.");
      if (receipt.isSuccess() && state.pending.reservationId && !state.reservations.includes(state.pending.reservationId)) state.reservations.push(state.pending.reservationId);
      state.pending = null;
      save();
      console.log("Confirmed transaction reconciled; gas budget remains conservatively reserved.");
    }
  } else if (["--fund", "--withdraw", "--release"].includes(mode)) {
    if (!config3.settlement) throw new Error("Configure a pinned settlement deployment first.");
    await verifyConfigSettlement();
    if (mode === "--release") {
      await releaseReservations();
    } else {
      const movement = mode === "--fund" ? config3.inventoryFunding : config3.inventoryWithdrawal;
      if (!movement || !/^[1-9][0-9]*$/.test(movement.amount) || BigInt(movement.amount) >= 1n << 128n) throw new Error("Configure an explicit positive u128 inventory amount.");
      const token = felt2(movement.token);
      const movementCall = { contractAddress: config3.settlement.address, entrypoint: mode === "--fund" ? "deposit_inventory" : "withdraw_inventory", calldata: [token, movement.amount] };
      await send(mode === "--fund" ? [{ contractAddress: token, entrypoint: "approve", calldata: [config3.settlement.address, movement.amount, "0"] }, movementCall] : movementCall);
    }
  } else if (mode === "--deactivate") {
    await send({ contractAddress: config3.address, entrypoint: "deactivate", calldata: [] });
  } else {
    let jwk;
    try {
      jwk = JSON.parse(process.env.APP20_MAKER_TRANSPORT_FILE ? readFileSync(resolve(process.env.APP20_MAKER_TRANSPORT_FILE), "utf8") : process.env.APP20_MAKER_TRANSPORT_JWK ?? "");
    } catch {
      throw new Error("Set APP20_MAKER_TRANSPORT_FILE to the private P-256 key file, or APP20_MAKER_TRANSPORT_JWK.");
    }
    if (!jwk.d) throw new Error("Transport private key is missing.");
    const recipientKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const pub = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
    const recipientPair = { privateKey: recipientKey, publicKey: await publicKey(pub) };
    if (mode === "--register") {
      const head = await verifyMakerBook(provider, config3);
      if (!Number.isSafeInteger(config3.keyValidUntil) || config3.keyValidUntil <= head.timestamp || config3.keyValidUntil > head.timestamp + 2592e3) throw new Error("keyValidUntil must be within the next 30 days.");
      await send({ contractAddress: config3.address, entrypoint: "register", calldata: [...keyCoordinates(pub), String(config3.keyValidUntil)] });
    } else {
      let responses = 0;
      while (responses < config3.maxResponses) {
        await releaseReservations();
        const head = await verifyMakerBook(provider, config3);
        const registered = await provider.callContract({ contractAddress: config3.address, entrypoint: "maker", calldata: [config3.account] }, head.block);
        const registeredKey = coordinatesKey(registered.slice(0, 4));
        if (registeredKey.x !== pub.x || registeredKey.y !== pub.y || Number(BigInt(registered[5])) <= head.timestamp) throw new Error("Register this encryption key before running the bot.");
        const end = Math.min(head.number, state.cursor + 999);
        if (Math.max(config3.fromBlock, state.cursor - 100) <= end) {
          let continuation_token;
          const seenTokens = /* @__PURE__ */ new Set();
          do {
            const page = await provider.getEvents({ address: config3.address, from_block: { block_number: Math.max(config3.fromBlock, state.cursor - 100) }, to_block: { block_number: end }, keys: [[hash_exports.getSelectorFromName("Requested")], [config3.account]], chunk_size: 50, ...continuation_token ? { continuation_token } : {} });
            for (const event of page.events) {
              if (responses >= config3.maxResponses) break;
              if (felt2(event.from_address) !== felt2(config3.address) || event.keys.length !== 3 || BigInt(event.keys[0]) !== BigInt(hash_exports.getSelectorFromName("Requested")) || felt2(event.keys[1]) !== felt2(config3.account)) continue;
              if (BigInt(event.data[3]) !== BigInt(event.data.length - 4)) throw new Error("Malformed request event.");
              const scope = { chainId: config3.chainId, book: config3.address, id: event.keys[2], maker: config3.account, taker: event.data[0], revision: Number(BigInt(event.data[1])), expiresAt: Number(BigInt(event.data[2])) };
              const current = await provider.callContract({ contractAddress: config3.address, entrypoint: "get_request", calldata: [scope.id] }, "latest");
              if (Number(BigInt(current[4])) !== 1 || scope.expiresAt <= head.timestamp || scope.revision !== Number(BigInt(registered[4]))) continue;
              let body, answer;
              try {
                body = await decodeRequest(await open(scope, "request", event.data.slice(4), recipientPair));
                answer = priceRequest(body, config3.markets, Math.max(head.timestamp, Math.floor(Date.now() / 1e3)), scope.expiresAt, body.settlementCommitment && config3.settlement ? config3.quoteTtlSeconds ?? 1200 : config3.indicativeTtlSeconds ?? 300);
              } catch {
                continue;
              }
              if (!answer) continue;
              if (config3.settlement) {
                const pin = await verifyConfigSettlement();
                const available = await provider.callContract({ contractAddress: config3.settlement.address, entrypoint: "available", calldata: [config3.account, body.buyToken] }, pin.block);
                if (BigInt(available[0]) + (BigInt(available[1]) << 128n) < BigInt(answer.buyAmount)) continue;
              }
              const responseTime = Math.max(head.timestamp, Math.floor(Date.now() / 1e3));
              if (!canRespond(config3, state.recentResponses, scope.taker, responseTime, Boolean(body.settlementCommitment), state.reservations.length)) continue;
              state.recentResponses = Object.fromEntries(Object.entries(state.recentResponses).filter(([, value]) => responseTime - value.at < 86400));
              state.recentResponses[felt2(scope.taker)] = { at: responseTime, firm: Boolean(body.settlementCommitment) };
              save();
              if (config3.settlement && body.settlementCommitment) {
                answer = { ...answer, kind: "executable", settlement: config3.settlement.address, quoteId: scope.id, commitment: body.settlementCommitment };
                const payload = await seal(scope, "quote", answer, await publicKey(body.replyKey));
                await send([{ contractAddress: config3.settlement.address, entrypoint: "reserve_quote", calldata: [scope.id, body.sellToken, body.buyToken, body.sellAmount, answer.buyAmount, body.settlementCommitment, String(answer.expiresAt)] }, responseCall(scope, payload)], scope.id);
              } else {
                const payload = await seal(scope, "quote", answer, await publicKey(body.replyKey));
                await send(responseCall(scope, payload));
              }
              responses++;
            }
            continuation_token = page.continuation_token;
            if (continuation_token && seenTokens.has(continuation_token)) throw new Error("RPC pagination did not advance.");
            if (continuation_token) seenTokens.add(continuation_token);
          } while (continuation_token && responses < config3.maxResponses);
          if (responses < config3.maxResponses) {
            state.cursor = end + 1;
            save();
          }
        }
        if (responses < config3.maxResponses) await new Promise((resolve2) => setTimeout(resolve2, 1e4));
      }
    }
  }
} finally {
  closeSync(lock);
  unlinkSync(`${statePath}.lock`);
}
