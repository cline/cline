import { createHash } from "node:crypto"
import * as vscode from "vscode"
import { getWorkspaceKey } from "./discoverPythonEnvironments"

/**
 * Stable session key for a persistent kernel subprocess.
 * Default: workspace + artifact + profile (isolated namespaces per artifact).
 */
export function buildKernelSessionKey(workspaceKey: string, artifactId: string, profileId: string): string {
	const shareAcrossArtifacts = vscode.workspace
		.getConfiguration("aihydro.htmlPreview")
		.get<boolean>("shareKernelAcrossArtifacts", false)
	const artifactPart = shareAcrossArtifacts ? "__shared__" : artifactId
	const raw = `${workspaceKey}\0${artifactPart}\0${profileId}`
	return createHash("sha256").update(raw).digest("hex").slice(0, 24)
}

export function buildSessionKeyForArtifact(artifactId: string, profileId: string): string {
	return buildKernelSessionKey(getWorkspaceKey(), artifactId, profileId)
}
