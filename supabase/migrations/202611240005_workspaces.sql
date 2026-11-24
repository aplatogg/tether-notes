-- Team workspaces: a workspace has an owner and members (by email invite).
-- Notes filed into a workspace (notes.workspace_id) are readable and writable
-- by every member; personal notes (workspace_id null) stay owner-only, and
-- the existing per-note share grants are untouched.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "workspaces_owner_all" on public.workspaces;
create policy "workspaces_owner_all"
on public.workspaces for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "workspaces_member_select" on public.workspaces;
create policy "workspaces_member_select"
on public.workspaces for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspaces.id and m.user_id = (select auth.uid())
  )
);

drop policy if exists "members_select" on public.workspace_members;
create policy "members_select"
on public.workspace_members for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members m2
    where m2.workspace_id = workspace_members.workspace_id and m2.user_id = (select auth.uid())
  )
);

drop policy if exists "members_owner_insert" on public.workspace_members;
create policy "members_owner_insert"
on public.workspace_members for insert
to authenticated
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id and w.owner_id = (select auth.uid())
  )
);

drop policy if exists "members_owner_delete" on public.workspace_members;
create policy "members_owner_delete"
on public.workspace_members for delete
to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id and w.owner_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
revoke all on public.workspaces from anon;
revoke all on public.workspace_members from anon;

alter table public.notes add column if not exists workspace_id uuid references public.workspaces (id) on delete set null;
create index if not exists notes_workspace_idx on public.notes (workspace_id) where workspace_id is not null;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;

-- Notes access: own + granted + workspace member.
drop policy if exists "notes_select_own_or_granted" on public.notes;
create policy "notes_select_own_granted_or_workspace"
on public.notes for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.note_grants g
    where g.note_id = notes.id and g.grantee_id = (select auth.uid())
  )
  or (
    notes.workspace_id is not null
    and public.is_workspace_member(notes.workspace_id)
  )
);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own_or_workspace"
on public.notes for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (notes.workspace_id is null or public.is_workspace_member(notes.workspace_id))
);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own_or_workspace"
on public.notes for update
to authenticated
using (
  (select auth.uid()) = user_id
  or (notes.workspace_id is not null and public.is_workspace_member(notes.workspace_id))
)
with check (
  (select auth.uid()) = user_id
  or (notes.workspace_id is not null and public.is_workspace_member(notes.workspace_id))
);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own_or_workspace"
on public.notes for delete
to authenticated
using (
  (select auth.uid()) = user_id
  or (notes.workspace_id is not null and public.is_workspace_member(notes.workspace_id))
);

-- RPCs -------------------------------------------------------------------

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.workspaces (name, owner_id)
  values (btrim(p_name), (select auth.uid()))
  returning id into v_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_id, (select auth.uid()), 'owner');

  return v_id;
end;
$$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;

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
  values (p_workspace_id, v_grantee, 'member')
  on conflict (workspace_id, user_id) do nothing;

  return v_grantee;
end;
$$;
revoke all on function public.invite_workspace_member(uuid, text) from public;
grant execute on function public.invite_workspace_member(uuid, text) to authenticated;

create or replace function public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = (select auth.uid())
  ) then
    raise exception 'only the workspace owner can remove members';
  end if;

  delete from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and role <> 'owner';
end;
$$;
revoke all on function public.remove_workspace_member(uuid, uuid) from public;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = (select auth.uid())
    and role <> 'owner';
end;
$$;
revoke all on function public.leave_workspace(uuid) from public;
grant execute on function public.leave_workspace(uuid) to authenticated;

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
  order by w.created_at;
$$;
revoke all on function public.my_workspaces() from public;
grant execute on function public.my_workspaces() to authenticated;

create or replace function public.workspace_members_list(p_workspace_id uuid)
returns table (user_id uuid, email text, role text)
language sql
security definer
set search_path = ''
as $$
  select m.user_id, u.email, m.role
  from public.workspace_members m
  join auth.users u on u.id = m.user_id
  where m.workspace_id = p_workspace_id
    and exists (
      select 1 from public.workspace_members m2
      where m2.workspace_id = p_workspace_id and m2.user_id = (select auth.uid())
    )
  order by m.created_at;
$$;
revoke all on function public.workspace_members_list(uuid) from public;
grant execute on function public.workspace_members_list(uuid) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['workspaces', 'workspace_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
