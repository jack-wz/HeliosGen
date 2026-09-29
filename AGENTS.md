<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working in this repo

## Layout

- `app/` — Next.js routes (pages + `app/api/*` route handlers). `app/i18n/request.ts` is the next-intl entry.
- `lib/` — everything shared: `nodeTypes.tsx` (node registry), `executor.ts` (pipeline + `resolveInputs` handle semantics), `modelConfig.ts` (model catalog), `guest/` (SQLite + local media).
- `components/nodes/` — canvas node components; register new ones in `lib/nodeTypes.tsx` **and** `components/WorkflowCanvas.tsx`.
- `cli/` + `bridge/` + `deployment/` — NAS/agent layer, not part of the desktop bundle.
- `src-tauri/` — desktop shell.

## Verify before you commit

There is no unit-test framework. Use these instead:

```sh
npx tsc --noEmit          # typecheck — the primary gate
pnpm lint                 # eslint — ~150 pre-existing problems, NOT clean, CI does not run it
DESKTOP_BUILD=1 pnpm build  # production build, desktop variant
pnpm build                # production build, plain server variant
```

`pnpm lint` exits non-zero on a clean checkout of upstream — the repo carries a
long-standing backlog of `react-hooks/*` and `no-unused-vars` findings. It is not
a gate. Don't "fix" the backlog; just don't add to it.

Regression tests (plain `node --test`, no framework; they transpile the `.ts`
source with `ts.transpileModule` and stub its imports):

```sh
node --test scripts/test-http-hash.mjs scripts/test-browser-id.mjs
node --test scripts/test-provider-api.mjs
node scripts/test-http-clipboard.mjs
```

Run the first line when touching hashing, IDs or clipboard; the provider one
when touching `lib/providerRegistry.ts` or the provider routes.

## Running the app locally

`HELIOS_DATA_DIR` / `HELIOS_MEDIA_DIR` isolate the store, so you can boot a
throwaway instance without touching your real `data/` and `public/generated/`:

```sh
HELIOS_DATA_DIR=/tmp/hg/data HELIOS_MEDIA_DIR=/tmp/hg/media PORT=3311 pnpm start
```

Note `getKieApiToken()` falls back to `KIE_API_KEY`, so a key in your shell
environment makes every "is kie configured" check report true — unset it
(`env -u KIE_API_KEY`) when testing that behaviour.

## Deploying to the NAS

See `README.nas.md`. Short version: change code → verify above → sync to the NAS →
`docker compose --env-file .env.sync -f compose.nas.yaml build` →
`up -d --force-recreate heliosgen` (name the service, or `asset-bridge` gets recreated too).

