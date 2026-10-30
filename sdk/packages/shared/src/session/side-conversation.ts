import { z } from "zod";
import { formatFileContentBlock } from "../prompt/format";

const TextFileSchema = z.object({ path: z.string(), content: z.string() });

// Preserve the stored marker used by existing conversation transcripts.
export const SIDE_REFERENCE_KIND = "desktop_side_reference";

export const SIDE_REFERENCE_BUDGET_BYTES = 16 * 1024;
export const SIDE_EXCERPT_BUDGET_BYTES = 4 * 1024;
export const SIDE_VISIBLE_BUDGET_BYTES = 24 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const referenceByteLength = (text: string) =>
	encoder.encode(text).length;

export function referenceExcerpt(
	text: string,
	budget = SIDE_EXCERPT_BUDGET_BYTES,
) {
	const bytes = encoder.encode(text);
	if (bytes.length <= budget) return { text, omittedBytes: 0 };
	const room = Math.max(0, budget - 96);
	let head = Math.floor(room / 2);
	while (head > 0 && (bytes[head] & 0xc0) === 0x80) head--;
	let tail = bytes.length - Math.floor(room / 2);
	while (tail < bytes.length && (bytes[tail] & 0xc0) === 0x80) tail++;
	const omittedBytes = tail - head;
	return {
		text: `${decoder.decode(bytes.subarray(0, head))}\n[excerpt: ${omittedBytes} UTF-8 bytes omitted]\n${decoder.decode(bytes.subarray(tail))}`,
		omittedBytes,
	};
}

export function sanitizeReferenceText(text: string): string {
	return text
		.replace(/cline:\/\/cache\/[^\s"'<>]+/g, "[parent cache handle omitted]")
		.replace(
			/data:(?:image|audio|video)\/[^\s"'<>]+/g,
			"[binary media omitted]",
		);
}

export function serializeReferenceData(
	value: unknown,
	onOmittedMedia?: () => void,
): string {
	return sanitizeReferenceText(
		JSON.stringify(value, (_key, item: unknown) => {
			if (item && typeof item === "object" && "type" in item) {
				if (item.type === "file") {
					const file = TextFileSchema.safeParse(item);
					if (file.success)
						return formatFileContentBlock(file.data.path, file.data.content);
				}
				if (
					["image", "audio", "media", "file"].includes(String(item.type)) ||
					(item.type === "resource" &&
						"resource" in item &&
						item.resource !== null &&
						typeof item.resource === "object" &&
						"blob" in item.resource &&
						typeof item.resource.blob === "string")
				) {
					onOmittedMedia?.();
					return "[media omitted]";
				}
				if (item.type === "thinking" || item.type === "redacted_thinking")
					return "[provider reasoning omitted]";
			}
			return item;
		}) ?? "",
	);
}

const VisibleExcerptSchema = z.object({
	messageId: z.string().min(1).max(512),
	role: z.enum(["user", "assistant", "tool"]),
	text: z
		.string()
		.refine((text) => referenceByteLength(text) <= SIDE_EXCERPT_BUDGET_BYTES),
	runCount: z.number().int().positive().optional(),
	submission: z.enum(["observed", "unconfirmed"]),
	omittedBytes: z.number().int().nonnegative(),
});
export const SideVisibleContextSchema = z
	.object({
		sessionId: z.string().min(1).max(512),
		environmentId: z.string().min(1).max(512),
		capturedAt: z.string().datetime(),
		excerpts: z.array(VisibleExcerptSchema).max(12),
		omittedExcerptCount: z.number().int().nonnegative(),
		omittedMediaCount: z.number().int().nonnegative(),
	})
	.refine(
		(value) =>
			referenceByteLength(JSON.stringify(value)) <= SIDE_VISIBLE_BUDGET_BYTES,
	);
export type SideVisibleContext = z.infer<typeof SideVisibleContextSchema>;
