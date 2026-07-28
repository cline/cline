export function resolveOpenAICompatibleMaxOutputTokens(
	providerId: string,
	maxTokens: number | undefined,
	defaultedMaxTokens: boolean | undefined,
): number | undefined {
	// Groq counts a requested completion budget toward TPM before generation.
	// Let it choose the model default unless the caller explicitly set a cap.
	return providerId === "groq" && defaultedMaxTokens === true ? undefined : maxTokens
}
