import { formatFileContentBlock } from "../prompt/format";
import {
	createMediaBudgetState,
	DEFAULT_MAX_IMAGE_DECODED_BYTES,
	DEFAULT_MAX_IMAGE_ENCODED_BYTES,
	type GeneratedMedia,
	type GeneratedMediaModality,
	IMAGE_OMITTED_PLACEHOLDER,
	IMAGE_UNSUPPORTED_PLACEHOLDER,
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
			type: "media";
			media: GeneratedMedia;
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
const GENERATED_IMAGE_TEXT = "[generated image]";

function generatedMediaText(modality: GeneratedMediaModality): string {
	return `[generated ${modality}]`;
}

function generatedMediaUnavailableText(
	media: GeneratedMedia,
): AiSdkMessagePart {
	return {
		type: "text",
		text: `[generated ${media.modality} unavailable to this model]`,
	};
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

/**
 * AI SDK 7 tool-result media part (`LanguageModelV4`-era canonical shape).
 * `data` is the tagged file-data union rather than a bare base64 string.
 */
type ToolResultImagePart = {
	type: "file";
	data: { type: "data"; data: string };
	mediaType: string;
};

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

/**
 * Build a tool-result `content` media part. AI SDK 7 collapsed the
 * `image-*`/`file-*` tool-result variants into a single `file` part whose
 * `data` is a tagged union; the old variants still round-trip through a
 * runtime shim but log a deprecation warning on every request.
 */
function toToolResultImagePart(
	image: AiSdkImageContentBlock,
	state: MediaBudgetState,
): ToolResultImagePart | { type: "text"; text: string } {
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
	return toolResultImagePart(validation.base64, validation.mediaType);
}

function toolResultImagePart(
	base64: string,
	mediaType: string,
): ToolResultImagePart {
	return {
		type: "file",
		data: { type: "data", data: base64 },
		mediaType,
	};
}

/**
 * Build a user-message media part. AI SDK 7 deprecated the `image` message
 * part in favour of a `file` part carrying an image `mediaType`, so this
 * always emits `file`. `mediaType` is required on `file` parts; when the
 * source did not carry one we fall back to the bare `image` top-level type,
 * which AI SDK 7 resolves per-provider (auto-detecting the subtype from
 * inline bytes where it can).
 */
function userMediaPart(
	data: string | Uint8Array | ArrayBuffer | URL,
	mediaType: string | undefined,
): AiSdkMessagePart {
	return {
		type: "file",
		data,
		mediaType: mediaType ?? "image",
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
			return userMediaPart(
				`data:${validation.mediaType};base64,${validation.base64}`,
				validation.mediaType,
			);
		}
		if (image.image.protocol !== "http:" && image.image.protocol !== "https:") {
			return imageOmittedTextPart();
		}
		if (!reserveRemoteImageUrlBudget(state)) {
			return imageOmittedTextPart();
		}
		return userMediaPart(image.image, image.mediaType);
	}

	if (typeof image.image === "string") {
		const protocol = parseUrlProtocol(image.image);
		if (protocol === "http:" || protocol === "https:") {
			if (!reserveRemoteImageUrlBudget(state)) {
				return imageOmittedTextPart();
			}
			return userMediaPart(image.image, image.mediaType);
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
		return userMediaPart(
			isDataUrl
				? `data:${validation.mediaType};base64,${validation.base64}`
				: validation.base64,
			validation.mediaType,
		);
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

	return userMediaPart(image.image, mediaType);
}

function supportsGeneratedMediaInput(
	media: GeneratedMedia,
	supportedInputModalities: readonly string[] | undefined,
): boolean {
	if (!supportedInputModalities) return true;
	if (media.modality === "file") {
		return (
			media.mediaType === "application/pdf" &&
			supportedInputModalities.includes("pdf")
		);
	}
	return supportedInputModalities.includes(media.modality);
}

function toUserGeneratedMediaPart(
	media: GeneratedMedia,
	state: MediaBudgetState,
	supportedInputModalities: readonly string[] | undefined,
): AiSdkMessagePart {
	if (!supportsGeneratedMediaInput(media, supportedInputModalities)) {
		return generatedMediaUnavailableText(media);
	}

	if (media.modality === "image") {
		if (media.source.type === "artifact") {
			return generatedMediaUnavailableText(media);
		}
		return toUserImagePart(
			{
				type: "image",
				image:
					media.source.type === "url" ? media.source.url : media.source.data,
				mediaType: media.mediaType,
			},
			state,
		);
	}

	if (media.source.type === "artifact") {
		return generatedMediaUnavailableText(media);
	}
	if (media.source.type === "url") {
		const protocol = parseUrlProtocol(media.source.url);
		if (protocol !== "http:" && protocol !== "https:" && protocol !== "data:") {
			return generatedMediaUnavailableText(media);
		}
	}
	return userMediaPart(
		media.source.type === "url" ? media.source.url : media.source.data,
		media.mediaType,
	);
}

interface StripImagesOptions {
	/**
	 * When true, valid image blocks are collected into `images` for the
	 * caller to hoist into native multimodal parts. When false, they are
	 * replaced inline with `inlineImagePlaceholder` text instead (used for
	 * error outputs and for models without image input support).
	 */
	hoistImages: boolean;
	inlineImagePlaceholder: string;
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
	options: StripImagesOptions,
): StripImagesResult {
	const { hoistImages, inlineImagePlaceholder } = options;
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
					if (!hoistImages) {
						out.push(inlineImagePlaceholder);
						changed = true;
						mediaChanged = true;
						continue;
					}
					const image = {
						type: "image",
						data: obj.data,
						mediaType: obj.mediaType,
					} satisfies AiSdkImageContentBlock;
					const part = toToolResultImagePart(image, state);
					if (part.type === "file") {
						images.push({
							type: "image",
							data: part.data.data,
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
			const stripped = stripImagesFromOutput(item, images, state, options);
			out.push(stripped.value);
			changed ||= stripped.changed;
			mediaChanged ||= stripped.mediaChanged;
		}
		return { value: changed ? out : value, changed, mediaChanged };
	}

	const obj = value as Record<string, unknown>;
	if (obj.type === "image") {
		if (typeof obj.data === "string" && typeof obj.mediaType === "string") {
			if (!hoistImages) {
				return {
					value: inlineImagePlaceholder,
					changed: true,
					mediaChanged: true,
				};
			}
			const image = {
				type: "image",
				data: obj.data,
				mediaType: obj.mediaType,
			} satisfies AiSdkImageContentBlock;
			const part = toToolResultImagePart(image, state);
			if (part.type === "file") {
				images.push({
					type: "image",
					data: part.data.data,
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
		const stripped = stripImagesFromOutput(v, images, state, options);
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
	options?: { supportsImages?: boolean },
): Record<string, unknown> {
	const supportsImages = options?.supportsImages ?? true;
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
	// When the target model does not support image input, the image blocks
	// are substituted with placeholder text instead so the model knows an
	// image was there.
	if (!isError && isAiSdkContentBlockArray(output)) {
		return {
			type: "content",
			value: output.map((block) =>
				block.type === "image"
					? supportsImages
						? toToolResultImagePart(block, mediaState)
						: { type: "text", text: IMAGE_UNSUPPORTED_PLACEHOLDER }
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
	// For models without image input support, images are replaced inline
	// with placeholder text instead of being hoisted.
	if (output !== null && typeof output === "object") {
		const images: AiSdkImageContentBlock[] = [];
		const stripped = stripImagesFromOutput(output, images, mediaState, {
			hoistImages: !isError && supportsImages,
			inlineImagePlaceholder: supportsImages
				? IMAGE_OMITTED_PLACEHOLDER
				: IMAGE_UNSUPPORTED_PLACEHOLDER,
		});
		if (!isError && images.length > 0) {
			const headerText =
				typeof stripped.value === "string"
					? sanitizeSurrogates(stripped.value)
					: JSON.stringify(sanitizeDeepStrings(stripped.value));
			return {
				type: "content",
				value: [
					{ type: "text", text: headerText },
					...images.map((image) =>
						toolResultImagePart(image.data, image.mediaType),
					),
				],
			};
		}
		if (stripped.mediaChanged) {
			return {
				type: isError ? "error-json" : "json",
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
	options?: {
		assistantToolCallArgKey?: "args" | "input";
		/**
		 * Whether the target model advertises image input. When false, image
		 * parts (user-attached and inside tool results) are substituted with
		 * `IMAGE_UNSUPPORTED_PLACEHOLDER` text so the request stays valid for
		 * text-only models while the model still learns an image was there.
		 * Defaults to true. The substitution happens here at request-build
		 * time only — stored conversation history is never mutated.
		 */
		supportedInputModalities?: readonly string[];
	},
): AiSdkMessage[] {
	const toolCallArgKey = options?.assistantToolCallArgKey ?? "input";
	const supportedInputModalities = options?.supportedInputModalities;
	const supportsImages =
		!supportedInputModalities || supportedInputModalities.includes("image");
	const result: AiSdkMessage[] = [];
	const mediaState = createMediaBudgetState();
	const pendingAssistantMedia: Array<
		| Extract<AiSdkFormatterPart, { type: "image" }>
		| Extract<AiSdkFormatterPart, { type: "media" }>
	> = [];
	const takePendingAssistantMedia = (): AiSdkMessagePart[] => {
		const pending = pendingAssistantMedia.splice(0);
		return pending.map((part) =>
			part.type === "image"
				? supportsImages
					? toUserImagePart(part, mediaState)
					: { type: "text", text: IMAGE_UNSUPPORTED_PLACEHOLDER }
				: toUserGeneratedMediaPart(
						part.media,
						mediaState,
						supportedInputModalities,
					),
		);
	};

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
			const movedAssistantMedia =
				message.role === "user" && pendingAssistantMedia.length > 0
					? takePendingAssistantMedia()
					: [];
			if (movedAssistantMedia.length > 0) {
				result.push({
					role: message.role,
					content: [
						{
							type: "text",
							text:
								contentParts.trim().length > 0
									? sanitizeSurrogates(contentParts)
									: EMPTY_CONTENT_TEXT,
						},
						...movedAssistantMedia,
					],
				});
				continue;
			}
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
					if (message.role === "assistant") {
						// AI SDK ModelMessage only accepts generated media as an
						// assistant `file` part, but common provider wire formats
						// (including Anthropic and OpenAI chat) only accept images on
						// user turns. Preserve the assistant output marker and move the
						// validated image to the following user turn so vision models
						// can reliably inspect generated images in conversation history.
						pendingAssistantMedia.push(part);
						messageParts.push({
							type: "text",
							text: GENERATED_IMAGE_TEXT,
						});
					} else {
						messageParts.push(
							supportsImages
								? toUserImagePart(part, mediaState)
								: { type: "text", text: IMAGE_UNSUPPORTED_PLACEHOLDER },
						);
					}
					break;
				case "media":
					if (message.role === "assistant") {
						pendingAssistantMedia.push(part);
						messageParts.push({
							type: "text",
							text: generatedMediaText(part.media.modality),
						});
					} else {
						messageParts.push(
							toUserGeneratedMediaPart(
								part.media,
								mediaState,
								supportedInputModalities,
							),
						);
					}
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
							{ supportsImages },
						),
					});
					break;
				}
			}
		}

		const hasToolResults = toolResultParts.length > 0;
		if (
			message.role === "user" &&
			!hasToolResults &&
			pendingAssistantMedia.length > 0
		) {
			messageParts.push(...takePendingAssistantMedia());
		}

		// A message whose parts are all empty text is effectively empty: the AI SDK
		// strips empty text parts before sending, and providers like Vercel reject
		// the resulting `content: []` ("user message must have content").
		if (
			messageParts.length > 0 &&
			messageParts.every(
				(part) =>
					part.type === "text" &&
					typeof part.text === "string" &&
					part.text.trim().length === 0,
			)
		) {
			messageParts.splice(0, messageParts.length, {
				type: "text",
				text: EMPTY_CONTENT_TEXT,
			});
		}
		if (messageParts.length > 0) {
			pushAiSdkMessage(result, { role: message.role, content: messageParts });
		}
		if (hasToolResults) {
			pushAiSdkMessage(result, { role: "tool", content: toolResultParts });
		}
	}

	if (pendingAssistantMedia.length > 0) {
		// Tool results must stay contiguous with their assistant tool calls. If
		// there was no later user turn to receive generated images, append one
		// synthetic user turn after the complete tool-result sequence.
		pushAiSdkMessage(result, {
			role: "user",
			content: takePendingAssistantMedia(),
		});
	}

	return result;
}
