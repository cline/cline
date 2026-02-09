export function normalizeCliArgvForPrompt(argv: string[]): string[] {
	// Some orchestrators pass a quoted prompt that begins with "- " (e.g. "- You are given ...").
	// Commander interprets this as an option unless we insert "--" first.
	if (argv.includes("--")) {
		return argv
	}

	const args = [...argv]
	for (let i = 2; i < args.length; i++) {
		const token = args[i]
		if (/^-\s/.test(token)) {
			args.splice(i, 0, "--")
			return args
		}
	}

	return args
}
