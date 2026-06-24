/**
 * Offline, deterministic supply-chain inspector for shell commands.
 *
 * Given a command the agent is about to run, this detects whether it installs (or
 * executes via a package runner) an npm package whose name is one edit away from a
 * popular package - a classic typosquat. On a hit it returns a "flagged" verdict
 * with a human-readable reason so the caller can require manual approval instead of
 * auto-approving the command. It never produces a hard deny.
 *
 * The check is pure: no network, no filesystem, no new dependencies. It complements
 * CommandPermissionController (which is gated behind CLINE_COMMAND_PERMISSIONS) and is
 * intended to run unconditionally.
 */

/** Result of inspecting a command for typosquat package installs. */
export interface SupplyChainInspectionResult {
	/** True when at least one likely-typosquat package was found. */
	flagged: boolean
	/** Human-readable explanation, e.g. "`lodahs` is one edit away from the popular package `lodash`". */
	reason?: string
	/** The flagged package names (lowercased), for telemetry/diagnostics. */
	packages: string[]
}

/**
 * Curated set of popular npm package names. A candidate is only flagged when it is
 * exactly one edit away from one of these AND that popular name is longer than four
 * characters (short names produce too many false positives).
 */
const POPULAR_PACKAGES: ReadonlySet<string> = new Set([
	"react",
	"react-dom",
	"vue",
	"angular",
	"lodash",
	"axios",
	"express",
	"next",
	"tailwindcss",
	"typescript",
	"vite",
	"webpack",
	"eslint",
	"prettier",
	"jest",
	"mocha",
	"chalk",
	"commander",
	"chokidar",
	"moment",
	"dayjs",
	"uuid",
	"yargs",
	"zod",
	"rxjs",
	"ramda",
	"dotenv",
	"cors",
	"body-parser",
	"socket.io",
	"mongoose",
	"sequelize",
	"prisma",
	"redux",
	"react-router",
	"react-router-dom",
	"react-query",
	"framer-motion",
	"styled-components",
	"antd",
	"bootstrap",
	"jquery",
	"underscore",
	"request",
	"node-fetch",
	"got",
	"puppeteer",
	"playwright",
	"cheerio",
	"fs-extra",
	"minimatch",
	"rimraf",
	"semver",
	"debug",
	"winston",
	"pino",
	"morgan",
	"helmet",
	"passport",
	"bcrypt",
	"jsonwebtoken",
	"argon2",
	"mysql2",
	"redis",
	"ioredis",
	"nodemon",
	"concurrently",
])

/** Shell wrappers that precede the real command and should be skipped. */
const WRAPPER_COMMANDS: ReadonlySet<string> = new Set([
	"sudo",
	"doas",
	"env",
	"time",
	"nice",
	"nohup",
	"stdbuf",
	"command",
	"xargs",
])

/** Package managers that install dependencies. */
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(["npm", "npm.cmd", "yarn", "pnpm", "bun"])

/** Standalone package runners (npx-like) where the executed package is the target. */
const RUNNERS: ReadonlySet<string> = new Set(["npx", "npx.cmd", "bunx", "bunx.cmd"])

/**
 * Install subcommands per manager that collect package args, and runner subcommands
 * per manager where only the executed package is the target.
 */
const INSTALL_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
	npm: new Set(["install", "i", "add"]),
	yarn: new Set(["add"]),
	pnpm: new Set(["add", "install", "i"]),
	bun: new Set(["add", "install", "i"]),
}

const RUNNER_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
	npm: new Set(["exec", "x"]),
	yarn: new Set(["dlx"]),
	pnpm: new Set(["dlx"]),
	bun: new Set(["x"]),
}

/**
 * Value-taking flags in install subcommands. When written without "=", the following
 * token is the flag's value and must not be treated as a package spec.
 */
const VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
	"--prefix",
	"-C",
	"--registry",
	"--cache",
	"--userconfig",
	"--globalconfig",
	"--workspace",
	"-w",
	"--omit",
	"--include",
	"--save-prefix",
	"--loglevel",
	"--filter",
	"--dir",
])

/** Redirection tokens that are never package specs. */
const REDIRECTION_TOKENS: ReadonlySet<string> = new Set([">", ">>", "<"])

/** Keywords that are recognised subcommands (used when deciding if a bare flag consumes its value). */
const ALL_SUBCOMMAND_KEYWORDS: ReadonlySet<string> = new Set([
	"install",
	"i",
	"add",
	"exec",
	"x",
	"dlx",
])

/**
 * Inspect a shell command for typosquat package installs.
 *
 * @param command - the raw command string the agent is about to run
 * @returns a result indicating whether any likely-typosquat package was found
 */
export function inspectCommandForTyposquat(command: string): SupplyChainInspectionResult {
	if (!command) {
		return { flagged: false, packages: [] }
	}

	const flagged: string[] = []
	const reasons: string[] = []
	const seen = new Set<string>()

	for (const subCommand of splitSubCommands(command)) {
		for (const pkg of collectPackagesFromSubCommand(subCommand)) {
			const name = normalizePackageName(pkg)
			const popular = findTyposquatTarget(name)
			if (popular && !seen.has(name)) {
				seen.add(name)
				flagged.push(name)
				reasons.push(`\`${name}\` is one edit away from the popular package \`${popular}\``)
			}
		}
	}

	if (flagged.length === 0) {
		return { flagged: false, packages: [] }
	}

	return { flagged: true, reason: reasons.join("; "), packages: flagged }
}

/**
 * Split a command into sub-commands on newline, ';', '&&', '||', single '|', single '&'.
 * Two-char operators (&&, ||) take precedence over their single-char counterparts.
 * Operators inside quotes are ignored.
 */
function splitSubCommands(command: string): string[] {
	const parts: string[] = []
	let current = ""
	let inSingle = false
	let inDouble = false

	for (let i = 0; i < command.length; i++) {
		const char = command[i]
		const next = command[i + 1]

		if (char === "'" && !inDouble) {
			inSingle = !inSingle
			current += char
			continue
		}
		if (char === '"' && !inSingle) {
			inDouble = !inDouble
			current += char
			continue
		}

		if (inSingle || inDouble) {
			current += char
			continue
		}

		// Newline separators
		if (char === "\n" || char === "\r") {
			parts.push(current)
			current = ""
			continue
		}

		// Two-char operators take precedence
		if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
			parts.push(current)
			current = ""
			i++
			continue
		}

		// Single-char separators: ';', '|', '&'
		if (char === ";" || char === "|" || char === "&") {
			parts.push(current)
			current = ""
			continue
		}

		current += char
	}

	parts.push(current)
	return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

/**
 * Tokenize a sub-command, strip leading shell noise (env assignments, wrappers, path
 * prefixes), dispatch on the binary, and collect any package specs it installs/runs.
 */
function collectPackagesFromSubCommand(subCommand: string): string[] {
	let tokens = tokenize(subCommand).map(unquote)
	tokens = stripLeadingNoise(tokens)
	if (tokens.length === 0) {
		return []
	}

	const binary = stripPathPrefix(tokens[0])
	const args = tokens.slice(1)

	if (RUNNERS.has(binary)) {
		return collectRunnerTarget(args)
	}

	if (PACKAGE_MANAGERS.has(binary)) {
		const manager = binary === "npm.cmd" ? "npm" : binary
		return collectManagerPackages(manager, args)
	}

	return []
}

/** Split on whitespace into raw tokens. */
function tokenize(input: string): string[] {
	return input.split(/\s+/).filter((t) => t.length > 0)
}

/** Strip ONE matched pair of surrounding single or double quotes from a token. */
function unquote(token: string): string {
	if (token.length >= 2) {
		const first = token[0]
		const last = token[token.length - 1]
		if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
			return token.slice(1, -1)
		}
	}
	return token
}

/**
 * Strip leading shell noise: env assignments (KEY=VALUE), wrapper commands and their
 * leading -options. Stops at the first token that is a real binary.
 */
function stripLeadingNoise(tokens: string[]): string[] {
	const envAssignment = /^[A-Za-z_][A-Za-z0-9_]*=/
	let i = 0

	while (i < tokens.length) {
		const token = tokens[i]

		// Environment assignment KEY=VALUE
		if (envAssignment.test(token)) {
			i++
			continue
		}

		// Wrapper command (strip the wrapper and any of its leading -options)
		const bare = stripPathPrefix(token)
		if (WRAPPER_COMMANDS.has(bare)) {
			i++
			// Skip wrapper options and any further env assignments (e.g. `env FOO=bar`)
			while (i < tokens.length && (tokens[i].startsWith("-") || envAssignment.test(tokens[i]))) {
				i++
			}
			continue
		}

		break
	}

	return tokens.slice(i)
}

/** Strip any path prefix on a binary name: /usr/bin/npm -> npm. */
function stripPathPrefix(token: string): string {
	const slash = token.lastIndexOf("/")
	return slash === -1 ? token : token.slice(slash + 1)
}

/**
 * For a package manager, find the subcommand (skipping leading global options), then
 * collect package specs for install subcommands or the executed target for runner
 * subcommands.
 */
function collectManagerPackages(manager: string, args: string[]): string[] {
	const installSubs = INSTALL_SUBCOMMANDS[manager]
	const runnerSubs = RUNNER_SUBCOMMANDS[manager]
	const subIndex = findSubcommandIndex(args)
	if (subIndex === -1) {
		return []
	}

	const subcommand = args[subIndex]
	const rest = args.slice(subIndex + 1)

	if (installSubs?.has(subcommand)) {
		return collectInstallPackages(rest)
	}
	if (runnerSubs?.has(subcommand)) {
		return collectRunnerTarget(rest)
	}
	return []
}

/**
 * Find the index of the subcommand by skipping leading global options:
 * - "--flag=value" is self-contained.
 * - a bare "--flag" consumes the next token as its value UNLESS that token starts with
 *   "-" or is itself a recognised subcommand keyword.
 * The first non-option token is the subcommand.
 */
function findSubcommandIndex(args: string[]): number {
	let i = 0
	while (i < args.length) {
		const token = args[i]
		if (token.startsWith("-")) {
			if (token.includes("=")) {
				// self-contained --flag=value
				i++
				continue
			}
			const next = args[i + 1]
			if (next !== undefined && !next.startsWith("-") && !ALL_SUBCOMMAND_KEYWORDS.has(next)) {
				// bare flag consumes its value
				i += 2
				continue
			}
			i++
			continue
		}
		// first non-option token = subcommand
		return i
	}
	return -1
}

/**
 * Collect package specs from the args of an install subcommand. Skips flags, value
 * tokens of value-taking flags (when written without "="), and redirection tokens.
 */
function collectInstallPackages(args: string[]): string[] {
	const packages: string[] = []

	for (let i = 0; i < args.length; i++) {
		const token = args[i]

		if (REDIRECTION_TOKENS.has(token)) {
			continue
		}

		if (token.startsWith("-")) {
			// Value-taking flag without "=" consumes the next token as its value.
			if (!token.includes("=") && VALUE_TAKING_FLAGS.has(token)) {
				i++
			}
			continue
		}

		if (isPackageSpec(token)) {
			packages.push(token)
		}
	}

	return packages
}

/**
 * For a runner, the executed package is the only target. Honor -p/--package and
 * --package=NAME; otherwise stop at the first executed positional token.
 */
function collectRunnerTarget(args: string[]): string[] {
	for (let i = 0; i < args.length; i++) {
		const token = args[i]

		// --package=NAME / -p=NAME
		if (token.startsWith("--package=")) {
			return [token.slice("--package=".length)]
		}
		if (token.startsWith("-p=")) {
			return [token.slice("-p=".length)]
		}
		// -p NAME / --package NAME
		if (token === "-p" || token === "--package") {
			const next = args[i + 1]
			if (next !== undefined) {
				return [next]
			}
			return []
		}

		if (REDIRECTION_TOKENS.has(token)) {
			continue
		}

		// Other flags: a bare flag may consume a value; be conservative and skip flags only.
		if (token.startsWith("-")) {
			continue
		}

		// First executed positional token is the runner target.
		if (isPackageSpec(token)) {
			return [token]
		}
		return []
	}
	return []
}

/**
 * A package spec is a token whose first byte is ascii-alphanumeric or "_", OR a scoped
 * name starting "@" that contains "/".
 */
function isPackageSpec(token: string): boolean {
	if (token.length === 0) {
		return false
	}
	const first = token[0]
	if (/[A-Za-z0-9_]/.test(first)) {
		return true
	}
	if (first === "@" && token.includes("/")) {
		return true
	}
	return false
}

/**
 * Strip a trailing "@version" but keep scope:
 *   "@scope/pkg@1.2.3" -> "@scope/pkg"
 *   "lodash@4"         -> "lodash"
 *   "@scope/pkg"       -> "@scope/pkg"
 */
function normalizePackageName(spec: string): string {
	let name = spec
	if (name.startsWith("@")) {
		// Scoped: only an "@" AFTER the scope separator denotes a version.
		const slash = name.indexOf("/")
		if (slash !== -1) {
			const at = name.indexOf("@", slash)
			if (at !== -1) {
				name = name.slice(0, at)
			}
		}
	} else {
		const at = name.indexOf("@")
		if (at > 0) {
			name = name.slice(0, at)
		}
	}
	return name.toLowerCase()
}

/**
 * Return the popular package a candidate typosquats, or undefined. A candidate is
 * flagged iff it is NOT itself popular AND its minimum Optimal-String-Alignment
 * distance to some popular name is exactly 1 AND that popular name's length > 4.
 */
function findTyposquatTarget(candidate: string): string | undefined {
	if (POPULAR_PACKAGES.has(candidate)) {
		return undefined
	}
	for (const popular of POPULAR_PACKAGES) {
		if (popular.length > 4 && optimalStringAlignmentDistance(candidate, popular) === 1) {
			return popular
		}
	}
	return undefined
}

/**
 * Optimal String Alignment distance (restricted Damerau-Levenshtein): supports
 * insertion, deletion, substitution and transposition of two ADJACENT characters,
 * with the restriction that no substring is edited more than once.
 */
function optimalStringAlignmentDistance(a: string, b: string): number {
	const m = a.length
	const n = b.length
	if (m === 0) {
		return n
	}
	if (n === 0) {
		return m
	}

	const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
	for (let i = 0; i <= m; i++) {
		d[i][0] = i
	}
	for (let j = 0; j <= n; j++) {
		d[0][j] = j
	}

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			d[i][j] = Math.min(
				d[i - 1][j] + 1, // deletion
				d[i][j - 1] + 1, // insertion
				d[i - 1][j - 1] + cost, // substitution
			)
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1) // adjacent transposition
			}
		}
	}

	return d[m][n]
}
