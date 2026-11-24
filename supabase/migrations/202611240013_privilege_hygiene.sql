-- Privilege hygiene (2026-11-25 audit):
-- Supabase's default ACL grants anon/authenticated arwdDxtm on new public
-- tables. TRUNCATE bypasses RLS entirely, and REFERENCES/TRIGGER are never
-- needed by clients. RLS still gates SELECT/INSERT/UPDATE/DELETE, so keep only
-- those four.

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.relname);
    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end $$;

-- Future tables created in public must not inherit the wide default either.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- Notes are readable by anonymous only through shared_note(token), never the table.
grant select on public.note_shares to authenticated;
revoke all on public.note_shares from anon;

-- Verify
select json_build_object(
  'notes_anon', (select json_agg(distinct privilege_type) from information_schema.role_table_grants
                 where table_schema='public' and table_name='notes' and grantee='anon'),
  'notes_auth', (select json_agg(distinct privilege_type) from information_schema.role_table_grants
                 where table_schema='public' and table_name='notes' and grantee='authenticated'),
  'truncate_any', (select count(*) from information_schema.role_table_grants
                   where table_schema='public' and privilege_type='TRUNCATE'
                     and grantee in ('anon','authenticated'))
) as privilege_hygiene;