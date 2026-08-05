import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { PLUGINS_DIRECTORY_NAME, resolveClineDir } from "@cline/shared/storage";

/**
 * Bundled plugins are first-party plugins that ship with a Cline host (today
 * the CLI) and are seeded onto disk under `~/.cline/plugins/_bundled/<slug>/`
 * so the regular plugin discovery, sandbox loading, and per-path disable
 * settings all apply unchanged. Unlike installed plugins they cannot be
 * uninstalled — hosts re-seed them on startup — but users can still disable
 * them through the normal plugin settings.
 */
export const BUNDLED_PLUGINS_DIRECTORY_NAME = "_bundled";

const BUNDLED_PLUGIN_MARKER_FILE_NAME = ".cline-bundled.json";
const BUNDLED_PLUGIN_MARKER_VERSION = 1;
const INSTALLS_DIRECTORY_NAME = "_installed";
const OFFICIAL_INSTALLS_DIRECTORY_NAME = "official";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface BundledPluginSpec {
	/** Stable identifier, also the on-disk directory name (e.g. "goal"). */
	slug: string;
	/** Relative file path -> file content for everything to seed on disk. */
	files: Record<string, string>;
}

export interface BundledPluginSyncResult {
	/** Slugs written for the first time. */
	seeded: string[];
	/** Slugs whose on-disk copy was refreshed because the content changed. */
	updated: string[];
	/** Slugs already on disk with matching content. */
	upToDate: string[];
	/**
	 * Slugs not seeded because the user already installed the same official
	 * plugin themselves (avoids double command/tool registration).
	 */
	skipped: string[];
	failures: Array<{ slug: string; message: string }>;
}

export function resolveBundledPluginsRoot(): string {
	return join(
		resolveClineDir(),
		PLUGINS_DIRECTORY_NAME,
		BUNDLED_PLUGINS_DIRECTORY_NAME,
	);
}

/**
 * True when the path points at (or into) a bundled plugin directory, i.e. any
 * `plugins/_bundled/<slug>` location regardless of which plugin search root
 * it lives under.
 */
export function isBundledPluginPath(path: string): boolean {
	const parts = resolve(path).split(sep);
	const bundledIndex = parts.lastIndexOf(BUNDLED_PLUGINS_DIRECTORY_NAME);
	return (
		bundledIndex > 0 &&
		bundledIndex < parts.length - 1 &&
		parts[bundledIndex - 1] === PLUGINS_DIRECTORY_NAME
	);
}

export function getBundledPluginSlug(path: string): string | undefined {
	if (!isBundledPluginPath(path)) {
		return undefined;
	}
	const parts = resolve(path).split(sep);
	return parts[parts.lastIndexOf(BUNDLED_PLUGINS_DIRECTORY_NAME) + 1];
}

function hashSpecContent(spec: BundledPluginSpec): string {
	const hash = createHash("sha256");
	hash.update(`v${BUNDLED_PLUGIN_MARKER_VERSION}\0`);
	for (const relativePath of Object.keys(spec.files).sort()) {
		hash.update(`${relativePath}\0${spec.files[relativePath]}\0`);
	}
	return hash.digest("hex");
}

function readMarkerHash(markerPath: string): string | undefined {
	try {
		const parsed = JSON.parse(readFileSync(markerPath, "utf8")) as {
			hash?: unknown;
		};
		return typeof parsed.hash === "string" ? parsed.hash : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The user may have installed the same official plugin manually (e.g.
 * `cline plugin install goal`) before it started shipping as a bundled
 * plugin. Seeding a second copy would register duplicate commands/tools, so
 * the first seed defers to the user's install.
 */
function hasOfficialInstallForSlug(slug: string): boolean {
	const officialRoot = join(
		resolveClineDir(),
		PLUGINS_DIRECTORY_NAME,
		INSTALLS_DIRECTORY_NAME,
		OFFICIAL_INSTALLS_DIRECTORY_NAME,
	);
	let entries: string[];
	try {
		entries = readdirSync(officialRoot);
	} catch {
		return false;
	}
	const installPattern = new RegExp(`^${slug}-[0-9a-f]{12}$`, "i");
	return entries.some((entry) => installPattern.test(entry));
}

export function isBundledPluginInstalled(slug: string): boolean {
	return existsSync(join(resolveBundledPluginsRoot(), slug));
}

function assertValidSpec(spec: BundledPluginSpec): void {
	if (!SLUG_PATTERN.test(spec.slug)) {
		throw new Error(`Invalid bundled plugin slug "${spec.slug}"`);
	}
	const relativePaths = Object.keys(spec.files);
	if (relativePaths.length === 0) {
		throw new Error(`Bundled plugin "${spec.slug}" has no files`);
	}
	for (const relativePath of relativePaths) {
		const normalized = normalize(relativePath);
		if (
			!relativePath.trim() ||
			isAbsolute(normalized) ||
			normalized === ".." ||
			normalized.startsWith(`..${sep}`) ||
			normalized === BUNDLED_PLUGIN_MARKER_FILE_NAME
		) {
			throw new Error(
				`Bundled plugin "${spec.slug}" has an invalid file path "${relativePath}"`,
			);
		}
	}
}

function writeBundledPlugin(
	root: string,
	spec: BundledPluginSpec,
	contentHash: string,
): void {
	const targetPath = join(root, spec.slug);
	const stagingPath = join(
		root,
		`.tmp-${spec.slug}-${Date.now()}-${process.pid}`,
	);
	try {
		for (const [relativePath, content] of Object.entries(spec.files)) {
			const filePath = join(stagingPath, normalize(relativePath));
			mkdirSync(dirname(filePath), { recursive: true });
			writeFileSync(filePath, content, "utf8");
		}
		writeFileSync(
			join(stagingPath, BUNDLED_PLUGIN_MARKER_FILE_NAME),
			`${JSON.stringify(
				{ version: BUNDLED_PLUGIN_MARKER_VERSION, hash: contentHash },
				null,
				2,
			)}\n`,
			"utf8",
		);
		rmSync(targetPath, { recursive: true, force: true });
		renameSync(stagingPath, targetPath);
	} catch (error) {
		rmSync(stagingPath, { recursive: true, force: true });
		throw error;
	}
}

/**
 * Idempotently seeds bundled plugins onto disk. Cheap when everything is up
 * to date (one marker read per plugin), so hosts can call it on every start.
 * Deleting a bundled plugin directory only lasts until the next sync — use
 * the plugin disable setting to turn a bundled plugin off.
 */
export function syncBundledPlugins(
	plugins: ReadonlyArray<BundledPluginSpec>,
): BundledPluginSyncResult {
	const result: BundledPluginSyncResult = {
		seeded: [],
		updated: [],
		upToDate: [],
		skipped: [],
		failures: [],
	};
	const root = resolveBundledPluginsRoot();
	for (const spec of plugins) {
		try {
			assertValidSpec(spec);
			const targetPath = join(root, spec.slug);
			const targetExists = existsSync(targetPath);
			const contentHash = hashSpecContent(spec);
			if (targetExists) {
				const markerHash = readMarkerHash(
					join(targetPath, BUNDLED_PLUGIN_MARKER_FILE_NAME),
				);
				if (markerHash === contentHash) {
					result.upToDate.push(spec.slug);
					continue;
				}
			} else if (hasOfficialInstallForSlug(spec.slug)) {
				result.skipped.push(spec.slug);
				continue;
			}
			mkdirSync(root, { recursive: true });
			writeBundledPlugin(root, spec, contentHash);
			(targetExists ? result.updated : result.seeded).push(spec.slug);
		} catch (error) {
			result.failures.push({
				slug: spec.slug,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return result;
}
