import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareChunkBudgets,
  findNodeBuiltinImports,
  hasDirectEval,
} from "./check-bundle-budget.mjs";

const config = {
  schemaVersion: 1,
  unit: "bytes",
  budgets: [
    { id: "entry", pattern: "^app-.+\\.js$", maxBytes: 100 },
    { id: "other", pattern: "^.+\\.js$", maxBytes: 50 },
  ],
};

test("pure chunk comparison applies the first recorded per-chunk budget", () => {
  const result = compareChunkBudgets(
    [
      { name: "app-hash.js", bytes: 100 },
      { name: "feature-hash.js", bytes: 51 },
      { name: "unmatched.css", bytes: 1 },
    ],
    config,
  );

  assert.deepEqual(result.results, [
    {
      name: "app-hash.js",
      bytes: 100,
      budgetId: "entry",
      maxBytes: 100,
      status: "within-budget",
    },
    {
      name: "feature-hash.js",
      bytes: 51,
      budgetId: "other",
      maxBytes: 50,
      status: "over-budget",
    },
    {
      name: "unmatched.css",
      bytes: 1,
      budgetId: null,
      maxBytes: null,
      status: "unbudgeted",
    },
  ]);
  assert.deepEqual(
    result.violations.map(({ name, status }) => ({ name, status })),
    [
      { name: "feature-hash.js", status: "over-budget" },
      { name: "unmatched.css", status: "unbudgeted" },
    ],
  );
});

test("direct eval detection covers every JavaScript string quoting form", () => {
  assert.equal(hasDirectEval(`const load = eval('require');`), true);
  assert.equal(hasDirectEval('const load = eval("require");'), true);
  assert.equal(hasDirectEval("const load = eval(`require`);"), true);
  assert.equal(hasDirectEval("const load = globalThis.eval(`require`);"), false);
  assert.equal(hasDirectEval("const load = (0, eval)(`require`);"), false);
});

test("Node builtin detection covers static, dynamic, require, and node-prefixed imports", () => {
  assert.deepEqual(
    findNodeBuiltinImports(
      'import hooks from "async_hooks"; import"node:os"; export {x} from "node:crypto"; import("node:fs/promises"); require("path");',
    ),
    ["async_hooks", "node:crypto", "node:fs/promises", "node:os", "path"],
  );
  assert.deepEqual(findNodeBuiltinImports('import "./crypto.js";'), []);
});
