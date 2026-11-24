-- Account-to-account sharing: the owner shares a note with a specific user
-- by email. The grantee can read the note (read-only); everyone else cannot.

create table if not exists public.note_grants (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  grantee_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (note_id, grantee_id)
);

create index if not exists note_grants_grantee_idx on public.note_grants (grantee_id, note_id);
create index if not exists note_grants_note_idx on public.note_grants (note_id);

alter table public.note_grants enable row level security;

drop policy if exists "grants_owner_all" on public.note_grants;
create policy "grants_owner_all"
on public.note_grants for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "grants_grantee_select" on public.note_grants;
create policy "grants_grantee_select"
on public.note_grants for select
to authenticated
using ((select auth.uid()) = grantee_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.note_grants to authenticated;
revoke all on table public.note_grants from anon;

-- Notes: a grantee may read notes shared with them. Insert/update/delete stay
-- owner-only (existing policies are untouched).
drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own_or_granted"
on public.notes for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.note_grants g
    where g.note_id = notes.id
      and g.grantee_id = (select auth.uid())
  )
);

-- Owner shares a note with a user resolved by email.
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
  select id, user_id into v_note from public.notes where id = p_note_id;
  if v_note.id is null then
    raise exception 'note not found';
  end if;
  if v_note.user_id <> (select auth.uid()) then
    raise exception 'only the owner can share this note';
  end if;

  select id into v_grantee from auth.users where lower(email) = lower(trim(p_email));
  if v_grantee is null then
    raise exception 'no user with that email';
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

-- Owner revokes one grantee.
create or replace function public.revoke_note_share(p_note_id uuid, p_grantee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.notes where id = p_note_id and user_id = (select auth.uid())
  ) then
    raise exception 'only the owner can revoke shares';
  end if;
  delete from public.note_grants
  where note_id = p_note_id
    and grantee_id = p_grantee_id
    and owner_id = (select auth.uid());
end;
$$;
revoke all on function public.revoke_note_share(uuid, uuid) from public;
grant execute on function public.revoke_note_share(uuid, uuid) to authenticated;

-- Owner lists the grantee emails of one of their notes.
create or replace function public.note_grant_emails(p_note_id uuid)
returns table (grantee_id uuid, email text)
language sql
security definer
set search_path = ''
as $$
  select g.grantee_id, u.email
  from public.note_grants g
  join auth.users u on u.id = g.grantee_id
  where g.note_id = p_note_id
    and g.owner_id = (select auth.uid());
$$;
revoke all on function public.note_grant_emails(uuid) from public;
grant execute on function public.note_grant_emails(uuid) to authenticated;

-- Recipient: owner email per shared note, for the "shared by" label.
create or replace function public.my_shared_note_owners()
returns table (note_id uuid, owner_email text)
language sql
security definer
set search_path = ''
as $$
  select g.note_id, u.email
  from public.note_grants g
  join auth.users u on u.id = g.owner_id
  where g.grantee_id = (select auth.uid());
$$;
revoke all on function public.my_shared_note_owners() from public;
grant execute on function public.my_shared_note_owners() to authenticated;

-- Realtime for grants so recipients see new shares without a reload.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'note_grants'
  ) then
    alter publication supabase_realtime add table public.note_grants;
  end if;
end;
$$;
