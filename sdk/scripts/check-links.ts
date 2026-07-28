#!/usr/bin/env bun

/**
 * Link checker for the repo's Markdown/MDX documentation and the published site.
 *
 * Four classes of link are validated:
 *   1. Repo links  - https://github.com/cline/cline/{tree,blob}/main/<path>
 *                    resolved against the working tree (offline, no rate limits).
 *                    This catches the most common docs rot: a file moved and the
 *                    absolute GitHub URL kept pointing at the old path.
 *   2. Local links - relative paths and, inside docs/, root-absolute doc routes
 *                    (/sdk/overview) resolved against docs/ plus docs.json redirects.
 *   3. Site links  - cline.bot is crawled by default and every link on every page
 *                    reached is checked. The published site is where readers hit
 *                    404s, and it can rot without a commit touching this repo.
 *   4. External    - every other http(s) URL found in the docs (--external).
 *
 * Usage:
 *   bun sdk/scripts/check-links.ts                  # repo checks + crawl cline.bot
 *   bun sdk/scripts/check-links.ts --no-site        # repo checks only (hermetic, for CI gates)
 *   bun sdk/scripts/check-links.ts --site <url>     # crawl a different site instead
 *   bun sdk/scripts/check-links.ts --external       # also check external URLs in the docs
 *   bun sdk/scripts/check-links.ts --json out.json  # machine-readable report
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");

/** GitHub slugs that refer to this repository, so their URLs resolve locally. */
const SELF_REPOS = ["cline/cline"];
/** Only refs that match the checked-out tree can be verified offline. */
const SELF_REFS = ["main", "HEAD"];

const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	".next",
	".turbo",
	".changeset",
]);

/** Files whose URLs are test fixtures to be fetched, not links to follow. */
const SKIP_FILES = new Set([
	"apps/vscode/webview-ui/src/components/mcp/RICH_MCP_TESTING.md",
]);

/** Hosts that are never reachable from CI and are not worth checking. */
const SKIP_HOSTS = [
	"localhost",
	"127.0.0.1",
	"0.0.0.0",
	"example.com",
	"example.org",
	"your-domain.com",
];

/** Crawled unless --no-site or --site says otherwise. */
const DEFAULT_SITE = "https://cline.bot";
/** Ceiling on crawled pages, so a big site cannot run away with the job. */
const MAX_PAGES = 150;

/** Sent on every probe: several docs hosts serve 404 to non-browser agents. */
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Anything that is a template rather than a real URL. */
const PLACEHOLDER = /[{}<>$]|YOUR_|xxxxx|\.\.\./i;

type Link = {
	file: string;
	line: number;
	url: string;
};

type Failure = Link & {
	kind: "repo" | "local" | "external" | "site";
	status: string;
	hint?: string;
};

// ---------------------------------------------------------------- extraction

const MARKDOWN_LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_ATTR = /(?:href|src)\s*=\s*"([^"]+)"/g;
const BARE_URL = /(?<![("[<])\bhttps?:\/\/[^\s<>"')\]},;]+/g;

/** Blank out fenced code blocks and inline code so examples are not treated as links. */
function stripCode(text: string): string[] {
	let fenced = false;
	return text.split(/\r?\n/).map((line) => {
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
			return "";
		}
		return fenced ? "" : line.replace(/`[^`]*`/g, "");
	});
}

/**
 * HTML attributes carry plenty of values that are not links (`<img src="x">` in a
 * prose example, for one), so require attribute values to look path-like.
 */
function looksLikeLink(url: string): boolean {
	return (
		/^[a-z][a-z0-9+.-]*:/i.test(url) ||
		/^[./#]/.test(url) ||
		url.includes("/") ||
		/\.[a-z0-9]{1,5}$/i.test(url)
	);
}

function extractLinks(file: string, text: string): Link[] {
	const links: Link[] = [];
	stripCode(text).forEach((line, index) => {
		const seen = new Set<string>();
		for (const regex of [MARKDOWN_LINK, HTML_ATTR, BARE_URL]) {
			regex.lastIndex = 0;
			let match = regex.exec(line);
			while (match !== null) {
				// A bare URL at the end of a sentence swallows the punctuation.
				const raw = (match[1] ?? match[0]).trim();
				const url = regex === BARE_URL ? raw.replace(/[.,:!?]+$/, "") : raw;
				if (
					url &&
					!seen.has(url) &&
					(regex !== HTML_ATTR || looksLikeLink(url))
				) {
					seen.add(url);
					links.push({ file, line: index + 1, url });
				}
				match = regex.exec(line);
			}
		}
	});
	return links;
}

async function collectDocFiles(
	dir: string,
	found: string[] = [],
): Promise<string[]> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) {
				await collectDocFiles(join(dir, entry.name), found);
			}
		} else if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
			found.push(join(dir, entry.name));
		}
	}
	return found;
}

// ---------------------------------------------------------------- resolution

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve a documentation path the way the docs site does: an extensionless
 * route may be backed by `<path>.mdx`, `<path>.md`, or `<path>/index.mdx`.
 */
async function resolveDocPath(path: string): Promise<boolean> {
	const candidates = [
		path,
		`${path}.mdx`,
		`${path}.md`,
		join(path, "index.mdx"),
		join(path, "index.md"),
	];
	for (const candidate of candidates) {
		if (await exists(candidate)) {
			return true;
		}
	}
	return false;
}

function parseSelfRepoUrl(url: string): string | null {
	const match =
		/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/#?]+)\/(tree|blob)\/([^/#?]+)(?:\/([^#?]*))?/.exec(
			url,
		);
	if (!match) {
		return null;
	}
	const [, slug, , ref, path = ""] = match;
	if (!SELF_REPOS.includes(slug) || !SELF_REFS.includes(ref)) {
		return null;
	}
	return decodeURIComponent(path).replace(/\/$/, "");
}

/**
 * Submodule contents are absent unless the checkout was recursive, and GitHub
 * serves them from the other repo, so paths inside one are left alone.
 */
async function loadSubmodulePaths(): Promise<string[]> {
	try {
		const gitmodules = await readFile(join(repoRoot, ".gitmodules"), "utf8");
		return [...gitmodules.matchAll(/^\s*path\s*=\s*(.+)$/gm)].map((match) =>
			match[1].trim(),
		);
	} catch {
		return [];
	}
}

async function loadDocRedirects(): Promise<Set<string>> {
	const sources = new Set<string>();
	try {
		const config = JSON.parse(
			await readFile(join(repoRoot, "docs", "docs.json"), "utf8"),
		);
		for (const redirect of config.redirects ?? []) {
			if (typeof redirect?.source === "string") {
				sources.add(redirect.source.replace(/\/$/, ""));
			}
		}
	} catch {
		// No docs.json (or unreadable) - root-absolute doc routes stay unchecked.
	}
	return sources;
}

// ------------------------------------------------------------------ network

type Probe = { ok: boolean; status: string };

async function probe(url: string, attempt = 0): Promise<Probe> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	try {
		let response = await fetch(url, {
			method: "HEAD",
			redirect: "follow",
			signal: controller.signal,
			headers: { "user-agent": USER_AGENT },
		});
		// Plenty of hosts (the VS Code Marketplace among them) answer HEAD with a
		// 404 or a method error, so never call a link dead without trying GET.
		if (response.status >= 400) {
			response = await fetch(url, {
				method: "GET",
				redirect: "follow",
				signal: controller.signal,
				headers: { "user-agent": USER_AGENT },
			});
		}
		// Rate limiting and bot walls are not broken links - retry, then let them pass.
		if ((response.status === 429 || response.status >= 500) && attempt < 2) {
			clearTimeout(timer);
			await new Promise((done) => setTimeout(done, 1_000 * 2 ** attempt));
			return probe(url, attempt + 1);
		}
		return {
			ok:
				response.status < 400 ||
				response.status === 401 ||
				response.status === 403 ||
				response.status === 429,
			status: String(response.status),
		};
	} catch (error) {
		if (attempt < 2) {
			clearTimeout(timer);
			await new Promise((done) => setTimeout(done, 1_000 * 2 ** attempt));
			return probe(url, attempt + 1);
		}
		// Only a host that does not answer is a dead link. Timeouts, TLS quirks and
		// the sign-in redirect loops some sites serve to non-browsers are noise, and
		// a report full of noise is a report nobody reads.
		const code = (error as { cause?: { code?: string } })?.cause?.code ?? "";
		const dead =
			code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EAI_AGAIN";
		return { ok: !dead, status: dead ? code : "unverified" };
	} finally {
		clearTimeout(timer);
	}
}

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	const runners = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (cursor < items.length) {
				const index = cursor++;
				results[index] = await worker(items[index]);
			}
		},
	);
	await Promise.all(runners);
	return results;
}

// --------------------------------------------------------------------- main

function isCheckableExternal(url: string): boolean {
	if (!/^https?:\/\//.test(url) || PLACEHOLDER.test(url)) {
		return false;
	}
	try {
		return !SKIP_HOSTS.some(
			(host) =>
				new URL(url).hostname === host ||
				new URL(url).hostname.endsWith(".local"),
		);
	} catch {
		return false;
	}
}

function sameSite(url: string, host: string): boolean {
	try {
		return new URL(url).hostname.replace(/^www\./, "") === host;
	} catch {
		return false;
	}
}

async function fetchPage(url: string): Promise<string | null> {
	try {
		const response = await fetch(url, {
			redirect: "follow",
			headers: { "user-agent": USER_AGENT },
		});
		if (!response.ok) {
			return null;
		}
		if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
			return null;
		}
		return await response.text();
	} catch {
		return null;
	}
}

/**
 * Walk the site from `seed`, following same-host anchors, and return every link
 * found along the way. Crawling is sequential: this hits someone else's server,
 * and a link checker has no business hammering it.
 */
async function crawlSite(seed: string): Promise<Link[]> {
	const host = new URL(seed).hostname.replace(/^www\./, "");
	const queue = [seed];
	const queued = new Set(queue);
	const links: Link[] = [];
	let crawled = 0;
	let dropped = 0;

	while (queue.length > 0) {
		const pageUrl = queue.shift() as string;
		const html = await fetchPage(pageUrl);
		if (html === null) {
			if (pageUrl === seed) {
				console.warn(`Could not read ${seed}; skipping the site crawl.`);
			}
			continue;
		}
		crawled += 1;
		const seen = new Set<string>();
		// Anchors only: preconnect and analytics hrefs are not links a reader follows.
		for (const match of html.matchAll(/<a\b[^>]*?href\s*=\s*"([^"]+)"/gi)) {
			let absolute: string;
			try {
				absolute = new URL(match[1], pageUrl).toString().split("#")[0];
			} catch {
				continue;
			}
			if (!seen.has(absolute) && isCheckableExternal(absolute)) {
				seen.add(absolute);
				links.push({ file: pageUrl, line: 0, url: absolute });
			}
			if (!sameSite(absolute, host) || queued.has(absolute)) {
				continue;
			}
			if (queued.size >= MAX_PAGES) {
				dropped += 1;
				continue;
			}
			queued.add(absolute);
			queue.push(absolute);
		}
	}

	console.log(`Crawled ${crawled} page(s) on ${host}.`);
	if (dropped > 0) {
		// Never let a cap look like full coverage.
		console.warn(
			`Stopped at the ${MAX_PAGES}-page ceiling; ${dropped} more page(s) went unvisited.`,
		);
	}
	return links;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const checkExternal = args.includes("--external");
	const jsonPath = args.includes("--json")
		? args[args.indexOf("--json") + 1]
		: null;
	// The site is crawled by default; --site retargets it, --no-site opts out.
	const siteUrl = args.includes("--no-site")
		? null
		: args.includes("--site")
			? args[args.indexOf("--site") + 1]
			: DEFAULT_SITE;

	const files = (await collectDocFiles(repoRoot))
		.map((file) => relative(repoRoot, file).replaceAll("\\", "/"))
		.filter((file) => !SKIP_FILES.has(file));
	const links: Link[] = [];
	for (const file of files) {
		links.push(
			...extractLinks(file, await readFile(join(repoRoot, file), "utf8")),
		);
	}

	const redirects = await loadDocRedirects();
	const submodules = await loadSubmodulePaths();
	const inSubmodule = (path: string) =>
		submodules.some((sub) => path === sub || path.startsWith(`${sub}/`));
	const failures: Failure[] = [];
	const external: Link[] = [];

	for (const link of links) {
		const url = link.url;
		const target = url.split("#")[0].split("?")[0];

		const repoPath = parseSelfRepoUrl(url);
		if (repoPath !== null) {
			if (
				repoPath !== "" &&
				!inSubmodule(repoPath) &&
				!(await exists(join(repoRoot, repoPath)))
			) {
				failures.push({
					...link,
					kind: "repo",
					status: "404",
					hint: `no such path in the repo: ${repoPath}`,
				});
			}
			continue;
		}

		if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
			if (checkExternal && isCheckableExternal(url)) {
				external.push(link);
			}
			continue;
		}

		if (target === "" || url.startsWith("#")) {
			continue;
		}

		if (target.startsWith("/")) {
			// Root-absolute links are doc-site routes; only docs/ pages own them.
			if (
				!link.file.startsWith("docs/") ||
				redirects.has(target.replace(/\/$/, ""))
			) {
				continue;
			}
			if (!(await resolveDocPath(join(repoRoot, "docs", target)))) {
				failures.push({
					...link,
					kind: "local",
					status: "missing",
					hint: `no docs page for route ${target}`,
				});
			}
			continue;
		}

		const resolved = resolve(
			repoRoot,
			dirname(link.file),
			decodeURIComponent(target),
		);
		if (inSubmodule(relative(repoRoot, resolved).replaceAll("\\", "/"))) {
			continue;
		}
		if (!(await resolveDocPath(resolved))) {
			failures.push({
				...link,
				kind: "local",
				status: "missing",
				hint: `no file at ${relative(repoRoot, resolved).replaceAll("\\", "/")}`,
			});
		}
	}

	if (siteUrl) {
		console.log(`Crawling ${siteUrl}...`);
		external.push(...(await crawlSite(siteUrl)));
	}

	if (external.length > 0) {
		const unique = [...new Set(external.map((link) => link.url))];
		console.log(`Checking ${unique.length} URLs over HTTP...`);
		const probes = await mapWithConcurrency(
			unique,
			8,
			async (url) => [url, await probe(url)] as const,
		);
		const byUrl = new Map(probes);
		for (const link of external) {
			const result = byUrl.get(link.url);
			if (result && !result.ok) {
				failures.push({
					...link,
					kind: link.file.startsWith("http") ? "site" : "external",
					status: result.status,
				});
			}
		}
	}

	const checked = links.length + external.length;
	if (jsonPath) {
		await writeFile(jsonPath, JSON.stringify({ checked, failures }, null, 2));
	}

	const inSite = failures.filter((failure) => failure.kind === "site").length;
	const inRepo = failures.length - inSite;
	if (failures.length === 0) {
		console.log(
			`All good: ${checked} links checked across ${files.length} files${siteUrl ? ` and ${siteUrl}` : ""}, no broken links.`,
		);
		return;
	}

	// Repo and site failures are acted on differently, so never blur the two.
	console.error(
		`\n${failures.length} broken link(s): ${inRepo} in the repo, ${inSite} on the crawled site.\n`,
	);
	for (const failure of failures.sort(
		(a, b) => a.file.localeCompare(b.file) || a.line - b.line,
	)) {
		const where =
			failure.line > 0 ? `${failure.file}:${failure.line}` : failure.file;
		console.error(`  [${failure.status}] ${failure.url}`);
		console.error(
			`         ${where}${failure.hint ? ` - ${failure.hint}` : ""}`,
		);
	}
	console.error("");
	process.exit(1);
}

await main();
