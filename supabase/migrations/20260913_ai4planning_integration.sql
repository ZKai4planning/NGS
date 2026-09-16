-- ============================================================================
-- AI4Planning integration: settings, submissions, and new project stages.
--
-- Design (per the explicit "API key vs plugin vs webhook, your call" ask):
-- a hybrid of API key + webhook, not a general plugin system.
--   - OUTBOUND (NGS -> AI4Planning): an API key, stored here, authenticates
--     NGS's submission requests. Planning decisions take days/weeks in
--     reality, so...
--   - INBOUND (AI4Planning -> NGS): a webhook, signed with a shared secret
--     using the same HMAC pattern as app/api/strata/webhook/route.ts,
--     delivers the eventual approved/rejected decision asynchronously.
-- A "plugin" architecture (a generic registry other third parties could
-- also implement against) would be the wrong amount of complexity for one
-- first-party integration between two systems the same company controls.
-- It's worth revisiting only if NGS ends up integrating with several
-- different planning authorities/portals, not for AI4Planning alone.
--
-- Run this AFTER schema.sql, schema-parametric-engine.sql, and schema-rls.sql.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Integration settings: one row per (org, provider). Holds the outbound
-- API key and the inbound webhook secret together, since for this
-- integration the same org config governs both directions.
--
-- The API key and webhook secret are stored in plaintext here, same as
-- STRATA_WEBHOOK_SECRET already is as an env var elsewhere in this app --
-- acceptable for a solo-installer-per-account model where org_id doubles
-- as the user's own id, but revisit with column-level encryption (e.g.
-- pgsodium) before this app has multiple people sharing one org who
-- shouldn't all see the raw key.
-- ----------------------------------------------------------------------------
create table if not exists integration_settings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null,
  provider text not null check (provider in ('ai4planning', 'strata')),
  api_key text,
  webhook_secret text,
  base_url text, -- e.g. a sandbox vs production AI4Planning environment
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider)
);

create trigger trg_integration_settings_updated_at before update on integration_settings
  for each row execute function set_updated_at();

alter table integration_settings enable row level security;

create policy "org members manage their own integration settings" on integration_settings
  for all
  using (org_id = auth.uid())
  with check (org_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Council submissions: one row per submit-for-approval attempt. A project
-- could in principle be resubmitted (e.g. after a rejection with changes),
-- so this is a log, not a single status column bolted onto projects --
-- read the latest row by created_at for "the current submission."
-- ----------------------------------------------------------------------------
create table if not exists council_submissions (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'withdrawn')),
  ai4planning_reference_id text, -- the ID AI4Planning's API returns for this submission
  decision_notes text,
  request_payload jsonb, -- what we sent, for audit/debugging
  response_payload jsonb, -- what AI4Planning's webhook sent back
  submitted_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists idx_council_submissions_project on council_submissions(project_id, submitted_at desc);
create index if not exists idx_council_submissions_reference on council_submissions(ai4planning_reference_id);

alter table council_submissions enable row level security;

create policy "org members manage council submissions via project" on council_submissions
  for all
  using (
    exists (select 1 from projects p where p.id = council_submissions.project_id and p.org_id = auth.uid())
  )
  with check (
    exists (select 1 from projects p where p.id = council_submissions.project_id and p.org_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- New project stages. Postgres CHECK constraints can't be altered in place,
-- so drop and recreate with the additional values. Existing rows (whose
-- status is already one of the original values) are unaffected.
-- ----------------------------------------------------------------------------
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (
  status in (
    'draft',
    'dimensions_set',
    'in_review',
    'approved',
    'exported',
    'submitted_for_council',
    'council_approved',
    'council_rejected',
    'scheduled'
  )
);
