import type { ChatMessage } from "@/lib/chat-schema";

/**
 * Find-in-session logic, kept free of React and DOM so the rules that decide
 * what counts as a match live in one testable place.
 *
 * Two deliberate limits, both of which follow from highlighting whole message
 * containers rather than individual words:
 *
 * - Only roles that render as prose bubbles are searched. Tool messages render
 *   through a collapsed tool block whose payload is not prose, and status
 *   messages are chrome, so neither can be meaningfully highlighted.
 * - A message counts as one match no matter how many times the query occurs
 *   inside it. Counting occurrences would make stepping appear to do nothing
 *   when consecutive occurrences share a message, because there is no in-text
 *   marker to move between.
 */

export type SessionSearchEntry = {
	messageId: string;
	/**
	 * The text as displayed, not the raw message content. Callers pass the
	 * formatted string so the search cannot match text the user cannot see
	 * (user input is stripped of command envelopes and mode notices before it
	 * is rendered).
	 */
	text: string;
};

export type SessionSearchMatch = {
	messageId: string;
	/** Zero-based position of this match within the ordered match list. */
	ordinal: number;
};

export type SessionSearchStepDirection = "next" | "previous";

/**
 * DOM id for a message container, so the find bar can scroll a match into view
 * without threading refs through every bubble. Built here rather than inline so
 * the writer and the reader cannot drift apart.
 */
export function searchAnchorId(messageId: string): string {
	return `session-message-${messageId}`;
}

const SEARCHABLE_ROLES: ReadonlySet<ChatMessage["role"]> = new Set([
	"user",
	"assistant",
	"error",
]);

export function isSearchableMessage(message: ChatMessage): boolean {
	return SEARCHABLE_ROLES.has(message.role);
}

/**
 * A query of only whitespace is treated as no query at all: it would match
 * nearly every message and tell the user nothing.
 */
export function isActiveSearchQuery(query: string): boolean {
	return query.trim().length > 0;
}

export function matchesSearchQuery(text: string, query: string): boolean {
	if (!isActiveSearchQuery(query)) {
		return false;
	}
	return text.toLowerCase().includes(query.toLowerCase());
}

export function findSessionMatches(
	entries: SessionSearchEntry[],
	query: string,
): SessionSearchMatch[] {
	if (!isActiveSearchQuery(query)) {
		return [];
	}
	const matches: SessionSearchMatch[] = [];
	for (const entry of entries) {
		if (matchesSearchQuery(entry.text, query)) {
			matches.push({ messageId: entry.messageId, ordinal: matches.length });
		}
	}
	return matches;
}

export type SessionSearchOffset = { start: number; end: number };

/**
 * Every occurrence of the query in a single block of text, as half-open
 * [start, end) offsets. Occurrences cannot overlap: the scan resumes after the
 * end of the previous hit, so searching "aa" in "aaaa" yields two matches
 * rather than three.
 */
export function findMatchOffsets(
	text: string,
	query: string,
): SessionSearchOffset[] {
	if (!isActiveSearchQuery(query) || !text) {
		return [];
	}
	const haystack = text.toLowerCase();
	const needle = query.toLowerCase();
	const offsets: SessionSearchOffset[] = [];
	let cursor = 0;
	while (cursor <= haystack.length - needle.length) {
		const found = haystack.indexOf(needle, cursor);
		if (found === -1) {
			break;
		}
		offsets.push({ start: found, end: found + needle.length });
		cursor = found + needle.length;
	}
	return offsets;
}

export type SegmentLocation = {
	segmentIndex: number;
	offsetInSegment: number;
};

/**
 * Maps an offset in concatenated text back to the segment that contains it.
 *
 * Rendered message text is spread across many DOM text nodes, so a match found
 * in the joined string has to be translated back into a (node, offset) pair
 * before it can become a Range. Kept pure — segment lengths in, coordinates
 * out — so the arithmetic is testable without a DOM.
 *
 * Boundary offsets resolve to the end of the earlier segment rather than the
 * start of the next, which keeps a Range's end anchored to the node holding
 * the final matched character.
 */
export function locateOffsetInSegments(
	segmentLengths: number[],
	offset: number,
	{ preferSegmentEnd = false }: { preferSegmentEnd?: boolean } = {},
): SegmentLocation | null {
	if (offset < 0) {
		return null;
	}
	let consumed = 0;
	for (let index = 0; index < segmentLengths.length; index += 1) {
		const length = segmentLengths[index];
		const end = consumed + length;
		const isInside = preferSegmentEnd
			? offset > consumed && offset <= end
			: offset >= consumed && offset < end;
		if (isInside) {
			return { segmentIndex: index, offsetInSegment: offset - consumed };
		}
		consumed = end;
	}
	// An offset exactly at the very end of the text belongs to the last
	// non-empty segment.
	if (offset === consumed) {
		for (let index = segmentLengths.length - 1; index >= 0; index -= 1) {
			if (segmentLengths[index] > 0) {
				return { segmentIndex: index, offsetInSegment: segmentLengths[index] };
			}
		}
	}
	return null;
}

/**
 * Steps through matches with wraparound. Returns 0 for an empty match list so
 * callers always hold a usable index.
 */
export function stepMatchIndex(
	currentIndex: number,
	totalMatches: number,
	direction: SessionSearchStepDirection,
): number {
	if (totalMatches <= 0) {
		return 0;
	}
	const delta = direction === "next" ? 1 : -1;
	const safeIndex = clampMatchIndex(currentIndex, totalMatches);
	return (safeIndex + delta + totalMatches) % totalMatches;
}

export function clampMatchIndex(index: number, totalMatches: number): number {
	if (totalMatches <= 0 || !Number.isFinite(index) || index < 0) {
		return 0;
	}
	return Math.min(Math.floor(index), totalMatches - 1);
}

/**
 * Text for the live region beside the input. Returns an empty string while no
 * query is entered so the region does not announce anything on open.
 */
export function formatMatchCount(
	activeIndex: number,
	totalMatches: number,
	query: string,
): string {
	if (!isActiveSearchQuery(query)) {
		return "";
	}
	if (totalMatches <= 0) {
		return "No results";
	}
	return `${clampMatchIndex(activeIndex, totalMatches) + 1} of ${totalMatches}`;
}
