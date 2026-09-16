-- ============================================================================
-- Row Level Security for the original app tables (schema.sql).
-- Run AFTER schema.sql and schema-parametric-engine.sql.
--
-- Matches the same convention as schema-parametric-engine.sql: org_id
-- currently doubles as the signed-in user's own id for solo installers
-- (see app/api/projects/route.ts), so `org_id = auth.uid()` is the check
-- everywhere. When multiple installers share one NGS account, replace that
-- with a real org-membership lookup -- same shape, one join to change.
-- ============================================================================

alter table clients enable row level security;
alter table projects enable row level security;
alter table project_elements enable row level security;
alter table exports enable row level security;
alter table strata_sync_log enable row level security;

-- ----------------------------------------------------------------------------
-- clients: direct org_id column
-- ----------------------------------------------------------------------------
create policy "org members manage their clients" on clients
  for all
  using (org_id = auth.uid())
  with check (org_id = auth.uid());

-- ----------------------------------------------------------------------------
-- projects: direct org_id column
-- ----------------------------------------------------------------------------
create policy "org members manage their projects" on projects
  for all
  using (org_id = auth.uid())
  with check (org_id = auth.uid());

-- ----------------------------------------------------------------------------
-- project_elements (windows): scoped via the parent project's org_id
-- ----------------------------------------------------------------------------
create policy "org members manage elements via project" on project_elements
  for all
  using (
    exists (select 1 from projects p where p.id = project_elements.project_id and p.org_id = auth.uid())
  )
  with check (
    exists (select 1 from projects p where p.id = project_elements.project_id and p.org_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- exports: scoped via the parent project's org_id. The export worker
-- (app/api/export/worker/route.ts) writes status updates using the service
-- client, which bypasses RLS entirely -- this policy only governs the
-- authenticated-user insert from app/api/export/route.ts.
-- ----------------------------------------------------------------------------
create policy "org members manage exports via project" on exports
  for all
  using (
    exists (select 1 from projects p where p.id = exports.project_id and p.org_id = auth.uid())
  )
  with check (
    exists (select 1 from projects p where p.id = exports.project_id and p.org_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- strata_sync_log: only ever written by the webhook receiver via the
-- service client (bypasses RLS by design -- Strata isn't a logged-in org
-- member). Authenticated users get read-only visibility into their own
-- project's sync history, nothing more.
-- ----------------------------------------------------------------------------
create policy "org members view their sync log" on strata_sync_log
  for select
  using (
    project_id is not null
    and exists (select 1 from projects p where p.id = strata_sync_log.project_id and p.org_id = auth.uid())
  );
