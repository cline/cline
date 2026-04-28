export type ModelSelectionStorage = {
	lastProvider: string;
	lastModelByProvider: Record<string, string>;
};

export type ChatMessage = {
	id: string;
	role: "user" | "assistant" | "meta" | "error";
	text: string;
	reasoning?: string;
	reasoningRedacted?: boolean;
	toolEvents?: ToolEvent[];
	blocks?: ChatMessageBlock[];
};

export type ChatMessageBlock =
	| { id: string; type: "text"; text: string }
	| { id: string; type: "reasoning"; text: string; redacted?: boolean }
	| { id: string; type: "tool"; toolEvent: ToolEvent };

export type ToolEvent = {
	id: string;
	toolCallId?: string;
	name: string;
	text: string;
	state: "input-available" | "output-available" | "output-error";
	input?: unknown;
	output?: unknown;
	error?: string;
};

export type ProviderOption = {
	id: string;
	name: string;
	enabled: boolean;
	defaultModelId?: string;
};
