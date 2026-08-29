import assert from "node:assert/strict";
import { test } from "node:test";
import { compareArtifactManifests } from "./check-build-determinism.mjs";

test("pure artifact comparison accepts identical path-to-hash manifests", () => {
  assert.deepEqual(
    compareArtifactManifests(
      { "assets/app.js": "aaa", "index.html": "bbb" },
      { "assets/app.js": "aaa", "index.html": "bbb" },
    ),
    [],
  );
});

test("pure artifact comparison reports changed, missing, and additional outputs deterministically", () => {
  assert.deepEqual(
    compareArtifactManifests(
      { "assets/app.js": "first", "only-first.txt": "one" },
      { "assets/app.js": "second", "only-second.txt": "two" },
    ),
    [
      {
        path: "assets/app.js",
        kind: "hash-mismatch",
        firstHash: "first",
        secondHash: "second",
      },
      {
        path: "only-first.txt",
        kind: "only-in-first",
        firstHash: "one",
      },
      {
        path: "only-second.txt",
        kind: "only-in-second",
        secondHash: "two",
      },
    ],
  );
});

test("renamed content-hashed assets are reported rather than treated as equal", () => {
  assert.deepEqual(
    compareArtifactManifests(
      { "assets/app-111.js": "same-content-hash" },
      { "assets/app-222.js": "same-content-hash" },
    ).map(({ path, kind }) => ({ path, kind })),
    [
      { path: "assets/app-111.js", kind: "only-in-first" },
      { path: "assets/app-222.js", kind: "only-in-second" },
    ],
  );
});
