-- Ridgeline schema
-- Run in Supabase SQL editor, or via `supabase db push`

create extension if not exists "uuid-ossp";

create table clients (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null,
  name text not null,
  phone text,
  address text,
  strata_client_id text unique, -- null when created manually in-app
  source text not null default 'manual' check (source in ('manual', 'strata')),
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null,
  client_id uuid references clients(id) on delete cascade,
  title text not null,
  job_type text not null check (job_type in ('roof', 'window', 'roof_and_window')),
  status text not null default 'draft'
    check (status in ('draft', 'dimensions_set', 'in_review', 'approved', 'exported', 'scheduled')),
  strata_job_id text, -- set once/if this project is linked to a Strata booking
  created_by uuid, -- fitter/estimator user id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per roof or window element on a project.
-- geometry is the source of truth the 2D/3D renderer reads from.
create table project_elements (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('roof', 'window')),
  label text, -- e.g. "Main roof", "W1 - south elevation"

  -- roof fields (null for windows)
  roof_type text check (roof_type in ('gable', 'hip', 'shed', 'gambrel')),
  span_m numeric,
  ridge_length_m numeric,
  pitch_deg numeric,

  -- window fields (null for roofs)
  frame_width_m numeric,
  frame_height_m numeric,
  window_style text check (window_style in ('casement', 'sliding', 'picture', 'bay', 'awning')),
  elevation text, -- 'north' | 'south' | 'east' | 'west' or custom label

  position jsonb, -- {x, y, z} placement if attached to a 3D scene
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table exports (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  format text not null check (format in ('dxf', 'pdf', 'svg', 'png', 'material_list')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  file_path text, -- Supabase Storage path once ready
  qstash_message_id text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table strata_sync_log (
  id uuid primary key default uuid_generate_v4(),
  direction text not null check (direction in ('inbound', 'outbound')),
  event_type text not null, -- e.g. 'client.created', 'job.booked', 'project.status_updated'
  strata_job_id text,
  project_id uuid references projects(id) on delete set null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index on projects (org_id, status);
create index on project_elements (project_id);
create index on exports (project_id, status);
create index on strata_sync_log (strata_job_id);

-- updated_at bookkeeping
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_projects_updated_at before update on projects
  for each row execute function set_updated_at();
create trigger trg_elements_updated_at before update on project_elements
  for each row execute function set_updated_at();
