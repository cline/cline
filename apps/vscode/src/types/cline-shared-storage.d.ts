declare module "@cline/shared/storage" {
	export function resolveGlobalSettingsPath(): string
	export function resolveRulesConfigSearchPaths(workspacePath?: string): string[]
	export function resolveSessionDataDir(): string
}
