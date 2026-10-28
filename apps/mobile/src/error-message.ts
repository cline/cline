/**
 * Converts failures from fetch, native modules, and the hub into text that is
 * safe to put in front of a person. APIs do not always agree on an error shape:
 * the useful sentence may be in `message`, `error.message`, `detail`, or a JSON
 * string. Never stringify an unknown object into the UI.
 */

import { safeJsonParse } from "@cline/shared";

const MESSAGE_KEYS = [
	"message",
	"error",
	"detail",
	"reason",
	"errors",
] as const;
const MAX_MESSAGE_LENGTH = 320;

function cleanText(value: string): string | undefined {
	const text = value.replace(/\s+/g, " ").trim();
	if (
		!text ||
		text === "{}" ||
		text === "[]" ||
		text === "[object Object]" ||
		/^<!doctype html|^<html[\s>]/i.test(text)
	) {
		return undefined;
	}
	return text;
}

function boundedText(text: string): string {
	return text.length > MAX_MESSAGE_LENGTH
		? `${text.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`
		: text;
}

function extractMessage(value: unknown, depth = 0): string | undefined {
	if (depth > 4 || value === null || value === undefined) return undefined;

	if (value instanceof Error) {
		return extractMessage(value.message, depth + 1);
	}

	if (typeof value === "string") {
		const cleaned = cleanText(value);
		if (!cleaned) return undefined;

		const parsed = safeJsonParse<unknown>(cleaned);
		if (parsed !== undefined && parsed !== cleaned) {
			return extractMessage(parsed, depth + 1);
		}

		// Some gateways prefix a JSON response with an HTTP status. Prefer the
		// sentence inside that response over showing the serialized payload.
		for (const marker of ["{", "["] as const) {
			const start = cleaned.indexOf(marker);
			if (start > 0) {
				const nested = safeJsonParse<unknown>(cleaned.slice(start));
				const message = extractMessage(nested, depth + 1);
				if (message) return message;
			}
		}

		return cleaned;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const message = extractMessage(item, depth + 1);
			if (message) return message;
		}
		return undefined;
	}

	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of MESSAGE_KEYS) {
			const message = extractMessage(record[key], depth + 1);
			if (message) return message;
		}
	}

	return undefined;
}

/** Return a readable error sentence, or the caller's contextual fallback. */
export function userErrorMessage(error: unknown, fallback: string): string {
	const message = extractMessage(error);
	if (!message) return fallback;
	if (/\bkey limit exceeded\b/i.test(message)) {
		return "This model's provider has reached its spending limit. Choose another model or try again later.";
	}
	// Expo fetch's timeout abort may arrive as a native exception plus a Swift
	// source location. Cancellation confirms no response, not that a server write
	// failed: the same request can still commit after the client stops waiting.
	if (
		/^(?:fetch failed:\s*)?FetchRequestCancel(?:ed|led)Exception\b/i.test(
			message,
		)
	) {
		return "The request was interrupted. Check whether it completed before trying again.";
	}
	if (
		/^(?:network request failed|failed to fetch|load failed)$/i.test(message)
	) {
		return "Cline couldn't reach the service. Check your connection and try again.";
	}
	if (/timed? out|timeout/i.test(message)) {
		return "The request took too long. Check whether it completed before trying again.";
	}
	// A bare status-bearing implementation message gives a person no useful next
	// step. The caller knows the operation and therefore owns the better fallback.
	if (
		/^(?:cline )?.*(?:request|response) failed \(\d{3}\)\.?$/i.test(message)
	) {
		return fallback;
	}
	// Bound the extracted sentence, not its JSON envelope: truncating before
	// parsing turns long provider responses back into unreadable JSON blobs.
	return boundedText(message);
}

/** Read a useful optional diagnostic without ever rendering an object blob. */
export function errorDetail(error: unknown): string | undefined {
	const message = extractMessage(error);
	return message ? boundedText(message) : undefined;
}
