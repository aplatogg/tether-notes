-- Sharing, note locking columns, and the public read function.

alter table public.notes
  add column if not exists lock_hash text;

create table if not exists public.note_shares (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists note_shares_note_idx on public.note_shares (note_id);
create index if not exists note_shares_owner_idx on public.note_shares (owner_id);

alter table public.note_shares enable row level security;

drop policy if exists "shares_owner_all" on public.note_shares;
create policy "shares_owner_all"
on public.note_shares for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.note_shares to authenticated;
revoke all on table public.note_shares from anon;

-- Reads one shared note by token without exposing the table.
-- Locked notes are not shared: the caller sees a null body instead.
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
    n.title,
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
