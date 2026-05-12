import { z } from "zod";

export const WorkspaceInfoSchema = z.object({
	rootPath: z.string().min(1),
	hint: z.string().min(1).optional(),
	associatedRemoteUrls: z.array(z.string().min(1)).optional(),
	latestGitCommitHash: z.string().min(1).optional(),
	latestGitBranchName: z.string().min(1).optional(),
});

export const WorkspaceManifestSchema = z.object({
	currentWorkspacePath: z.string().min(1).optional(),
	workspaces: z.record(z.string().min(1), WorkspaceInfoSchema),
});

export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;

export function emptyWorkspaceManifest(): WorkspaceManifest {
	return { workspaces: {} };
}

export interface WorkspaceInfo {
	rootPath: string;
	hint?: string;
	associatedRemoteUrls?: string[];
	latestGitCommitHash?: string;
	latestGitBranchName?: string;
}

export function upsertWorkspaceInfo(
	manifest: WorkspaceManifest,
	info: WorkspaceInfo,
): WorkspaceManifest {
	const nextManifest: WorkspaceManifest = {
		...manifest,
		workspaces: {
			...manifest.workspaces,
			[info.rootPath]: info,
		},
	};
	if (!nextManifest.currentWorkspacePath) {
		nextManifest.currentWorkspacePath = info.rootPath;
	}
	return WorkspaceManifestSchema.parse(nextManifest);
}
