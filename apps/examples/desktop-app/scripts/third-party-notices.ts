import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bunRuntimeEntries } from "../../../../scripts/third-party-notices/bun-runtime";
import { cargoCrateEntries } from "../../../../scripts/third-party-notices/cargo";
import { generateNotices } from "../../../../scripts/third-party-notices/index";
import { CLI_EMBEDDED_INPUT_LISTS } from "../../../cli/script/third-party-notices";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const INPUTS_DIR = join(APP_ROOT, "dist/third-party");
const WEBVIEW_OUT = join(APP_ROOT, "webview/out");
const PRODUCT = "Cline Desktop";

// Bundled as a Tauri resource (tauri.conf.json) and opened from Settings → About.
export const NOTICES_FILE = join(
	APP_ROOT,
	"src-tauri/bin/THIRD_PARTY_NOTICES.txt",
);

export const inputListPath = (name: "cli" | "backend" | "webview"): string =>
	join(INPUTS_DIR, `${name}-inputs.json`);

export function writeInputList(
	name: "cli" | "backend" | "webview",
	inputs: Iterable<string>,
): void {
	mkdirSync(INPUTS_DIR, { recursive: true });
	writeFileSync(inputListPath(name), JSON.stringify([...new Set(inputs)]));
}

// Bundled modules named by one Turbopack source map. [project] is the turbopack root, which
// next.config.mjs sets to the repo root; [turbopack] is its own runtime.
export function webviewSourcePaths(
	mapJson: string,
	repoRoot: string,
): string[] {
	const parsed = JSON.parse(mapJson) as {
		sources?: string[];
		sections?: { map: { sources: string[] } }[];
	};
	const sources =
		parsed.sources ?? parsed.sections?.flatMap((s) => s.map.sources) ?? [];
	return sources.flatMap((source) => {
		const match = /^turbopack:\/\/\/\[project\]\/(.+)$/.exec(source);
		return match ? [join(repoRoot, match[1])] : [];
	});
}

// Turbopack has no metafile, so the webview build emits source maps (next.config.mjs) and
// this reads their sources, then deletes them so the app never ships them.
export function recordWebviewInputs(): void {
	const maps = [...new Bun.Glob("**/*.map").scanSync({ cwd: WEBVIEW_OUT })].map(
		(map) => join(WEBVIEW_OUT, map),
	);
	const inputs = maps.flatMap((path) =>
		webviewSourcePaths(readFileSync(path, "utf8"), REPO_ROOT),
	);
	// Fail before deleting the maps so the output can be inspected.
	if (inputs.length === 0) {
		throw new Error(
			maps.length === 0
				? `[third-party-notices] no source maps in ${WEBVIEW_OUT}; is productionBrowserSourceMaps enabled?`
				: `[third-party-notices] none of the ${maps.length} source maps in ${WEBVIEW_OUT} name a turbopack:///[project]/ source; update webviewSourcePaths for the new format`,
		);
	}
	for (const path of maps) rmSync(path);
	for (const file of new Bun.Glob("**/*.{js,css}").scanSync({
		cwd: WEBVIEW_OUT,
	})) {
		const path = join(WEBVIEW_OUT, file);
		const content = readFileSync(path, "utf8");
		const stripped = content.replace(
			/\n?(\/\/# sourceMappingURL=\S+|\/\*# sourceMappingURL=\S+?\s*\*\/)\s*$/,
			"",
		);
		if (stripped !== content) writeFileSync(path, stripped);
	}
	writeInputList("webview", inputs);
}

const cargoTargets = (targetTriple: string): string[] =>
	targetTriple === "universal-apple-darwin"
		? ["aarch64-apple-darwin", "x86_64-apple-darwin"]
		: [targetTriple];

/** Writes the notices for everything the installer ships: shell, webview, backend, and the CLIs. */
export async function writeDesktopThirdPartyNotices(options: {
	targetTriple: string;
	// Dev builds start before the webview is exported.
	allowMissingInputLists: boolean;
}): Promise<void> {
	generateNotices({
		product: PRODUCT,
		inputs: [],
		baseDir: REPO_ROOT,
		inputLists: {
			...CLI_EMBEDDED_INPUT_LISTS,
			CLI: inputListPath("cli"),
			// The backend runs beside its own copy of the plugin runtime, already listed above.
			"desktop backend": inputListPath("backend"),
			webview: inputListPath("webview"),
		},
		allowMissingInputLists: options.allowMissingInputLists,
		extraEntries: bunRuntimeEntries(PRODUCT),
		packageEntries: await cargoCrateEntries(
			join(APP_ROOT, "src-tauri/Cargo.toml"),
			cargoTargets(options.targetTriple),
		),
		outFile: NOTICES_FILE,
	});
}
