export interface GitSettings {
	commitMessageInstructions: string
}

export const DEFAULT_GIT_SETTINGS: GitSettings = {
	commitMessageInstructions: `1. Start with a short summary (50-72 characters)
2. Use the imperative mood (e.g., "Add feature" not "Added feature")
3. Describe what was changed and why
4. Be clear and descriptive`,
}
