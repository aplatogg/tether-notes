-- Reminders, folders, and note attachments (Supabase Storage, private bucket).

alter table public.notes
  add column if not exists reminder_at timestamptz,
  add column if not exists folder text not null default '';

create index if not exists notes_reminder_idx on public.notes (reminder_at)
  where reminder_at is not null;

create table if not exists public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null unique,
  name text not null,
  mime text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists note_attachments_note_idx on public.note_attachments (note_id);

alter table public.note_attachments enable row level security;

drop policy if exists "attachments_owner_all" on public.note_attachments;
create policy "attachments_owner_all"
on public.note_attachments for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Recipients of a shared note can read its attachment metadata.
drop policy if exists "attachments_grantee_select" on public.note_attachments;
create policy "attachments_grantee_select"
on public.note_attachments for select
to authenticated
using (
  exists (
    select 1 from public.note_grants g
    where g.note_id = note_attachments.note_id
      and g.grantee_id = (select auth.uid())
  )
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.note_attachments to authenticated;
revoke all on table public.note_attachments from anon;

-- Private storage bucket for attachment bytes.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "attachments owner manage objects" on storage.objects;
create policy "attachments owner manage objects"
on storage.objects for all
to authenticated
using (
  bucket_id = 'attachments'
  and (select auth.uid())::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'attachments'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "attachments grantee read objects" on storage.objects;
create policy "attachments grantee read objects"
on storage.objects for select
to authenticated
using (
  bucket_id = 'attachments'
  and exists (
    select 1
    from public.note_attachments a
    join public.note_grants g on g.note_id = a.note_id
    where a.path = storage.objects.name
      and g.grantee_id = (select auth.uid())
  )
);

-- Realtime for attachment metadata so shared notes show files live.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'note_attachments'
  ) then
    alter publication supabase_realtime add table public.note_attachments;
  end if;
end;
$$;
