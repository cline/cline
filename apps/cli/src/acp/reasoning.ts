import type { SessionConfigOption } from "@agentclientprotocol/sdk";

export const REASONING_CONFIG_ID = "thought_level";

export const ACP_REASONING_LEVELS = [
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

export type AcpReasoningLevel = (typeof ACP_REASONING_LEVELS)[number];

const LEVELS: Record<AcpReasoningLevel, { name: string; description: string }> =
	{
		none: { name: "Off", description: "No extended thinking" },
		low: { name: "Low", description: "Minimal reasoning" },
		medium: { name: "Medium", description: "Balanced reasoning" },
		high: { name: "High", description: "Deep reasoning" },
		xhigh: { name: "Extra High", description: "Maximum reasoning" },
	};

export function supportsReasoning(info?: {
	capabilities?: readonly string[];
}): boolean {
	return info?.capabilities?.includes("reasoning") ?? false;
}

export function isAcpReasoningLevel(
	value: unknown,
): value is AcpReasoningLevel {
	return (
		typeof value === "string" &&
		(ACP_REASONING_LEVELS as readonly string[]).includes(value)
	);
}

export function buildReasoningConfigOption(
	currentValue: AcpReasoningLevel,
): SessionConfigOption {
	return {
		type: "select",
		id: REASONING_CONFIG_ID,
		name: "Reasoning",
		description: "How much model-side thinking to request, when supported",
		category: "thought_level",
		currentValue,
		options: ACP_REASONING_LEVELS.map((level) => ({
			value: level,
			name: LEVELS[level].name,
			description: LEVELS[level].description,
		})),
	};
}

export function reasoningConnectionUpdate(level: AcpReasoningLevel): {
	thinking: boolean;
	reasoningEffort?: Exclude<AcpReasoningLevel, "none">;
} {
	return level === "none"
		? { thinking: false }
		: { thinking: true, reasoningEffort: level };
}
