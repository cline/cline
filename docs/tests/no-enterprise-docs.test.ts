// Regression guard: Cline does not offer an enterprise product, so the docs
// must not advertise one. This fails if the removed "Enterprise Solutions"
// section (docs.cline.bot/enterprise-solutions/*), its nav tab, links,
// headers, cards, or sales CTAs are reintroduced.
//
// Generic uses of the word "enterprise" that describe the *reader's* own
// environment (e.g. "your enterprise's AWS SSO" in the Bedrock guides) are
// allowed; only references to a Cline enterprise offering are banned.
//
// Run: bun test docs/tests

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DOCS_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(DOCS_ROOT, "..");

type Page = string | { group: string; pages: Page[] };
type Tab = {
	tab: string;
	groups?: { group: string; pages: Page[] }[];
	pages?: Page[];
};
type DocsJson = {
	navigation: { tabs: Tab[] };
	redirects?: { source: string; destination: string }[];
	navbar?: {
		links?: { label: string; href: string }[];
		primary?: { label: string; href: string };
	};
	anchors?: { name: string; url: string }[];
};

const docsJson: DocsJson = JSON.parse(
	readFileSync(join(DOCS_ROOT, "docs.json"), "utf8"),
);

function walkContent(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name.startsWith(".")) continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...walkContent(full));
		else if (/\.mdx?$/.test(name)) out.push(full);
	}
	return out;
}

const contentFiles = walkContent(DOCS_ROOT);

function navEntries(): { tabs: string[]; groups: string[]; pages: string[] } {
	const tabs: string[] = [];
	const groups: string[] = [];
	const pages: string[] = [];
	const visit = (list: Page[] = []) => {
		for (const p of list) {
			if (typeof p === "string") pages.push(p);
			else {
				groups.push(p.group);
				visit(p.pages);
			}
		}
	};
	for (const tab of docsJson.navigation.tabs) {
		tabs.push(tab.tab);
		for (const g of tab.groups ?? []) {
			groups.push(g.group);
			visit(g.pages);
		}
		visit(tab.pages);
	}
	return { tabs, groups, pages };
}

// Patterns that indicate a Cline enterprise *offering* (not generic usage).
const BANNED_CONTENT_PATTERNS: [RegExp, string][] = [
	[
		/enterprise-solutions/i,
		"link/path to the removed enterprise-solutions section",
	],
	[/cline\.bot\/enterprise/i, "link to the Cline enterprise marketing page"],
	[/cline\.bot\/contact-sales/i, "enterprise sales CTA"],
	[/^#{1,6}\s.*\benterprise\b/im, "markdown header mentioning Enterprise"],
	[/<Card[^>]*title=["'][^"']*enterprise/i, "Card titled Enterprise"],
	[/\bCline(?:'s)? enterprise\b/i, "reference to a Cline enterprise product"],
	[
		/\benterprise[- ](?:plan|tier|solutions?|edition|features?|customers?|support|configuration|monitoring)\b/i,
		"enterprise product wording",
	],
	[/\|\s*Enterprise\s*\|/, "table cell labelled Enterprise"],
];

describe("docs: no enterprise product", () => {
	test("enterprise-solutions directory does not exist", () => {
		expect(existsSync(join(DOCS_ROOT, "enterprise-solutions"))).toBe(false);
	});

	test("navigation has no Enterprise tab, group, or page", () => {
		const { tabs, groups, pages } = navEntries();
		expect(tabs.filter((t) => /enterprise/i.test(t))).toEqual([]);
		expect(groups.filter((g) => /enterprise/i.test(g))).toEqual([]);
		expect(pages.filter((p) => /enterprise/i.test(p))).toEqual([]);
	});

	test("navbar and anchors have no enterprise links", () => {
		const links = [
			...(docsJson.navbar?.links ?? []).map((l) => `${l.label} ${l.href}`),
			docsJson.navbar?.primary
				? `${docsJson.navbar.primary.label} ${docsJson.navbar.primary.href}`
				: "",
			...(docsJson.anchors ?? []).map((a) => `${a.name} ${a.url}`),
		];
		expect(links.filter((l) => /enterprise|contact-sales/i.test(l))).toEqual(
			[],
		);
	});

	test("no redirect points into the removed enterprise section", () => {
		const bad = (docsJson.redirects ?? []).filter((r) =>
			/enterprise/i.test(r.destination),
		);
		expect(bad).toEqual([]);
	});

	test("old enterprise URLs (incl. /enterprise-solutions/overview) redirect instead of 404ing", () => {
		const catchAll = (docsJson.redirects ?? []).find(
			(r) => r.source === "/enterprise-solutions/:slug*",
		);
		expect(catchAll?.destination).toBe("/cline-overview");
	});

	test("no docs page references the enterprise offering", () => {
		const violations: string[] = [];
		for (const file of contentFiles) {
			const text = readFileSync(file, "utf8");
			for (const [re, why] of BANNED_CONTENT_PATTERNS) {
				const m = text.match(re);
				if (m)
					violations.push(
						`${relative(DOCS_ROOT, file)}: ${why} -> "${m[0].trim()}"`,
					);
			}
		}
		expect(violations).toEqual([]);
	});

	test("VS Code marketplace README has no Enterprise section or sales links", () => {
		const readme = readFileSync(
			join(REPO_ROOT, "apps/vscode/README.marketplace.md"),
			"utf8",
		);
		expect(readme).not.toMatch(/^#{1,6}\s.*enterprise/im);
		expect(readme).not.toMatch(/cline\.bot\/(enterprise|contact-sales)/i);
	});
});

describe("docs: navigation integrity after removal", () => {
	test("every page in docs.json navigation exists", () => {
		const missing = navEntries().pages.filter(
			(p) =>
				!/^https?:/.test(p) &&
				!existsSync(join(DOCS_ROOT, `${p}.mdx`)) &&
				!existsSync(join(DOCS_ROOT, `${p}.md`)),
		);
		expect(missing).toEqual([]);
	});

	test("no internal link points at a removed page", () => {
		const known = new Set(
			contentFiles.map(
				(f) => `/${relative(DOCS_ROOT, f).replace(/\.mdx?$/, "")}`,
			),
		);
		const redirectSources = (docsJson.redirects ?? []).map((r) => r.source);
		const matchesRedirect = (path: string) =>
			redirectSources.some((src) => {
				if (src === path) return true;
				const wildcard = src.indexOf("/:");
				return wildcard !== -1 && path.startsWith(src.slice(0, wildcard + 1));
			});

		const broken: string[] = [];
		const linkRe = /(?:href=["']|\]\()(\/[a-zA-Z0-9][^"')#?\s]*)/g;
		for (const file of contentFiles) {
			const text = readFileSync(file, "utf8");
			for (const m of text.matchAll(linkRe)) {
				const path = m[1].replace(/\/$/, "");
				if (path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(path)) continue;
				if (!known.has(path) && !matchesRedirect(path))
					broken.push(`${relative(DOCS_ROOT, file)} -> ${path}`);
			}
		}
		expect(broken).toEqual([]);
	});
});
