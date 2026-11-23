create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  tags text[] not null default '{}'::text[],
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_tags_limit check (cardinality(tags) <= 20)
);

create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);

create index if not exists notes_user_active_updated_idx
  on public.notes (user_id, updated_at desc)
  where deleted_at is null and is_archived = false;

create index if not exists notes_user_pinned_updated_idx
  on public.notes (user_id, updated_at desc)
  where deleted_at is null and is_archived = false and is_pinned = true;

create index if not exists notes_user_archived_updated_idx
  on public.notes (user_id, updated_at desc)
  where deleted_at is null and is_archived = true;

create or replace function public.set_notes_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;

  if new.updated_at = old.updated_at then
    new.updated_at = clock_timestamp();
  end if;

  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
before update on public.notes
for each row execute function public.set_notes_updated_at();

alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own"
on public.notes for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own"
on public.notes for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own"
on public.notes for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own"
on public.notes for delete
to authenticated
using ((select auth.uid()) = user_id);

alter table public.notes replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;
end;
$$;
