import { HostProvider } from "@/hosts/host-provider"
import { EmptyRequest } from "@/shared/proto/cline/common"

/**
 * Checks if the current workspace has multiple root folders open.
 * This is a lightweight check that only counts workspace folders,
 * independent of feature flags or internal multi-root implementation status.
 *
 * Use this when you need to know the actual workspace state (e.g., for telemetry,
 * headers, or UI display), not whether multi-root features are enabled.
 *
 * @returns true if 2 or more workspace folders are open, false otherwise
 * @example
 * ```typescript
 * const isMultiRoot = await isMultiRootWorkspace()
 * console.log(`User has ${isMultiRoot ? 'multiple' : 'single'} workspace folders open`)
 * ```
 */
export async function isMultiRootWorkspace(): Promise<boolean> {
	try {
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths(EmptyRequest.create({}))
		return workspacePaths.paths.length > 1
	} catch (error) {
		console.error("Failed to detect multi-root workspace", error)
		return false
	}
}
