import {
	upsertWorkspaceInfo,
	type WorkspaceInfo,
	type WorkspaceManifest,
	WorkspaceManifestSchema,
} from "@clinebot/shared";
import {
	generateWorkspaceInfo,
	normalizeWorkspacePath,
} from "../services/workspace-manifest";

export interface WorkspaceManagerEvent {
	type: "workspace_added" | "workspace_switched";
	workspace: WorkspaceInfo;
}

export interface WorkspaceManager {
	addWorkspacePath(workspacePath: string): Promise<WorkspaceInfo>;
	switchWorkspace(workspacePath: string): Promise<WorkspaceInfo>;
	subscribe(listener: (event: WorkspaceManagerEvent) => void): () => void;
	getCurrentWorkspace(): WorkspaceInfo | undefined;
	getWorkspace(workspacePath: string): WorkspaceInfo | undefined;
	listWorkspaces(): WorkspaceInfo[];
	getManifest(): WorkspaceManifest;
}

export class InMemoryWorkspaceManager implements WorkspaceManager {
	private manifest: WorkspaceManifest;
	private readonly listeners = new Set<
		(event: WorkspaceManagerEvent) => void
	>();

	constructor(manifest?: WorkspaceManifest) {
		this.manifest = WorkspaceManifestSchema.parse(
			manifest ?? { workspaces: {} },
		);
	}

	async addWorkspacePath(workspacePath: string): Promise<WorkspaceInfo> {
		const info = await generateWorkspaceInfo(workspacePath);
		this.manifest = upsertWorkspaceInfo(this.manifest, info);
		this.emit({ type: "workspace_added", workspace: info });
		return info;
	}

	async switchWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
		const normalizedPath = normalizeWorkspacePath(workspacePath);
		const existing = this.manifest.workspaces[normalizedPath];
		if (existing) {
			this.manifest = WorkspaceManifestSchema.parse({
				...this.manifest,
				currentWorkspacePath: normalizedPath,
			});
			this.emit({ type: "workspace_switched", workspace: existing });
			return existing;
		}

		const added = await this.addWorkspacePath(normalizedPath);
		this.manifest = WorkspaceManifestSchema.parse({
			...this.manifest,
			currentWorkspacePath: added.rootPath,
		});
		this.emit({ type: "workspace_switched", workspace: added });
		return added;
	}

	subscribe(listener: (event: WorkspaceManagerEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getCurrentWorkspace(): WorkspaceInfo | undefined {
		const currentPath = this.manifest.currentWorkspacePath;
		if (!currentPath) {
			return undefined;
		}
		return this.manifest.workspaces[currentPath];
	}

	getWorkspace(workspacePath: string): WorkspaceInfo | undefined {
		const normalizedPath = normalizeWorkspacePath(workspacePath);
		return this.manifest.workspaces[normalizedPath];
	}

	listWorkspaces(): WorkspaceInfo[] {
		return Object.values(this.manifest.workspaces);
	}

	getManifest(): WorkspaceManifest {
		return this.manifest;
	}

	private emit(event: WorkspaceManagerEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
