import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { BUNDLE_INPUTS } from "./bundle-inputs";

export interface NoticeEntry {
	name: string;
	version: string;
	license: string;
	repository?: string;
	texts: { file: string; content: string }[];
}

export interface GenerateNoticesOptions {
	product: string;
	inputs: string[];
	baseDir: string;
	inputLists?: Record<string, string>;
	allowMissingInputLists?: boolean;
	extraPackageDirs?: string[];
	packageEntries?: NoticeEntry[];
	extraEntries?: NoticeEntry[];
	outFile: string;
}

export const PLUGIN_RUNTIME_INPUTS = resolve(
	import.meta.dirname,
	"../../sdk/packages/core/dist/plugin-runtime-inputs.json",
);

const LOG_PREFIX = "[third-party-notices]";

// Bundles built in a separate step record what they bundled; see vite.ts and build-plugin-runtime.mts.
function readInputList(
	label: string,
	file: string,
	allowMissing: boolean,
): string[] {
	if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
	const message = `${LOG_PREFIX} ${label} input list not found at ${file}; build ${label} first`;
	if (!allowMissing) throw new Error(message);
	console.warn(`${message} (notices will omit it)`);
	return [];
}

export const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;
export const NON_TEXT_EXT = /\.(js|cjs|mjs|ts|json|d\.ts|map|html)$/i;
const RULE = "=".repeat(80);
const THIN_RULE = "-".repeat(80);

// The package root is the directory right after the last node_modules segment; nested
// manifests (dist/esm/package.json, posthog-js/react/package.json) are not packages.
function findPackageDir(file: string): string | undefined {
	const marker = `${sep}node_modules${sep}`;
	const at = file.lastIndexOf(marker);
	if (at === -1) return undefined;
	const segments = file.slice(at + marker.length).split(sep);
	const depth = segments[0].startsWith("@") ? 2 : 1;
	const dir = join(
		file.slice(0, at + marker.length),
		...segments.slice(0, depth),
	);
	return existsSync(join(dir, "package.json")) ? dir : undefined;
}

function licenseOf(pkg: Record<string, unknown>): string {
	const { license, licenses } = pkg as {
		license?: string | { type?: string };
		licenses?: { type?: string }[] | { type?: string };
	};
	if (typeof license === "string") return license;
	if (license?.type) return license.type;
	const list = Array.isArray(licenses) ? licenses : licenses ? [licenses] : [];
	const types = list.map((l) => l.type).filter(Boolean);
	return types.length ? types.join(" OR ") : "";
}

function repositoryOf(pkg: Record<string, unknown>): string | undefined {
	const repo = pkg.repository as string | { url?: string } | undefined;
	const url = typeof repo === "string" ? repo : repo?.url;
	return url?.replace(/^git\+/, "").replace(/\.git$/, "");
}

function authorOf(pkg: Record<string, unknown>): string | undefined {
	const author = pkg.author as string | { name?: string } | undefined;
	const name = typeof author === "string" ? author : author?.name;
	return name?.replace(/\s*[<(].*$/, "").trim() || undefined;
}

const TEMPLATE_IDS: Record<string, string> = {
	MIT: "MIT",
	"MIT/X11": "MIT",
	ISC: "ISC",
	"Apache-2.0": "Apache-2.0",
	"BSD-2-Clause": "BSD-2-Clause",
	"BSD-3-Clause": "BSD-3-Clause",
	"MPL-2.0": "MPL-2.0",
	Zlib: "Zlib",
};

// Components that omit their license file still owe the license text and copyright notice.
export function fallbackLicenseTexts(
	license: string,
	copyrightHolder: string,
): NoticeEntry["texts"] {
	const ids = license
		.replace(/[()]/g, "")
		.split(/\s+(?:AND|OR)\s+/)
		.map((id) => TEMPLATE_IDS[id])
		.filter(Boolean);
	return [...new Set(ids)].map((id) => ({
		file: `${id} (standard text; the component ships no license file)`,
		content: standardLicenseText(id, copyrightHolder),
	}));
}

export function standardLicenseText(
	id: string,
	copyrightHolder: string,
): string {
	return readFileSync(
		join(import.meta.dirname, "licenses", `${id}.txt`),
		"utf8",
	)
		.replace("{{copyright}}", `Copyright (c) ${copyrightHolder}`)
		.trim();
}

const LICENSE_SIGNATURES: [RegExp, string][] = [
	[/Permission is hereby granted, free of charge/, "MIT"],
	[/Permission to use, copy, modify, and\/or distribute this software/, "ISC"],
	[
		/free and unencumbered software released into the public domain/,
		"Unlicense",
	],
	[/Apache License\s+Version 2\.0/, "Apache-2.0"],
];

function detectLicense(texts: { content: string }[]): string {
	const text = texts.map((t) => t.content).join("\n");
	return LICENSE_SIGNATURES.find(([pattern]) => pattern.test(text))?.[1] ?? "";
}

// Package metadata and symlinks are untrusted: only read regular files that resolve inside
// the package, so a dependency cannot pull build-machine files into the shipped notices.
function isPackageFile(packageRoot: string, file: string): boolean {
	const path = join(packageRoot, file);
	if (!existsSync(path)) return false;
	const rel = relative(packageRoot, realpathSync(path));
	return (
		rel !== "" &&
		!rel.startsWith(`..${sep}`) &&
		rel !== ".." &&
		!isAbsolute(rel) &&
		statSync(path).isFile()
	);
}

// Reads a component's license files, plus one its metadata points to (npm "SEE LICENSE IN",
// Cargo license-file), from inside its root directory.
export function readLicenseTexts(
	root: string,
	referenced?: string,
): NoticeEntry["texts"] {
	const realRoot = realpathSync(root);
	const files = readdirSync(realRoot)
		.filter((f) => LICENSE_FILE.test(f) && !NON_TEXT_EXT.test(f))
		.concat(referenced ? [referenced] : [])
		.filter((f) => isPackageFile(realRoot, f));
	return [...new Set(files)].sort().map((file) => ({
		file,
		content: readFileSync(join(realRoot, file), "utf8").trim(),
	}));
}

export function readPackageEntry(packageDir: string): NoticeEntry {
	const pkg = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf8"),
	);
	const license = licenseOf(pkg);
	const texts = readLicenseTexts(
		packageDir,
		/^SEE LICENSE IN (\S+)/i.exec(license)?.[1],
	);
	return {
		name: pkg.name,
		version: pkg.version,
		license: license || detectLicense(texts),
		repository: repositoryOf(pkg),
		texts: texts.length
			? texts
			: fallbackLicenseTexts(
					license,
					authorOf(pkg) ?? `the ${pkg.name} authors`,
				),
	};
}

// Source maps chain to a package's original sources (src/*.tsx), which its published files
// may not include; resolve symlinks through the part of the path that exists.
function realpathOfExisting(file: string): string {
	const parent = dirname(file);
	if (existsSync(file) || parent === file) return realpathSync(file);
	return join(realpathOfExisting(parent), basename(file));
}

// Workspace packages whose dist bundles third-party code record what it bundled; see bundle-inputs.ts.
function workspaceBundleList(file: string): string | undefined {
	for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
		if (!existsSync(join(dir, "package.json"))) continue;
		const list = join(dir, "dist", BUNDLE_INPUTS);
		const inDist = !relative(join(dir, "dist"), file).startsWith("..");
		return inDist && existsSync(list) ? list : undefined;
	}
	return undefined;
}

// Bundlers compile CSS @import/@plugin targets themselves, so they never appear as modules.
function cssImports(file: string): string[] {
	const css = readFileSync(file, "utf8");
	const specifiers = [
		...css.matchAll(/^\s*@(?:import|plugin)\s+(?:url\(\s*)?["']([^"']+)["']/gm),
	].map((m) => m[1]);
	return specifiers.flatMap((specifier) => {
		if (/^[./]/.test(specifier)) return [resolve(dirname(file), specifier)];
		if (/^[a-z]+:/i.test(specifier)) return [];
		const name = specifier
			.split("/")
			.slice(0, specifier.startsWith("@") ? 2 : 1)
			.join("/");
		for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
			const pkg = join(dir, "node_modules", name, "package.json");
			if (existsSync(pkg)) return [pkg];
		}
		return [];
	});
}

export function collectPackageEntries(
	inputs: string[],
	baseDir: string,
): NoticeEntry[] {
	const dirs = new Set<string>();
	const seen = new Set<string>();
	const queue = [...inputs];
	while (queue.length > 0) {
		const input = queue.pop() as string;
		// Bundlers report virtual modules ("\0commonjsHelpers", "<runtime>") alongside real files.
		if (input.startsWith("\0") || input.startsWith("<")) continue;
		const path = input.split("?")[0];
		const file = realpathOfExisting(
			isAbsolute(path) ? path : resolve(baseDir, path),
		);
		if (seen.has(file)) continue;
		seen.add(file);
		const dir = findPackageDir(file);
		const list = dir ? undefined : workspaceBundleList(file);
		if (dir) dirs.add(dir);
		else if (list && !seen.has(list)) {
			seen.add(list);
			queue.push(...JSON.parse(readFileSync(list, "utf8")));
		}
		if (file.endsWith(".css") && existsSync(file))
			queue.push(...cssImports(file));
	}
	return [...dirs].map(readPackageEntry);
}

const OPEN_SOURCE_IDS = new Set(
	[
		"0BSD",
		"Apache-2.0",
		"BlueOak-1.0.0",
		"BSD-2-Clause",
		"BSD-3-Clause",
		"CC-BY-4.0",
		"CC0-1.0",
		"ISC",
		"MIT",
		"MIT/X11",
		"MIT-0",
		"MPL-2.0",
		"OFL-1.1",
		"Python-2.0",
		"Unicode-3.0",
		"Unlicense",
		"WTFPL",
		"Zlib",
	].map((id) => id.toLowerCase()),
);

function isOpenSource(license: string): boolean {
	// SPDX identifiers are case-insensitive ("apache-2.0" is Apache-2.0).
	const ids = license
		.toLowerCase()
		.replace(/[()]/g, "")
		.split(/\s+(?:and|or)\s+/);
	// An OR expression is satisfied by any permissive choice; AND needs all of them.
	return / or /i.test(license) && !/ and /i.test(license)
		? ids.some((id) => OPEN_SOURCE_IDS.has(id))
		: ids.every((id) => OPEN_SOURCE_IDS.has(id));
}

export function findProblems(entries: NoticeEntry[]): string[] {
	return entries.flatMap((e) => {
		const id = `${e.name}@${e.version}`;
		if (e.texts.length === 0)
			return [`${id}: no license text found (declared: "${e.license}")`];
		if (!isOpenSource(e.license))
			return [`${id}: license "${e.license}" needs review`];
		return [];
	});
}

export function renderNotices(product: string, entries: NoticeEntry[]): string {
	const header = [
		`THIRD-PARTY SOFTWARE NOTICES AND INFORMATION`,
		``,
		`${product} incorporates the third-party components listed below. Each`,
		`component is licensed to you under the terms reproduced with it; those`,
		`terms are not modified by the license that applies to ${product} itself.`,
		``,
	];
	const sections = entries.map((e) => {
		const lines = [
			RULE,
			`${e.name} ${e.version}`,
			`License: ${e.license || "see license text below"}`,
		];
		if (e.repository) lines.push(`Source: ${e.repository}`);
		lines.push(THIN_RULE);
		for (const t of e.texts) lines.push("", t.content, "");
		return lines.join("\n");
	});
	return `${[...header, ...sections].join("\n")}\n`;
}

function dedupe(entries: NoticeEntry[]): NoticeEntry[] {
	const byId = new Map(entries.map((e) => [`${e.name}@${e.version}`, e]));
	return [...byId.values()].sort(
		(a, b) =>
			a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
	);
}

export function generateNotices(options: GenerateNoticesOptions): {
	entries: NoticeEntry[];
	problems: string[];
} {
	const inputs = [
		...options.inputs,
		...Object.entries(options.inputLists ?? {}).flatMap(([label, file]) =>
			readInputList(label, file, options.allowMissingInputLists ?? false),
		),
	];
	const packages = dedupe([
		...collectPackageEntries(inputs, options.baseDir),
		...(options.extraPackageDirs ?? []).map(readPackageEntry),
		...(options.packageEntries ?? []),
	]);
	const entries = [...(options.extraEntries ?? []), ...packages];
	mkdirSync(dirname(options.outFile), { recursive: true });
	writeFileSync(options.outFile, renderNotices(options.product, entries));
	const problems = findProblems(packages);
	console.log(
		`${LOG_PREFIX} wrote notices for ${entries.length} components to ${options.outFile}`,
	);
	for (const problem of problems) console.warn(`${LOG_PREFIX} ${problem}`);
	return { entries, problems };
}
