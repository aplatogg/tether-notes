-- Security hardening v3 (2026-11-26):
-- 1) [P2] Locked-note × workspace isolation:
--    A PIN-locked note must never expose its lock_hash (salt:hash) or encrypted
--    body to other workspace members via direct table SELECT/UPDATE.
--    - Existing rows that are both locked and in a workspace are unfiled back
--      to Personal (workspace_id = NULL).
--    - guard_note_ownership() and a CHECK constraint forbid combining
--      workspace_id IS NOT NULL with lock_hash IS NOT NULL.
--    - notes_select_own_or_workspace and notes_update_own_or_workspace also
--      require lock_hash IS NULL on the workspace-member branch as defense in
--      depth.
-- 2) [Hardening] note_attachments path prefix binding:
--    attachments_insert and attachments_update now enforce
--    path LIKE (auth.uid()::text || '/' || note_id::text || '/%') in WITH CHECK,
--    plus a table CHECK constraint binding path to user_id/note_id.
-- 3) [Low] Mask title for locked notes in shared_note(text) and granted_notes().
-- 4) [Low] Revoke unnecessary anon EXECUTE privilege on granted_notes().
-- 5) [Verification] Idempotently enforce ENABLE ROW LEVEL SECURITY on all tables.

-- 0) Idempotent RLS enforcement across all public tables --------------------
alter table public.notes enable row level security;
alter table public.note_grants enable row level security;
alter table public.note_shares enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.note_attachments enable row level security;
alter table public.share_group_rules enable row level security;

-- 1) Locked-note × workspace isolation -------------------------------------

-- Unfile any existing locked note from shared workspaces so the new constraint validates cleanly.
update public.notes
set workspace_id = null
where lock_hash is not null
  and workspace_id is not null;

alter table public.notes
  drop constraint if exists notes_lock_workspace_exclusive_check;

alter table public.notes
  add constraint notes_lock_workspace_exclusive_check
  check (workspace_id is null or lock_hash is null);

-- Defense-in-depth on RLS: workspace members only see/update unlocked rows.
drop policy if exists notes_select_own_or_workspace on public.notes;
create policy notes_select_own_or_workspace on public.notes for select
  using (
    (select auth.uid()) = user_id
    or (
      workspace_id is not null
      and lock_hash is null
      and public.is_workspace_member(workspace_id)
    )
  );

drop policy if exists "notes_update_own_or_workspace" on public.notes;
drop policy if exists notes_update_own_or_workspace on public.notes;
create policy notes_update_own_or_workspace on public.notes for update
  using (
    (select auth.uid()) = user_id
    or (
      workspace_id is not null
      and lock_hash is null
      and public.is_workspace_member(workspace_id)
    )
  )
  with check (
    (select auth.uid()) = user_id
    or (
      workspace_id is not null
      and lock_hash is null
      and public.is_workspace_member(workspace_id)
    )
  );

create or replace function public.guard_note_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.notes;
begin
  if new.workspace_id is not null and new.lock_hash is not null then
    raise exception 'locked notes cannot be placed in a shared workspace'
      using errcode = '42501';
  end if;

  -- Administrative sessions (SQL editor / service role) are not end users.
  if v_uid is null then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      return new;
    end if;
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.user_id = v_uid then
      return new;
    end if;
    -- The only legitimate insert carrying another owner is an upsert of an
    -- existing collaborative workspace row (ON CONFLICT DO UPDATE fires the
    -- INSERT trigger first, before the conflict resolves).
    select * into v_existing from public.notes where id = new.id;
    if v_existing.id is null
      or v_existing.user_id is distinct from new.user_id
      or v_existing.workspace_id is null
      or v_existing.lock_hash is not null
      or new.workspace_id is distinct from v_existing.workspace_id
      or not public.is_workspace_member(v_existing.workspace_id)
    then
      raise exception 'note owner must be the authenticated user'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: ownership never moves.
  if new.user_id is distinct from old.user_id then
    raise exception 'note ownership is immutable' using errcode = '42501';
  end if;
  -- Only the owner may lock or unlock a note.
  if new.lock_hash is distinct from old.lock_hash
     and old.user_id is distinct from v_uid then
    raise exception 'only the note owner can lock or unlock a note'
      using errcode = '42501';
  end if;
  -- Only the owner may re-file a note into (or out of) a workspace.
  if new.workspace_id is distinct from old.workspace_id
     and old.user_id is distinct from v_uid then
    raise exception 'only the note owner can move it between workspaces'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_note_ownership() from public;

-- 2) note_attachments path prefix binding ----------------------------------

drop policy if exists attachments_insert on public.note_attachments;
create policy attachments_insert on public.note_attachments for insert
  with check (
    (select auth.uid()) = user_id
    and path like ((select auth.uid())::text || '/' || note_id::text || '/%')
    and exists (
      select 1 from public.notes n
      where n.id = note_attachments.note_id
        and (
          n.user_id = (select auth.uid())
          or (n.workspace_id is not null and n.lock_hash is null and public.is_workspace_member(n.workspace_id))
        )
    )
  );

drop policy if exists attachments_update on public.note_attachments;
create policy attachments_update on public.note_attachments for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and path like ((select auth.uid())::text || '/' || note_id::text || '/%')
    and exists (
      select 1 from public.notes n
      where n.id = note_attachments.note_id
        and (
          n.user_id = (select auth.uid())
          or (n.workspace_id is not null and n.lock_hash is null and public.is_workspace_member(n.workspace_id))
        )
    )
  );

alter table public.note_attachments
  drop constraint if exists note_attachments_path_owner_check;

alter table public.note_attachments
  add constraint note_attachments_path_owner_check
  check (path like (user_id::text || '/' || note_id::text || '/%')) not valid;

-- 3+4) Mask locked-note title in shared_note() & granted_notes(), revoke anon on granted_notes()

create or replace function public.shared_note(p_token text)
returns table (
  id uuid,
  title text,
  body text,
  updated_at timestamptz,
  is_locked boolean
)
language sql
security definer
set search_path = ''
as $$
  select
    n.id,
    case when n.lock_hash is null then n.title else '' end as title,
    case when n.lock_hash is null then n.body else null end as body,
    n.updated_at,
    (n.lock_hash is not null) as is_locked
  from public.note_shares s
  join public.notes n on n.id = s.note_id
  where s.token = p_token
    and s.revoked_at is null
    and n.deleted_at is null
  limit 1;
$$;

revoke all on function public.shared_note(text) from public;
grant execute on function public.shared_note(text) to anon, authenticated;

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
    case when n.lock_hash is null then n.title else '' end as title,
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
revoke all on function public.granted_notes() from anon;
grant execute on function public.granted_notes() to authenticated;
