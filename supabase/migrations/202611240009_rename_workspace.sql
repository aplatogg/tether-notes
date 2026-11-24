-- Owner can rename a workspace.
create or replace function public.rename_workspace(p_workspace_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'workspace name cannot be empty';
  end if;

  if not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = (select auth.uid())
  ) then
    raise exception 'only the workspace owner can rename it';
  end if;

  update public.workspaces set name = btrim(p_name) where id = p_workspace_id;
end;
$$;
revoke all on function public.rename_workspace(uuid, text) from public;
grant execute on function public.rename_workspace(uuid, text) to authenticated;
