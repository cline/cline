export function isClineManagedProvider(provider: string | undefined) {
	return provider === "cline" || provider === "cline-pass"
}
