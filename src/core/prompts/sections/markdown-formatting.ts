export function markdownFormattingSection(): string {
	return `====

MARKDOWN RULES

ALL responses MUST show ANY \`language construct\` OR filename reterence as clickable, exactly as [\`filename OR language.declaration()\`](relative/file/path.ext:line); line is required for \`syntax\` and optional for filename links. This applies to ALL markdown responses and ALSO those in <attempt_completion>`
}
