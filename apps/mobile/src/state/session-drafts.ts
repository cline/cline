/**
 * Small process-local draft cache keyed by the exact chat route.
 *
 * It protects text while moving between sessions without putting prompts in route
 * parameters or durable storage. Process-death persistence is deliberately a
 * separate privacy/product decision.
 */

const MAX_DRAFTS = 24;
// Image-picker payloads are base64 strings. Bound their aggregate process memory
// separately from the entry count: a handful of large photos can otherwise retain
// far more memory than 24 ordinary text drafts. Text survives image eviction.
export const MAX_DRAFT_IMAGE_CHARACTERS = 16 * 1024 * 1024;
interface SessionDraft {
	text: string;
	userImages?: string[];
}

const drafts = new Map<string, SessionDraft>();

export function readSessionDraft(key: string): string | undefined {
	return drafts.get(key)?.text || undefined;
}

export function writeSessionDraft(key: string, text: string): void {
	const current = drafts.get(key);
	storeDraft(key, {
		text,
		...(current?.userImages?.length ? { userImages: current.userImages } : {}),
	});
}

export function readSessionDraftImages(key: string): string[] | undefined {
	const images = drafts.get(key)?.userImages;
	return images?.length ? [...images] : undefined;
}

export function writeSessionDraftImages(
	key: string,
	userImages: string[],
): void {
	storeDraft(key, {
		text: drafts.get(key)?.text ?? "",
		...(userImages.length ? { userImages: [...userImages] } : {}),
	});
}

function storeDraft(key: string, draft: SessionDraft): void {
	drafts.delete(key);
	if (!draft.text && !draft.userImages?.length) return;
	drafts.set(key, draft);
	while (drafts.size > MAX_DRAFTS) {
		const oldest = drafts.keys().next().value;
		if (typeof oldest !== "string") return;
		drafts.delete(oldest);
	}
	let imageCharacters = [...drafts.values()].reduce(
		(total, candidate) =>
			total +
			(candidate.userImages?.reduce(
				(imageTotal, image) => imageTotal + image.length,
				0,
			) ?? 0),
		0,
	);
	if (imageCharacters <= MAX_DRAFT_IMAGE_CHARACTERS) return;
	for (const [draftKey, candidate] of drafts) {
		if (!candidate.userImages?.length) continue;
		imageCharacters -= candidate.userImages.reduce(
			(total, image) => total + image.length,
			0,
		);
		if (candidate.text) {
			drafts.set(draftKey, { text: candidate.text });
		} else {
			drafts.delete(draftKey);
		}
		if (imageCharacters <= MAX_DRAFT_IMAGE_CHARACTERS) return;
	}
}

export function clearSessionDraft(key: string): void {
	drafts.delete(key);
}

/** Test-only reset; intentionally not exported from the state barrel. */
export function clearAllSessionDrafts(): void {
	drafts.clear();
}
