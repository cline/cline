import { EmptyRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineClient } from "@/shared/cline"
import { GetHostVersionResponse } from "@/shared/proto/index.host"

export async function getHostVersion(_: EmptyRequest): Promise<GetHostVersionResponse> {
	return {
		platform: vscode.env.appName,
		version: vscode.version,
		clineType: ClineClient.VSCode,
		clineVersion: ExtensionRegistryInfo.version,
		// vscode.env.remoteName is a non-empty string when connected to a remote workspace
		// (e.g. "ssh-remote", "dev-container", "codespaces") and undefined otherwise.
		// We coerce falsy values (undefined, null, "") to undefined so the proto optional
		// field is absent for local workspaces. An empty string is treated as local — the
		// safe direction (false negative rather than false positive).
		remoteName: vscode.env.remoteName || undefined,
	}
}
