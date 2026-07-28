// LanguageModelV4 middleware that recovers file/image bytes from
// `role:"tool"` messages whose content arrays the downstream chat-completions
// converter would otherwise destroy.
//
// Background: AI SDK 7's `LanguageModelV4ToolResultOutput` of type `'content'`
// may contain canonical `{ type: 'file', data: SharedV4FileData, mediaType }`
// parts (replacing the V3 `image-data` / `image-url` / `file-data` /
// `file-url` / `image-file-id` variants). The OpenAI Chat Completions wire
// format does NOT support multimodal tool messages — `role:"tool"` content
// must be a single string. The `@ai-sdk/openai-compatible` chat-messages
// converter therefore just `JSON.stringify`s the parts array. The image
// bytes survive as escaped base64 inside a string, which the model treats
// as ~50KB of opaque text and hallucinates the image's actual contents.
//
// This middleware operates on the typed `LanguageModelV4Prompt` BEFORE the
// downstream converter runs. For every `role:"tool"` message containing
// extractable file parts inside a tool-result `output.type === 'content'`
// value, it:
//
//   1. Replaces the media parts inside the tool-result with placeholder
//      text parts: `(see following user message for image)`. The
//      tool-result then carries only text — safe for any wire format.
//   2. Inserts a synthetic `role:"user"` message right after the tool
//      message, carrying the media parts as `LanguageModelV4FilePart`s.
//
// Because the synthetic user message is typed (not raw JSON), every
// downstream converter — Chat Completions, Mistral, Anthropic, Bedrock,
// etc. — translates it to its own native multimodal user-content shape
// without further help.
//
// Provider file references (`data.type === 'reference'`) and inline text
// documents (`data.type === 'text'`) are left in the tool-result: references
// have no bytes to recover via a sibling user message, and text documents
// are already safe as tool content.
//
// This pattern is documented in the OpenAI Chat Completions spec
// (consecutive `user` messages are concatenated by the model) and is a
// direct port of the proven wire pattern used by classic Cline's
// `convertToOpenAiMessages` (see `src/core/api/transform/openai-format.ts`
// in origin/main).
//
// Replaces fetch interceptor `vendors/openai-compatible-image-rewrite.ts`,
// which did the same rewrite at the wire layer (post-converter). The
// middleware approach is preferred because:
//   * No JSON parse / restringify round-trip on every chat-completions
//     request.
//   * Works equally for any converter — `@ai-sdk/mistral` (which has its
//     own chat-messages converter) was previously uncovered.
//   * Decoupled from the AI SDK's wire-output shape: if the SDK ever
//     changes how it serialises content arrays, this layer doesn't care.

import type {
	LanguageModelV4CallOptions,
	LanguageModelV4FilePart,
	LanguageModelV4Message,
	LanguageModelV4Middleware,
	LanguageModelV4TextPart,
	LanguageModelV4ToolResultOutput,
	LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";
import {
	createMediaBudgetState,
	DEFAULT_MAX_IMAGE_DECODED_BYTES,
	DEFAULT_MAX_IMAGE_ENCODED_BYTES,
	IMAGE_OMITTED_PLACEHOLDER,
	isCanonicalBase64,
	type MediaBudgetState,
	reserveImageMediaBytes,
	validateAndReserveImageMedia,
} from "@cline/shared";

const IMAGE_PLACEHOLDER = "(see following user message for image)";

type ContentOutput = Extract<
	LanguageModelV4ToolResultOutput,
	{ type: "content" }
>;
type ContentPart = ContentOutput["value"][number];
type FileContentPart = Extract<ContentPart, { type: "file" }>;

function isImageMediaType(mediaType: string): boolean {
	return mediaType === "image" || mediaType.startsWith("image/");
}

/**
 * Extractable media: inline `data` or `url` file parts. References and
 * inline text documents stay in the tool-result (see file-level comment).
 */
function isExtractableMediaPart(part: ContentPart): part is FileContentPart {
	if (part.type !== "file") {
		return false;
	}
	switch (part.data.type) {
		case "data":
		case "url":
			return true;
		case "reference":
		case "text":
			return false;
		default: {
			const _exhaustive: never = part.data;
			void _exhaustive;
			return false;
		}
	}
}

/**
 * Tool-result content `file` parts share the `LanguageModelV4FilePart`
 * shape, so promotion into a synthetic user message is a structural copy.
 */
function contentFilePartToUserFilePart(
	part: FileContentPart,
): LanguageModelV4FilePart {
	return {
		type: "file",
		data: part.data,
		mediaType: part.mediaType,
		...(part.filename ? { filename: part.filename } : {}),
		...(part.providerOptions
			? { providerOptions: part.providerOptions }
			: {}),
	};
}

interface SplitResult {
	stripped: ContentOutput;
	media: LanguageModelV4FilePart[];
}

function imageOmittedTextPart(): LanguageModelV4TextPart {
	return {
		type: "text",
		text: IMAGE_OMITTED_PLACEHOLDER,
	};
}

function reserveUnknownUrlMediaBudget(
	url: URL,
	mediaState: MediaBudgetState,
): boolean {
	if (url.protocol === "data:") {
		const href = url.href;
		const commaIndex = href.indexOf(",");
		if (commaIndex === -1) {
			return false;
		}
		const metadata = href.slice("data:".length, commaIndex).toLowerCase();
		if (!metadata.endsWith(";base64")) {
			return false;
		}
		const base64 = href.slice(commaIndex + 1);
		if (!isCanonicalBase64(base64)) {
			return false;
		}
		return (
			reserveImageMediaBytes(
				base64.length,
				0,
				{
					maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
					maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
				},
				mediaState,
			) === null
		);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return false;
	}

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
			mediaState,
		) === null
	);
}

function estimateMediaDataEncodedBytes(data: unknown): number {
	if (typeof data === "string") {
		return data.length;
	}
	if (data instanceof Uint8Array) {
		return data.byteLength;
	}
	if (data instanceof ArrayBuffer) {
		return data.byteLength;
	}
	return Number.POSITIVE_INFINITY;
}

/**
 * `validateAndReserveImageMedia` accepts base64 (or data-URL) strings.
 * V4 file data may also be raw `Uint8Array` bytes — convert those first.
 */
function fileDataToBase64OrString(data: string | Uint8Array): string {
	if (typeof data === "string") {
		return data;
	}
	return Buffer.from(data).toString("base64");
}

function reserveGenericMediaDataBudget(
	data: unknown,
	mediaState: MediaBudgetState,
): boolean {
	return (
		reserveImageMediaBytes(
			estimateMediaDataEncodedBytes(data),
			0,
			{
				maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
				maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
			},
			mediaState,
		) === null
	);
}

/**
 * Validate / budget-check an extractable file part. Returns the (possibly
 * normalized) part to promote, or `null` when the part should be replaced
 * with an omission placeholder.
 */
function prepareExtractableFilePart(
	part: FileContentPart,
	mediaState: MediaBudgetState,
): FileContentPart | null {
	switch (part.data.type) {
		case "data": {
			if (isImageMediaType(part.mediaType)) {
				const validation = validateAndReserveImageMedia(
					part.mediaType === "image" ? undefined : part.mediaType,
					fileDataToBase64OrString(part.data.data),
					{
						maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
						maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
					},
					mediaState,
				);
				if (!validation.ok) {
					return null;
				}
				return {
					...part,
					data: { type: "data", data: validation.base64 },
					mediaType: validation.mediaType,
				};
			}
			if (!reserveGenericMediaDataBudget(part.data.data, mediaState)) {
				return null;
			}
			return part;
		}
		case "url": {
			const url = part.data.url;
			if (url.protocol === "data:" && isImageMediaType(part.mediaType)) {
				const validation = validateAndReserveImageMedia(
					part.mediaType === "image" ? undefined : part.mediaType,
					url.href,
					{
						maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
						maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
					},
					mediaState,
				);
				if (!validation.ok) {
					return null;
				}
				return {
					...part,
					data: {
						type: "url",
						url: new URL(
							`data:${validation.mediaType};base64,${validation.base64}`,
						),
					},
					mediaType: validation.mediaType,
				};
			}
			if (!reserveUnknownUrlMediaBudget(url, mediaState)) {
				return null;
			}
			return part;
		}
		case "reference":
		case "text":
			// Not extractable — callers should not reach here.
			return part;
		default: {
			const _exhaustive: never = part.data;
			void _exhaustive;
			return null;
		}
	}
}

/**
 * Split a tool-result `output` of type `'content'` into:
 *   - a `stripped` output where every extractable media part is replaced by a
 *     placeholder text part, and
 *   - the list of media parts converted to `LanguageModelV4FilePart`.
 *
 * Returns `null` if the output isn't of type `'content'`, or if it doesn't
 * carry any extractable media parts (in which case no rewrite is needed).
 */
function splitContentOutputMedia(
	output: LanguageModelV4ToolResultOutput,
	mediaState: MediaBudgetState,
): SplitResult | null {
	if (output.type !== "content") {
		return null;
	}
	const media: LanguageModelV4FilePart[] = [];
	const newValue: ContentOutput["value"] = [];
	let mutated = false;
	for (const part of output.value) {
		if (!isExtractableMediaPart(part)) {
			newValue.push(part);
			continue;
		}
		const prepared = prepareExtractableFilePart(part, mediaState);
		if (!prepared) {
			newValue.push(imageOmittedTextPart());
			mutated = true;
			continue;
		}
		media.push(contentFilePartToUserFilePart(prepared));
		mutated = true;
		const placeholder: LanguageModelV4TextPart = {
			type: "text",
			text: IMAGE_PLACEHOLDER,
		};
		newValue.push(placeholder);
	}
	if (!mutated) {
		return null;
	}
	return {
		stripped: {
			type: "content",
			value: newValue,
		},
		media,
	};
}

/**
 * Walk a `LanguageModelV4Prompt` and rewrite every `role:"tool"` message
 * containing image/file parts inside its tool-result `output`s. See the
 * file-level comment for the rewrite shape.
 *
 * Returns the (possibly new) prompt array and a `mutated` flag for
 * test/observation use.
 */
export function rewritePromptToolImages(prompt: LanguageModelV4Message[]): {
	prompt: LanguageModelV4Message[];
	mutated: boolean;
} {
	const newPrompt: LanguageModelV4Message[] = [];
	let mutated = false;
	const mediaState = createMediaBudgetState();

	for (const message of prompt) {
		if (message.role !== "tool") {
			newPrompt.push(message);
			continue;
		}

		const collectedMedia: LanguageModelV4FilePart[] = [];
		const newContent: typeof message.content = message.content.map((part) => {
			if (part.type !== "tool-result") {
				return part;
			}
			const split = splitContentOutputMedia(part.output, mediaState);
			if (!split) {
				return part;
			}
			collectedMedia.push(...split.media);
			mutated = true;
			const newPart: LanguageModelV4ToolResultPart = {
				...part,
				output: split.stripped,
			};
			return newPart;
		});

		newPrompt.push({ ...message, content: newContent });

		if (collectedMedia.length > 0) {
			newPrompt.push({
				role: "user",
				content: collectedMedia,
			});
		}
	}

	return { prompt: newPrompt, mutated };
}

/**
 * `LanguageModelV4Middleware` that splits image-carrying tool-result
 * messages so chat-completions-style converters don't lose the bytes.
 *
 * Apply via `wrapLanguageModel({ model, middleware: splitToolImagesMiddleware })`
 * in any provider whose downstream converter doesn't natively handle
 * multimodal `role:"tool"` content (currently: `@ai-sdk/openai-compatible`,
 * `@ai-sdk/mistral`).
 *
 * Anthropic's converter natively renders content arrays on tool-result
 * messages and should NOT use this middleware — it would replace
 * structurally-faithful tool-results with the placeholder text + sibling
 * user message pattern unnecessarily.
 */
export const splitToolImagesMiddleware: LanguageModelV4Middleware = {
	specificationVersion: "v4",
	transformParams: async ({ params }) => {
		const { prompt: newPrompt, mutated } = rewritePromptToolImages(
			params.prompt,
		);
		if (!mutated) {
			return params;
		}
		const next: LanguageModelV4CallOptions = {
			...params,
			prompt: newPrompt,
		};
		return next;
	},
};
