#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

function parseArgs(argv) {
	const args = {}
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i]
		if (!token.startsWith("--")) continue
		const key = token.slice(2)
		const next = argv[i + 1]
		if (!next || next.startsWith("--")) {
			args[key] = true
		} else {
			args[key] = next
			i++
		}
	}
	return args
}

function usage() {
	console.log(`changelog-inventory.mjs

Usage:
  node scripts/release/changelog-inventory.mjs \\
    --scope <vscode|cli> \\
    [--from <latest|tag|ref>] \\
    [--to <now|tag|ref>] \\
    --output-dir <abs-or-rel-path> \\
    [--version <x.y.z>] [--batch-size <n>] [--repo-owner <owner>] [--repo-name <name>] \\
    [--pr-numbers <comma-separated>] [--apply] [--target-file <path>]

Writes artifacts:
  - pr-inventory.json
  - scope-classification.json
  - candidate-bullets.md
  - final-changelog.md

With --apply:
  - inserts the generated changelog section into the target changelog file
  - leaves changes uncommitted for human review
`)
}

function run(cmd, args, opts = {}) {
	try {
		const out = execFileSync(cmd, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			...opts,
		})
		return { ok: true, stdout: out, stderr: "", code: 0 }
	} catch (error) {
		return {
			ok: false,
			stdout: error.stdout?.toString?.() ?? "",
			stderr: error.stderr?.toString?.() ?? error.message,
			code: error.status ?? 1,
		}
	}
}

function runGit(args) {
	return run("git", args)
}

function runGh(args) {
	return run("gh", args)
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true })
}

function writeJson(filePath, data) {
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8")
}

function normalizeTitle(title) {
	return (title || "")
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

function humanizeTitle(title) {
	let t = normalizeTitle(title)
	// Remove conventional commit prefix, e.g. "feat(cli): " or "fix: "
	t = t.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, "")
	// Normalize sentence casing lightly
	if (t.length > 0) {
		t = t.charAt(0).toUpperCase() + t.slice(1)
	}
	return t
}

function toSemverNoV(value) {
	if (!value) return undefined
	return value.replace(/^v/i, "")
}

function looksLikeSemverTagOrVersion(value) {
	if (!value) return false
	return /^v?\d+\.\d+\.\d+$/.test(String(value).trim())
}

function sectionForTitle(title) {
	const t = (title || "").toLowerCase()
	if (/^(feat|add|added|new)(\(|:|\s)/.test(t)) return "Added"
	if (/^(fix|fixed|bugfix)(\(|:|\s)/.test(t)) return "Fixed"
	return "Changed"
}

function isInternalOnlyPath(p) {
	const v = p || ""
	return (
		v.startsWith(".github/") ||
		v.startsWith("docs/") ||
		v.startsWith("evals/") ||
		v.startsWith("scripts/") ||
		v.startsWith("tests/") ||
		v.startsWith("test/") ||
		v.startsWith(".changeset/") ||
		v.startsWith(".clinerules/workflows/") ||
		v.endsWith(".md")
	)
}

function classifyScope(pr) {
	const paths = pr.files ?? []
	if (!paths.length) {
		return { scope: "exclude", reason: "no-file-data" }
	}

	const internalOnly = paths.every(isInternalOnlyPath)
	if (internalOnly) {
		return { scope: "exclude", reason: "internal-only-paths" }
	}

	const hasCli = paths.some((p) => p.startsWith("cli/"))
	const hasNonCli = paths.some((p) => !p.startsWith("cli/"))

	if (hasCli && hasNonCli) return { scope: "both", reason: "mixed-cli-and-extension-paths" }
	if (hasCli) return { scope: "cli", reason: "cli-paths" }
	return { scope: "vscode", reason: "non-cli-paths" }
}

function shouldInclude(scope, classifiedScope) {
	if (classifiedScope === "exclude") return false
	if (scope === "vscode") return classifiedScope === "vscode" || classifiedScope === "both"
	return classifiedScope === "cli" || classifiedScope === "both"
}

function graphqlString(value) {
	return JSON.stringify(value)
}

function fetchRepoOwnerName(args) {
	if (args["repo-owner"] && args["repo-name"]) {
		return { owner: String(args["repo-owner"]), name: String(args["repo-name"]) }
	}
	const repoRes = runGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
	if (!repoRes.ok) {
		throw new Error(`gh repo view failed: ${repoRes.stderr || repoRes.stdout}`)
	}
	const repo = repoRes.stdout.trim()
	const [owner, name] = repo.split("/")
	if (!owner || !name) {
		throw new Error(`Invalid repo nameWithOwner: ${repo}`)
	}
	return { owner, name }
}

function fetchGraphql(query) {
	const res = runGh(["api", "graphql", "-f", `query=${query}`])
	if (!res.ok) {
		// Try to parse stdout anyway, gh can error with partial responses.
		if (!res.stdout?.trim()) {
			throw new Error(`gh api graphql failed: ${res.stderr || res.stdout}`)
		}
	}
	let parsed
	try {
		parsed = JSON.parse(res.stdout)
	} catch {
		throw new Error(`Failed to parse GraphQL stdout as JSON. stderr=${res.stderr}`)
	}
	if (!parsed?.data) {
		throw new Error("GraphQL response missing .data")
	}
	return parsed
}

function resolveLatestTag() {
	const tagRes = runGit(["tag", "--list", "v[0-9]*", "--sort=-version:refname"])
	if (!tagRes.ok) {
		throw new Error(`git tag failed: ${tagRes.stderr || tagRes.stdout}`)
	}
	const tags = tagRes.stdout
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter(Boolean)
	if (!tags.length) {
		throw new Error("No vX.Y.Z tags found. Try fetching tags first.")
	}
	return tags[0]
}

function gitAvailable() {
	const res = runGit(["rev-parse", "--is-inside-work-tree"])
	return res.ok
}

function resolveRef(ref) {
	if (ref === "latest") return resolveLatestTag()
	if (ref === "now") return "main"
	return ref
}

function verifyRefExists(ref) {
	const res = runGit(["rev-parse", "--verify", "--quiet", `${ref}^{}`])
	if (!res.ok) {
		throw new Error(`Ref does not resolve: ${ref}`)
	}
	return res.stdout.trim()
}

function candidatePrNumbers(fromRef, toRef) {
	const logRes = runGit(["log", "--first-parent", "--pretty=%s", `${fromRef}..${toRef}`])
	if (!logRes.ok) {
		throw new Error(`git log failed: ${logRes.stderr || logRes.stdout}`)
	}
	const matches = [...logRes.stdout.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
	return [...new Set(matches)].sort((a, b) => a - b)
}

function fetchPrMetadata(owner, name, prNumbers, batchSize = 80) {
	const out = []
	for (let i = 0; i < prNumbers.length; i += batchSize) {
		const batch = prNumbers.slice(i, i + batchSize)
		const body = batch
			.map(
				(n) =>
					`pr${n}: pullRequest(number: ${n}) { number title url mergedAt author { login } labels(first: 20) { nodes { name } } files(first: 100) { nodes { path } pageInfo { hasNextPage endCursor } } }`,
			)
			.join(" ")
		const query = `query { repository(owner: ${graphqlString(owner)}, name: ${graphqlString(name)}) { ${body} } }`
		const parsed = fetchGraphql(query)
		const repoObj = parsed.data.repository || {}
		for (const value of Object.values(repoObj)) {
			if (!value) continue
			const files = value.files?.nodes?.map((n) => n.path) ?? []
			const hasMoreFiles = Boolean(value.files?.pageInfo?.hasNextPage)
			out.push({
				number: value.number,
				title: normalizeTitle(value.title),
				url: value.url,
				mergedAt: value.mergedAt,
				author: value.author?.login ?? null,
				labels: (value.labels?.nodes ?? []).map((n) => n.name),
				files,
				hasMoreFiles,
			})
		}
	}
	return out.sort((a, b) => a.number - b.number)
}

function membershipIsInternal(login) {
	if (!login) return false
	const res = runGh(["api", `orgs/cline/memberships/${login}`])
	if (!res.ok) return false
	return true
}

function fetchEarliestPrByAuthor(owner, name, authors) {
	const map = {}
	for (const author of authors) {
		const query = `query { search(query: ${graphqlString(`repo:${owner}/${name} is:pr is:merged author:${author} sort:created-asc`)}, type: ISSUE, first: 1) { nodes { ... on PullRequest { number author { login } } } } }`
		try {
			const parsed = fetchGraphql(query)
			const node = parsed?.data?.search?.nodes?.[0]
			if (node?.author?.login && typeof node.number === "number") {
				map[node.author.login] = node.number
			}
		} catch {
			// best-effort
		}
	}
	return map
}

function detectSectionHeadingLevel(changelogText) {
	// Prefer the first explicit Added/Fixed/Changed heading if present.
	const lines = changelogText.split(/\r?\n/)
	for (const line of lines) {
		const trimmed = line.trim()
		if (/^###\s+(Added|Fixed|Changed|New Contributors)\b/i.test(trimmed)) {
			return "###"
		}
		if (/^##\s+(Added|Fixed|Changed|New Contributors)\b/i.test(trimmed)) {
			return "##"
		}
	}
	// Default to ### to match current changelog style in this repo.
	return "###"
}

function detectVersionHeadingStyle(changelogText) {
	const lines = changelogText.split(/\r?\n/)
	for (const line of lines) {
		const trimmed = line.trim()
		if (/^##\s+\[\d+\.\d+\.\d+\]\s*$/.test(trimmed)) {
			return "bracketed"
		}
		if (/^##\s+\d+\.\d+\.\d+\s*$/.test(trimmed)) {
			return "plain"
		}
	}
	return "bracketed"
}

function buildVersionHeading(version, versionHeadingStyle) {
	return versionHeadingStyle === "plain" ? `## ${version}` : `## [${version}]`
}

function buildChangelogBlock({ version, versionHeadingStyle, sectionHeading, grouped, firstTime }) {
	const lines = [buildVersionHeading(version, versionHeadingStyle), ""]
	for (const sectionName of ["Added", "Fixed", "Changed"]) {
		if (grouped[sectionName].length) {
			lines.push(`${sectionHeading} ${sectionName}`, "")
			lines.push(...grouped[sectionName], "")
		}
	}
	if (firstTime.length) {
		lines.push(`${sectionHeading} New Contributors`, "")
		for (const pr of firstTime) {
			lines.push(`- @${pr.author} made their first contribution.`)
		}
		lines.push("")
	}
	return lines.join("\n").trimEnd() + "\n"
}

function insertAtTopOfChangelog(existingText, entryBlock) {
	const lines = existingText.split(/\r?\n/)
	const firstVersionIndex = lines.findIndex((line) => /^##\s+\[?\d+\.\d+\.\d+\]?\s*$/.test(line.trim()))
	if (firstVersionIndex === -1) {
		throw new Error("Could not find first version heading in target changelog")
	}

	const before = lines.slice(0, firstVersionIndex).join("\n").replace(/\s*$/, "")
	const after = lines.slice(firstVersionIndex).join("\n").replace(/^\s*/, "")
	return `${before}\n\n${entryBlock.trimEnd()}\n\n${after}\n`
}

function changelogAlreadyHasVersion(existingText, version) {
	const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const re = new RegExp(`^##\\s+(?:\\[${escaped}\\]|${escaped})\\s*$`, "m")
	return re.test(existingText)
}

function applyChangelogUpdate(targetPath, entryBlock, version) {
	const existing = fs.readFileSync(targetPath, "utf8")
	if (changelogAlreadyHasVersion(existing, version)) {
		throw new Error(`Target changelog already contains version ${version}`)
	}
	const updated = insertAtTopOfChangelog(existing, entryBlock)
	fs.writeFileSync(targetPath, updated, "utf8")
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	if (args.help || args.h || !args.scope || !args["output-dir"]) {
		usage()
		process.exit(args.help || args.h ? 0 : 1)
	}

	const scope = String(args.scope)
	if (scope !== "vscode" && scope !== "cli") {
		throw new Error(`Invalid --scope: ${scope}`)
	}

	const outputDir = path.resolve(String(args["output-dir"]))
	ensureDir(outputDir)
	const apply = Boolean(args.apply)
	const targetFile = args["target-file"]
		? path.resolve(String(args["target-file"]))
		: path.resolve(scope === "cli" ? "cli/CHANGELOG.md" : "CHANGELOG.md")

	const prNumbersArg = args["pr-numbers"]
	const explicitPrNumbers = prNumbersArg
		? [
				...new Set(
					String(prNumbersArg)
						.split(/[\s,]+/)
						.map((s) => Number(s.trim()))
						.filter((n) => Number.isFinite(n) && n > 0),
				),
			].sort((a, b) => a - b)
		: []

	const usingGitRange = explicitPrNumbers.length === 0
	if (usingGitRange && (!args.from || !args.to)) {
		throw new Error("Provide --from/--to, or provide --pr-numbers to bypass git range discovery")
	}

	const fromRef = args.from ? resolveRef(String(args.from)) : null
	const toRef = args.to ? resolveRef(String(args.to)) : null
	let fromSha = null
	let toSha = null

	if (usingGitRange) {
		if (!gitAvailable()) {
			throw new Error("git metadata unavailable in this environment. Re-run with --pr-numbers and optional --version")
		}
		fromSha = verifyRefExists(fromRef)
		toSha = verifyRefExists(toRef)
	}

	const { owner, name } = fetchRepoOwnerName(args)

	const prNums = usingGitRange ? candidatePrNumbers(fromRef, toRef) : explicitPrNumbers
	const prs = fetchPrMetadata(owner, name, prNums, Number(args["batch-size"] || 80))

	const classification = prs.map((pr) => {
		const c = classifyScope(pr)
		const included = shouldInclude(scope, c.scope)
		return {
			number: pr.number,
			title: pr.title,
			url: pr.url,
			author: pr.author,
			labels: pr.labels,
			files: pr.files,
			hasMoreFiles: pr.hasMoreFiles,
			classifiedScope: c.scope,
			classificationReason: c.reason,
			status: included ? "included" : "excluded",
			exclusionReason: included ? null : c.reason,
		}
	})

	const included = classification.filter((p) => p.status === "included")

	const authorSet = [...new Set(included.map((p) => p.author).filter(Boolean))]
	const internalLookup = Object.fromEntries(authorSet.map((a) => [a, membershipIsInternal(a)]))

	for (const row of classification) {
		const a = row.author
		row.externalContributor = a ? internalLookup[a] === false : false
	}

	const earliestByAuthor = fetchEarliestPrByAuthor(owner, name, authorSet)
	const firstTime = included
		.filter((p) => p.author && earliestByAuthor[p.author] === p.number)
		.sort((a, b) => a.number - b.number)

	let version = args.version ? String(args.version) : undefined
	if (!version && toRef && looksLikeSemverTagOrVersion(toRef)) {
		version = toSemverNoV(toRef)
	}
	if (!version && gitAvailable()) {
		version = toSemverNoV(resolveLatestTag())
	}
	if (!version) {
		throw new Error("Unable to infer version. Provide --version explicitly.")
	}

	const targetExistingText = fs.readFileSync(targetFile, "utf8")
	const sectionHeading = detectSectionHeadingLevel(targetExistingText)
	const versionHeadingStyle = detectVersionHeadingStyle(targetExistingText)

	const grouped = { Added: [], Fixed: [], Changed: [] }
	for (const pr of included) {
		const section = sectionForTitle(pr.title)
		const thanks = pr.externalContributor && pr.author ? ` (Thanks @${pr.author}!)` : ""
		grouped[section].push(`- ${humanizeTitle(pr.title)}${thanks}`)
	}

	const hasChangelogContent =
		grouped.Added.length > 0 || grouped.Fixed.length > 0 || grouped.Changed.length > 0 || firstTime.length > 0

	const finalChangelog = hasChangelogContent
		? buildChangelogBlock({
				version,
				versionHeadingStyle,
				sectionHeading,
				grouped,
				firstTime,
			})
		: ""

	const prInventory = {
		scope,
		from: fromRef,
		to: toRef,
		fromSha,
		toSha,
		repository: `${owner}/${name}`,
		candidatePrNumbers: prNums,
		prs,
	}

	const scopeClassification = {
		scope,
		includedCount: included.length,
		excludedCount: classification.length - included.length,
		classification,
	}

	const candidateBullets = [
		"# Candidate Bullets",
		"",
		`Scope: ${scope}`,
		`Range: ${fromRef && toRef ? `${fromRef}..${toRef}` : "(from explicit PR numbers)"}`,
		"",
		"## Added",
		"",
		...(grouped.Added.length ? grouped.Added : ["(none)"]),
		"",
		"## Fixed",
		"",
		...(grouped.Fixed.length ? grouped.Fixed : ["(none)"]),
		"",
		"## Changed",
		"",
		...(grouped.Changed.length ? grouped.Changed : ["(none)"]),
		"",
	]

	writeJson(path.join(outputDir, "pr-inventory.json"), prInventory)
	writeJson(path.join(outputDir, "scope-classification.json"), scopeClassification)
	fs.writeFileSync(path.join(outputDir, "candidate-bullets.md"), candidateBullets.join("\n"), "utf8")
	fs.writeFileSync(
		path.join(outputDir, "final-changelog.md"),
		hasChangelogContent ? finalChangelog : "(no included changes for this scope/range)\n",
		"utf8",
	)

	if (apply && hasChangelogContent) {
		applyChangelogUpdate(targetFile, finalChangelog, version)
	}

	console.log(`Wrote: ${path.join(outputDir, "pr-inventory.json")}`)
	console.log(`Wrote: ${path.join(outputDir, "scope-classification.json")}`)
	console.log(`Wrote: ${path.join(outputDir, "candidate-bullets.md")}`)
	console.log(`Wrote: ${path.join(outputDir, "final-changelog.md")}`)
	if (apply && hasChangelogContent) {
		console.log(`Updated: ${targetFile}`)
	} else if (apply) {
		console.log(`Skipped update (no included changes): ${targetFile}`)
	}
	console.log("---")
	console.log(`scope=${scope} range=${fromRef}..${toRef} version=${version}`)
	console.log(`prs=${classification.length} included=${included.length} excluded=${classification.length - included.length}`)
}

try {
	main()
} catch (error) {
	console.error(`ERROR: ${error?.message || error}`)
	process.exit(1)
}
