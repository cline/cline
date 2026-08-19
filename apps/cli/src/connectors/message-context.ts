export type ConnectorMessageContextField = {
	key: string;
	value: string;
};

/**
 * Characters that could break a line-oriented `<tag>` context block:
 * control characters (inject extra metadata lines), angle brackets
 * (close/reopen the surrounding tag), backslashes and double quotes
 * (ambiguous against the JSON-encoded form).
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control characters in user-controlled values is the purpose of this pattern
const UNSAFE_CONTEXT_VALUE_PATTERN = /[\u0000-\u001f\u007f<>\\"]/;

/**
 * Encode one user-controlled value for a connector message-context block.
 * Plain values pass through unchanged; anything that could inject metadata
 * lines or close/reopen the context tag is JSON-encoded with angle brackets
 * escaped as unicode sequences, so the result always stays on one line and
 * never contains a literal `<` or `>`.
 */
export function encodeConnectorMessageContextValue(value: string): string {
	if (!UNSAFE_CONTEXT_VALUE_PATTERN.test(value) && value === value.trim()) {
		return value;
	}
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e");
}

/**
 * Serialize a connector message-context block ahead of the visible message
 * text. Field keys are code-controlled constants; every field value is
 * encoded so user-controlled input cannot break out of the block.
 */
export function formatConnectorMessageContext(input: {
	tag: string;
	fields: ConnectorMessageContextField[];
	text: string;
}): string {
	return [
		`<${input.tag}>`,
		...input.fields.map(
			(field) =>
				`${field.key}: ${encodeConnectorMessageContextValue(field.value)}`,
		),
		`</${input.tag}>`,
		"",
		input.text,
	].join("\n");
}
