export type AiSdkFormatterMessageRole = "user" | "assistant" | "tool";

export type AiSdkFormatterPart =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "reasoning";
			text: string;
	  }
	| {
			type: "image";
			image: string | Uint8Array | ArrayBuffer | URL;
			mediaType?: string;
	  }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			input: unknown;
	  }
	| {
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			output: unknown;
			isError?: boolean;
	  };

export interface AiSdkFormatterMessage {
	role: AiSdkFormatterMessageRole;
	content: string | AiSdkFormatterPart[];
}

export type AiSdkMessagePart = Record<string, unknown>;
export type AiSdkMessage = {
	role: "system" | "user" | "assistant" | "tool";
	content: string | AiSdkMessagePart[];
};

export function toAiSdkToolResultOutput(
	output: unknown,
	isError = false,
): Record<string, unknown> {
	if (typeof output === "string") {
		return {
			type: isError ? "error-text" : "text",
			value: output,
		};
	}

	if (
		output === null ||
		typeof output === "boolean" ||
		typeof output === "number" ||
		typeof output === "object"
	) {
		return {
			type: isError ? "error-json" : "json",
			value: output,
		};
	}

	return {
		type: isError ? "error-text" : "text",
		value: String(output),
	};
}

export function formatMessagesForAiSdk(
	systemContent: string | AiSdkMessagePart[] | undefined,
	messages: readonly AiSdkFormatterMessage[],
	options?: { assistantToolCallArgKey?: "args" | "input" },
): AiSdkMessage[] {
	const toolCallArgKey = options?.assistantToolCallArgKey ?? "input";
	const result: AiSdkMessage[] = [];

	if (systemContent != null) {
		result.push({ role: "system", content: systemContent });
	}

	for (const message of messages) {
		if (typeof message.content === "string") {
			result.push({ role: message.role, content: message.content });
			continue;
		}

		const parts: AiSdkMessagePart[] = [];
		for (const part of message.content) {
			switch (part.type) {
				case "text":
					parts.push({ type: "text", text: part.text });
					break;
				case "reasoning":
					parts.push({ type: "reasoning", text: part.text });
					break;
				case "image":
					parts.push({
						type: "image",
						image: part.image,
						mediaType: part.mediaType,
					});
					break;
				case "tool-call":
					if (message.role === "assistant") {
						parts.push({
							type: "tool-call",
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							[toolCallArgKey]: part.input,
						});
					}
					break;
				case "tool-result":
					parts.push({
						type: "tool-result",
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: toAiSdkToolResultOutput(part.output, part.isError ?? false),
					});
					break;
			}
		}

		if (parts.length > 0) {
			result.push({ role: message.role, content: parts });
		}
	}

	return result;
}
