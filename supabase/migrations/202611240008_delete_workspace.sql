-- append: delete_workspace RPC (owner only; notes fall back to personal via FK)
create or replace function public.delete_workspace(p_workspace_id uuid)
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
    raise exception 'only the workspace owner can delete it';
  end if;

  delete from public.workspaces where id = p_workspace_id;
end;
$$;
revoke all on function public.delete_workspace(uuid) from public;
grant execute on function public.delete_workspace(uuid) to authenticated;
