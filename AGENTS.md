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
pnpm lint                 # eslint (a few pre-existing WorkflowCanvas react-hooks/refs warnings)
DESKTOP_BUILD=1 pnpm build  # production build, desktop variant
pnpm build                # production build, plain server variant
```

HTTP (non-secure-context) regression tests — run when touching hashing, IDs or clipboard:

```sh
node --test scripts/test-http-hash.mjs scripts/test-browser-id.mjs
node scripts/test-http-clipboard.mjs
```

## Deploying to the NAS

See `README.nas.md`. Short version: change code → verify above → sync to the NAS →
`docker compose --env-file .env.sync -f compose.nas.yaml build` →
`up -d --force-recreate heliosgen` (name the service, or `asset-bridge` gets recreated too).

