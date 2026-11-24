-- Fix: members_select self-joined workspace_members causing infinite recursion.
-- Use the security-definer helper instead.
drop policy if exists "members_select" on public.workspace_members;
create policy "members_select"
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_members.workspace_id));

drop policy if exists "workspaces_member_select" on public.workspaces;
create policy "workspaces_member_select"
on public.workspaces for select
to authenticated
using (public.is_workspace_member(workspaces.id));
