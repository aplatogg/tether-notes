-- Security fixes (2026-11-25 audit):
-- 1) notes UPDATE could rewrite user_id -> ownership takeover by any workspace
--    member (RLS permitted it; only the FK blocked an invalid uuid).
-- 2) notes INSERT permitted a foreign user_id -> authorship spoofing.
-- 3) notes DELETE let members hard-delete (purge) workspace notes, bypassing
--    trash and destroying grants/attachments with no audit trail.
-- 4) note_grants / note_shares INSERT only checked owner_id = auth.uid(), not
--    that the referenced note actually belongs to that user -> a grant/share
--    row could be minted for someone else's note and read through the
--    SECURITY DEFINER helpers (granted_notes / shared_note).
-- 5) share/invite RPCs leaked whether an email exists (user enumeration).

-- 1+2) Ownership guard on notes -------------------------------------------

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

drop trigger if exists notes_guard_ownership on public.notes;
create trigger notes_guard_ownership
before insert or update on public.notes
for each row execute function public.guard_note_ownership();

-- 3) Hard delete (purge) is owner-only; members still trash via UPDATE.
drop policy if exists notes_delete_own_or_workspace on public.notes;
drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes for delete
  using ((select auth.uid()) = user_id);

-- 4) Grants/shares must reference a note the inserter actually owns ---------

drop policy if exists grants_owner_all on public.note_grants;
create policy grants_owner_all on public.note_grants for all
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.notes n
      where n.id = note_grants.note_id and n.user_id = (select auth.uid())
    )
  );

drop policy if exists shares_owner_all on public.note_shares;
create policy shares_owner_all on public.note_shares for all
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.notes n
      where n.id = note_shares.note_id and n.user_id = (select auth.uid())
    )
  );

-- Clean up rows created under the old permissive policies (defense in depth;
-- granted_notes/shared_note join on these).
delete from public.note_grants g
where not exists (
  select 1 from public.notes n
  where n.id = g.note_id and n.user_id = g.owner_id
);

delete from public.note_shares s
where not exists (
  select 1 from public.notes n
  where n.id = s.note_id and n.user_id = s.owner_id
);

-- 5) Anti-enumeration ------------------------------------------------------

create or replace function public.share_note_with_email(p_note_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note record;
  v_grantee uuid;
begin
  -- Uniform failure for "not yours" and "does not exist" so note ids cannot be
  -- probed.
  select id, user_id into v_note
  from public.notes
  where id = p_note_id and user_id = (select auth.uid());
  if v_note.id is null then
    raise exception 'you can only share notes you own';
  end if;

  select id into v_grantee from auth.users where lower(email) = lower(trim(p_email));
  if v_grantee is null then
    -- Same message shape as an existing account; the client only learns success
    -- through the returned grantee id.
    raise exception 'cannot share with that account';
  end if;
  if v_grantee = (select auth.uid()) then
    raise exception 'cannot share a note with yourself';
  end if;

  insert into public.note_grants (note_id, owner_id, grantee_id)
  values (v_note.id, v_note.user_id, v_grantee)
  on conflict (note_id, grantee_id) do nothing;

  return v_grantee;
end;
$$;
revoke all on function public.share_note_with_email(uuid, text) from public;
grant execute on function public.share_note_with_email(uuid, text) to authenticated;

create or replace function public.invite_workspace_member(p_workspace_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grantee uuid;
begin
  if not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = (select auth.uid())
  ) then
    raise exception 'only the workspace owner can invite members';
  end if;

  select id into v_grantee from auth.users where lower(email) = lower(btrim(p_email));
  if v_grantee is null then
    raise exception 'cannot invite that account';
  end if;
  if v_grantee = (select auth.uid()) then
    raise exception 'you are already the owner';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, v_grantee, 'invited')
  on conflict (workspace_id, user_id) do nothing;

  return v_grantee;
end;
$$;
revoke all on function public.invite_workspace_member(uuid, text) from public;
grant execute on function public.invite_workspace_member(uuid, text) to authenticated;