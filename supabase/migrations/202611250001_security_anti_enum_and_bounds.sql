-- Security hardening v2 (2026-11-25):
-- 1) True anti-enumeration (Exploit 5):
--    share_note_with_email and invite_workspace_member previously raised an
--    exception when p_email was not in auth.users and returned the victim's
--    UUID when it was, letting any authenticated account enumerate registered
--    emails and map them to user IDs. Both functions now return void and
--    silently no-op when the target email does not exist (or equals the
--    caller). Basic email syntax validation is still enforced uniformly.
-- 2) Column length & payload bounds (Exploit 6):
--    Enforce hard upper bounds on title, body, folder, lock_hash, workspace
--    name, share group labels, and attachment metadata so a rogue client
--    cannot stuff multi-megabyte strings into single rows.

-- 1) Anti-enumeration RPCs -------------------------------------------------

drop function if exists public.share_note_with_email(uuid, text);
create or replace function public.share_note_with_email(p_note_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_clean_email text := lower(btrim(coalesce(p_email, '')));
  v_note record;
  v_grantee uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if v_clean_email = '' or char_length(v_clean_email) > 320 or position('@' in v_clean_email) <= 1 then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;

  -- Uniform check for ownership so foreign note IDs cannot be probed.
  select id, user_id into v_note
  from public.notes
  where id = p_note_id and user_id = v_uid;
  if v_note.id is null then
    raise exception 'you can only share notes you own' using errcode = '42501';
  end if;

  select id into v_grantee
  from auth.users
  where lower(email) = v_clean_email;

  -- Constant-shape response: whether the email exists or not, no error is
  -- raised and no UUID is returned.
  if v_grantee is not null and v_grantee <> v_uid then
    insert into public.note_grants (note_id, owner_id, grantee_id)
    values (v_note.id, v_note.user_id, v_grantee)
    on conflict (note_id, grantee_id) do nothing;
  end if;
end;
$$;
revoke all on function public.share_note_with_email(uuid, text) from public;
grant execute on function public.share_note_with_email(uuid, text) to authenticated;

drop function if exists public.invite_workspace_member(uuid, text);
create or replace function public.invite_workspace_member(p_workspace_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_clean_email text := lower(btrim(coalesce(p_email, '')));
  v_grantee uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if v_clean_email = '' or char_length(v_clean_email) > 320 or position('@' in v_clean_email) <= 1 then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = v_uid
  ) then
    raise exception 'only the workspace owner can invite members' using errcode = '42501';
  end if;

  select id into v_grantee
  from auth.users
  where lower(email) = v_clean_email;

  -- Constant-shape response: do not reveal whether the email is registered.
  if v_grantee is not null and v_grantee <> v_uid then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, v_grantee, 'invited')
    on conflict (workspace_id, user_id) do nothing;
  end if;
end;
$$;
revoke all on function public.invite_workspace_member(uuid, text) from public;
grant execute on function public.invite_workspace_member(uuid, text) to authenticated;

-- 2) Column length & payload bounds (Exploit 6) ----------------------------

alter table public.notes
  drop constraint if exists notes_title_length_check,
  drop constraint if exists notes_body_length_check,
  drop constraint if exists notes_folder_length_check,
  drop constraint if exists notes_lock_hash_length_check;

alter table public.notes
  add constraint notes_title_length_check check (char_length(title) <= 500) not valid,
  add constraint notes_body_length_check check (char_length(body) <= 500000) not valid,
  add constraint notes_folder_length_check check (char_length(folder) <= 60) not valid,
  add constraint notes_lock_hash_length_check check (lock_hash is null or char_length(lock_hash) <= 256) not valid;

alter table public.notes
  validate constraint notes_title_length_check,
  validate constraint notes_body_length_check,
  validate constraint notes_folder_length_check,
  validate constraint notes_lock_hash_length_check;

alter table public.workspaces
  drop constraint if exists workspaces_name_length_check;

alter table public.workspaces
  add constraint workspaces_name_length_check check (char_length(btrim(name)) between 1 and 60) not valid;

alter table public.workspaces
  validate constraint workspaces_name_length_check;

alter table public.note_grants
  drop constraint if exists note_grants_group_name_length_check;

alter table public.note_grants
  add constraint note_grants_group_name_length_check check (group_name is null or char_length(group_name) <= 60) not valid;

alter table public.note_grants
  validate constraint note_grants_group_name_length_check;

alter table public.share_group_rules
  drop constraint if exists share_group_rules_bounds_check;

alter table public.share_group_rules
  add constraint share_group_rules_bounds_check check (
    char_length(owner_email) <= 320 and char_length(group_name) <= 60
  ) not valid;

alter table public.share_group_rules
  validate constraint share_group_rules_bounds_check;

alter table public.note_attachments
  drop constraint if exists note_attachments_bounds_check;

alter table public.note_attachments
  add constraint note_attachments_bounds_check check (
    size_bytes >= 0
    and size_bytes <= 26214400
    and char_length(name) <= 200
    and char_length(mime) <= 120
    and char_length(path) <= 500
  ) not valid;

alter table public.note_attachments
  validate constraint note_attachments_bounds_check;

update storage.buckets
set file_size_limit = 26214400
where id = 'attachments';
