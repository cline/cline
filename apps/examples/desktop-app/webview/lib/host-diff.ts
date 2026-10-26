"use client";

import { desktopClient } from "@/lib/desktop-client";
import type { SessionChangeContents, SessionChangeFile } from "@/lib/session-changes";
import { resolveWorkspaceFilePath } from "@/lib/workspace-paths";

/**
 * Open a session change in the host's diff viewer (VS Code's side-by-side
 * editor). The sidecar reads the before/after blobs by git OID; the host
 * renders them. Used when `HostCapabilities.opensDiffsExternally` is set.
 */
export async function openSessionChangeInHost(options: {
	environmentId: string;
	/** Repository root the file paths are relative to. */
	root: string;
	file: SessionChangeFile;
}): Promise<void> {
	const { environmentId, root, file } = options;
	const contents = await desktopClient.invoke<SessionChangeContents>(
		"read_session_change",
		{
			environmentId,
			cwd: root,
			oldOid: file.oldOid,
			newOid: file.newOid,
		},
	);
	if (contents.binary) {
		throw new Error("Binary files cannot be shown as a diff.");
	}
	await desktopClient.invoke("open_file_diff", {
		path: resolveWorkspaceFilePath(file.path, root),
		title: `${file.path} (Cline changes)`,
		oldText: contents.oldText ?? "",
		newText: contents.newText,
		status: file.status,
	});
}
