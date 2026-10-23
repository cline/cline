import {
	type GeneratedMedia,
	GeneratedMediaSchema,
	generatedMediaModalityFromMediaType,
} from "@cline/shared";

const MAX_MEDIA = 16;
const MAX_VISITED_VALUES = 256;

function inlineMedia(value: unknown, id: string): GeneratedMedia | undefined {
	const canonical = GeneratedMediaSchema.safeParse(value);
	if (canonical.success) return canonical.data;
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const record = value as Record<string, unknown>;
	if (
		(record.type !== "image" && record.type !== "file") ||
		typeof record.data !== "string" ||
		typeof record.mediaType !== "string"
	) {
		return;
	}
	return GeneratedMediaSchema.safeParse({
		id,
		modality: generatedMediaModalityFromMediaType(record.mediaType),
		mediaType: record.mediaType,
		...(typeof record.name === "string" ? { name: record.name } : {}),
		source: { type: "base64", data: record.data },
	}).data;
}

/** Bounded extraction of current desktop-compatible media from tool results. */
export function extractToolOutputMedia(value: unknown): GeneratedMedia[] {
	const result: GeneratedMedia[] = [];
	const seen = new Set<object>();
	let visited = 0;
	const visit = (next: unknown): void => {
		if (visited++ >= MAX_VISITED_VALUES || result.length >= MAX_MEDIA) return;
		const media = inlineMedia(next, `tool-media-${result.length}`);
		if (media) {
			result.push(media);
			return;
		}
		if (!next || typeof next !== "object" || seen.has(next)) return;
		seen.add(next);
		for (const child of Array.isArray(next)
			? next
			: Object.values(next as Record<string, unknown>)) {
			visit(child);
		}
	};
	visit(value);
	return result;
}

/** Replace inline media bytes before a tool result is stringified for preview. */
export function redactToolOutputMedia(value: unknown): unknown {
	const seen = new Map<object, unknown>();
	let visited = 0;
	const redact = (next: unknown): unknown => {
		if (visited++ >= MAX_VISITED_VALUES) return "[output truncated]";
		const media = inlineMedia(next, "preview");
		if (media) return `[${media.modality} attachment]`;
		if (!next || typeof next !== "object") return next;
		const existing = seen.get(next);
		if (existing) return existing;
		if (Array.isArray(next)) {
			const copy: unknown[] = [];
			seen.set(next, copy);
			for (const child of next) copy.push(redact(child));
			return copy;
		}
		const copy: Record<string, unknown> = {};
		seen.set(next, copy);
		for (const [key, child] of Object.entries(next)) copy[key] = redact(child);
		return copy;
	};
	return redact(value);
}
