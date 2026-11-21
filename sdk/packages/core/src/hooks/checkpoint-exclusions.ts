import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
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
 *
 * Changing this list means bumping CHECKPOINT_EXCLUSIONS_VERSION and keeping
 * the previous list resolvable: a checkpoint has to be restored with the list
 * it was made with.
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
 * Recorded on every checkpoint made with CHECKPOINT_DEFAULT_EXCLUDES, as
 * `CheckpointEntry.exclusions`. Restore and compare must apply the list a
 * checkpoint was made with: with a longer list they would leave a captured
 * file in place and fail to re-create it, with a shorter one they would treat
 * a skipped file as created afterwards and delete it.
 */
export const CHECKPOINT_EXCLUSIONS_VERSION = 1;

/** Reads the `exclusions` marker off a stored checkpoint entry. */
export function readCheckpointExclusions(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 1
		? value
		: undefined;
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

async function readUserExcludes(cwd: string): Promise<string> {
	const configured = await gitOutput(cwd, [
		"config",
		"--path",
		"--get",
		"core.excludesFile",
	]);
	if (!configured) {
		return readOptional(defaultUserExcludesPath());
	}
	if (isAbsolute(configured)) {
		return readOptional(configured);
	}
	// Git reads a relative path from the top of the worktree; this process
	// usually runs somewhere else.
	const repoRoot = await gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
	return readOptional(resolve(repoRoot ?? cwd, configured));
}

/** Git accepts forward slashes everywhere; config values avoid escape rules. */
function toGitPath(path: string): string {
	return process.platform === "win32" ? path.replace(/\\/g, "/") : path;
}

/**
 * Runs one git command with the exclusion list a checkpoint was made with
 * treated as ignored: the snapshot's untracked listing, the restore safety
 * stash, or the compare listing. A file the snapshot skipped is then one that
 * restore does not move into its discarded safety stash, and that compare does
 * not report as new.
 *
 * `version` is the checkpoint's `exclusions` marker. Checkpoints without one
 * captured every untracked file and get no extra args, so they behave exactly
 * as they did before exclusions existed.
 *
 * The patterns reach git as `core.excludesFile`, which replaces the user's own
 * setting for that command, so the user's file is merged in.
 */
export async function withCheckpointExcludes<T>(
	cwd: string,
	version: number | undefined,
	run: (gitConfigArgs: string[]) => Promise<T>,
): Promise<T> {
	if (version === undefined) {
		return run([]);
	}
	if (version !== CHECKPOINT_EXCLUSIONS_VERSION) {
		throw new Error(
			"This checkpoint was created by a newer version of Cline. Update Cline to restore or compare it.",
		);
	}
	const dir = await mkdtemp(join(tmpdir(), "cline-checkpoint-excludes-"));
	try {
		const file = join(dir, "excludes");
		await writeFile(
			file,
			[await readUserExcludes(cwd), ...CHECKPOINT_DEFAULT_EXCLUDES, ""].join(
				"\n",
			),
		);
		return await run(["-c", `core.excludesFile=${toGitPath(file)}`]);
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}
