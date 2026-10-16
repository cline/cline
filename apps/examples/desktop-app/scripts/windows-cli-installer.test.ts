import { describe, expect, test } from "bun:test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const content = "#!/bin/sh\necho cline\n";
const hash = createHash("sha256").update(content).digest("hex");

function expectSameFile(reported: string, expected: string) {
	expect(isAbsolute(reported)).toBe(true);
	const actualFile = statSync(reported);
	const expectedFile = statSync(expected);
	expect({ device: actualFile.dev, inode: actualFile.ino }).toEqual({
		device: expectedFile.dev,
		inode: expectedFile.ino,
	});
}

describe.skipIf(process.platform !== "win32")(
	"PowerShell runtime installer",
	() => {
		test("verifies downloads, reuses the cache offline, and rejects bad checksums", () => {
			const root = mkdtempSync(join(tmpdir(), "cline-install-windows-"));
			try {
				const wrapper = join(root, "test-install.ps1");
				writeFileSync(
					wrapper,
					`
$ErrorActionPreference = 'Stop'
function global:Invoke-WebRequest {
    param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec)
    if ($env:FAIL_DOWNLOAD -eq '1') { throw 'Download failed' }
    if ($Uri.EndsWith('.sha256')) { [IO.File]::WriteAllText($OutFile, "$($env:EXPECTED_HASH)  runtime") }
    else { [IO.File]::WriteAllText($OutFile, "#!/bin/sh\`necho cline\`n") }
}
& $env:INSTALLER_SCRIPT -Release desktop-v0.0.43-beta.1 -Target x86_64-pc-windows-msvc -InstallDir $env:INSTALL_DIRECTORY -NoModifyPath
`,
				);
				const directory = join(root, "runtime with spaces");
				const env = {
					...process.env,
					INSTALLER_SCRIPT: resolve(
						import.meta.dir,
						"cli-installer/install.ps1",
					),
					INSTALL_DIRECTORY: "runtime with spaces",
					EXPECTED_HASH: hash,
					CLINE_INSTALL_BUILD_EPOCH_MS: "10",
				};
				const powershellArgs = [
					"-NoProfile",
					"-NonInteractive",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					wrapper,
				];
				const installed = execFileSync("powershell.exe", powershellArgs, {
					env,
					cwd: root,
					encoding: "utf8",
				});
				expectSameFile(
					installed.trim().split(/\r?\n/).at(-1) ?? "",
					join(directory, "cline.exe"),
				);
				expect(readFileSync(join(directory, "cline.exe"), "utf8")).toBe(
					content,
				);
				execFileSync("powershell.exe", powershellArgs, {
					env: { ...env, FAIL_DOWNLOAD: "1" },
					cwd: root,
				});
				rmSync(join(directory, "cline.exe.build-epoch"));
				execFileSync("powershell.exe", powershellArgs, { env, cwd: root });
				expect(
					readFileSync(join(directory, "cline.exe.build-epoch"), "utf8").trim(),
				).toBe("10");
				writeFileSync(join(directory, "cline.exe"), "corrupt");
				execFileSync("powershell.exe", powershellArgs, { env, cwd: root });
				expect(readFileSync(join(directory, "cline.exe"), "utf8")).toBe(
					content,
				);
				const failedDirectory = join(root, "failed");
				const result = spawnSync("powershell.exe", powershellArgs, {
					env: {
						...env,
						INSTALL_DIRECTORY: failedDirectory,
						EXPECTED_HASH: "0".repeat(64),
					},
				});
				expect(result.status).not.toBe(0);
				expect(existsSync(join(failedDirectory, "cline.exe"))).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}, 60_000);
	},
);

describe.skipIf(process.platform !== "win32")(
	"PowerShell CLI consolidation",
	() => {
		test("reuses a compatible external wrapper without creating a shared copy", () => {
			const root = mkdtempSync(join(tmpdir(), "cline-consolidate-windows-"));
			try {
				const native = join(root, "native-cline.exe");
				writeFileSync(native, "existing native executable");
				const existing = join(root, "existing-cline.ps1");
				writeFileSync(
					existing,
					"@{ buildId = 'sdk-fixture'; compiled = $true; target = 'x86_64-pc-windows-msvc'; executablePath = $env:NATIVE_CLI } | ConvertTo-Json -Compress",
				);
				const wrapper = join(root, "consolidate.ps1");
				writeFileSync(
					wrapper,
					`
$ErrorActionPreference = 'Stop'
function global:Get-Command {
    param($Name, $ErrorAction)
    if ($Name -eq 'cline') { [PSCustomObject]@{ Source = $env:EXISTING_CLI } }
    else { Microsoft.PowerShell.Core\\Get-Command -Name $Name -ErrorAction $ErrorAction }
}
function global:Invoke-WebRequest { param($Uri, [switch]$UseBasicParsing, $TimeoutSec) [PSCustomObject]@{ Content = 'sdk-fixture' } }
& $env:INSTALLER_SCRIPT -Release desktop-v0.0.43 -NoModifyPath
`,
				);
				const output = execFileSync(
					"powershell.exe",
					[
						"-NoProfile",
						"-NonInteractive",
						"-ExecutionPolicy",
						"Bypass",
						"-File",
						wrapper,
					],
					{
						encoding: "utf8",
						env: {
							...process.env,
							USERPROFILE: root,
							NATIVE_CLI: native,
							EXISTING_CLI: existing,
							INSTALLER_SCRIPT: resolve(
								import.meta.dir,
								"cli-installer/install.ps1",
							),
						},
					},
				);
				expect(output.trim().split(/\r?\n/).at(-1)).toBe(native);
				expect(existsSync(join(root, ".cline"))).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}, 60_000);
	},
);

describe.skipIf(process.platform !== "win32")(
	"PowerShell managed releases",
	() => {
		test("switches a relative command directory while the previous executable is running", async () => {
			const root = mkdtempSync(join(tmpdir(), "cline-managed-windows-测试-"));
			let running: ReturnType<typeof spawn> | undefined;
			try {
				const source = join(root, "fixture.ts");
				const binary = join(root, "fixture.exe");
				const installer = resolve(import.meta.dir, "cli-installer/install.ps1");
				const build = async (epoch: number) => {
					writeFileSync(
						source,
						`const info = {compiled:true, buildId:"sdk-fixture", target:"x86_64-pc-windows-msvc", buildEpochMs:${epoch}, executablePath:process.execPath};
if (process.argv[2] === "--hold") { console.log("ready"); setInterval(() => {}, 1000); }
else if (process.argv[2] === "--runtime-info") console.log(JSON.stringify(info));
else if (process.argv[2] === "--runtime-build-id") console.log(info.buildId);
else if (process.argv[2] === "--runtime-build-epoch") console.log(info.buildEpochMs);`,
					);
					const result = await Bun.build({
						entrypoints: [source],
						compile: { outfile: binary },
					});
					expect(result.success).toBe(true);
				};
				const install = (epoch: number, buildId = "sdk-fixture") =>
					spawnSync(
						"powershell.exe",
						[
							"-NoProfile",
							"-NonInteractive",
							"-ExecutionPolicy",
							"Bypass",
							"-File",
							installer,
							"-Binary",
							binary,
							"-InstallDir",
							"command dir",
							"-Managed",
							"-NoModifyPath",
						],
						{
							cwd: root,
							encoding: "utf8",
							env: {
								...process.env,
								USERPROFILE: root,
								CLINE_INSTALL_BUILD_EPOCH_MS: String(epoch),
								CLINE_INSTALL_BUILD_ID: buildId,
							},
						},
					);
				await build(10);
				const first = install(10);
				expect(first.status, first.stderr).toBe(0);
				const entry = join(root, "command dir", "cline.cmd");
				expectSameFile(first.stdout.trim().split(/\r?\n/).at(-1) ?? "", entry);
				const firstLauncher = readFileSync(entry, "utf8");
				const activeRecord = join(root, "command dir", "cline-runtime");
				const firstActive = readFileSync(activeRecord, "utf8");
				const firstNative = join(
					root,
					".cline",
					"packages",
					"standalone",
					"releases",
					firstActive.trim().split(/\r?\n/)[0],
					"cline.exe",
				);
				expect(
					[...firstActive].every((character) => character.charCodeAt(0) < 128),
				).toBe(true);
				const held = spawn("cmd.exe", ["/d", "/c", entry, "--hold"], {
					stdio: ["ignore", "pipe", "ignore"],
					env: { ...process.env, USERPROFILE: root },
				});
				running = held;
				await new Promise<void>((resolve, reject) => {
					held.once("error", reject);
					held.stdout.once("data", () => resolve());
				});
				await build(20);
				const second = install(20);
				expect(second.status, second.stderr).toBe(0);
				expect(existsSync(firstNative)).toBe(true);
				const active = readFileSync(activeRecord, "utf8");
				expect(active).not.toBe(firstActive);
				expect(readFileSync(entry, "utf8")).toBe(firstLauncher);
				const info = JSON.parse(
					execFileSync("cmd.exe", ["/d", "/c", entry, "--runtime-info"], {
						encoding: "utf8",
						env: { ...process.env, USERPROFILE: root },
					}),
				);
				expect(info.buildEpochMs).toBe(20);
				await build(10);
				const downgrade = install(10);
				expect(downgrade.status).not.toBe(0);
				expect(downgrade.stderr).toContain("no downgrade");
				expect(readFileSync(activeRecord, "utf8")).toBe(active);
				await build(30);
				const mismatch = install(30, "wrong-sdk");
				expect(mismatch.status).not.toBe(0);
				expect(mismatch.stderr).toContain("identity");
				expect(readFileSync(activeRecord, "utf8")).toBe(active);
			} finally {
				if (running && running.exitCode === null) {
					const closed = new Promise<void>((resolve) =>
						running?.once("close", () => resolve()),
					);
					execFileSync("taskkill", ["/T", "/F", "/PID", String(running.pid)]);
					await closed;
				}
				rmSync(root, { recursive: true, force: true });
			}
		}, 60_000);
	},
);
