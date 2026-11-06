import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/**
 * Untracked paths checkpoints never snapshot, in gitignore syntax. Tracked
 * files are unaffected: they are captured from the user's own index as before.
 *
 * Ported from the legacy extension's defaults, minus entries agents routinely
 * author or edit — `.vscode/`, `.idea/`, `.clinerules/`, `bin/`, `build/`,
 * `env/`, `temp/`, `*.lock` — which Reset Code must keep rewinding. Data,
 * config/env, and geospatial formats are also left out pending a product
 * decision. ML model and array formats are added: they are the likeliest
 * multi-gigabyte untracked files in agent workspaces.
 */
export const CHECKPOINT_DEFAULT_EXCLUDES: readonly string[] = [
	// Build output and dependency trees. Directory patterns also stop git from
	// walking these trees on every snapshot.
	".gradle/",
	".next/",
	".nuxt/",
	".parcel-cache/",
	".pytest_cache/",
	".sass-cache/",
	".vs/",
	"Pods/",
	"__pycache__/",
	"bundle/",
	"coverage/",
	"deps/",
	"dist/",
	"node_modules/",
	"obj/",
	"out/",
	"pycache/",
	"target/dependency/",
	"vendor/",
	"venv/",
	// Media. `*.svg` stays included: it is text and agents write it.
	"*.3gp",
	"*.aac",
	"*.aiff",
	"*.asf",
	"*.avi",
	"*.avif",
	"*.bmp",
	"*.divx",
	"*.eps",
	"*.flac",
	"*.gif",
	"*.heic",
	"*.ico",
	"*.jpeg",
	"*.jpg",
	"*.m4a",
	"*.m4v",
	"*.mkv",
	"*.mov",
	"*.mp3",
	"*.mp4",
	"*.mpeg",
	"*.mpg",
	"*.ogg",
	"*.opus",
	"*.png",
	"*.psd",
	"*.raw",
	"*.rm",
	"*.rmvb",
	"*.tif",
	"*.tiff",
	"*.vob",
	"*.wav",
	"*.webm",
	"*.webp",
	"*.wma",
	"*.wmv",
	// Archives and binaries.
	"*.7z",
	"*.bin",
	"*.dat",
	"*.dll",
	"*.dmg",
	"*.dylib",
	"*.exe",
	"*.gz",
	"*.iso",
	"*.msi",
	"*.rar",
	"*.so",
	"*.tar",
	"*.zip",
	// ML model weights and arrays (not in legacy).
	"*.ckpt",
	"*.gguf",
	"*.ggml",
	"*.h5",
	"*.hdf5",
	"*.joblib",
	"*.keras",
	"*.npy",
	"*.npz",
	"*.onnx",
	"*.pickle",
	"*.pkl",
	"*.pt",
	"*.pth",
	"*.safetensors",
	"*.tflite",
	// Caches and editor temp files. Legacy's `*.Thumbs.db` never matched the
	// real `Thumbs.db` file name; fixed here.
	"*.DS_Store",
	"*.bak",
	"*.cache",
	"*.crdownload",
	"*.dmp",
	"*.dump",
	"*.eslintcache",
	"*.old",
	"*.part",
	"*.partial",
	"*.pyc",
	"*.pyo",
	"*.stackdump",
	"*.swo",
	"*.swp",
	"*.temp",
	"*.tmp",
	"Thumbs.db",
	// Logs. Legacy's `*.npm-debug.log*` never matched `npm-debug.log.<n>`;
	// fixed here.
	"*.error",
	"*.log",
	"*.logs",
	"*.out",
	"*.stdout",
	"npm-debug.log*",
	"yarn-debug.log*",
	"yarn-error.log*",
];

/**
 * Patterns the repository routes through Git LFS. Untracked matches are
 * skipped like the defaults: they are large by definition, and adding them to
 * the snapshot index would run the LFS clean filter — slow, and a hard failure
 * where git-lfs is required but not installed.
 */
export function parseLfsPatterns(gitattributes: string): string[] {
	return gitattributes
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.filter((line) => /(^|\s)filter=lfs(\s|$)/.test(line))
		.map((line) => line.split(/\s+/)[0] ?? "")
		.filter(Boolean);
}

async function gitOutput(
	cwd: string,
	args: string[],
): Promise<string | undefined> {
	try {
		const { stdout } = await execFile("git", ["-C", cwd, ...args], {
			windowsHide: true,
		});
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function readOptional(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}

function defaultUserExcludesPath(): string {
	const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
	return join(xdgConfigHome || join(homedir(), ".config"), "git", "ignore");
}

/** Git accepts forward slashes everywhere; config values avoid escape rules. */
function toGitPath(path: string): string {
	return process.platform === "win32" ? path.replace(/\\/g, "/") : path;
}

export type WithCheckpointExcludes = <T>(
	run: (gitConfigArgs: string[]) => Promise<T>,
) => Promise<T>;

/**
 * Returns a runner that hands git config args making every checkpoint git
 * command — the untracked listing, the restore safety stash, and cleanup —
 * treat the default and LFS patterns as ignored. Sharing one mechanism is what
 * keeps snapshot and restore consistent: a file the snapshot skips is one
 * restore neither deletes nor moves into its discarded safety stash.
 *
 * The patterns reach git as `core.excludesFile`, which replaces the user's own
 * setting for that command, so the user's file is merged in first. File
 * contents are re-read on each call (edits apply to the next snapshot); the
 * repository root and the user's excludes path are resolved once per runner.
 */
export function createCheckpointExcludes(cwd: string): WithCheckpointExcludes {
	let locations:
		| Promise<{ repoRoot: string; userExcludes: string }>
		| undefined;
	const resolveLocations = () => {
		locations ??= Promise.all([
			gitOutput(cwd, ["rev-parse", "--show-toplevel"]),
			gitOutput(cwd, ["config", "--path", "--get", "core.excludesFile"]),
		]).then(([repoRoot, userExcludes]) => ({
			repoRoot: repoRoot ?? cwd,
			userExcludes: userExcludes ?? defaultUserExcludesPath(),
		}));
		return locations;
	};

	return async (run) => {
		const { repoRoot, userExcludes } = await resolveLocations();
		const [userPatterns, gitattributes] = await Promise.all([
			readOptional(userExcludes),
			readOptional(join(repoRoot, ".gitattributes")),
		]);
		const content = [
			userPatterns,
			...CHECKPOINT_DEFAULT_EXCLUDES,
			...parseLfsPatterns(gitattributes),
		].join("\n");
		const dir = await mkdtemp(join(tmpdir(), "cline-checkpoint-excludes-"));
		try {
			const file = join(dir, "excludes");
			await writeFile(file, `${content}\n`);
			return await run(["-c", `core.excludesFile=${toGitPath(file)}`]);
		} finally {
			await rm(dir, { recursive: true, force: true }).catch(() => undefined);
		}
	};
}
