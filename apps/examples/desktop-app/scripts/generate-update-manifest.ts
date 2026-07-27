// Generates the Tauri updater manifest (latest.json) from the updater
// artifacts produced by the desktop-publish workflow. The manifest is uploaded
// to the rolling `desktop-latest` GitHub release, which is the static endpoint
// configured in src-tauri/tauri.conf.json; its platform URLs point back at the
// immutable per-version release assets.
//
// Usage:
//   bun scripts/generate-update-manifest.ts \
//     --version 0.1.0 --tag desktop-v0.1.0 --dir dist/desktop \
//     --out dist/desktop/latest.json [--repo cline/cline] [--notes-file notes.md]

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type UpdaterPlatformEntry = {
	signature: string;
	url: string;
};

export type UpdateManifest = {
	version: string;
	notes: string;
	pub_date: string;
	platforms: Record<string, UpdaterPlatformEntry>;
};

// Maps the arch token embedded in artifact file names (see the "Collect
// artifacts" workflow step) to the platform keys the Tauri updater requests.
const PLATFORM_KEY_BY_ARCH_SUFFIX: Record<string, string> = {
	aarch64: "darwin-aarch64",
	x86_64: "darwin-x86_64",
};

const getArgValue = (args: string[], name: string): string | undefined => {
	const index = args.indexOf(name);
	if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
		return args[index + 1];
	}
	const prefix = `${name}=`;
	const inline = args.find((arg) => arg.startsWith(prefix));
	return inline?.slice(prefix.length);
};

const archOfUpdaterArtifact = (fileName: string): string | undefined => {
	if (!fileName.endsWith(".app.tar.gz")) {
		return undefined;
	}
	return Object.keys(PLATFORM_KEY_BY_ARCH_SUFFIX).find((arch) =>
		fileName.includes(`_${arch}`),
	);
};

export const buildUpdateManifest = (options: {
	version: string;
	tag: string;
	dir: string;
	repo: string;
	notes: string;
	pubDate: string;
}): UpdateManifest => {
	const platforms: Record<string, UpdaterPlatformEntry> = {};

	for (const fileName of readdirSync(options.dir).sort()) {
		const arch = archOfUpdaterArtifact(fileName);
		if (!arch) {
			continue;
		}
		const signaturePath = path.join(options.dir, `${fileName}.sig`);
		const signature = readFileSync(signaturePath, "utf8").trim();
		if (!signature) {
			throw new Error(`empty updater signature at ${signaturePath}`);
		}
		platforms[PLATFORM_KEY_BY_ARCH_SUFFIX[arch]] = {
			signature,
			url: `https://github.com/${options.repo}/releases/download/${options.tag}/${encodeURIComponent(fileName)}`,
		};
	}

	if (Object.keys(platforms).length === 0) {
		throw new Error(
			`no updater artifacts (*.app.tar.gz with a known arch suffix) found in ${options.dir}`,
		);
	}

	return {
		version: options.version,
		notes: options.notes,
		pub_date: options.pubDate,
		platforms,
	};
};

const main = () => {
	const args = process.argv.slice(2);
	const version = getArgValue(args, "--version");
	const tag = getArgValue(args, "--tag");
	const dir = getArgValue(args, "--dir");
	const out = getArgValue(args, "--out");
	const repo =
		getArgValue(args, "--repo") ??
		process.env.GITHUB_REPOSITORY ??
		"cline/cline";
	const notesFile = getArgValue(args, "--notes-file");

	if (!version || !tag || !dir || !out) {
		throw new Error(
			"usage: generate-update-manifest.ts --version X.Y.Z --tag desktop-vX.Y.Z --dir <artifact dir> --out <latest.json> [--repo owner/repo] [--notes-file <file>]",
		);
	}

	const notes = notesFile
		? readFileSync(notesFile, "utf8").trim()
		: `Cline Code v${version}`;

	const manifest = buildUpdateManifest({
		version,
		tag,
		dir,
		repo,
		notes,
		pubDate: new Date().toISOString(),
	});

	writeFileSync(out, `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log(`wrote ${out}`);
	for (const [platform, entry] of Object.entries(manifest.platforms)) {
		console.log(`- ${platform}: ${entry.url}`);
	}
};

if (import.meta.main) {
	main();
}
