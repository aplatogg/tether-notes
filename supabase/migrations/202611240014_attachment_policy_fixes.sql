-- Attachment follow-ups (2026-11-25 audit):
-- 1) note_attachments(path) is already indexed by the UNIQUE(path) constraint
--    (note_attachments_path_key), so the storage read policy's join is covered;
--    no extra index is added here.
-- 2) attachments_delete only allowed the uploader. A note owner could not remove
--    an attachment a workspace member added to their own note (metadata row
--    blocked), and the storage policy scoped objects to the uploader's folder,
--    so the bytes could not be deleted either.
-- 3) Upload path now uses the uploader's uid (client fix), matching the bucket
--    policy; the note owner additionally gets delete rights on their notes.

drop policy if exists attachments_delete on public.note_attachments;
create policy attachments_delete on public.note_attachments for delete
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.notes n
      where n.id = note_attachments.note_id
        and n.user_id = (select auth.uid())
    )
  );

-- Storage: allow deleting an object that belongs to a note you own, in addition
-- to the existing "own folder" rule.
drop policy if exists "attachments owner delete objects" on storage.objects;
create policy "attachments owner delete objects"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'attachments'
  and exists (
    select 1
    from public.note_attachments a
    join public.notes n on n.id = a.note_id
    where a.path = storage.objects.name
      and n.user_id = (select auth.uid())
  )
);

select json_build_object(
  'path_index', (select count(*) from pg_indexes where schemaname='public' and tablename='note_attachments' and indexname='note_attachments_path_idx'),
  'delete_policy', (select pg_get_expr(polqual, polrelid) from pg_policy where polname='attachments_delete' and polrelid='public.note_attachments'::regclass),
  'storage_policies', (select string_agg(polname, ', ' order by polname) from pg_policy where polrelid='storage.objects'::regclass)
) as result;
-- 4) The original grantee-read policy (202611240003) was superseded by the
--    workspace-aware one in 202611240011 but never dropped, leaving two
--    permissive SELECT policies on storage.objects.
drop policy if exists "attachments grantee read objects" on storage.objects;
