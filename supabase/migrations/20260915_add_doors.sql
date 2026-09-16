-- Doors are a wall element exactly like windows -- same offset_mm/
-- sill_height_mm/wall_id placement infrastructure (see
-- 20260914_add_window_position_fields.sql and 20260914_add_walls_table.sql),
-- just with door-specific fabrication fields instead of window ones.
-- ParametricDoor (lib/parametric-engine/core/ParametricDoor.ts) already
-- existed in the engine fully built; this migration is what lets the app
-- actually save a door against a project.
--
-- Run this AFTER 20260914_add_walls_table.sql.

alter table project_elements drop constraint if exists project_elements_kind_check;
alter table project_elements add constraint project_elements_kind_check
  check (kind in ('roof', 'window', 'door'));

alter table project_elements
  add column if not exists door_type text check (door_type in ('single', 'double', 'sliding')),
  add column if not exists leaf_thickness_mm numeric,
  add column if not exists frame_depth_mm numeric;

comment on column project_elements.door_type is
  'DoorParams.type: single, double (two leaves + astragal), or sliding (head track, no astragal). Null for windows.';
comment on column project_elements.leaf_thickness_mm is
  'DoorParams.leafThickness -- the door slab thickness in mm. Null for windows.';
comment on column project_elements.frame_depth_mm is
  'DoorParams.frameDepth -- optional, defaults to 90mm in ParametricDoor when null.';

-- Doors reuse frame_width_m/frame_height_m (overall opening size, same
-- convention as windows) and frame_sightline_mm (visible frame member
-- width -- the same physical concept for both element types, hence the
-- shared column rather than a duplicate door_frame_sightline_mm).
--
-- sill_height_mm is intentionally left unset (null) for doors and NOT
-- exposed as an editable field in the UI: ParametricDoor's jambs run the
-- full height to the floor with no bottom rail, so a door's sill is
-- always 0 by construction, not a value someone chooses per door.
