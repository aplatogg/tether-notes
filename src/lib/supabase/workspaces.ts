import type { SupabaseClient } from "@supabase/supabase-js";

export interface Workspace {
  id: string;
  name: string;
  role: "owner" | "member";
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  role: string;
}

export interface WorkspaceInvite {
  workspaceId: string;
  name: string;
  inviterEmail: string;
}

export async function listMyInvites(client: SupabaseClient): Promise<WorkspaceInvite[]> {
  const { data, error } = await client.rpc("my_workspace_invites");
  if (error) throw new Error(error.message);
  return (data ?? []).map(
    (row: { workspace_id: string; name: string; inviter_email: string }) => ({
      workspaceId: row.workspace_id,
      name: row.name,
      inviterEmail: row.inviter_email,
    }),
  );
}

export async function acceptWorkspaceInvite(
  client: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await client.rpc("accept_workspace_invite", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(error.message);
}

export async function declineWorkspaceInvite(
  client: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await client.rpc("decline_workspace_invite", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(error.message);
}

export async function listMyWorkspaces(client: SupabaseClient): Promise<Workspace[]> {
  const { data, error } = await client.rpc("my_workspaces");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { workspace_id: string; name: string; role: string }) => ({
    id: row.workspace_id,
    name: row.name,
    role: row.role === "owner" ? "owner" : "member",
  }));
}

export async function createWorkspace(client: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await client.rpc("create_workspace", { p_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function inviteWorkspaceMember(
  client: SupabaseClient,
  workspaceId: string,
  email: string,
): Promise<void> {
  const { error } = await client.rpc("invite_workspace_member", {
    p_workspace_id: workspaceId,
    p_email: email,
  });
  if (error) throw new Error(error.message);
}

export async function removeWorkspaceMember(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { error } = await client.rpc("remove_workspace_member", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function leaveWorkspace(client: SupabaseClient, workspaceId: string): Promise<void> {
  const { error } = await client.rpc("leave_workspace", { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
}

/** Owner-only. Notes are kept and become personal (workspace_id set null by FK). */
export async function deleteWorkspace(client: SupabaseClient, workspaceId: string): Promise<void> {
  const { error } = await client.rpc("delete_workspace", { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
}

export async function listWorkspaceMembers(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const { data, error } = await client.rpc("workspace_members_list", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { user_id: string; email: string; role: string }) => ({
    userId: row.user_id,
    email: row.email,
    role: row.role,
  }));
}
