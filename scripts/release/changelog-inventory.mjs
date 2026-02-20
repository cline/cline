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
    [--pr-numbers <comma-separated>] [--apply] [--target-file <path>] \\
    [--allow-incomplete-classification]

Writes artifacts:
  - pr-inventory.json
  - scope-classification.json
  - candidate-bullets.md
  - final-changelog.md

With --apply:
  - inserts the generated changelog section into the target changelog file
  - leaves changes uncommitted for human review

Notes:
  - if --to is not semver-like (for example "main"), --version is required
  - incomplete PR file lists fail classification unless --allow-incomplete-classification is set
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

function parseJson(text, fallback = null) {
	try {
		return JSON.parse(text)
	} catch {
		return fallback
	}
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
	t = t.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, "")
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
		v.startsWith(".clinerules/workflows/")
	)
}

function classifyScope(pr) {
	if (pr.filesIncomplete) {
		return { scope: "unknown", reason: "incomplete-file-list" }
	}

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
	if (classifiedScope === "unknown") return false
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
	if (!res.ok && !res.stdout?.trim()) {
		throw new Error(`gh api graphql failed: ${res.stderr || res.stdout}`)
	}
	const parsed = parseJson(res.stdout)
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

function firstParentCommits(fromRef, toRef) {
	const logRes = runGit(["log", "--first-parent", "--pretty=%H%x09%s", `${fromRef}..${toRef}`])
	if (!logRes.ok) {
		throw new Error(`git log failed: ${logRes.stderr || logRes.stdout}`)
	}
	return logRes.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [sha, ...rest] = line.split("\t")
			return { sha, subject: rest.join("\t") }
		})
}

function fetchAssociatedPrNumbersForCommits(owner, name, commitShas) {
	const numbers = new Set()
	let errors = 0

	for (const sha of commitShas) {
		const res = runGh(["api", "-H", "Accept: application/vnd.github+json", `repos/${owner}/${name}/commits/${sha}/pulls`])
		if (!res.ok) {
			errors++
			continue
		}
		const arr = parseJson(res.stdout, [])
		if (!Array.isArray(arr)) continue
		for (const pr of arr) {
			if (typeof pr?.number === "number") {
				numbers.add(pr.number)
			}
		}
	}

	return { numbers: [...numbers].sort((a, b) => a - b), errors }
}

function discoverPrNumbers(owner, name, fromRef, toRef) {
	const commits = firstParentCommits(fromRef, toRef)
	const bySubject = new Set()
	for (const c of commits) {
		for (const m of c.subject.matchAll(/#(\d+)/g)) {
			bySubject.add(Number(m[1]))
		}
	}

	const associated = fetchAssociatedPrNumbersForCommits(
		owner,
		name,
		commits.map((c) => c.sha),
	)

	const merged = new Set([...bySubject, ...associated.numbers])
	return {
		prNumbers: [...merged].sort((a, b) => a - b),
		discovery: {
			firstParentCommitCount: commits.length,
			fromSubjectCount: bySubject.size,
			fromAssociatedCommitCount: associated.numbers.length,
			associatedLookupErrors: associated.errors,
		},
	}
}

function fetchAllPrFiles(owner, name, prNumber, initialNodes, initialPageInfo) {
	const files = [...(initialNodes ?? []).map((n) => n.path).filter(Boolean)]
	let hasNextPage = Boolean(initialPageInfo?.hasNextPage)
	let endCursor = initialPageInfo?.endCursor ?? null

	while (hasNextPage && endCursor) {
		const query = `query { repository(owner: ${graphqlString(owner)}, name: ${graphqlString(name)}) { pr: pullRequest(number: ${prNumber}) { files(first: 100, after: ${graphqlString(endCursor)}) { nodes { path } pageInfo { hasNextPage endCursor } } } } }`
		const parsed = fetchGraphql(query)
		const page = parsed?.data?.repository?.pr?.files
		const nodes = page?.nodes ?? []
		for (const node of nodes) {
			if (node?.path) files.push(node.path)
		}
		hasNextPage = Boolean(page?.pageInfo?.hasNextPage)
		endCursor = page?.pageInfo?.endCursor ?? null
	}

	return files
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

			const initialNodes = value.files?.nodes ?? []
			const initialPageInfo = value.files?.pageInfo
			let files = []
			let filesIncomplete = false

			try {
				files = fetchAllPrFiles(owner, name, value.number, initialNodes, initialPageInfo)
			} catch {
				files = initialNodes.map((n) => n.path)
				filesIncomplete = true
			}

			if (initialPageInfo?.hasNextPage && files.length === initialNodes.length) {
				filesIncomplete = true
			}

			out.push({
				number: value.number,
				title: normalizeTitle(value.title),
				url: value.url,
				mergedAt: value.mergedAt,
				author: value.author?.login ?? null,
				labels: (value.labels?.nodes ?? []).map((n) => n.name),
				files,
				hasMoreFiles: Boolean(initialPageInfo?.hasNextPage),
				filesIncomplete,
			})
		}
	}

	return out.sort((a, b) => a.number - b.number)
}

function fetchOrgMembers(org) {
	const logins = new Set()
	let page = 1

	while (true) {
		const res = runGh(["api", `orgs/${org}/members?per_page=100&page=${page}`])
		if (!res.ok) {
			throw new Error(`Failed to fetch org members page ${page}: ${res.stderr || res.stdout}`)
		}
		const arr = parseJson(res.stdout, [])
		if (!Array.isArray(arr) || arr.length === 0) {
			break
		}
		for (const user of arr) {
			if (user?.login) logins.add(user.login)
		}
		if (arr.length < 100) break
		page++
	}

	return logins
}

function fetchMembershipStatusForAuthors(authors, org = "cline") {
	const byAuthor = Object.fromEntries(authors.map((a) => [a, "unknown"]))

	if (!authors.length) {
		return { byAuthor, confidence: "not-needed", error: null }
	}

	try {
		const members = fetchOrgMembers(org)
		for (const author of authors) {
			byAuthor[author] = members.has(author) ? "internal" : "external"
		}
		return { byAuthor, confidence: "complete", error: null }
	} catch (error) {
		return { byAuthor, confidence: "unknown", error: error?.message || String(error) }
	}
}

function aliasForAuthor(author, index) {
	const safe = String(author)
		.replace(/[^A-Za-z0-9_]/g, "_")
		.replace(/^([^A-Za-z_])/, "_$1")
	return `a${index}_${safe}`
}

function fetchEarliestPrByAuthor(owner, name, authors, batchSize = 40) {
	const map = {}
	const failedAuthors = []

	for (let i = 0; i < authors.length; i += batchSize) {
		const batch = authors.slice(i, i + batchSize)
		const aliasToAuthor = {}
		const fields = batch
			.map((author, idx) => {
				const alias = aliasForAuthor(author, i + idx)
				aliasToAuthor[alias] = author
				const q = `repo:${owner}/${name} is:pr is:merged author:${author} sort:created-asc`
				return `${alias}: search(query: ${graphqlString(q)}, type: ISSUE, first: 1) { nodes { ... on PullRequest { number author { login } } } }`
			})
			.join(" ")

		const query = `query { ${fields} }`
		try {
			const parsed = fetchGraphql(query)
			const data = parsed?.data ?? {}
			for (const [alias, author] of Object.entries(aliasToAuthor)) {
				const node = data?.[alias]?.nodes?.[0]
				if (node?.author?.login && typeof node.number === "number") {
					map[node.author.login] = node.number
				} else {
					failedAuthors.push(author)
				}
			}
		} catch {
			failedAuthors.push(...batch)
		}
	}

	return { map, failedAuthors: [...new Set(failedAuthors)] }
}

function detectSectionHeadingLevel(changelogText) {
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
	const allowIncompleteClassification = Boolean(args["allow-incomplete-classification"])
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

	const discoveryResult = usingGitRange ? discoverPrNumbers(owner, name, fromRef, toRef) : null
	const prNums = usingGitRange ? discoveryResult.prNumbers : explicitPrNumbers
	const prs = fetchPrMetadata(owner, name, prNums, Number(args["batch-size"] || 80))

	const classification = prs.map((pr) => {
		const c = classifyScope(pr)
		const included = shouldInclude(scope, c.scope)
		const status = c.scope === "unknown" ? "unclassified" : included ? "included" : "excluded"
		return {
			number: pr.number,
			title: pr.title,
			url: pr.url,
			author: pr.author,
			labels: pr.labels,
			files: pr.files,
			hasMoreFiles: pr.hasMoreFiles,
			filesIncomplete: Boolean(pr.filesIncomplete),
			classifiedScope: c.scope,
			classificationReason: c.reason,
			status,
			exclusionReason: status === "included" ? null : c.reason,
		}
	})

	const unclassified = classification.filter((p) => p.status === "unclassified")
	if (unclassified.length && !allowIncompleteClassification) {
		throw new Error(
			`Unclassified PRs due to incomplete file data: ${unclassified.map((p) => `#${p.number}`).join(", ")}. Re-run with --allow-incomplete-classification to proceed best-effort.`,
		)
	}

	const included = classification.filter((p) => p.status === "included")

	const authorSet = [...new Set(included.map((p) => p.author).filter(Boolean))]
	const membership = fetchMembershipStatusForAuthors(authorSet, "cline")

	for (const row of classification) {
		const login = row.author
		const membershipStatus = login ? (membership.byAuthor[login] ?? "unknown") : "unknown"
		row.membershipStatus = membershipStatus
		row.externalContributor = membershipStatus === "external"
	}

	const earliestByAuthorResult = fetchEarliestPrByAuthor(owner, name, authorSet)
	const earliestByAuthor = earliestByAuthorResult.map
	const firstTime = included
		.filter((p) => p.author && earliestByAuthor[p.author] === p.number)
		.sort((a, b) => a.number - b.number)

	let version = args.version ? String(args.version) : undefined
	if (!version && toRef && looksLikeSemverTagOrVersion(toRef)) {
		version = toSemverNoV(toRef)
	}
	if (!version && toRef && !looksLikeSemverTagOrVersion(toRef)) {
		throw new Error("Unable to infer version from --to. Provide --version explicitly when --to is not semver-like.")
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
		const thanks = pr.membershipStatus === "external" && pr.author ? ` (Thanks @${pr.author}!)` : ""
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
		prNumberDiscovery: discoveryResult?.discovery ?? { mode: "explicit-pr-numbers" },
		prs,
	}

	const scopeClassification = {
		scope,
		includedCount: included.length,
		excludedCount: classification.filter((p) => p.status === "excluded").length,
		unclassifiedCount: unclassified.length,
		classificationComplete: unclassified.length === 0,
		allowIncompleteClassification,
		attributionConfidence: {
			membershipLookup: membership.confidence,
			membershipLookupError: membership.error,
			earliestPrLookupFailedAuthors: earliestByAuthorResult.failedAuthors,
		},
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
	console.log(
		`prs=${classification.length} included=${included.length} excluded=${classification.filter((p) => p.status === "excluded").length} unclassified=${unclassified.length}`,
	)
}

try {
	main()
} catch (error) {
	console.error(`ERROR: ${error?.message || error}`)
	process.exit(1)
}
