interface MentionSearchSnapshot {
	workspaceRoot: string;
	generation: number;
}

export function createMentionSearchController(initialWorkspaceRoot: string) {
	let workspaceRoot = initialWorkspaceRoot;
	let generation = 0;

	return {
		startSearch(): MentionSearchSnapshot {
			generation += 1;
			return { workspaceRoot, generation };
		},
		setWorkspaceRoot(nextWorkspaceRoot: string): boolean {
			if (workspaceRoot === nextWorkspaceRoot) {
				return false;
			}
			workspaceRoot = nextWorkspaceRoot;
			generation += 1;
			return true;
		},
		isCurrent(snapshot: MentionSearchSnapshot): boolean {
			return (
				snapshot.workspaceRoot === workspaceRoot &&
				snapshot.generation === generation
			);
		},
	};
}
