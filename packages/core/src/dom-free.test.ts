import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_BROWSER_GLOBALS = [
  /\bwindow\b/,
  /\bdocument\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bnavigator\b/,
  /\bHTMLElement\b/,
  /\bnew\s+Blob\b/,
  /\bAudioContext\b/,
];

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("@bodhi/core platform portability invariant", () => {
  it("contains zero browser/DOM-only globals so it runs natively on React Native", () => {
    const srcRoot = path.resolve(import.meta.dirname);
    const files = collectSourceFiles(srcRoot);
    expect(files.length).toBeGreaterThan(15);

    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      // Strip comments so JSDoc references do not trigger false positives
      const withoutComments = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      for (const pattern of FORBIDDEN_BROWSER_GLOBALS) {
        if (pattern.test(withoutComments)) {
          violations.push(
            `${path.relative(srcRoot, file)} matched ${pattern.toString()}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
