import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	open,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const PINNED_BUN_VERSION = "1.3.13";

type RuntimeSpec = {
	archiveName: string;
	cacheName: string;
	expectedMachine: number;
	sha256: string;
};

const WINDOWS_LINUX_RUNTIME_SPECS: Record<string, RuntimeSpec> = {
	"bun-linux-x64": {
		archiveName: "bun-linux-x64",
		cacheName: "bun-linux-x64",
		expectedMachine: 62,
		sha256: "79c0771fa8b92c33aae41e15a0e0d307ea99d0e2f00317c71c6c53237a78e25a",
	},
	"bun-linux-arm64": {
		archiveName: "bun-linux-aarch64",
		cacheName: "bun-linux-aarch64",
		expectedMachine: 183,
		sha256: "70bae41b3908b0a120e1e58c5c8af30e74afae3b8d11b0d3fdd8e787ddfb4b22",
	},
};

export type WindowsCrossCompileRuntime = RuntimeSpec & {
	cacheFilename: string;
	downloadUrl: string;
};

export const resolveWindowsCrossCompileRuntime = (
	bunTarget: string,
	bunVersion: string,
): WindowsCrossCompileRuntime | undefined => {
	const spec = WINDOWS_LINUX_RUNTIME_SPECS[bunTarget];
	if (!spec) return undefined;
	if (bunVersion !== PINNED_BUN_VERSION) {
		throw new Error(
			`Windows Linux cross-compilation requires Bun ${PINNED_BUN_VERSION}; received ${bunVersion}`,
		);
	}
	return {
		...spec,
		cacheFilename: `${spec.cacheName}-v${bunVersion}`,
		downloadUrl: `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${spec.archiveName}.zip`,
	};
};

export const isExpectedElfExecutable = (
	header: Uint8Array,
	expectedMachine: number,
): boolean =>
	header.length >= 20 &&
	header[0] === 0x7f &&
	header[1] === 0x45 &&
	header[2] === 0x4c &&
	header[3] === 0x46 &&
	header[5] === 1 &&
	header[18] === (expectedMachine & 0xff) &&
	header[19] === ((expectedMachine >> 8) & 0xff);

const hasExpectedRuntime = async (
	filePath: string,
	expectedMachine: number,
): Promise<boolean> => {
	try {
		const fileStat = await stat(filePath);
		if (!fileStat.isFile() || fileStat.size < 1_000_000) return false;
		const file = await open(filePath, "r");
		try {
			const header = new Uint8Array(20);
			const { bytesRead } = await file.read(header, 0, header.length, 0);
			return (
				bytesRead === header.length &&
				isExpectedElfExecutable(header, expectedMachine)
			);
		} finally {
			await file.close();
		}
	} catch {
		return false;
	}
};

const powershellLiteral = (value: string): string =>
	`'${value.replaceAll("'", "''")}'`;

/**
 * Bun cannot currently unpack Linux cross-compile runtimes on Windows. Put the
 * official pinned runtime in Bun's normal cache so `bun build --compile` can
 * use it without taking the broken extractor path.
 */
export const prepareWindowsCrossCompileRuntime = async (
	bunTarget: string,
): Promise<void> => {
	if (process.platform !== "win32") return;
	const spec = resolveWindowsCrossCompileRuntime(bunTarget, Bun.version);
	if (!spec) return;

	const bunInstall =
		process.env.BUN_INSTALL?.trim() || path.join(homedir(), ".bun");
	const cacheDir = path.join(bunInstall, "install", "cache");
	const cachePath = path.join(cacheDir, spec.cacheFilename);
	if (await hasExpectedRuntime(cachePath, spec.expectedMachine)) return;

	const stagingDir = await mkdtemp(
		path.join(tmpdir(), `cline-${spec.archiveName}-`),
	);
	try {
		const archivePath = path.join(stagingDir, `${spec.archiveName}.zip`);
		const extractDir = path.join(stagingDir, "extracted");
		const response = await fetch(spec.downloadUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to download ${spec.archiveName}: HTTP ${response.status}`,
			);
		}
		const archive = new Uint8Array(await response.arrayBuffer());
		const actualSha256 = createHash("sha256").update(archive).digest("hex");
		if (actualSha256 !== spec.sha256) {
			throw new Error(
				`${spec.archiveName} checksum mismatch: expected ${spec.sha256}, received ${actualSha256}`,
			);
		}
		await Bun.write(archivePath, archive);
		await mkdir(extractDir, { recursive: true });

		const expandCommand = `Expand-Archive -LiteralPath ${powershellLiteral(archivePath)} -DestinationPath ${powershellLiteral(extractDir)} -Force`;
		const expand = Bun.spawn(
			[
				"powershell.exe",
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				expandCommand,
			],
			{ stdout: "inherit", stderr: "inherit" },
		);
		const expandExitCode = await expand.exited;
		if (expandExitCode !== 0) {
			throw new Error(
				`Failed to extract ${spec.archiveName} (exit ${expandExitCode})`,
			);
		}

		const extractedRuntime = path.join(extractDir, spec.archiveName, "bun");
		if (!(await hasExpectedRuntime(extractedRuntime, spec.expectedMachine))) {
			throw new Error(
				`${spec.archiveName} did not contain the expected Linux executable`,
			);
		}

		await mkdir(cacheDir, { recursive: true });
		const stagedCachePath = `${cachePath}.${process.pid}.tmp`;
		await copyFile(extractedRuntime, stagedCachePath);
		await rm(cachePath, { force: true, recursive: true });
		await rename(stagedCachePath, cachePath);
		console.log(`Prepared Bun cross-compile runtime: ${spec.cacheFilename}`);
	} finally {
		await rm(stagingDir, { force: true, recursive: true });
	}
};

const main = async (): Promise<void> => {
	const targets = process.argv.slice(2);
	if (targets.length === 0) {
		throw new Error("Pass at least one Bun compile target to prepare");
	}
	for (const target of targets) {
		await prepareWindowsCrossCompileRuntime(target);
	}
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
