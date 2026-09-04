import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A CSS-module class that does not exist resolves to `undefined`: the element
 * renders with no styling at all and the word "undefined" in its class list,
 * with nothing to notice at build time. Two such references had left a page
 * masthead and a form field unstyled before this guard existed.
 */
function componentFiles(): string[] {
  return execFileSync("git", ["ls-files", "src/**/*.tsx"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function definedClasses(cssPath: string): Set<string> {
  const text = readFileSync(cssPath, "utf8");
  const names = new Set<string>();
  for (const match of text.matchAll(/\.([A-Za-z_][\w-]*)/g)) names.add(match[1]);
  return names;
}

function resolveImport(fromFile: string, specifier: string): string {
  if (specifier.startsWith("@/")) return resolve("src", specifier.slice(2));
  return resolve(dirname(fromFile), specifier);
}

describe("CSS module references", () => {
  it("only uses classes its stylesheet defines", () => {
    const undefinedReferences: string[] = [];
    for (const file of componentFiles()) {
      const source = readFileSync(file, "utf8");
      const importMatch = source.match(
        /import\s+styles\s+from\s+"([^"]+\.css)"/,
      );
      if (!importMatch) continue;
      const defined = definedClasses(resolveImport(file, importMatch[1]));
      const used = new Set(
        [...source.matchAll(/styles\.([A-Za-z_][\w]*)/g)].map(
          (match) => match[1],
        ),
      );
      for (const name of used) {
        if (!defined.has(name)) undefinedReferences.push(`${file}: ${name}`);
      }
    }
    expect(undefinedReferences).toEqual([]);
  });
});
