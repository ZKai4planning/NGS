-- Freeform wall studio: walls are now user-drawn line segments (start point,
-- end point, thickness, height) instead of only being derivable from a
-- rectangular roof footprint (see buildingEnvelope.ts, which still handles
-- the box case but now goes through the same wallSegmentToFrame() math as
-- these).
--
-- Run this AFTER 20260914_add_window_position_fields.sql.

create table walls (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  start_x_mm numeric not null,
  start_y_mm numeric not null, -- plan-view Y (maps to world Z -- see wallSegment.ts)
  end_x_mm numeric not null,
  end_y_mm numeric not null,
  thickness_mm numeric not null default 150,
  height_mm numeric not null default 2400,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walls_nonzero_length check (start_x_mm != end_x_mm or start_y_mm != end_y_mm)
);

create index on walls (project_id);

create trigger trg_walls_updated_at before update on walls
  for each row execute function set_updated_at();

-- Windows/doors can now reference a real drawn wall directly instead of
-- (or alongside) the old fixed elevation label. Nullable and additive:
-- existing rows keep using `elevation` against the roof-derived box walls
-- exactly as before (see windowRowToPlacement() in
-- app/(dashboard)/projects/[id]/page.tsx) -- nothing breaks for projects
-- that haven't drawn any freeform walls. A row with wall_id set takes
-- precedence over `elevation` once a project has real walls.
alter table project_elements
  add column if not exists wall_id uuid references walls(id) on delete set null;

comment on column project_elements.wall_id is
  'References walls.id when this window/door sits on a freeform drawn wall. Null for windows still using the old elevation-only (roof-box) placement.';
