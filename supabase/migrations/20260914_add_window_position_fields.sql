-- Adds real on-wall positioning to windows, needed to place them on the
-- building envelope (see lib/parametric-engine/core/buildingEnvelope.ts)
-- instead of rendering each window as an isolated generic wall swatch.
--
-- Both columns are nullable and deliberately have NO fixed numeric default:
-- a fixed mm default can't be "centered" for every wall, since wall width
-- depends on the roof's span/ridge-length (gable) or width/length
-- (hip/shed), which varies per project. Existing rows -- and any new
-- window row that doesn't specify a position -- get null here, and the
-- app treats null as "auto-center on this window's wall" / "standard
-- sill height" at render/placement time (see windowRowToPlacement() in
-- app/(dashboard)/projects/[id]/page.tsx). That is what makes this
-- migration non-breaking: every existing window keeps rendering exactly
-- where it visually was (centered), just now expressed as an explicit
-- "no position set yet" rather than baked into a swatch that had no real
-- position at all.
--
-- Run this AFTER supabase/schema.sql and
-- 20260913_add_window_engine_fields.sql.

alter table project_elements
  add column if not exists offset_mm numeric check (offset_mm is null or offset_mm >= 0),
  add column if not exists sill_height_mm numeric check (sill_height_mm is null or sill_height_mm >= 0);

comment on column project_elements.offset_mm is
  'Distance in mm from the left edge of the window''s wall (as defined per-elevation in buildingEnvelope.ts) to the left edge of the window. Null = auto-center on that wall.';
comment on column project_elements.sill_height_mm is
  'Height in mm of the window sill above the floor/eave line. Null = standard default (900mm) applied by the app.';
