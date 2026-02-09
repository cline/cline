export function normalizeCliArgvForPrompt(argv: string[]): string[] {
	// Some orchestrators pass a quoted prompt that begins with "- " (e.g. "- You are given ...").
	// Commander interprets this as an option unless we insert "--" first.
	if (argv.includes("--")) {
		return argv
	}

	const args = [...argv]
	const subcommand = args[2]
	const isPromptCapableSubcommand = subcommand === "task" || subcommand === "t"
	const isKnownNonPromptSubcommand = new Set(["history", "h", "config", "auth", "version", "update", "dev"]).has(
		subcommand,
	)
	const canContainPrompt = isPromptCapableSubcommand || !isKnownNonPromptSubcommand

	if (!canContainPrompt) {
		return args
	}

	// Keep this narrow: only guard final prompt position used by Harbor/task wrappers.
	const lastIndex = args.length - 1
	if (lastIndex >= 2 && /^-\s/.test(args[lastIndex])) {
		args.splice(lastIndex, 0, "--")
		return args
	}

	return args
}
