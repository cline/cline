import { existsSync } from "node:fs";
import {
	chmod,
	cp,
	mkdtemp,
	open,
	readdir,
	readFile,
	rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { $ } from "bun";

// The Factory tester records its browser through Playwright, which encodes
// video with its own ffmpeg build looked up in a browsers directory as
// `ffmpeg-<revision>/<binary>`. The app bundles that directory (see
// tauri.conf.json `resources` and sidecar/video-encoder.ts) so recording does
// not depend on the user's Playwright cache.

const APP_ROOT = path.resolve(import.meta.dir, "..");
const STAGED_BROWSERS_DIR = path.join(
	APP_ROOT,
	"src-tauri",
	"bin",
	"playwright",
);

type Arch = "arm64" | "x64";
type Format = "macho" | "elf" | "pe";
/** One architecture of the encoder, and the host platform Playwright's installer downloads it for. */
export type EncoderSlice = { arch: Arch; installerPlatform: string };
export type EncoderTarget = {
	binary: string;
	format: Format;
	slices: EncoderSlice[];
};

const mac = (arch: Arch): EncoderSlice => ({
	arch,
	installerPlatform: arch === "arm64" ? "mac15-arm64" : "mac15",
});

/** The encoder Playwright uses on the platform a Rust target triple builds for. */
export function encoderTarget(targetTriple: string): EncoderTarget {
	if (targetTriple === "universal-apple-darwin")
		return {
			binary: "ffmpeg-mac",
			format: "macho",
			slices: [mac("arm64"), mac("x64")],
		};
	if (targetTriple.startsWith("aarch64-apple-darwin"))
		return { binary: "ffmpeg-mac", format: "macho", slices: [mac("arm64")] };
	if (targetTriple.startsWith("x86_64-apple-darwin"))
		return { binary: "ffmpeg-mac", format: "macho", slices: [mac("x64")] };
	if (targetTriple.startsWith("x86_64-pc-windows"))
		return {
			binary: "ffmpeg-win64.exe",
			format: "pe",
			slices: [{ arch: "x64", installerPlatform: "win64" }],
		};
	if (targetTriple.startsWith("x86_64-unknown-linux"))
		return {
			binary: "ffmpeg-linux",
			format: "elf",
			slices: [{ arch: "x64", installerPlatform: "ubuntu22.04-x64" }],
		};
	if (targetTriple.startsWith("aarch64-unknown-linux"))
		return {
			binary: "ffmpeg-linux",
			format: "elf",
			slices: [{ arch: "arm64", installerPlatform: "ubuntu22.04-arm64" }],
		};
	throw new Error(`Playwright has no video encoder build for ${targetTriple}.`);
}

/** Playwright's default browsers cache for the machine running the build. */
export function playwrightCacheDir(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	home: string,
): string {
	const configured = env.PLAYWRIGHT_BROWSERS_PATH;
	if (configured && configured !== "0") return path.resolve(configured);
	const base =
		platform === "darwin"
			? path.join(home, "Library", "Caches")
			: platform === "win32"
				? env.LOCALAPPDATA || path.join(home, "AppData", "Local")
				: env.XDG_CACHE_HOME || path.join(home, ".cache");
	return path.join(base, "ms-playwright");
}

const MACHO_CPU: Record<number, Arch> = { 16777228: "arm64", 16777223: "x64" };
const ELF_MACHINE: Record<number, Arch> = { 183: "arm64", 62: "x64" };
const PE_MACHINE: Record<number, Arch> = { 43620: "arm64", 34404: "x64" };

/** The executable format and architectures a binary's header declares. */
export function binaryArchitectures(
	header: Buffer,
): { format: Format; archs: Arch[] } | undefined {
	if (header.length < 64) return undefined;
	const known = (archs: Array<Arch | undefined>) =>
		archs.filter((arch): arch is Arch => arch !== undefined);
	if (header.readUInt32LE(0) === 0xfeedfacf)
		return {
			format: "macho",
			archs: known([MACHO_CPU[header.readUInt32LE(4)]]),
		};
	if (header.readUInt32BE(0) === 0xcafebabe) {
		const count = header.readUInt32BE(4);
		const archs = Array.from({ length: count }, (_, index) =>
			8 + index * 20 + 4 <= header.length
				? MACHO_CPU[header.readUInt32BE(8 + index * 20)]
				: undefined,
		);
		return { format: "macho", archs: known(archs) };
	}
	if (header.toString("latin1", 0, 4) === "\x7fELF")
		return {
			format: "elf",
			archs: known([ELF_MACHINE[header.readUInt16LE(18)]]),
		};
	if (header.toString("latin1", 0, 2) === "MZ") {
		const pe = header.readUInt32LE(0x3c);
		if (
			pe + 6 > header.length ||
			header.toString("latin1", pe, pe + 4) !== "PE\0\0"
		)
			return undefined;
		return {
			format: "pe",
			archs: known([PE_MACHINE[header.readUInt16LE(pe + 4)]]),
		};
	}
	return undefined;
}

/** Whether a binary is exactly what the target needs, every slice and nothing else. */
export function matchesTarget(
	found: ReturnType<typeof binaryArchitectures>,
	target: EncoderTarget,
	slices: EncoderSlice[] = target.slices,
): boolean {
	return (
		found?.format === target.format &&
		found.archs.length === slices.length &&
		slices.every((slice) => found.archs.includes(slice.arch))
	);
}

/**
 * Where one slice comes from: the build machine's Playwright cache when it
 * holds a complete install of this revision for that architecture (a cross-
 * architecture build never takes the host's binary), otherwise Playwright's
 * own installer.
 */
export function encoderSource(
	target: EncoderTarget,
	slice: EncoderSlice,
	cached: { complete: boolean; header?: Buffer },
): "cache" | "installer" {
	return cached.complete &&
		cached.header &&
		matchesTarget(binaryArchitectures(cached.header), target, [slice])
		? "cache"
		: "installer";
}

async function readHeader(file: string): Promise<Buffer | undefined> {
	const handle = await open(file, "r").catch(() => undefined);
	if (!handle) return undefined;
	try {
		const buffer = Buffer.alloc(4096);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

async function playwrightPackage(): Promise<{
	root: string;
	revision: string;
}> {
	const root = path.dirname(
		Bun.resolveSync("playwright-core/package.json", APP_ROOT),
	);
	const { browsers } = JSON.parse(
		await readFile(path.join(root, "browsers.json"), "utf8"),
	) as { browsers: Array<{ name: string; revision: string }> };
	const revision = browsers.find((entry) => entry.name === "ffmpeg")?.revision;
	if (!revision)
		throw new Error(`${root}/browsers.json lists no ffmpeg revision.`);
	return { root, revision };
}

// DEPENDENCIES_VALIDATED records a check of the build machine, not the user's.
const copyEncoderDir = (from: string, to: string) =>
	cp(from, to, {
		recursive: true,
		filter: (file) => path.basename(file) !== "DEPENDENCIES_VALIDATED",
	});

/** Copies one slice's `ffmpeg-<revision>` directory into `into`. */
async function fetchSlice(input: {
	target: EncoderTarget;
	slice: EncoderSlice;
	revision: string;
	cacheDir: string;
	playwrightRoot: string;
	into: string;
	dryRun: boolean;
}): Promise<void> {
	const directory = `ffmpeg-${input.revision}`;
	const cached = path.join(input.cacheDir, directory);
	const source = encoderSource(input.target, input.slice, {
		complete: existsSync(path.join(cached, "INSTALLATION_COMPLETE")),
		header: await readHeader(path.join(cached, input.target.binary)),
	});
	if (source === "cache") {
		console.log(`video encoder (${input.slice.arch}): copying ${cached}`);
		if (!input.dryRun)
			await copyEncoderDir(cached, path.join(input.into, directory));
		return;
	}
	// Playwright's installer, pinned to the installed playwright-core's
	// revision, for the target's platform rather than the build machine's.
	const browsers = await mkdtemp(path.join(tmpdir(), "cline-video-encoder-"));
	console.log(
		`video encoder (${input.slice.arch}): no matching copy in ${cached}; running Playwright's installer for ${input.slice.installerPlatform}${input.dryRun ? " (dry run)" : ""}`,
	);
	try {
		const installed =
			await $`${process.execPath} ${path.join(input.playwrightRoot, "cli.js")} install ${input.dryRun ? ["--dry-run"] : []} ffmpeg`
				.env({
					...process.env,
					PLAYWRIGHT_BROWSERS_PATH: browsers,
					PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: input.slice.installerPlatform,
				})
				.nothrow();
		const complete = existsSync(
			path.join(browsers, directory, "INSTALLATION_COMPLETE"),
		);
		if (!input.dryRun && (installed.exitCode !== 0 || !complete))
			throw new Error(
				`Could not stage Playwright's video encoder (ffmpeg ${input.revision}, ${input.slice.installerPlatform}): ${cached} has no matching copy and Playwright's installer failed. Fix: give this build network access to Playwright's download host (or set PLAYWRIGHT_DOWNLOAD_HOST to a mirror) and rebuild.`,
			);
		if (!input.dryRun)
			await copyEncoderDir(
				path.join(browsers, directory),
				path.join(input.into, directory),
			);
	} finally {
		await rm(browsers, { recursive: true, force: true });
	}
}

/**
 * Developer ID signs the encoder for notarization. Tauri signs only the main
 * binary and externalBin, so a Mach-O under Contents/Resources must arrive
 * signed with the hardened runtime and a timestamp. Unsigned local builds
 * keep ffmpeg's ad-hoc signature.
 */
async function signForNotarization(binary: string): Promise<void> {
	let identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
	const certificate = process.env.APPLE_CERTIFICATE?.trim();
	if (!identity && !certificate) {
		console.log("video encoder: no Apple signing identity; left unsigned");
		return;
	}
	// CI passes the certificate itself, which Tauri imports only later, while
	// bundling; import it into a throwaway keychain for this one signature.
	let keychain: string | undefined;
	const work = await mkdtemp(path.join(tmpdir(), "cline-encoder-sign-"));
	try {
		if (certificate) {
			keychain = path.join(work, "signing.keychain-db");
			const password = crypto.randomUUID();
			const p12 = path.join(work, "certificate.p12");
			await Bun.write(p12, Buffer.from(certificate, "base64"));
			await $`security create-keychain -p ${password} ${keychain}`;
			await $`security set-keychain-settings ${keychain}`;
			await $`security unlock-keychain -p ${password} ${keychain}`;
			await $`security import ${p12} -k ${keychain} -P ${process.env.APPLE_CERTIFICATE_PASSWORD ?? ""} -T /usr/bin/codesign`.quiet();
			await $`security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k ${password} ${keychain}`.quiet();
			// Without APPLE_SIGNING_IDENTITY, sign with the certificate's own
			// identity, as Tauri does.
			identity ||= (
				await $`security find-identity -v -p codesigning ${keychain}`.text()
			).match(/\b([0-9A-F]{40})\b/)?.[1];
			if (!identity)
				throw new Error(
					"APPLE_CERTIFICATE holds no code signing identity, so the bundled video encoder cannot be signed. Fix: export the Developer ID Application certificate with its private key.",
				);
		}
		await $`codesign --force --options runtime --timestamp ${keychain ? ["--keychain", keychain] : []} --sign ${identity} ${binary}`;
		await $`codesign --verify --strict ${binary}`;
	} finally {
		if (keychain) await $`security delete-keychain ${keychain}`.nothrow();
		await rm(work, { recursive: true, force: true });
	}
}

/** Stages `bin/playwright/ffmpeg-<revision>/` for the target into src-tauri. */
export async function stageVideoEncoder(
	targetTriple: string,
	options: { dryRun?: boolean } = {},
): Promise<void> {
	const dryRun = options.dryRun ?? false;
	const target = encoderTarget(targetTriple);
	const { root: playwrightRoot, revision } = await playwrightPackage();
	const cacheDir = playwrightCacheDir(process.platform, process.env, homedir());
	const directory = `ffmpeg-${revision}`;
	const staged = path.join(STAGED_BROWSERS_DIR, directory, target.binary);
	if (!dryRun) await rm(STAGED_BROWSERS_DIR, { recursive: true, force: true });

	// universal-apple-darwin stages each slice apart and merges them into one
	// fat binary, like the sidecar.
	const universal = target.slices.length > 1;
	const sliceDirs: string[] = [];
	try {
		for (const slice of target.slices) {
			const into = universal
				? await mkdtemp(
						path.join(tmpdir(), `cline-video-encoder-${slice.arch}-`),
					)
				: STAGED_BROWSERS_DIR;
			sliceDirs.push(path.join(into, directory));
			await fetchSlice({
				target,
				slice,
				revision,
				cacheDir,
				playwrightRoot,
				into,
				dryRun,
			});
		}
		if (dryRun) return;
		if (universal) {
			await cp(sliceDirs[0] as string, path.dirname(staged), {
				recursive: true,
			});
			await $`lipo -create -output ${staged} ${sliceDirs.map((dir) => path.join(dir, target.binary))}`;
		}
	} finally {
		if (universal)
			await Promise.all(
				sliceDirs.map((dir) =>
					rm(path.dirname(dir), { recursive: true, force: true }),
				),
			);
	}
	await chmod(staged, 0o755);
	const found = binaryArchitectures(
		(await readHeader(staged)) ?? Buffer.alloc(0),
	);
	if (!matchesTarget(found, target))
		throw new Error(
			`Staged video encoder ${staged} is ${found ? `${found.format} ${found.archs.join("+")}` : "not an executable"}, but ${targetTriple} needs ${target.format} ${target.slices.map((slice) => slice.arch).join("+")}. Fix: delete ${STAGED_BROWSERS_DIR} and rebuild.`,
		);
	if (target.format === "macho") await signForNotarization(staged);
	console.log(
		`video encoder: staged ${path.relative(APP_ROOT, staged)} (${found?.archs.join("+")}); contents: ${(await readdir(path.dirname(staged))).join(", ")}`,
	);
}

// Standalone: `bun run stage:video-encoder [--target <triple>] [--dry-run]`.
// build:sidecar:bin stages it for the triple it builds.
const main = async () => {
	const args = process.argv.slice(2);
	const targetIndex = args.indexOf("--target");
	const targetTriple =
		(targetIndex >= 0 ? args[targetIndex + 1] : undefined) ||
		process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
		(await $`rustc -vV`.text()).match(/^host: (.+)$/m)?.[1]?.trim();
	if (!targetTriple) throw new Error("Pass --target <rust target triple>.");
	await stageVideoEncoder(targetTriple, { dryRun: args.includes("--dry-run") });
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
