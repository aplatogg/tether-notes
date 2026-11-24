-- Workspace notes are collaborative: members may upsert rows they don't own.
-- The ON CONFLICT upsert path passes through INSERT's WITH CHECK, so allow
-- members to insert into a workspace they belong to (row owner stays the note owner).
drop policy if exists notes_insert_own_or_workspace on public.notes;
create policy notes_insert_own_or_workspace on public.notes for insert
  with check (
    (workspace_id is null and (select auth.uid()) = user_id)
    or (workspace_id is not null and is_workspace_member(workspace_id))
  );
