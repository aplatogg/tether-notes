-- Share groups: let the recipient organize notes shared with them into named
-- groups, plus a per-sender auto-group rule ("everything from this coworker
-- goes to group X"). Only the recipient can label their own incoming shares;
-- the owner never sees group labels.

alter table public.note_grants add column if not exists group_name text;

create table if not exists public.share_group_rules (
  user_id uuid not null references auth.users (id) on delete cascade,
  owner_email text not null,
  group_name text not null,
  primary key (user_id, owner_email)
);

alter table public.share_group_rules enable row level security;

drop policy if exists "share_group_rules_own" on public.share_group_rules;
create policy "share_group_rules_own"
on public.share_group_rules for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.share_group_rules to authenticated;
revoke all on public.share_group_rules from anon;

-- Recipient sets/clears the group label on one of their incoming shares.
create or replace function public.set_shared_note_group(p_note_id uuid, p_group text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.note_grants
  set group_name = nullif(btrim(p_group), '')
  where note_id = p_note_id
    and grantee_id = (select auth.uid());
end;
$$;
revoke all on function public.set_shared_note_group(uuid, text) from public;
grant execute on function public.set_shared_note_group(uuid, text) to authenticated;

-- Recipient sets/clears the auto-group rule for one sender email.
-- Empty group removes the rule.
create or replace function public.set_share_autogroup(p_owner_email text, p_group text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_group), '') is null then
    delete from public.share_group_rules
    where user_id = (select auth.uid())
      and owner_email = lower(btrim(p_owner_email));
  else
    insert into public.share_group_rules (user_id, owner_email, group_name)
    values ((select auth.uid()), lower(btrim(p_owner_email)), btrim(p_group))
    on conflict (user_id, owner_email)
    do update set group_name = excluded.group_name;
  end if;
end;
$$;
revoke all on function public.set_share_autogroup(text, text) from public;
grant execute on function public.set_share_autogroup(text, text) to authenticated;

-- Effective group per shared note: explicit grant label wins, otherwise the
-- sender's auto-group rule applies.
create or replace function public.my_shared_note_groups()
returns table (note_id uuid, group_name text)
language sql
security definer
set search_path = ''
as $$
  select g.note_id, coalesce(g.group_name, r.group_name) as group_name
  from public.note_grants g
  left join public.share_group_rules r
    on r.user_id = g.grantee_id
   and r.owner_email = (
     select lower(u.email) from auth.users u where u.id = g.owner_id
   )
  where g.grantee_id = (select auth.uid())
    and coalesce(g.group_name, r.group_name) is not null;
$$;
revoke all on function public.my_shared_note_groups() from public;
grant execute on function public.my_shared_note_groups() to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'share_group_rules'
  ) then
    alter publication supabase_realtime add table public.share_group_rules;
  end if;
end;
$$;
