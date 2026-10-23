/** User-facing copy for known Cloud phases; never expose new backend identifiers. */
export function cloudStartStatus(phase?: string, resuming = false): string {
	switch (phase) {
		case "resuming":
			return "Resuming your workspace…";
		case "cloning_repo":
			return "Cloning your repository…";
		case "agent_starting":
			return "Starting the agent…";
		case "ready":
			return "Opening your conversation…";
		default:
			return resuming ? "Resuming your workspace…" : "Starting your workspace…";
	}
}
