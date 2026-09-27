export type HistoryScope = "current" | "hierarchical" | "all";

export function getNextHistoryScope(current: HistoryScope): HistoryScope {
	switch (current) {
		case "current":
			return "hierarchical";
		case "hierarchical":
			return "all";
		case "all":
			return "current";
	}
}

export function formatHistoryScopeLabel(
	scope: HistoryScope,
	count: number,
	options: { isSubWorkspace?: boolean } = {},
): string {
	switch (scope) {
		case "current":
			return `${options.isSubWorkspace ? "Current Sub-Workspace" : "Current Workspace"} (${count} sessions)`;
		case "hierarchical":
			return `Entire Monorepo (${count} sessions)`;
		case "all":
			return `All Global Projects (${count} sessions)`;
	}
}
