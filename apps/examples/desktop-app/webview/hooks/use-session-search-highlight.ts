"use client";

import { useEffect } from "react";
import {
	findMatchOffsets,
	isActiveSearchQuery,
	locateOffsetInSegments,
	searchAnchorId,
} from "@/lib/session-search";

/**
 * Paints find-in-session matches using the CSS Custom Highlight API.
 *
 * Why this and not <mark> elements: message text renders through
 * MemoizedMarkdown, which is memoized so a stream flush does not re-run the
 * markdown pipeline for every bubble. Wrapping matches in elements would mean
 * mutating that rendered output — invalidating the memo and risking broken
 * formatting where a match spans inline markup. Highlight ranges paint over
 * the existing DOM without modifying it at all, so React never re-renders and
 * the markdown pipeline never re-runs.
 *
 * Ranges are built from *rendered* text, so markdown syntax characters are
 * absent by construction and a match can never straddle them.
 */

const ALL_MATCHES_HIGHLIGHT = "cline-find-match";
const ACTIVE_MATCH_HIGHLIGHT = "cline-find-match-active";

type HighlightRegistry = {
	set: (name: string, highlight: unknown) => void;
	delete: (name: string) => void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

function getHighlightApi(): {
	registry: HighlightRegistry;
	Highlight: HighlightConstructor;
} | null {
	// Read both off globalThis: a bare `CSS` reference throws a ReferenceError
	// rather than yielding undefined in environments that lack it (jsdom).
	const scope = globalThis as unknown as {
		CSS?: { highlights?: HighlightRegistry };
		Highlight?: HighlightConstructor;
	};
	const registry = scope.CSS?.highlights;
	const Highlight = scope.Highlight;
	if (!registry || typeof Highlight !== "function") {
		return null;
	}
	return { registry, Highlight };
}

/** True when the browser can paint highlight ranges. */
export function supportsHighlightApi(): boolean {
	return getHighlightApi() !== null;
}

function collectTextNodes(root: HTMLElement): Text[] {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			// Skip the action row (timestamps, copy/edit buttons): it is chrome,
			// not message prose, and highlighting it would be noise.
			const parent = node.parentElement;
			if (!parent || parent.closest("[data-slot='kbd']")) {
				return NodeFilter.FILTER_REJECT;
			}
			if (parent.closest(".cline-chat-message-actions")) {
				return NodeFilter.FILTER_REJECT;
			}
			return node.nodeValue
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_REJECT;
		},
	});
	const nodes: Text[] = [];
	let current = walker.nextNode();
	while (current) {
		nodes.push(current as Text);
		current = walker.nextNode();
	}
	return nodes;
}

/**
 * Builds one Range per occurrence inside a message container. Matching runs
 * over the concatenation of the container's text nodes so an occurrence split
 * across nodes (by bold, code spans, links) is still found.
 */
function buildRangesForMessage(root: HTMLElement, query: string): Range[] {
	const textNodes = collectTextNodes(root);
	if (textNodes.length === 0) {
		return [];
	}
	const segments = textNodes.map((node) => node.nodeValue ?? "");
	const lengths = segments.map((segment) => segment.length);
	const combined = segments.join("");
	const ranges: Range[] = [];
	for (const offset of findMatchOffsets(combined, query)) {
		const start = locateOffsetInSegments(lengths, offset.start);
		const end = locateOffsetInSegments(lengths, offset.end, {
			preferSegmentEnd: true,
		});
		if (!start || !end) {
			continue;
		}
		const range = document.createRange();
		range.setStart(textNodes[start.segmentIndex], start.offsetInSegment);
		range.setEnd(textNodes[end.segmentIndex], end.offsetInSegment);
		ranges.push(range);
	}
	return ranges;
}

/**
 * Registers highlight ranges for the given matches.
 *
 * `messageIds` and `activeMessageId` identify which containers to paint;
 * `revision` lets callers force a repaint when the transcript changes under a
 * stable query, since Ranges hold live node references that stale out.
 */
export function useSessionSearchHighlight({
	query,
	messageIds,
	activeMessageId,
	revision = 0,
}: {
	query: string;
	messageIds: string[];
	activeMessageId: string | null;
	revision?: number;
}): void {
	// messageIds is joined into a primitive so a fresh array of identical ids
	// does not retrigger the effect on every render.
	const messageKey = messageIds.join(",");
	useEffect(() => {
		// Read so the dependency is genuine rather than suppressed: ranges
		// capture live text nodes, so a transcript change under an unchanged
		// query must rebuild them.
		void revision;
		const api = getHighlightApi();
		if (!api) {
			return;
		}
		const { registry, Highlight } = api;
		const clear = () => {
			registry.delete(ALL_MATCHES_HIGHLIGHT);
			registry.delete(ACTIVE_MATCH_HIGHLIGHT);
		};
		if (!isActiveSearchQuery(query) || messageKey.length === 0) {
			clear();
			return clear;
		}
		const allRanges: Range[] = [];
		const activeRanges: Range[] = [];
		for (const messageId of messageKey.split(",")) {
			const element = document.getElementById(searchAnchorId(messageId));
			if (!element) {
				continue;
			}
			const ranges = buildRangesForMessage(element, query);
			allRanges.push(...ranges);
			if (messageId === activeMessageId) {
				activeRanges.push(...ranges);
			}
		}
		if (allRanges.length === 0) {
			clear();
			return clear;
		}
		registry.set(ALL_MATCHES_HIGHLIGHT, new Highlight(...allRanges));
		if (activeRanges.length > 0) {
			registry.set(ACTIVE_MATCH_HIGHLIGHT, new Highlight(...activeRanges));
		} else {
			registry.delete(ACTIVE_MATCH_HIGHLIGHT);
		}
		return clear;
	}, [query, messageKey, activeMessageId, revision]);
}
