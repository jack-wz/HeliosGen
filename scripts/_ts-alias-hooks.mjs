/**
 * Node module hooks that let maintenance scripts import the app's TypeScript
 * directly, instead of reimplementing it.
 *
 * Two things Node needs teaching:
 *   1. the `@/` alias from tsconfig.json
 *   2. extensionless imports — the repo is written for a bundler, so it says
 *      `./paths`, and Node's ESM resolver wants `./paths.ts`
 *
 * Registered by scripts/backfill-thumbs.mjs. Node 24 strips types natively, so
 * types are not this file's problem.
 */
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const CANDIDATES = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts")];

function firstExisting(base) {
  return CANDIDATES(base).find((p) => existsSync(p) && !p.endsWith("/"));
}

export async function resolve(specifier, context, nextResolve) {
  // 1) `@/foo` -> <root>/foo
  if (specifier.startsWith("@/")) {
    const hit = firstExisting(join(ROOT, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }

  // 2) `./foo` / `../foo` with no extension, resolved against the importer
  if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
    const hit = firstExisting(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
