import type { LanguageModelChatSelector } from "vscode";

export const SELECTOR_SEPARATOR = "/";

function encodeSelectorSegment(value: string): string {
	return encodeURIComponent(value);
}

function decodeSelectorSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		// Be tolerant of selector strings persisted before encoding was added.
		return value;
	}
}

export function stringifyVsCodeLmModelSelector(
	selector: LanguageModelChatSelector,
): string {
	return [selector.vendor, selector.family, selector.version, selector.id]
		.filter((part): part is string => Boolean(part))
		.map(encodeSelectorSegment)
		.join(SELECTOR_SEPARATOR);
}

/**
 * Parse a stringified VS Code LM selector (`vendor/family[/version/id]`) back
 * into a `LanguageModelChatSelector`.
 *
 * Selector segments are URI-encoded by stringifyVsCodeLmModelSelector so model
 * family/id values can themselves contain `/` (common for BYOK providers such as
 * `openai/gpt-4o`). For backwards compatibility with older persisted values,
 * two-segment strings are still treated as plain `vendor/family`.
 */
export function parseVsCodeLmModelSelector(
	modelId: string | undefined,
): LanguageModelChatSelector {
	if (!modelId) {
		return {};
	}

	const parts = modelId.split(SELECTOR_SEPARATOR);
	const [vendor, family, version, id] = parts.map(decodeSelectorSegment);
	const selector: LanguageModelChatSelector = {};
	if (vendor) {
		selector.vendor = vendor;
	}
	if (family) {
		selector.family = family;
	}
	if (version) {
		selector.version = version;
	}
	if (id) {
		selector.id = id;
	}
	return selector;
}
