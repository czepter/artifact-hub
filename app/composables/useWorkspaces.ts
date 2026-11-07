export interface WorkspaceInfo {
  id: string, name: string, description: string, color: string | null, icon: string | null,
  isDefault: boolean, artifactCount: number, createdAt: string, updatedAt: string,
}

/** Shared workspace list for the switcher, the artifacts page and the move menus. */
export function useWorkspaces() {
  const list = useState<WorkspaceInfo[]>('hub-workspaces', () => [])
  async function load() {
    list.value = await $fetch<WorkspaceInfo[]>('/api/workspaces').catch(() => list.value)
  }
  return { list, load }
}

export const WORKSPACE_COLORS = ['#0d6fd6', '#1a8f5c', '#b7791f', '#c4281c', '#8250df', '#d1458b', '#0f8b8d', '#6b7280']
