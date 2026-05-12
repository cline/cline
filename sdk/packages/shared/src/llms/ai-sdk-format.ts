import { formatFileContentBlock } from "../prompt/format";

/**
 * Sanitizes unpaired/lone Unicode surrogates in text content.
 *
 * Lone surrogates (high surrogates without matching low surrogates, or vice versa)
 * can cause JSON serialization issues and downstream processing errors when sending
 * text to LLM providers. This function replaces them with the Unicode replacement
 * character (U+FFFD).
 *
 * @param content - The string to sanitize
 * @returns The string with lone surrogates replaced by U+FFFD
 */
export function sanitizeSurrogates(content: string): string {
	return content.replace(
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
		"\uFFFD",
	);
}

export type AiSdkFormatterMessageRole = "user" | "assistant" | "tool";

export type AiSdkFormatterPart =
	| {
			type: "text";
			text: string;
			providerOptions?: Record<string, Record<string, unknown>>;
	  }
	| {
			type: "reasoning";
			text: string;
			providerOptions?: Record<string, Record<string, unknown>>;
	  }
	| {
			type: "image";
			image: string | Uint8Array | ArrayBuffer | URL;
			mediaType?: string;
	  }
	| {
			type: "file";
			path: string;
			content: string;
	  }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			input: unknown;
			providerOptions?: Record<string, Record<string, unknown>>;
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

type AiSdkContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mediaType: string };
type AiSdkImageContentBlock = Extract<AiSdkContentBlock, { type: "image" }>;

function pushAiSdkMessage(result: AiSdkMessage[], message: AiSdkMessage): void {
	const previous = result[result.length - 1];
	if (
		message.role === "tool" &&
		previous?.role === "tool" &&
		Array.isArray(previous.content) &&
		Array.isArray(message.content)
	) {
		previous.content.push(...message.content);
		return;
	}

	result.push(message);
}

/**
 * Type guard for tool-output content blocks that should be passed to the model
 * as native multimodal parts (rather than JSON-encoded). We accept the cline
 * `image` and `text` block shapes used by `formatStructuredToolResult`.
 */
function isAiSdkContentBlockArray(
	value: unknown,
): value is AiSdkContentBlock[] {
	if (!Array.isArray(value) || value.length === 0) {
		return false;
	}
	return value.every((block) => {
		if (!block || typeof block !== "object") {
			return false;
		}
		const b = block as Record<string, unknown>;
		if (b.type === "text") {
			return typeof b.text === "string";
		}
		if (b.type === "image") {
			return typeof b.data === "string" && typeof b.mediaType === "string";
		}
		return false;
	});
}

/**
 * Recursively walk a tool-result `output` value, removing any AI-SDK image
 * content blocks (`{type:'image', data, mediaType}`) and collecting them
 * into `images`. Inline-text blocks (`{type:'text', text}`) are unwrapped
 * to bare strings so the resulting structure JSON-serialises cleanly for
 * the model.
 *
 * Returns the stripped value with images removed (other structure
 * preserved). The original input is not mutated.
 */
function stripImagesFromOutput(
	value: unknown,
	images: AiSdkImageContentBlock[],
): unknown {
	if (value == null || typeof value !== "object") {
		return value;
	}

	if (Array.isArray(value)) {
		const out: unknown[] = [];
		for (const item of value) {
			if (item && typeof item === "object") {
				const obj = item as Record<string, unknown>;
				if (
					obj.type === "image" &&
					typeof obj.data === "string" &&
					typeof obj.mediaType === "string"
				) {
					images.push({
						type: "image",
						data: obj.data,
						mediaType: obj.mediaType,
					});
					continue;
				}
				if (obj.type === "text" && typeof obj.text === "string") {
					out.push(obj.text);
					continue;
				}
			}
			out.push(stripImagesFromOutput(item, images));
		}
		return out;
	}

	const obj = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		out[k] = stripImagesFromOutput(v, images);
	}
	return out;
}

/** Sanitize all string values deeply nested inside an arbitrary object/array. */
function sanitizeDeepStrings(value: unknown): unknown {
	if (typeof value === "string") {
		return sanitizeSurrogates(value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeDeepStrings(item));
	}
	if (value !== null && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			out[k] = sanitizeDeepStrings(v);
		}
		return out;
	}
	return value;
}

export function toAiSdkToolResultOutput(
	output: unknown,
	isError = false,
): Record<string, unknown> {
	if (typeof output === "string") {
		return {
			type: isError ? "error-text" : "text",
			value: sanitizeSurrogates(output),
		};
	}

	// Arrays of `text` / `image` content blocks (e.g. from read_file image
	// results) must be forwarded as AI SDK `content` parts so providers
	// translate them into real multimodal inputs. Without this, the array
	// falls through to the `json` branch below and the base64 image data
	// is sent to the model as a JSON string — the model cannot see it and
	// will hallucinate the image's contents.
	if (!isError && isAiSdkContentBlockArray(output)) {
		return {
			type: "content",
			value: output.map((block) =>
				block.type === "image"
					? {
							type: "image-data",
							data: block.data,
							mediaType: block.mediaType,
						}
					: { type: "text", text: sanitizeSurrogates(block.text) },
			),
		};
	}

	// Structured outputs that contain nested image blocks (e.g. the
	// `[{query, result: ['Successfully read image', {type:'image',...}], success}]`
	// shape produced by `read_files` for image paths) must also reach the
	// model as native multimodal parts. Walk the structure, pull the image
	// blocks out, and forward the remaining metadata as a JSON-stringified
	// text block followed by the extracted images. Without this, the wire
	// converter JSON-serialises the whole tree and the model receives the
	// base64 bytes as opaque text.
	if (!isError && output !== null && typeof output === "object") {
		const images: AiSdkImageContentBlock[] = [];
		const stripped = stripImagesFromOutput(output, images);
		if (images.length > 0) {
			const headerText =
				typeof stripped === "string"
					? sanitizeSurrogates(stripped)
					: JSON.stringify(sanitizeDeepStrings(stripped));
			return {
				type: "content",
				value: [
					{ type: "text", text: headerText },
					...images.map((image) => ({
						type: "image-data",
						data: image.data,
						mediaType: image.mediaType,
					})),
				],
			};
		}
	}

	if (
		output === null ||
		typeof output === "boolean" ||
		typeof output === "number" ||
		typeof output === "object"
	) {
		return {
			type: isError ? "error-json" : "json",
			value: sanitizeDeepStrings(output),
		};
	}

	return {
		type: isError ? "error-text" : "text",
		value: sanitizeSurrogates(String(output)),
	};
}

export function formatMessagesForAiSdk(
	systemContent: string | AiSdkMessagePart[] | undefined,
	messages: readonly AiSdkFormatterMessage[],
	options?: { assistantToolCallArgKey?: "args" | "input" },
): AiSdkMessage[] {
	const toolCallArgKey = options?.assistantToolCallArgKey ?? "input";
	const result: AiSdkMessage[] = [];

	if (
		(typeof systemContent === "string" && systemContent.trim().length > 0) ||
		(Array.isArray(systemContent) && systemContent.length > 0)
	) {
		result.push({
			role: "system",
			content:
				typeof systemContent === "string"
					? sanitizeSurrogates(systemContent)
					: systemContent,
		});
	}

	for (const message of messages) {
		const contentParts = message.content;

		if (typeof contentParts === "string") {
			result.push({
				role: message.role,
				content: sanitizeSurrogates(contentParts),
			});
			continue;
		}

		const messageParts: AiSdkMessagePart[] = [];
		const toolResultParts: AiSdkMessagePart[] = [];
		for (const part of contentParts) {
			switch (part.type) {
				case "text":
					messageParts.push({
						type: "text",
						text: sanitizeSurrogates(part.text),
						...(part.providerOptions
							? { providerOptions: part.providerOptions }
							: {}),
					});
					break;
				case "reasoning":
					messageParts.push({
						type: "reasoning",
						text: sanitizeSurrogates(part.text),
						...(part.providerOptions
							? { providerOptions: part.providerOptions }
							: {}),
					});
					break;
				case "image":
					messageParts.push({
						type: "image",
						image: part.image,
						mediaType: part.mediaType,
					});
					break;
				case "file":
					messageParts.push({
						type: "text",
						text: formatFileContentBlock(
							part.path,
							sanitizeSurrogates(part.content),
						),
					});
					break;
				case "tool-call":
					if (message.role === "assistant") {
						messageParts.push({
							type: "tool-call",
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							[toolCallArgKey]: part.input,
							...(part.providerOptions
								? { providerOptions: part.providerOptions }
								: {}),
						});
					}
					break;
				case "tool-result":
					toolResultParts.push({
						type: "tool-result",
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: toAiSdkToolResultOutput(part.output, part.isError ?? false),
					});
					break;
			}
		}

		if (messageParts.length > 0) {
			pushAiSdkMessage(result, { role: message.role, content: messageParts });
		}
		if (toolResultParts.length > 0) {
			pushAiSdkMessage(result, { role: "tool", content: toolResultParts });
		}
	}

	return result;
}
