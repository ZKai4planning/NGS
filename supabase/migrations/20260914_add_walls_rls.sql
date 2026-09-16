-- The `walls` table (supabase/migrations/20260914_add_walls_table.sql) was
-- created after schema-rls.sql enabled RLS on every other project-scoped
-- table, so it was left without a policy -- meaning every insert/update/
-- delete was rejected outright ("new row violates row-level security
-- policy for table 'walls'") regardless of who owned the project. This
-- closes that gap using the exact same "scoped via the parent project's
-- org_id" shape as project_elements in schema-rls.sql.
--
-- Run this AFTER 20260914_add_walls_table.sql.

alter table walls enable row level security;

create policy "org members manage walls via project" on walls
  for all
  using (
    exists (select 1 from projects p where p.id = walls.project_id and p.org_id = auth.uid())
  )
  with check (
    exists (select 1 from projects p where p.id = walls.project_id and p.org_id = auth.uid())
  );
