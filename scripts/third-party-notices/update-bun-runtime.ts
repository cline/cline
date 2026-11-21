#!/usr/bin/env bun
// Refreshes bun-runtime/notices.json: the license texts for everything Bun statically links or
// embeds, pinned to what the current Bun release builds with. Run it after changing the repo's
// Bun version (needs an authenticated `gh`):
//
//   bun scripts/third-party-notices/update-bun-runtime.ts

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
	LICENSE_FILE,
	NON_TEXT_EXT,
	type NoticeEntry,
	readPackageEntry,
	standardLicenseText,
} from "./index";

const BUN_REPO = "oven-sh/bun";
const tag = `bun-v${Bun.version}`;

type Text = NoticeEntry["texts"][number];

async function gh<T>(path: string): Promise<T> {
	return (await $`gh api ${path}`.quiet().json()) as T;
}

async function fileAt(
	repo: string,
	ref: string,
	path: string,
): Promise<string> {
	const { content } = await gh<{ content: string }>(
		`repos/${repo}/contents/${path}?ref=${ref}`,
	);
	return Buffer.from(content, "base64").toString("utf8").trim();
}

// Repositories that state their license only in a source file's header comment.
const LICENSE_IN_SOURCE_HEADER: Record<string, string> = {
	"h2o/picohttpparser": "picohttpparser.c",
};

async function licenseFilesAt(repo: string, ref: string): Promise<Text[]> {
	const listing = await gh<{ name: string; type: string }[]>(
		`repos/${repo}/contents/?ref=${ref}`,
	);
	const names = listing
		.filter(
			(f) =>
				f.type === "file" &&
				LICENSE_FILE.test(f.name) &&
				!NON_TEXT_EXT.test(f.name),
		)
		.map((f) => f.name)
		.sort();
	const headerSource = LICENSE_IN_SOURCE_HEADER[repo];
	if (names.length === 0 && headerSource) {
		const source = await fileAt(repo, ref, headerSource);
		const header = /^\/\*([\s\S]*?)\*\//.exec(source)?.[1];
		if (!header)
			throw new Error(`${repo}@${ref}: no license header in ${headerSource}`);
		const content = header.replace(/^\s*\* ?/gm, "").trim();
		return [{ file: `${headerSource} (license header)`, content }];
	}
	if (names.length === 0)
		throw new Error(`${repo}@${ref} has no license file at its root`);
	return Promise.all(
		names.map(async (file) => ({
			file,
			content: await fileAt(repo, ref, file),
		})),
	);
}

async function spdxOf(repo: string): Promise<string> {
	const { license } = await gh<{ license?: { spdx_id?: string } }>(
		`repos/${repo}/license`,
	).catch(() => ({ license: undefined }));
	const id = license?.spdx_id;
	return id && id !== "NOASSERTION" ? id : "see license text below";
}

function linked(
	name: string,
	repo: string,
	ref: string,
	license: string,
	texts: Text[],
): NoticeEntry {
	return {
		name: `${name} (linked into the Bun runtime)`,
		version: ref,
		license,
		repository: `https://github.com/${repo}/tree/${ref}`,
		texts,
	};
}

// Libraries Bun fetches at a pinned commit (scripts/build/deps/*.ts).
async function pinnedDependencies(): Promise<NoticeEntry[]> {
	const files = await gh<{ name: string }[]>(
		`repos/${BUN_REPO}/contents/scripts/build/deps?ref=${tag}`,
	);
	const entries: NoticeEntry[] = [];
	for (const { name } of files) {
		// webkit is covered by the JavaScriptCore entry; index.ts only re-exports.
		if (!name.endsWith(".ts") || name === "index.ts" || name === "webkit.ts")
			continue;
		const source = await fileAt(BUN_REPO, tag, `scripts/build/deps/${name}`);
		const dep = name.replace(/\.ts$/, "");
		if (/kind:\s*"in-tree"/.test(source) && dep === "sqlite") {
			entries.push(SQLITE);
			continue;
		}
		// Headers only, but their inline functions are compiled into Bun's N-API layer.
		const nodeVersion = /NODEJS_VERSION = "([^"]+)"/.exec(source)?.[1];
		if (dep === "nodejs-headers" && nodeVersion) {
			const ref = `v${nodeVersion}`;
			entries.push(
				linked("Node.js headers", "nodejs/node", ref, "MIT", [
					{
						file: "LICENSE",
						content: await fileAt("nodejs/node", ref, "LICENSE"),
					},
				]),
			);
			continue;
		}
		const repo = /repo:\s*"([^"]+)"/.exec(source)?.[1];
		const commitRef = /commit:\s*([A-Z0-9_]+|"[^"]+")/.exec(source)?.[1];
		const commit = commitRef?.startsWith('"')
			? commitRef.slice(1, -1)
			: new RegExp(`const ${commitRef} = "([^"]+)"`).exec(source)?.[1];
		if (!/kind:\s*"github-archive"/.test(source) || !repo || !commit) {
			throw new Error(
				`Cannot read the pinned source of Bun dependency ${dep}; handle it explicitly`,
			);
		}
		entries.push(
			linked(
				dep,
				repo,
				commit,
				await spdxOf(repo),
				await licenseFilesAt(repo, commit),
			),
		);
	}
	return entries;
}

const SQLITE: NoticeEntry = {
	name: "SQLite (linked into the Bun runtime)",
	version: "in-tree",
	license: "blessing (public domain)",
	repository: "https://sqlite.org/copyright.html",
	texts: [
		{
			file: "Dedication",
			content: [
				"The author disclaims copyright to this source code. In place of",
				"a legal notice, here is a blessing:",
				"",
				"   May you do good and not evil.",
				"   May you find forgiveness for yourself and forgive others.",
				"   May you share freely, never taking more than you give.",
			].join("\n"),
		},
	],
};

// Code Bun vendors in its own repository with a separate license.
const IN_REPO = [
	{
		name: "uSockets (Bun fork)",
		path: "packages/bun-usockets/LICENSE",
		license: "Apache-2.0",
	},
	{
		name: "uWebSockets (Bun fork)",
		path: "packages/bun-uws/LICENSE",
		license: "Apache-2.0",
	},
	{ name: "zig-clap", path: "src/clap/LICENSE", license: "Unlicense" },
];

// Credited in Bun's LICENSE.md but not fetched by its build scripts. A null ref means Bun does
// not pin a version; the text is taken from the default branch and its commit is recorded.
const CREDITED: {
	name: string;
	repo: string;
	ref: string | null;
	path?: string;
	license: string;
}[] = [
	{
		name: "ICU",
		repo: "unicode-org/icu",
		ref: "release-78.1",
		path: "icu4c/LICENSE",
		license: "Unicode-3.0",
	},
	{
		name: "LLVM libc++abi (__cxa_thread_atexit fallback)",
		repo: "llvm/llvm-project",
		ref: "llvmorg-19.1.0",
		path: "libcxxabi/LICENSE.TXT",
		license: "Apache-2.0 WITH LLVM-exception",
	},
	{
		name: "TigerBeetle (portions of the I/O code)",
		repo: "tigerbeetle/tigerbeetle",
		ref: "532c8b70b9142c17e07737ab6d3da68d7500cbca",
		license: "Apache-2.0",
	},
	{
		name: "simdutf",
		repo: "simdutf/simdutf",
		ref: null,
		license: "Apache-2.0 OR MIT",
	},
	{
		name: "libbase64",
		repo: "aklomp/base64",
		ref: null,
		license: "BSD-2-Clause",
	},
	{ name: "uucode", repo: "jacobsandlund/uucode", ref: null, license: "MIT" },
];

async function creditedLibraries(): Promise<NoticeEntry[]> {
	return Promise.all(
		CREDITED.map(async (lib) => {
			const ref =
				lib.ref ??
				(await gh<{ sha: string }>(`repos/${lib.repo}/commits/HEAD`)).sha;
			const texts = lib.path
				? [{ file: lib.path, content: await fileAt(lib.repo, ref, lib.path) }]
				: await licenseFilesAt(lib.repo, ref);
			return linked(lib.name, lib.repo, ref, lib.license, texts);
		}),
	);
}

async function inRepoLibraries(): Promise<NoticeEntry[]> {
	return Promise.all(
		IN_REPO.map(async (lib) =>
			linked(lib.name, BUN_REPO, tag, lib.license, [
				{ file: "LICENSE", content: await fileAt(BUN_REPO, tag, lib.path) },
			]),
		),
	);
}

// Copied into Bun's node-fallbacks (base64-js pins its version in a comment) or credited in its
// LICENSE.md although Bun now ships its own shim. acorn, url and path come from Node.js, whose
// LICENSE is included with the Node.js headers.
const VENDORED_NPM = [
	"base64-js@1.5.1",
	"ieee754",
	"constants-browserify",
	"os-browserify",
	"path-browserify",
	"stream-browserify",
	"timers-browserify",
	"tty-browserify",
	"url",
	"vm-browserify",
];

// Node.js polyfills Bun embeds, at the exact versions in its node-fallbacks lockfile.
async function polyfills(): Promise<NoticeEntry[]> {
	const lockText = await fileAt(BUN_REPO, tag, "src/node-fallbacks/bun.lock");
	const lock = JSON.parse(lockText.replace(/,(\s*[}\]])/g, "$1")) as {
		packages: Record<string, [string, ...unknown[]]>;
	};
	const locked = Object.values(lock.packages).map(([spec]) => spec);
	const workDir = mkdtempSync(join(tmpdir(), "bun-polyfills-"));
	try {
		const entries: NoticeEntry[] = [];
		for (const spec of [...locked, ...VENDORED_NPM]) {
			const at = spec.lastIndexOf("@");
			const name = at > 0 ? spec.slice(0, at) : spec;
			const version =
				at > 0
					? spec.slice(at + 1)
					: (
							(await (
								await fetch(`https://registry.npmjs.org/${name}/latest`)
							).json()) as { version: string }
						).version;
			const dir = join(workDir, "node_modules", name);
			const tarball = `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;
			await $`mkdir -p ${dir} && curl -sfL ${tarball} | tar xz -C ${dir} --strip-components=1`.quiet();
			const entry = readPackageEntry(dir);
			entries.push({
				...entry,
				name: `${entry.name} (embedded in the Bun runtime)`,
			});
		}
		return entries;
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

const [pinned, inRepo, credited, embedded] = await Promise.all([
	pinnedDependencies(),
	inRepoLibraries(),
	creditedLibraries(),
	polyfills(),
]);

const bunEntry: NoticeEntry = {
	name: "Bun",
	version: Bun.version,
	license: "MIT",
	repository: `https://github.com/${BUN_REPO}/tree/${tag}`,
	texts: [
		// Bun declares MIT but publishes no license text or copyright line; LICENSE.md is its credits page.
		{
			file: "MIT (standard text; Bun ships no license file)",
			content: standardLicenseText("MIT", "the Bun authors"),
		},
		{ file: "LICENSE.md", content: await fileAt(BUN_REPO, tag, "LICENSE.md") },
	],
};

const outFile = join(import.meta.dirname, "bun-runtime/notices.json");
const byName = (a: NoticeEntry, b: NoticeEntry) => a.name.localeCompare(b.name);
writeFileSync(
	outFile,
	`${JSON.stringify(
		{
			bunVersion: Bun.version,
			entries: [
				bunEntry,
				...[...pinned, ...inRepo, ...credited].sort(byName),
				...embedded.sort(byName),
			],
		},
		null,
		"\t",
	)}\n`,
);
console.log(
	`Wrote ${outFile}: ${pinned.length + inRepo.length + credited.length} linked libraries, ${embedded.length} polyfill packages`,
);
