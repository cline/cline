#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const cliDir = resolve(import.meta.dir, "..");
const rootDir = resolve(cliDir, "../..");
const installerDir = join(import.meta.dir, "windows-installer");
const nsisVersion = "3.11";
const nsisArchiveSha256 =
	"c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1";

export async function runInstallerCommand(
	command: string[],
	options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<void> {
	const child = Bun.spawn(command, {
		cwd: options.cwd ?? cliDir,
		env: options.env ?? process.env,
		stdout: "inherit",
		stderr: "inherit",
		windowsHide: true,
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(
			`${basename(command[0] ?? "command")} exited with ${exitCode}`,
		);
	}
}

export async function findNSISCompiler(): Promise<string> {
	const configured = process.env.MAKENSIS_PATH ?? Bun.which("makensis");
	if (configured) {
		if (!existsSync(configured)) {
			throw new Error(`NSIS compiler not found: ${configured}`);
		}
		return resolve(configured);
	}
	const cacheDir = join(rootDir, "tmp/cli-installer");
	const compiler = join(cacheDir, `nsis-${nsisVersion}/makensis.exe`);
	if (existsSync(compiler)) return compiler;

	mkdirSync(cacheDir, { recursive: true });
	const archive = join(cacheDir, `nsis-${nsisVersion}.zip`);
	console.log(`Downloading NSIS ${nsisVersion}...`);
	const response = await fetch(
		`https://github.com/tauri-apps/binary-releases/releases/download/nsis-${nsisVersion}/nsis-${nsisVersion}.zip`,
	);
	if (!response.ok) {
		throw new Error(`NSIS download failed: HTTP ${response.status}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	if (createHash("sha256").update(bytes).digest("hex") !== nsisArchiveSha256) {
		throw new Error("NSIS archive checksum mismatch");
	}
	writeFileSync(archive, bytes);
	const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
	await runInstallerCommand([
		"powershell.exe",
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		`$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(cacheDir)} -Force`,
	]);
	if (!existsSync(compiler)) throw new Error("NSIS extraction failed");
	return compiler;
}

function nsisString(value: string): string {
	if (/[\r\n]/.test(value))
		throw new Error("Invalid newline in installer path");
	return value.replaceAll("$", () => "$$").replaceAll('"', '$\\"');
}

function nsisFilePath(value: string): string {
	if (/[\r\n"]/.test(value)) throw new Error("Invalid installer file path");
	// File, OutFile and !include are compiler inputs, not runtime strings.
	// Their dollar signs are literal and must not be doubled.
	return value;
}

function collectFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name))
		.flatMap((entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) return collectFiles(path);
			if (entry.isFile()) return [path];
			throw new Error(`Unsupported installer payload entry: ${path}`);
		});
}

export async function buildWindowsInstaller(input: {
	packageDir: string;
	outputFile: string;
	arch: "x64" | "arm64";
	version: string;
	compiler: string;
	// Tests compile the real installer against disposable registry keys.
	environmentKey?: string;
	installKey?: string;
}): Promise<void> {
	const versionParts = /^(\d+)\.(\d+)\.(\d+)/.exec(input.version);
	if (!versionParts) throw new Error(`Invalid CLI version: ${input.version}`);
	const stageDir = mkdtempSync(
		join(resolve(tmpdir()), "cline-installer-build-"),
	);
	try {
		const files = collectFiles(input.packageDir);
		if (!files.includes(join(input.packageDir, "bin/cline.exe"))) {
			throw new Error("The Windows platform package is missing bin/cline.exe");
		}
		const directories = new Set<string>();
		const installLines: string[] = [];
		const uninstallLines: string[] = [];
		let previousDirectory: string | undefined;
		let totalSize = 0;
		for (const file of files) {
			const payloadPath = relative(input.packageDir, file);
			const directory = dirname(payloadPath);
			if (directory !== previousDirectory) {
				installLines.push(
					`SetOutPath "$INSTDIR${directory === "." ? "" : `\\${nsisString(directory)}`}"`,
				);
				previousDirectory = directory;
			}
			installLines.push(`File "${nsisFilePath(file)}"`);
			uninstallLines.push(`Delete "$INSTDIR\\${nsisString(payloadPath)}"`);
			totalSize += statSync(file).size;
			let currentDirectory = directory;
			while (currentDirectory !== ".") {
				directories.add(currentDirectory);
				currentDirectory = dirname(currentDirectory);
			}
		}
		for (const directory of [...directories].sort(
			(left, right) => right.length - left.length,
		)) {
			uninstallLines.push(`RMDir "$INSTDIR\\${nsisString(directory)}"`);
		}
		const installFiles = join(stageDir, "install-files.nsh");
		const uninstallFiles = join(stageDir, "uninstall-files.nsh");
		writeFileSync(installFiles, installLines.join("\n"));
		writeFileSync(uninstallFiles, uninstallLines.join("\n"));
		mkdirSync(dirname(input.outputFile), { recursive: true });
		const defines = {
			OUTPUT_FILE: input.outputFile,
			ARCH: input.arch,
			VERSION: input.version,
			NUMERIC_VERSION: `${versionParts[1]}.${versionParts[2]}.${versionParts[3]}.0`,
			ESTIMATED_SIZE: String(Math.ceil(totalSize / 1024)),
			ENVIRONMENT_SCRIPT: join(installerDir, "environment.ps1"),
			ENVIRONMENT_KEY: input.environmentKey ?? "Environment",
			INSTALL_KEY:
				input.installKey ??
				"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ClineCLI",
			INSTALL_FILES: installFiles,
			UNINSTALL_FILES: uninstallFiles,
		};
		await runInstallerCommand([
			input.compiler,
			"/V2",
			...Object.entries(defines).map(
				([key, value]) =>
					`/D${key}=${key === "ENVIRONMENT_KEY" || key === "INSTALL_KEY" ? nsisString(value) : nsisFilePath(value)}`,
			),
			join(installerDir, "installer.nsi"),
		]);
	} finally {
		rmSync(stageDir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	if (process.platform !== "win32") {
		throw new Error("Build Windows installers on Windows.");
	}
	const args = process.argv.slice(2);
	const arch =
		args.find((arg) => arg.startsWith("--arch="))?.slice(7) ?? process.arch;
	if (arch !== "arm64" && arch !== "x64") {
		throw new Error(`Unsupported Windows architecture: ${arch}`);
	}
	if (!args.includes("--skip-build")) {
		if (arch !== process.arch) {
			throw new Error(
				"Build the target platform package first, then use --skip-build --arch=<arch>.",
			);
		}
		await runInstallerCommand([
			process.execPath,
			"script/build.ts",
			"--single",
		]);
	}
	const packageDir = join(cliDir, `dist/cli-windows-${arch}`);
	const sourcePackage = JSON.parse(
		readFileSync(join(cliDir, "package.json"), "utf8"),
	);
	const platformPackage = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf8"),
	);
	if (platformPackage.version !== sourcePackage.version) {
		throw new Error("The platform package is stale. Rebuild the CLI first.");
	}
	const outputFile = join(
		cliDir,
		`dist/installers/ClineCLI-${sourcePackage.version}-windows-${arch}-setup.exe`,
	);
	await buildWindowsInstaller({
		packageDir,
		outputFile,
		arch,
		version: sourcePackage.version,
		compiler: await findNSISCompiler(),
	});
	console.log(`Installer built: ${outputFile}`);
}

if (import.meta.main) {
	await main();
}
