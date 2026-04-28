import type { ToolPolicy } from "../llms/tools";

export type AgentMode = "act" | "plan" | "yolo" | "zen";
export type RuntimeConfigExtensionKind = "rules" | "skills" | "plugins";

export const RUNTIME_CONFIG_EXTENSION_KINDS = [
	"rules",
	"skills",
	"plugins",
] as const satisfies readonly RuntimeConfigExtensionKind[];

export const DEFAULT_RUNTIME_CONFIG_EXTENSIONS = RUNTIME_CONFIG_EXTENSION_KINDS;

const RUNTIME_CONFIG_EXTENSION_KIND_SET = new Set<string>(
	RUNTIME_CONFIG_EXTENSION_KINDS,
);

export function isRuntimeConfigExtensionKind(
	value: unknown,
): value is RuntimeConfigExtensionKind {
	return (
		typeof value === "string" && RUNTIME_CONFIG_EXTENSION_KIND_SET.has(value)
	);
}

export function parseRuntimeConfigExtensions(
	value: unknown,
): RuntimeConfigExtensionKind[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const extensions = value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(isRuntimeConfigExtensionKind);
	return [...new Set(extensions)];
}

export function hasRuntimeConfigExtension(
	extensions: ReadonlyArray<RuntimeConfigExtensionKind> | undefined,
	kind: RuntimeConfigExtensionKind,
): boolean {
	return new Set(extensions ?? DEFAULT_RUNTIME_CONFIG_EXTENSIONS).has(kind);
}

export interface SessionPromptConfig {
	mode?: AgentMode;
	systemPrompt?: string;
	rules?: string;
	maxIterations?: number;
}

export interface SessionWorkspaceConfig {
	cwd: string;
	workspaceRoot?: string;
}

export interface SessionExecutionConfig {
	enableTools: boolean;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	maxConsecutiveMistakes?: number;
	toolPolicies?: Record<string, ToolPolicy>;
}
