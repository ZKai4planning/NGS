# NGS — rooftop & window quoting

Next.js + Supabase + Upstash, deployed on Vercel.

## Auth: email/password + forgot password (Brevo email)

Login is email/password (`app/login/page.tsx`), not the earlier magic-link
flow. Forgot-password works like this:

1. `app/forgot-password/page.tsx` posts the email to
   `app/api/auth/forgot-password/route.ts`.
2. That route uses the Supabase **service-role** client's
   `auth.admin.generateLink({ type: "recovery" })` and builds the reset URL
   itself from the returned `hashed_token`
   (`/reset-password?token_hash=...&type=recovery`) — it does **not** use
   `data.properties.action_link` or call
   `supabase.auth.resetPasswordForEmail()`. `action_link` points at
   Supabase's own `/verify` endpoint and, for a link generated server-side
   via the admin API (no browser-held PKCE code verifier), redirects back
   in a way the browser client can't exchange for a session — using
   `token_hash` + `verifyOtp()` on our own page is the pattern that
   actually works here.
3. The link is emailed via **Brevo's transactional API**
   (`lib/brevo.ts`) using the NGS-branded template in
   `lib/email-templates/reset-password.ts` (shell in
   `lib/email-templates/layout.ts` — reuse it for future templates, e.g. a
   welcome email).
4. Clicking the link lands on `app/reset-password/page.tsx`, which calls
   `supabase.auth.verifyOtp({ token_hash, type: "recovery" })` to establish
   a session, then lets the user set a new password.

The route always returns the same generic success message so it can't be
used to enumerate which emails have accounts.

**No database changes needed.** Passwords aren't a column you add
anywhere — Supabase Auth already stores them (hashed) on its own internal
`auth.users` table, which none of this app's schema files touch. The only
thing to check: any account created purely through the old magic-link flow
may not have a password set yet. Either set one directly in the Supabase
dashboard (Authentication -> Users -> a user -> "..." -> Reset password /
or edit), or just have that person run the forgot-password flow once —
`updateUser({ password })` sets the password whether or not one existed
before.

**Layout:** the header/nav chrome now lives in
`app/(dashboard)/layout.tsx` and only wraps the app pages (`/projects`,
etc.) — `app/layout.tsx` (root) is a bare `<html><body>` shell. That's why
`/login`, `/forgot-password`, and `/reset-password` render full-bleed with
no nav bar; moving `app/projects` under a route group doesn't change any
URLs.

**Setup required:**
- Add `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (must be a verified sender in
  Brevo), and `BREVO_SENDER_NAME` to your environment (`.env.example`).
- Set `APP_URL` to your real deployed URL — it's used both for the
  reset-password redirect and for the logo `<img>` src in the email (email
  clients can't load a relative path).
- In Supabase Auth settings, the built-in "reset password" email template
  is no longer used by this flow, but leave email confirmations configured
  however you already have them for anything else that relies on it.
- There's still no self-serve signup page — accounts are created directly
  in Supabase (matches the existing solo-installer-per-account model where
  `org_id = auth.uid()`).

## What changed: the parametric engine is now the roof system

The uploaded `parametric-engine` package replaced the earlier hand-rolled
roof math entirely (`lib/roofGeometry.ts`, `RoofScene3D.tsx`,
`RoofDrawing2D.tsx`, `DimensionForm.tsx` are gone). Roofs now flow through:

```
UI params (mm-based: span/ridge/pitch or width/length, eave height, overhang)
  → createRoof(params).generateAll()          instant client-side 3D preview, no network call
  → POST /api/roofs/generate                  persisted to Supabase (roof_configs + parts), cached in Upstash
  → POST /api/nesting                          sheet nesting + linear cutting-stock, remnants checked first
  → per-sheet SVG + real DXF download          client-side, no round trip
```

This is a genuinely different tier of engine than what it replaced:
mm-precision structural members (rafters, ridge, hip/jack rafters with
angle cuts), a real bill of materials, sheet-goods nesting against a
remnant inventory that compounds savings across jobs, and a
dependency-free DXF R12 writer that's actually CNC-ready — not the
two-line placeholder DXF from before.

### What's real vs still a known limitation (documented in the engine's own source comments)

| Area | Status |
|---|---|
| Gable / hip / shed roof math, structure, parts, BOM | Real, computed from params |
| 3D preview | Real — same engine class runs identically client-side and server-side |
| Sheet nesting | Real, but shelf-packing (rectangles only) — swap for SVGnest/Deepnest when non-rectangular parts show up |
| Linear cutting-stock | Real, First-Fit-Decreasing heuristic — swap for ILP if you need the last 1-3% of material |
| Hip roof jack rafters | Approximated as one averaged length, not one member per discrete rafter |
| Remnant reuse | Wired up end-to-end: nesting/cutting-stock check inventory first, leftovers feed back in after each job |
| Windows | Not covered by the engine yet — still using the old `project_elements` table/route (kind='window' only now; the roof half of that table is unused going forward) |
| Gambrel roofs | Not supported — the engine only does gable/hip/shed. If you need gambrel, it's the same pattern as the other three classes, just not written |

### Integration adjustments made to fit this app (vs the engine as uploaded)

- `lib/parametric-engine/db/supabase-client.ts` — the engine shipped its own
  `getSupabaseServerClient()` reading `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
  Replaced with a re-export of this app's existing service client
  (`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) so there's one
  Supabase client pattern, not two.
- `supabase/schema-parametric-engine.sql` — the engine's own `schema.sql`
  defines its own `projects (owner_id, name)` table. This app already has a
  richer `projects` table (org_id, client_id, title, job_type, status) from
  `supabase/schema.sql`. The new migration is additive: `roof_configs`,
  `parts`, `cutting_jobs`, `remnants` reference **this app's** `projects.id`,
  and RLS policies check `projects.org_id` instead of a second owner column.
  Run `schema.sql` first, then `schema-parametric-engine.sql`.
- `app/api/roofs/generate/route.ts` and `app/api/nesting/route.ts` — the
  engine's originals only rate-limited by IP. Added a real auth check
  (`createClient().auth.getUser()`) on top, since this app has actual logins
  now. The nesting route's ownership lookup changed from
  `projects(owner_id)` to `projects(org_id)` to match.
- `components/RoofViewer.tsx` / `components/NestingLayoutSVG.tsx` — same
  logic as the engine shipped, recolored from generic Tailwind-style hex
  values to this app's `--ink`/`--teal`/`--amber` design tokens.
- `app/api/export/worker/route.ts` — previously generated a placeholder DXF
  from `project_elements` columns. That DXF branch is gone (superseded by
  real fabrication DXF from the nesting flow); it now only generates the
  client-facing PDF summary, pulled from the latest `roof_configs` row for
  a project instead of the old flat columns.
- `package.json` — dropped `dxf-writer` (the engine has its own
  dependency-free DXF writer, no need for both), added `@upstash/ratelimit`
  (used by the engine's cache layer for the generate/nesting rate limiter).
- Added `tsconfig.json`, `next.config.js`, `next-env.d.ts` — these didn't
  exist yet in the scaffold, which meant the `@/` import alias used
  throughout (including in the uploaded engine's adapted files) would have
  silently failed to resolve.

## Engine version 2: windows and doors added

The latest `parametric-engine` upload generalized the base class and added
first-class window/door support:

- `lib/parametric-engine/core/ParametricComponent.ts` — new shared abstract
  base. `ParametricRoof` now extends this instead of declaring the same
  `generateGeometry`/`generateStructure`/`generateParts`/etc contract itself.
  `GableRoof`/`HipRoof`/`ShedRoof` are byte-identical to before — this was a
  pure refactor for code reuse, not a breaking change.
- `lib/parametric-engine/core/ParametricWindow.ts` /
  `ParametricDoor.ts` / `createOpening.ts` — fixed/casement/sliding windows
  and single/double/sliding doors, with the same `generateAll()` contract
  (geometry, structure, dimensions, parts, BOM) as roofs. Each documents its
  own construction convention and at least one honest limitation in its
  source comments (e.g. door leaves generally won't fit standard sheet
  stock and will correctly show as "unplaced" — that's accurate, not a bug).
- `lib/parametric-engine/fabrication/group-parts.ts` — the important
  correctness fix this version brings: nesting/cutting-stock now runs
  **per (material, thickness) group**, not across all parts at once. Once a
  project has a roof (plywood sheathing) *and* windows (glass) *and* doors
  (slab leaves), nesting them onto the same virtual sheet without this
  grouping would be physically meaningless. `app/api/nesting/route.ts` was
  rewritten to loop over `groupPartsByMaterial()` groups, run a separate
  cutting job per group, and tag each result sheet/plan with its
  `material`/`thickness` so the UI can label them (see the badge added to
  `components/NestingLayoutSVG.tsx`).

**What's NOT yet wired up:** the engine can compute windows and doors, but
there's no UI to create them as engine components yet — `/projects/[id]`
still only lets you configure a roof. Window data still goes through the
old flat `project_elements` table (kind='window') from the first schema,
which has nothing to do with `ParametricWindow`. Wiring windows/doors into
the actual project workspace (their own `roof_configs`-equivalent table, a
UI to add one or more openings per project, 3D placement on a wall) is
real, non-trivial work — that wasn't built in this pass, only the engine
capability was merged so it's available to build against next.

## The full flow, end to end

1. `/login` → magic link → `/projects`
2. `/projects/new` → creates a client + project directly in this app (no
   Strata dependency required)
3. `/projects/[id]` → pick roof type, adjust span/ridge/pitch (or
   width/length for hip/shed) → instant 3D preview + live BOM, no save needed
4. **Approve dimensions** → `POST /api/roofs/generate` → persists `roof_configs`
   + `parts`, project status → `dimensions_set`
5. **Export CAD** → `POST /api/nesting` → sheet nesting + linear cutting
   plan, remnants checked first → per-sheet SVG previews with real DXF
   downloads, project status → `exported`
6. **Mark install scheduled** → `PATCH /api/projects/[id]` → status → `scheduled`
7. **Delete** (from `/projects` or from inside a project) → `DELETE /api/projects/[id]` → cascades through `project_elements`, `roof_configs` → `parts` → `cutting_jobs` automatically via the FK chain in the schema.

## Strata webhook: current status

No public documentation exists for stratacrm.app exposing outbound
webhooks, and it doesn't appear in Zapier's app directory as a trigger (a
direct search only surfaces "Urbanise Strata," an unrelated property
management product). The receiving endpoint
(`app/api/strata/webhook/route.ts`) is fully built and testable independent
of Strata — see the curl example below — but confirming Strata's actual
capability requires checking their own Settings/Integrations page or asking
their support directly, since this isn't something documented anywhere
public as of this integration.

```bash
curl -X POST https://your-app.vercel.app/api/strata/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"job.booked","client":{"id":"test-1","name":"Test Client","phone":"555-0100","address":"123 Main St"},"job":{"id":"job-1","service_name":"Test roof job"}}'
```

A successful call creates a client + project and logs a row in
`strata_sync_log`. Once you know Strata's real payload shape, only the
field names inside that route need to change.


## Verifying the engine's math independently

```bash
npm install
npx tsx scripts/verify-engine.ts
```

Runs `createRoof()` for a gable, hip, and shed example, prints the raw
`calculations`/`bom` output, and independently recomputes each roof's key
trig relationships from scratch (rise, rafter length, a Pythagorean
a²+b²=c² check on the roof slope) to assert they match — not just printed
numbers to eyeball, since a plausible-looking wrong number is easy to miss.
Also confirms the engine actually rejects non-physical inputs (negative
span, 90°+ pitch) instead of silently producing garbage geometry. No
Next.js, Supabase, or Upstash needed — pure engine, useful while developing
against it or after pulling a new engine version.

## DXF vs DWG, and seeing the whole job at once

DXF is the correct format here, not a fallback for not supporting DWG: DWG
is Autodesk's closed binary format, and writing a valid one requires their
proprietary RealDWG/Teigha SDK. DXF is the actual open interchange format
every major CAD/CAM tool (AutoCAD, Fusion 360, VCarve, SheetCam, LibreCAD,
DraftSight) reads natively.

What genuinely was missing: a way to see every sheet at once instead of
downloading one DXF per sheet. `lib/combined-dxf-export.ts` adds a
"Download combined DXF (all sheets)" option on the fabrication output tab —
it lays every sheet out in a grid with a gap and a text label, so opening
the single file in any CAD viewer shows the whole job the way nesting
software presents an overview, matching what the individual per-sheet
downloads already provide for a single sheet.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Upstash + Brevo keys
# run these ten, in order, in the Supabase SQL editor:
#   1. supabase/schema.sql
#   2. supabase/schema-parametric-engine.sql
#   3. supabase/schema-rls.sql
#   4. supabase/migrations/20260913_add_window_engine_fields.sql
#   5. supabase/migrations/20260913_ai4planning_integration.sql
#   6. supabase/migrations/20260914_add_window_position_fields.sql
#   7. supabase/migrations/20260914_add_walls_table.sql
#   8. supabase/migrations/20260914_add_walls_rls.sql
#   9. supabase/migrations/20260915_add_polygon_roof_type.sql
#   10. supabase/migrations/20260915_add_doors.sql
# Auth is email/password now (not magic link) - create accounts directly in
# the Supabase dashboard; see "Auth: email/password + forgot password" above.
npm run dev
```

## Suggested next build order

1. ~~Row Level Security for clients/projects/project_elements/exports~~ — done,
   see `supabase/schema-rls.sql`. If you still hit "new row violates row-level
   security policy", it almost always means this file hasn't been run yet
   against your Supabase project, or RLS was toggled on for a table this file
   doesn't cover.
2. `/api/roofs/generate`, `/api/nesting`, and `/api/roofs/parts` all write via
   the **service client**, which bypasses RLS by design (the engine's
   fabrication math needs to run server-side regardless of the caller's
   permissions). That means *those routes*, not the database, are responsible
   for checking project ownership — all three now do an explicit
   `project.org_id === caller's org_id` check before touching data. Worth
   re-reading if you add more service-client routes later: the pattern is
   "look up ownership through the RLS-governed client first, then act."
3. Confirm the Strata webhook payload shape and fix up
   `app/api/strata/webhook/route.ts` to match.
4. One-member-per-jack-rafter in `HipRoof.generateStructure()` for exact-length
   CNC cutting, instead of the current averaged approximation.
5. Swap the shelf-packing nester for SVGnest/Deepnest once non-rectangular
   parts (windows, curved fascia) enter the picture.
6. ~~Window 3D rendering~~ / ~~wire ParametricWindow into the UI~~ — done, see
   "Windows are now fully wired in" below.
7. Confirm AI4Planning's real API contract once it exists and fix up
   `app/api/ai4planning/submit/route.ts` / `webhook/route.ts` to match — see
   "AI4Planning integration" below for exactly what's proposed vs verified.

## This pass: merging a parallel session's work + fixing what it left broken

A separate coding session (not this one) had continued building on an
earlier zip of this app - real email/password auth with a Brevo-powered
forgot-password flow, a `(dashboard)` route group, and a first pass at
wiring windows into the workspace. That work was good, but three real bugs
had crept in and needed fixing before anything here was trustworthy:

- **`app/api/roofs/generate/route.ts` and `app/api/projects/[id]/elements/route.ts`
  had their contents swapped.** The roof-generation route's *active* code was
  actually the window list/create logic, while the real roof-generation
  logic sat dead, commented out, at the top of the same file. This meant
  approving roof dimensions would have silently hit the wrong endpoint.
  Fixed by restoring each route's correct logic to its correct file.
- **The window DELETE handler was at the wrong path.** It expected an
  `elementId` route param but lived at `.../elements/route.ts`, which has
  no `[elementId]` segment - that param could never actually be populated.
  Moved to `.../elements/[elementId]/route.ts` where the segment exists.
- **The `frame_sightline_mm`/`glass_thickness_mm`/`panels` migration was
  referenced in code comments but the file itself didn't exist anywhere in
  the upload.** Written now as `supabase/migrations/20260913_add_window_engine_fields.sql`.

Also cleaned up: ~880 lines of dead commented-out code sitting above the
real content in `app/(dashboard)/projects/[id]/page.tsx` (and smaller
versions of the same pattern in a couple of API routes), four orphaned
files from before the parametric engine existed
(`lib/roofGeometry.ts`, `components/RoofScene3D.tsx`,
`components/RoofDrawing2D.tsx`, `components/DimensionForm.tsx` - confirmed
nothing imports them before deleting), the now-unused
`@react-three/fiber`/`@react-three/drei` dependencies, and
`scripts/verify-engine.ts` was carrying the same old-version-plus-dead-copy
pattern - replaced with the colorized/tabular version from earlier in this
project's history, extended with a window sanity check.

Everything was then verified for real: `npx tsc --noEmit` against the
actual installed dependencies (zero errors), and
`npx tsx scripts/verify-engine.ts` (12/12 checks pass, including the new
window check).

## Windows are now fully wired in

`/projects/[id]` shows Roof and Windows as two independent, always-visible
sections (not tabs that hide one while the other is shown) when a
project's `job_type` is `roof_and_window` - each with its own live 3D
preview and BOM. A **Project bill of materials** table at the bottom
merges every material across the roof and all windows by material+unit.

This directly answers two things asked earlier:
- *"How is the bill of materials being selected?"* - nothing is selected.
  `combinedBOM` is always the full, current set of components on the
  project, recomputed live from whatever's in the roof form and however
  many windows are saved. There's no separate "which BOM to show" state.
- *"If we select roof and window, why can't we see both?"* - the previous
  version literally didn't know a project's `job_type` (there was no
  `GET /api/projects/[id]` at all), so it always rendered the roof-only UI.
  That's fixed - see `showRoof`/`showWindows` in the workspace page.

## AI4Planning integration

You said AI4Planning is a companion site you're building yourselves, and
asked for a recommendation between API key, plugin, or webhook. Built as a
**hybrid of the two that actually fit**, not a general plugin system:

- **Outbound (NGS → AI4Planning): an API key.** Stored per-org in the new
  `integration_settings` table, configured at
  `/settings/integrations/ai4planning`. `POST /api/ai4planning/submit`
  sends the project's roof/window data as `Authorization: Bearer <key>`.
- **Inbound (AI4Planning → NGS): a webhook.** Planning decisions take
  days or weeks in reality - polling for a decision would be wasteful.
  `POST /api/ai4planning/webhook` receives the eventual approved/rejected
  call, signed with a per-org secret (same HMAC-SHA256 pattern as the
  existing Strata webhook), and updates the project's status.
- **Why not a general "plugin" architecture:** that shape (a registry any
  third party could implement against) is the wrong amount of complexity
  for one first-party integration between two systems your own company
  controls. Worth revisiting only if NGS ends up integrating with several
  different planning authorities/portals with genuinely different
  contracts, not for AI4Planning alone.

**This is a proposed contract, not a verified one** - AI4Planning doesn't
exist as a live service yet, so the request/response shapes in
`app/api/ai4planning/submit/route.ts` and `.../webhook/route.ts` are
reasonable guesses, clearly marked as such in both files' comments. Once
AI4Planning's real API is defined, only the payload-building and
response-parsing in those two files need to change.

**New project stages:** `submitted_for_council`, `council_approved`,
`council_rejected` (see the CHECK constraint update in
`supabase/migrations/20260913_ai4planning_integration.sql`). This is
deliberately an *optional* stage, not a hard gate - "Submit for council
approval" appears once a roof's dimensions are approved, but Export CAD
and Mark install scheduled work regardless of whether it's ever used, since
not every job needs planning permission.

**Settings/Integrations UI:** `/settings` → `/settings/integrations` lists
Strata and AI4Planning with connection status; `/settings/integrations/ai4planning`
is where the base URL, API key, and webhook secret actually get saved (keys
are masked everywhere except the one-time reveal right after saving the
webhook secret). Linked from a new "Settings" button in the header.

**Not yet built:** document attachment. The PDF quote and DXF exports are
generated client-side/on-demand with no durable hosted URL to hand to
AI4Planning, and there's no confirmed contract yet for whether it wants a
multipart upload, a pre-signed URL, or base64 inline - flagged in
`submit/route.ts` rather than guessed at. A per-project toggle for "this
job needs planning permission" also doesn't exist yet - the submit button
is just always available once dimensions are approved.

