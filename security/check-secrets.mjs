import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const rules = [
	{ id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, gitPattern: "(AKIA|ASIA)[A-Z0-9]{16}" },
	{
		id: "private-key",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
		gitPattern: "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----",
	},
	{ id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, gitPattern: "gh[pousr]_[A-Za-z0-9]{36,}" },
	{ id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, gitPattern: "xox[baprs]-[A-Za-z0-9-]{20,}" },
]
const ignoredPathPatterns = [
	/(?:^|\/)(?:node_modules|dist|build|out|coverage)(?:\/|$)/,
	/\.(?:png|jpg|jpeg|gif|woff2?|ttf|ico|vsix)$/i,
]
// These exact historical diffs were manually reviewed. They contain synthetic
// redaction fixtures only (placeholder AWS IDs and a literal PRIVATE KEY block
// whose body is the word "SECRET"), not usable credential material.
const reviewedHistoricalFixtures = new Set([
	"aws-access-key:HISTORY:a2714d96d7ed:apps/vscode/src/hosts/vscode/__tests__/commit-message-generator.test.ts",
	"aws-access-key:HISTORY:a2714d96d7ed:apps/vscode/src/services/diagnostics/local-diagnostic-logger.test.ts",
	"aws-access-key:HISTORY:af8678d9ffac:apps/vscode/src/services/bedrock/bedrock-errors.test.ts",
	"aws-access-key:HISTORY:879998fddbbb:apps/vscode/src/hosts/vscode/__tests__/commit-message-generator.test.ts",
	"aws-access-key:HISTORY:879998fddbbb:apps/vscode/src/services/bedrock/bedrock-errors.test.ts",
	"aws-access-key:HISTORY:879998fddbbb:apps/vscode/src/services/diagnostics/local-diagnostic-logger.test.ts",
	"private-key:HISTORY:8452084842a0:apps/cli/src/bin/ca-certs.test.ts",
	"private-key:HISTORY:e2cc08ac8ca4:apps/cli/src/bin/ca-certs.test.ts",
])

function ignoredPath(path) {
	const normalized = path.replaceAll("\\", "/")
	return ignoredPathPatterns.some((pattern) => pattern.test(normalized))
}

function isDocumentedPlaceholder(value) {
	return /EXAMPLE|REDACTED|PLACEHOLDER|FAKE|TEST/i.test(value)
}

function scanText(source, locationPrefix, findings) {
	for (const rule of rules) {
		rule.pattern.lastIndex = 0
		for (const match of source.matchAll(rule.pattern)) {
			if (isDocumentedPlaceholder(match[0])) continue
			if (reviewedHistoricalFixtures.has(`${rule.id}:${locationPrefix}`)) continue
			const lineNumber = source.slice(0, match.index).split("\n").length
			findings.add(`${rule.id}\t${locationPrefix}:${lineNumber}`)
		}
	}
}

async function runGitLines(args, onLine) {
	const child = spawn("git", args, {
		cwd: repositoryRoot,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	})
	let stderr = ""
	child.stderr.setEncoding("utf8")
	child.stderr.on("data", (chunk) => {
		stderr += chunk
	})
	const closed = new Promise((resolveExit) => child.on("close", resolveExit))
	const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
	for await (const line of lines) onLine(line)
	const exitCode = child.exitCode ?? (await closed)
	if (exitCode !== 0) {
		throw new Error(`git ${args[0]} failed (${exitCode}): ${stderr.trim()}`)
	}
}

const findings = new Set()
const trackedFiles = []
await runGitLines(["ls-files", "--cached", "--others", "--exclude-standard"], (line) => {
	if (line && !ignoredPath(line)) trackedFiles.push(line)
})

for (const file of trackedFiles) {
	let source
	try {
		source = await readFile(resolve(repositoryRoot, file), "utf8")
	} catch {
		continue
	}
	scanText(source, `WORKTREE:${file}`, findings)
}

let commitCount = "unknown"
await runGitLines(["rev-list", "--all", "--count"], (line) => {
	commitCount = line
})
for (const rule of rules) {
	let currentCommit = "unknown"
	let currentFile = "unknown"
	await runGitLines(
		["log", "-p", "--all", "--full-history", "--no-ext-diff", "--no-textconv", "--format=commit:%H", "--unified=0", "-G", rule.gitPattern],
		(line) => {
			if (line.startsWith("commit:")) {
				currentCommit = line.slice("commit:".length, "commit:".length + 12)
				return
			}
			if (line.startsWith("diff --git ")) {
				currentFile = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)?.[2] ?? "unknown"
				return
			}
			if (
				ignoredPath(currentFile) ||
				(!line.startsWith("+") && !line.startsWith("-")) ||
				line.startsWith("+++") ||
				line.startsWith("---")
			) {
				return
			}
			scanText(line.slice(1), `HISTORY:${currentCommit}:${currentFile}`, findings)
		},
	)
}

if (findings.size > 0) {
	for (const finding of [...findings].sort()) {
		const [rule, location] = finding.split("\t")
		console.error(`[secrets] ${rule} at ${location}`)
	}
	console.error(`[secrets] ${findings.size} potential secret occurrence(s) require review`)
	process.exit(1)
}

console.log(
	`[secrets] scanned ${trackedFiles.length} current-tree files and the patches of ${commitCount} Git commits; no high-confidence secrets found`,
)
