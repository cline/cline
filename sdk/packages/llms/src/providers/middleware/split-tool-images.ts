// LanguageModelV3 middleware that recovers image bytes from
// `role:"tool"` messages whose content arrays the downstream chat-completions
// converter would otherwise destroy.
//
// Background: AI SDK's `LanguageModelV3ToolResultOutput` of type `'content'`
// may contain `image-data`, `image-url`, `file-data`, `file-url`, or
// `image-file-id` parts. The OpenAI Chat Completions wire format does NOT
// support multimodal tool messages — `role:"tool"` content must be a single
// string. The `@ai-sdk/openai-compatible` chat-messages converter therefore
// just `JSON.stringify`s the parts array. The image bytes survive as escaped
// base64 inside a string, which the model treats as ~50KB of opaque text and
// hallucinates the image's actual contents.
//
// This middleware operates on the typed `LanguageModelV3Prompt` BEFORE the
// downstream converter runs. For every `role:"tool"` message containing
// image/file parts inside a tool-result `output.type === 'content'` value,
// it:
//
//   1. Replaces the media parts inside the tool-result with placeholder
//      text parts: `(see following user message for image)`. The
//      tool-result then carries only text — safe for any wire format.
//   2. Inserts a synthetic `role:"user"` message right after the tool
//      message, carrying the media parts as `LanguageModelV3FilePart`s.
//
// Because the synthetic user message is typed (not raw JSON), every
// downstream converter — Chat Completions, Mistral, Anthropic, Bedrock,
// etc. — translates it to its own native multimodal user-content shape
// without further help.
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
	LanguageModelV3CallOptions,
	LanguageModelV3FilePart,
	LanguageModelV3Message,
	LanguageModelV3Middleware,
	LanguageModelV3TextPart,
	LanguageModelV3ToolResultOutput,
	LanguageModelV3ToolResultPart,
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
	LanguageModelV3ToolResultOutput,
	{ type: "content" }
>;
type ContentPart = ContentOutput["value"][number];

function isMediaContentPart(part: ContentPart): part is Extract<
	ContentPart,
	{
		type:
			| "image-data"
			| "image-url"
			| "file-data"
			| "file-url"
			| "image-file-id";
	}
> {
	switch (part.type) {
		case "image-data":
		case "image-url":
		case "file-data":
		case "file-url":
		case "image-file-id":
			return true;
		default:
			return false;
	}
}

/**
 * Convert a media content-part from a `ToolResultOutput` of type `'content'`
 * into the equivalent `LanguageModelV3FilePart` for use in a user message.
 * Returns `null` for `image-file-id` parts because `LanguageModelV3FilePart`
 * has no provider-file-id slot — those parts are left in place inside the
 * tool-result and pass through to the converter as-is. (Image-file-id is
 * an OpenAI-specific reference; if a caller is using it they are already
 * on a multimodal-aware path and don't need this rewrite.)
 */
function mediaPartToFilePart(
	part: Extract<
		ContentPart,
		{
			type:
				| "image-data"
				| "image-url"
				| "file-data"
				| "file-url"
				| "image-file-id";
		}
	>,
): LanguageModelV3FilePart | null {
	switch (part.type) {
		case "image-data":
			return {
				type: "file",
				data: part.data,
				mediaType: part.mediaType,
				...(part.providerOptions
					? { providerOptions: part.providerOptions }
					: {}),
			};
		case "image-url":
			return {
				type: "file",
				// FilePart.data accepts a URL or string. Pass the URL string;
				// the converter will wire it through to e.g. `image_url.url`.
				data: part.url,
				// AI SDK requires a mediaType. We don't know the actual type
				// from a URL, so fall back to a wildcard image type — the
				// downstream converter (chat-completions) only needs the
				// URL anyway.
				mediaType: "image/*",
				...(part.providerOptions
					? { providerOptions: part.providerOptions }
					: {}),
			};
		case "file-data":
			return {
				type: "file",
				data: part.data,
				mediaType: part.mediaType,
				...(part.filename ? { filename: part.filename } : {}),
				...(part.providerOptions
					? { providerOptions: part.providerOptions }
					: {}),
			};
		case "file-url":
			return {
				type: "file",
				data: part.url,
				mediaType: "application/octet-stream",
				...(part.providerOptions
					? { providerOptions: part.providerOptions }
					: {}),
			};
		case "image-file-id":
			// No FilePart equivalent — caller is on a path that already handles
			// provider-side file references, so we leave the part in place.
			return null;
	}
}

interface SplitResult {
	stripped: ContentOutput;
	media: LanguageModelV3FilePart[];
}

function imageOmittedTextPart(): LanguageModelV3TextPart {
	return {
		type: "text",
		text: IMAGE_OMITTED_PLACEHOLDER,
	};
}

function reserveUnknownUrlMediaBudget(
	url: string,
	mediaState: MediaBudgetState,
): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol === "data:") {
		const commaIndex = url.indexOf(",");
		if (commaIndex === -1) {
			return false;
		}
		const metadata = url.slice("data:".length, commaIndex).toLowerCase();
		if (!metadata.endsWith(";base64")) {
			return false;
		}
		const base64 = url.slice(commaIndex + 1);
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

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
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

function isDataUrl(url: string): boolean {
	try {
		return new URL(url).protocol === "data:";
	} catch {
		return false;
	}
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
 * Split a tool-result `output` of type `'content'` into:
 *   - a `stripped` output where every media part is replaced by a
 *     placeholder text part, and
 *   - the list of media parts converted to `LanguageModelV3FilePart`.
 *
 * Returns `null` if the output isn't of type `'content'`, or if it doesn't
 * carry any extractable media parts (in which case no rewrite is needed).
 */
function splitContentOutputMedia(
	output: LanguageModelV3ToolResultOutput,
	mediaState: MediaBudgetState,
): SplitResult | null {
	if (output.type !== "content") {
		return null;
	}
	const media: LanguageModelV3FilePart[] = [];
	const newValue: ContentOutput["value"] = [];
	let mutated = false;
	for (const part of output.value) {
		if (!isMediaContentPart(part)) {
			newValue.push(part);
			continue;
		}
		let currentPart = part;
		if (currentPart.type === "image-data") {
			const validation = validateAndReserveImageMedia(
				currentPart.mediaType,
				currentPart.data,
				{
					maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
					maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
				},
				mediaState,
			);
			if (!validation.ok) {
				newValue.push({
					type: "text",
					text: IMAGE_OMITTED_PLACEHOLDER,
				});
				mutated = true;
				continue;
			}
			currentPart = {
				...currentPart,
				data: validation.base64,
				mediaType: validation.mediaType,
			};
		} else if (currentPart.type === "image-url") {
			if (isDataUrl(currentPart.url)) {
				const validation = validateAndReserveImageMedia(
					undefined,
					currentPart.url,
					{
						maxImageEncodedBytes: DEFAULT_MAX_IMAGE_ENCODED_BYTES,
						maxImageDecodedBytes: DEFAULT_MAX_IMAGE_DECODED_BYTES,
					},
					mediaState,
				);
				if (!validation.ok) {
					newValue.push(imageOmittedTextPart());
					mutated = true;
					continue;
				}
				currentPart = {
					...currentPart,
					url: `data:${validation.mediaType};base64,${validation.base64}`,
				};
			} else if (!reserveUnknownUrlMediaBudget(currentPart.url, mediaState)) {
				newValue.push(imageOmittedTextPart());
				mutated = true;
				continue;
			}
		} else if (currentPart.type === "file-url") {
			if (!reserveUnknownUrlMediaBudget(currentPart.url, mediaState)) {
				newValue.push(imageOmittedTextPart());
				mutated = true;
				continue;
			}
		} else if (currentPart.type === "file-data") {
			if (!reserveGenericMediaDataBudget(currentPart.data, mediaState)) {
				newValue.push(imageOmittedTextPart());
				mutated = true;
				continue;
			}
		}
		const filePart = mediaPartToFilePart(currentPart);
		if (!filePart) {
			// Unhandled media kind (image-file-id) — pass through unchanged.
			newValue.push(currentPart);
			continue;
		}
		media.push(filePart);
		mutated = true;
		const placeholder: LanguageModelV3TextPart = {
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
 * Walk a `LanguageModelV3Prompt` and rewrite every `role:"tool"` message
 * containing image/file parts inside its tool-result `output`s. See the
 * file-level comment for the rewrite shape.
 *
 * Returns the (possibly new) prompt array and a `mutated` flag for
 * test/observation use.
 */
export function rewritePromptToolImages(prompt: LanguageModelV3Message[]): {
	prompt: LanguageModelV3Message[];
	mutated: boolean;
} {
	const newPrompt: LanguageModelV3Message[] = [];
	let mutated = false;
	const mediaState = createMediaBudgetState();

	for (const message of prompt) {
		if (message.role !== "tool") {
			newPrompt.push(message);
			continue;
		}

		const collectedMedia: LanguageModelV3FilePart[] = [];
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
			const newPart: LanguageModelV3ToolResultPart = {
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
 * `LanguageModelV3Middleware` that splits image-carrying tool-result
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
export const splitToolImagesMiddleware: LanguageModelV3Middleware = {
	specificationVersion: "v3",
	transformParams: async ({ params }) => {
		const { prompt: newPrompt, mutated } = rewritePromptToolImages(
			params.prompt,
		);
		if (!mutated) {
			return params;
		}
		const next: LanguageModelV3CallOptions = {
			...params,
			prompt: newPrompt,
		};
		return next;
	},
};
