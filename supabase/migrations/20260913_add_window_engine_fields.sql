-- Adds the fields the parametric engine's ParametricWindow needs that the
-- original project_elements window columns didn't carry. Referenced by
-- app/api/projects/[id]/elements/route.ts and the window preview logic in
-- app/(dashboard)/projects/[id]/page.tsx (windowRowToParams()), but the
-- file itself was missing from this app's history until now -- this is
-- the first time it's actually been written down.
--
-- Run this AFTER supabase/schema.sql (which creates project_elements).

alter table project_elements
  add column if not exists frame_sightline_mm numeric,
  add column if not exists glass_thickness_mm numeric,
  add column if not exists panels integer;

comment on column project_elements.frame_sightline_mm is
  'Visible frame member width in mm, i.e. WindowParams.frameWidth. Defaults to 60mm in the API when not supplied.';
comment on column project_elements.glass_thickness_mm is
  'Glazing thickness in mm, i.e. WindowParams.glassThickness. Defaults to 4mm in the API when not supplied.';
comment on column project_elements.panels is
  'Number of glass lights divided by vertical mullions, i.e. WindowParams.panels. Defaults to 1 in the API when not supplied.';
