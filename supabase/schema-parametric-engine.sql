-- ============================================================================
-- Parametric Engine tables -- ADDITIVE migration.
-- Run AFTER supabase/schema.sql. Does NOT redefine `projects`: the engine's
-- own schema.sql creates its own `projects (owner_id, name)` table, but this
-- app already has one (org_id, client_id, title, job_type, status...) from
-- supabase/schema.sql, so roof_configs references that instead.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Roof configs: the raw parametric input (mm-based RoofParams) + a content
-- hash for cache lookups. One project can have multiple configs over time
-- (e.g. re-saving after a dimension change) but only the latest matters for
-- the UI -- order by created_at desc when reading.
-- ----------------------------------------------------------------------------
create table if not exists roof_configs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  roof_type text not null check (roof_type in ('gable', 'hip', 'shed')),
  params jsonb not null,
  params_hash text not null, -- sha256 of normalized params, also the Upstash cache key
  created_at timestamptz not null default now(),
  unique (project_id, params_hash)
);

create index if not exists idx_roof_configs_project on roof_configs(project_id);
create index if not exists idx_roof_configs_hash on roof_configs(params_hash);

-- ----------------------------------------------------------------------------
-- Parts: fabrication-ready output of generateParts(), one row per Part.
-- ----------------------------------------------------------------------------
create table if not exists parts (
  id uuid primary key default uuid_generate_v4(),
  roof_config_id uuid not null references roof_configs(id) on delete cascade,
  external_id text not null, -- Part.id from the engine (stable within a config)
  source_component text not null,
  material text not null,
  stock_type text not null check (stock_type in ('sheet', 'linear')),
  thickness numeric not null,
  outline jsonb not null,       -- Point2D[]
  joinery jsonb,                 -- JoineryFeature[]
  length numeric,
  quantity integer not null default 1,
  allow_rotation boolean not null default true,
  grain_direction numeric,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_parts_roof_config on parts(roof_config_id);
create index if not exists idx_parts_stock_type on parts(stock_type);

-- ----------------------------------------------------------------------------
-- Cutting jobs: a single optimizer run (linear cutting-stock or nesting)
-- against a set of parts, with the resulting plan and waste stats.
-- ----------------------------------------------------------------------------
create table if not exists cutting_jobs (
  id uuid primary key default uuid_generate_v4(),
  roof_config_id uuid not null references roof_configs(id) on delete cascade,
  job_type text not null check (job_type in ('linear', 'nesting')),
  tool_profile jsonb not null,       -- ToolProfile (kerf, minSpacing)
  stock_options jsonb not null,      -- LinearStockOption[] | SheetStockOption[]
  result jsonb not null,             -- LinearOptimizationResult | NestingResult
  overall_utilization numeric,
  status text not null default 'completed' check (status in ('queued', 'processing', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_cutting_jobs_roof_config on cutting_jobs(roof_config_id);
create index if not exists idx_cutting_jobs_status on cutting_jobs(status);

-- ----------------------------------------------------------------------------
-- Remnants: leftover material inventory from completed nesting/cutting jobs.
-- `owner_id` matches the engine's own db/remnants.ts queries verbatim --
-- populate it with org_id when calling those helpers (this app currently
-- sets org_id = the signed-in user's own id for solo installers, so
-- `auth.uid() = owner_id` in the RLS policy below holds either way).
-- ----------------------------------------------------------------------------
create table if not exists remnants (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null,
  material text not null,
  stock_type text not null check (stock_type in ('sheet', 'linear')),
  thickness numeric,
  width numeric,   -- sheet remnants
  height numeric,  -- sheet remnants
  length numeric,  -- linear remnants
  source_cutting_job_id uuid references cutting_jobs(id) on delete set null,
  status text not null default 'available' check (status in ('available', 'reserved', 'used')),
  created_at timestamptz not null default now()
);

create index if not exists idx_remnants_material on remnants(material, stock_type, status);

-- ----------------------------------------------------------------------------
-- Row Level Security. roof_configs / parts / cutting_jobs check ownership by
-- joining back to THIS app's `projects.org_id` (not a separate owner_id
-- column on a second projects table).
-- ----------------------------------------------------------------------------
alter table roof_configs enable row level security;
alter table parts enable row level security;
alter table cutting_jobs enable row level security;
alter table remnants enable row level security;

create policy "org members manage roof configs via project" on roof_configs
  for all using (
    exists (select 1 from projects p where p.id = roof_configs.project_id and p.org_id = auth.uid())
  );

create policy "org members manage parts via config" on parts
  for all using (
    exists (
      select 1 from roof_configs rc
      join projects p on p.id = rc.project_id
      where rc.id = parts.roof_config_id and p.org_id = auth.uid()
    )
  );

create policy "org members manage cutting jobs via config" on cutting_jobs
  for all using (
    exists (
      select 1 from roof_configs rc
      join projects p on p.id = rc.project_id
      where rc.id = cutting_jobs.roof_config_id and p.org_id = auth.uid()
    )
  );

create policy "owners manage their remnants" on remnants
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Note: these policies assume org_id doubles as a single user's id (see
-- app/api/projects/route.ts). Once multiple installers share one NGS
-- account, replace `p.org_id = auth.uid()` with a real org-membership
-- lookup -- same shape everywhere, one join to change.
