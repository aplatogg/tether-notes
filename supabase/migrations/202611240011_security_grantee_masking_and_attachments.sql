-- Security fixes (2026-11-24 audit):
-- 1) Locked notes: grantees must not read bodies/lock hashes via direct table access.
--    notes_select no longer includes grant-shared notes; grantee reads go through
--    granted_notes(), which masks body and lock_hash for locked notes.
-- 2) note_attachments: writes must reference a note the writer can see
--    (owner or workspace member), and reads extend to workspace members so
--    attachments work in collaborative workspaces.
-- 3) storage.objects grantee read also covers workspace notes.

-- 1) notes: drop grant clause from SELECT
drop policy if exists notes_select_own_granted_or_workspace on public.notes;
create policy notes_select_own_or_workspace on public.notes for select
  using (
    (select auth.uid()) = user_id
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  );

-- grantee read path: masked view through a security-definer function
create or replace function public.granted_notes()
returns table (
  id uuid,
  user_id uuid,
  title text,
  body text,
  tags text[],
  is_pinned boolean,
  is_archived boolean,
  is_locked boolean,
  reminder_at timestamp with time zone,
  folder text,
  workspace_id uuid,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language sql
security definer
set search_path = ''
as $$
  select
    n.id,
    n.user_id,
    n.title,
    case when n.lock_hash is null then n.body else null end as body,
    n.tags,
    n.is_pinned,
    n.is_archived,
    (n.lock_hash is not null) as is_locked,
    n.reminder_at,
    n.folder,
    n.workspace_id,
    n.deleted_at,
    n.created_at,
    n.updated_at
  from public.note_grants g
  join public.notes n on n.id = g.note_id
  where g.grantee_id = (select auth.uid())
    and n.deleted_at is null;
$$;
revoke all on function public.granted_notes() from public;
grant execute on function public.granted_notes() to anon, authenticated;

-- 2) note_attachments: split policies; writes require visibility of the target note
drop policy if exists attachments_owner_all on public.note_attachments;
drop policy if exists attachments_grantee_select on public.note_attachments;

create policy attachments_select on public.note_attachments for select
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.note_grants g
      where g.note_id = note_attachments.note_id and g.grantee_id = (select auth.uid())
    )
    or exists (
      select 1 from public.notes n
      where n.id = note_attachments.note_id
        and n.workspace_id is not null
        and public.is_workspace_member(n.workspace_id)
    )
  );

create policy attachments_insert on public.note_attachments for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_attachments.note_id
        and (
          n.user_id = (select auth.uid())
          or (n.workspace_id is not null and public.is_workspace_member(n.workspace_id))
        )
    )
  );

create policy attachments_update on public.note_attachments for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_attachments.note_id
        and (
          n.user_id = (select auth.uid())
          or (n.workspace_id is not null and public.is_workspace_member(n.workspace_id))
        )
    )
  );

create policy attachments_delete on public.note_attachments for delete
  using ((select auth.uid()) = user_id);

-- 3) storage: grantee read also covers workspace notes
drop policy if exists "attachments grantee read" on storage.objects;
create policy "attachments grantee read" on storage.objects for select
  using (
    bucket_id = 'attachments'
    and (
      exists (
        select 1
        from public.note_attachments a
        join public.note_grants g on g.note_id = a.note_id
        where a.path = objects.name and g.grantee_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.note_attachments a
        join public.notes n on n.id = a.note_id
        where a.path = objects.name
          and n.workspace_id is not null
          and public.is_workspace_member(n.workspace_id)
      )
    )
  );
