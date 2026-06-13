import { formatFileContentBlock } from "../prompt/format";
import {
	createMediaBudgetState,
	DEFAULT_MAX_IMAGE_DECODED_BYTES,
	DEFAULT_MAX_IMAGE_ENCODED_BYTES,
	IMAGE_OMITTED_PLACEHOLDER,
	imageBase64LengthForDecodedBytes,
	type MediaBudgetState,
	reserveImageMediaBytes,
	SUPPORTED_IMAGE_MEDIA_TYPES,
	validateAndReserveImageMedia,
} from "./media";

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

export const EMPTY_CONTENT_TEXT = "ERROR: EMPTY CONTENT";
const IMAGE_ATTACHED_TEXT = "[image attached]";

export type AiSdkMessagePart = Record<string, unknown>;
export type AiSdkMessage = {
	role: "system" | "user" | "assistant" | "tool";
	content: string | AiSdkMessagePart[];
};

type AiSdkContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mediaType: string };
type AiSdkImageContentBlock = Extract<AiSdkContentBlock, { type: "image" }>;

interface StripImagesResult {
	value: unknown;
	changed: boolean;
	mediaChanged: boolean;
}

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

function imageOmittedTextPart(): { type: "text"; text: string } {
	return { type: "text", text: IMAGE_OMITTED_PLACEHOLDER };
}

function reserveRemoteImageUrlBudget(state: MediaBudgetState): boolean {
	// Remote URL byte size is unknown at formatting time, so charge the
	// conservative per-image cap instead of letting URL media count as free.
	return (
		reserveImageMediaBytes(
			DEFAULT_MAX_IMAGE_ENCODED_BYTES,
			0,
			{
				maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
				maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
			},
			state,
		) === null
	);
}

function parseUrlProtocol(value: string): string | undefined {
	try {
		return new URL(value).protocol;
	} catch {
		return undefined;
	}
}

function toImageDataPart(
	image: AiSdkImageContentBlock,
	state: MediaBudgetState,
):
	| { type: "image-data"; data: string; mediaType: string }
	| {
			type: "text";
			text: string;
	  } {
	const validation = validateAndReserveImageMedia(
		image.mediaType,
		image.data,
		{
			maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
			maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
		},
		state,
	);
	if (!validation.ok) {
		return imageOmittedTextPart();
	}
	return {
		type: "image-data",
		data: validation.base64,
		mediaType: validation.mediaType,
	};
}

function toUserImagePart(
	image: Extract<AiSdkFormatterPart, { type: "image" }>,
	state: MediaBudgetState,
): AiSdkMessagePart {
	if (image.image instanceof URL) {
		if (image.image.protocol === "data:") {
			const validation = validateAndReserveImageMedia(
				image.mediaType,
				image.image.href,
				{
					maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
					maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
				},
				state,
			);
			if (!validation.ok) {
				return imageOmittedTextPart();
			}
			return {
				type: "image",
				image: `data:${validation.mediaType};base64,${validation.base64}`,
				mediaType: validation.mediaType,
			};
		}
		if (image.image.protocol !== "http:" && image.image.protocol !== "https:") {
			return imageOmittedTextPart();
		}
		if (!reserveRemoteImageUrlBudget(state)) {
			return imageOmittedTextPart();
		}
		return {
			type: "image",
			image: image.image,
			mediaType: image.mediaType,
		};
	}

	if (typeof image.image === "string") {
		const protocol = parseUrlProtocol(image.image);
		if (protocol === "http:" || protocol === "https:") {
			if (!reserveRemoteImageUrlBudget(state)) {
				return imageOmittedTextPart();
			}
			return {
				type: "image",
				image: image.image,
				mediaType: image.mediaType,
			};
		}
		const isDataUrl = protocol === "data:";

		const validation = validateAndReserveImageMedia(
			image.mediaType ?? (isDataUrl ? undefined : "image/png"),
			image.image,
			{
				maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
				maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
			},
			state,
		);
		if (!validation.ok) {
			return imageOmittedTextPart();
		}
		return {
			type: "image",
			image: isDataUrl
				? `data:${validation.mediaType};base64,${validation.base64}`
				: validation.base64,
			mediaType: validation.mediaType,
		};
	}

	const decodedBytes = image.image.byteLength;
	const encodedBytes = imageBase64LengthForDecodedBytes(decodedBytes);
	const mediaType = image.mediaType?.toLowerCase() ?? "image/png";
	const supportedMediaTypes: readonly string[] = SUPPORTED_IMAGE_MEDIA_TYPES;
	if (
		!supportedMediaTypes.includes(mediaType) ||
		reserveImageMediaBytes(
			encodedBytes,
			decodedBytes,
			{
				maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
				maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
			},
			state,
		)
	) {
		return imageOmittedTextPart();
	}

	return {
		type: "image",
		image: image.image,
		mediaType,
	};
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
	state: MediaBudgetState,
): StripImagesResult {
	if (value == null || typeof value !== "object") {
		return { value, changed: false, mediaChanged: false };
	}

	if (Array.isArray(value)) {
		const out: unknown[] = [];
		let changed = false;
		let mediaChanged = false;
		for (const item of value) {
			if (item && typeof item === "object") {
				const obj = item as Record<string, unknown>;
				if (
					obj.type === "image" &&
					typeof obj.data === "string" &&
					typeof obj.mediaType === "string"
				) {
					const image = {
						type: "image",
						data: obj.data,
						mediaType: obj.mediaType,
					} satisfies AiSdkImageContentBlock;
					const part = toImageDataPart(image, state);
					if (part.type === "image-data") {
						images.push({
							type: "image",
							data: part.data,
							mediaType: part.mediaType,
						});
					} else {
						out.push(part.text);
					}
					changed = true;
					mediaChanged = true;
					continue;
				}
				if (obj.type === "image") {
					out.push(IMAGE_OMITTED_PLACEHOLDER);
					changed = true;
					mediaChanged = true;
					continue;
				}
				if (obj.type === "text" && typeof obj.text === "string") {
					out.push(obj.text);
					changed = true;
					continue;
				}
			}
			const stripped = stripImagesFromOutput(item, images, state);
			out.push(stripped.value);
			changed ||= stripped.changed;
			mediaChanged ||= stripped.mediaChanged;
		}
		return { value: changed ? out : value, changed, mediaChanged };
	}

	const obj = value as Record<string, unknown>;
	if (obj.type === "image") {
		if (typeof obj.data === "string" && typeof obj.mediaType === "string") {
			const image = {
				type: "image",
				data: obj.data,
				mediaType: obj.mediaType,
			} satisfies AiSdkImageContentBlock;
			const part = toImageDataPart(image, state);
			if (part.type === "image-data") {
				images.push({
					type: "image",
					data: part.data,
					mediaType: part.mediaType,
				});
				return {
					value: IMAGE_ATTACHED_TEXT,
					changed: true,
					mediaChanged: true,
				};
			}
			return { value: part.text, changed: true, mediaChanged: true };
		}
		return {
			value: IMAGE_OMITTED_PLACEHOLDER,
			changed: true,
			mediaChanged: true,
		};
	}

	const out: Record<string, unknown> = {};
	let changed = false;
	let mediaChanged = false;
	for (const [k, v] of Object.entries(obj)) {
		const stripped = stripImagesFromOutput(v, images, state);
		out[k] = stripped.value;
		changed ||= stripped.changed;
		mediaChanged ||= stripped.mediaChanged;
	}
	return { value: changed ? out : value, changed, mediaChanged };
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
	mediaState: MediaBudgetState = createMediaBudgetState(),
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
					? toImageDataPart(block, mediaState)
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
		const stripped = stripImagesFromOutput(output, images, mediaState);
		if (images.length > 0) {
			const headerText =
				typeof stripped.value === "string"
					? sanitizeSurrogates(stripped.value)
					: JSON.stringify(sanitizeDeepStrings(stripped.value));
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
		if (stripped.mediaChanged) {
			return {
				type: "json",
				value: sanitizeDeepStrings(stripped.value),
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
	const mediaState = createMediaBudgetState();

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
			if (contentParts.trim().length === 0) {
				result.push({
					role: message.role,
					content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
				});
				continue;
			}
			result.push({
				role: message.role,
				content: sanitizeSurrogates(contentParts),
			});
			continue;
		}

		const messageParts: AiSdkMessagePart[] = [];
		const toolResultParts: AiSdkMessagePart[] = [];
		if (contentParts.length === 0) {
			result.push({
				role: message.role,
				content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
			});
			continue;
		}

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
					messageParts.push(toUserImagePart(part, mediaState));
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
				case "tool-result": {
					toolResultParts.push({
						type: "tool-result",
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: toAiSdkToolResultOutput(
							part.output,
							part.isError ?? false,
							mediaState,
						),
					});
					break;
				}
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
