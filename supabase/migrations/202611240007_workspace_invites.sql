-- Workspace invites need an approval step: invite creates a pending 'invited'
-- row; the invitee sees it in an Invitations inbox and accepts (-> member) or
-- declines. Pending invitees get no access to workspace notes.

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check check (role in ('owner', 'member', 'invited'));

-- Membership now excludes pending invites.
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'member')
  );
$$;
revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;

-- Members see rows of workspaces they belong to; anyone sees their own rows (invites).
drop policy if exists "members_select" on public.workspace_members;
create policy "members_select"
on public.workspace_members for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.is_workspace_member(workspace_members.workspace_id)
);

-- Invite now creates a pending invite.
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
    raise exception 'no user with that email';
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

-- Only accepted workspaces show up as "my workspaces".
create or replace function public.my_workspaces()
returns table (workspace_id uuid, name text, role text)
language sql
security definer
set search_path = ''
as $$
  select w.id, w.name, m.role
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = (select auth.uid())
    and m.role in ('owner', 'member')
  order by w.created_at;
$$;
revoke all on function public.my_workspaces() from public;
grant execute on function public.my_workspaces() to authenticated;

-- Pending invites for the current user, with the inviter's email.
create or replace function public.my_workspace_invites()
returns table (workspace_id uuid, name text, inviter_email text)
language sql
security definer
set search_path = ''
as $$
  select w.id, w.name, u.email
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  join auth.users u on u.id = w.owner_id
  where m.user_id = (select auth.uid())
    and m.role = 'invited'
  order by m.created_at;
$$;
revoke all on function public.my_workspace_invites() from public;
grant execute on function public.my_workspace_invites() to authenticated;

create or replace function public.accept_workspace_invite(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workspace_members
  set role = 'member'
  where workspace_id = p_workspace_id
    and user_id = (select auth.uid())
    and role = 'invited';
end;
$$;
revoke all on function public.accept_workspace_invite(uuid) from public;
grant execute on function public.accept_workspace_invite(uuid) to authenticated;

create or replace function public.decline_workspace_invite(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = (select auth.uid())
    and role = 'invited';
end;
$$;
revoke all on function public.decline_workspace_invite(uuid) from public;
grant execute on function public.decline_workspace_invite(uuid) to authenticated;
