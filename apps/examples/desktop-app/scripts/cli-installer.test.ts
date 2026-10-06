import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "cli-installer/install.sh");
const release = "desktop-v0.0.43-beta.1";
const target = "x86_64-unknown-linux-gnu";
const content = "#!/bin/sh\necho cline\n";
const hash = createHash("sha256").update(content).digest("hex");

function fixture(run: (root: string, env: NodeJS.ProcessEnv) => void) {
	const root = mkdtempSync(join(tmpdir(), "cline-install-"));
	try {
		const commands = join(root, "commands");
		mkdirSync(commands);
		// Simulate release transport without reaching GitHub or touching the real HOME.
		writeFileSync(
			join(commands, "curl"),
			`#!/bin/bash\nset -euo pipefail\nprintf '%s\\n' "$*" >> "$TEST_ROOT/requests"\n[[ "\${FAIL_DOWNLOAD:-}" != 1 ]] || exit 22\nwhile [[ $# -gt 0 ]]; do\n case "$1" in -o) output="$2"; shift 2 ;; https://*) url="$1"; shift ;; *) shift ;; esac\ndone\ncase "$url" in *.build-id) printf 'sdk-fixture\\n' ;; *.sha256) printf '%s\\n' "\${EXPECTED_HASH}  runtime" > "$output" ;; *) printf '#!/bin/sh\\necho cline\\n' > "$output" ;; esac\n`,
		);
		chmodSync(join(commands, "curl"), 0o755);
		run(root, {
			...process.env,
			HOME: root,
			SHELL: "/bin/zsh",
			PATH: `${commands}:${process.env.PATH}`,
			TEST_ROOT: root,
			EXPECTED_HASH: hash,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
function args(directory: string) {
	return [
		script,
		"--release",
		release,
		"--target",
		target,
		"--install-dir",
		directory,
		"--no-modify-path",
	];
}

describe.skipIf(process.platform === "win32")("Bash runtime installer", () => {
	test("verifies a download, reuses it offline, and repairs a corrupted cache", () =>
		fixture((root, env) => {
			const directory = join(root, "runtime with spaces");
			execFileSync("bash", args(directory), { env });
			expect(readFileSync(join(directory, "cline"), "utf8")).toBe(content);
			expect(existsSync(join(root, ".zshrc"))).toBe(false);
			execFileSync("bash", args(directory), {
				env: { ...env, FAIL_DOWNLOAD: "1" },
			});
			expect(
				readFileSync(join(root, "requests"), "utf8").trim().split("\n"),
			).toHaveLength(2);
			writeFileSync(join(directory, "cline"), "corrupt");
			execFileSync("bash", args(directory), { env });
			expect(readFileSync(join(directory, "cline"), "utf8")).toBe(content);
			expect(existsSync(join(directory, ".install-lock"))).toBe(false);
		}));
	test("rejects corrupt or failed downloads and cleans up without replacing the CLI", () =>
		fixture((root, env) => {
			for (const failure of [
				{ EXPECTED_HASH: "0".repeat(64) },
				{ FAIL_DOWNLOAD: "1" },
			]) {
				const directory = join(root, "failed");
				const result = spawnSync("bash", args(directory), {
					env: { ...env, ...failure },
					encoding: "utf8",
				});
				expect(result.status).not.toBe(0);
				expect(existsSync(join(directory, "cline"))).toBe(false);
				expect(existsSync(join(directory, ".install-lock"))).toBe(false);
			}
		}));
	test("installs a local binary and adds a quoted PATH entry only once", () =>
		fixture((root, env) => {
			const binary = join(root, "local-cline");
			const directory = join(root, "it's my runtime");
			writeFileSync(binary, content);
			const localArgs = [
				script,
				"--binary",
				binary,
				"--target",
				target,
				"--install-dir",
				directory,
			];
			execFileSync("bash", localArgs, { env });
			execFileSync("bash", localArgs, { env });
			const config = readFileSync(join(root, ".zshrc"), "utf8");
			expect(config.match(/# Cline/g)).toHaveLength(1);
			const result = execFileSync(
				"bash",
				["-c", 'source "$HOME/.zshrc"; command -v cline'],
				{ env, encoding: "utf8" },
			);
			expect(result.trim()).toBe(join(directory, "cline"));
		}));
	test("reuses an existing native CLI through its wrapper without copying it", () =>
		fixture((root, env) => {
			const native = join(root, "existing native CLI");
			const report = `#!/bin/sh\ncase "$1" in --runtime-build-id) echo sdk-fixture ;; --runtime-path) printf '%s\\n' '${native}' ;; *) exit 1 ;; esac\n`;
			writeFileSync(native, report);
			chmodSync(native, 0o755);
			const wrapper = join(root, "commands", "cline");
			writeFileSync(wrapper, report);
			chmodSync(wrapper, 0o755);
			const result = execFileSync(
				"bash",
				[script, "--binary", native, "--no-modify-path"],
				{ env, encoding: "utf8" },
			);
			expect(result.trim()).toBe(native);
			expect(existsSync(join(root, ".cline", "bin", "cline"))).toBe(false);
			expect(existsSync(join(root, "requests"))).toBe(false);
			writeFileSync(native, "#!/bin/sh\necho incompatible-sdk\n");
			const mismatch = spawnSync(
				"bash",
				[script, "--binary", native, "--no-modify-path"],
				{ env, encoding: "utf8" },
			);
			expect(mismatch.status).not.toBe(0);
			expect(mismatch.stderr).toContain("incompatible SDK build");
			expect(existsSync(join(root, ".cline"))).toBe(false);
		}));
	test("reuses a release-compatible external CLI after fetching only SDK metadata", () =>
		fixture((root, env) => {
			const native = join(root, "commands", "cline");
			writeFileSync(
				native,
				`#!/bin/sh\ncase "$1" in --runtime-build-id) echo sdk-fixture ;; --runtime-path) printf '%s\\n' '${native}' ;; *) exit 1 ;; esac\n`,
			);
			chmodSync(native, 0o755);
			const result = execFileSync(
				"bash",
				[script, "--release", release, "--target", target, "--no-modify-path"],
				{ env, encoding: "utf8" },
			);
			expect(result.trim()).toBe(native);
			expect(readFileSync(join(root, "requests"), "utf8")).toContain(
				".build-id",
			);
			expect(
				readFileSync(join(root, "requests"), "utf8").trim().split("\n"),
			).toHaveLength(1);
			expect(existsSync(join(root, ".cline"))).toBe(false);
		}));
	test("rejects unpinned tags and unknown options", () =>
		fixture((_root, env) => {
			expect(
				spawnSync("bash", [script, "--release", "desktop-latest"], { env })
					.status,
			).not.toBe(0);
			expect(spawnSync("bash", [script, "--typo"], { env }).status).not.toBe(0);
		}));
});

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
					INSTALL_DIRECTORY: directory,
					EXPECTED_HASH: hash,
				};
				const powershellArgs = [
					"-NoProfile",
					"-NonInteractive",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					wrapper,
				];
				execFileSync("powershell.exe", powershellArgs, { env });
				expect(readFileSync(join(directory, "cline.exe"), "utf8")).toBe(
					content,
				);
				execFileSync("powershell.exe", powershellArgs, {
					env: { ...env, FAIL_DOWNLOAD: "1" },
				});
				writeFileSync(join(directory, "cline.exe"), "corrupt");
				execFileSync("powershell.exe", powershellArgs, { env });
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
		});
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
					"@{ buildId = 'sdk-fixture'; compiled = $true; executablePath = $env:NATIVE_CLI } | ConvertTo-Json -Compress",
				);
				const wrapper = join(root, "consolidate.ps1");
				writeFileSync(
					wrapper,
					`
$ErrorActionPreference = 'Stop'
function global:Get-Command { param($Name, $ErrorAction) [PSCustomObject]@{ Source = $env:EXISTING_CLI } }
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
				expect(output.trim()).toBe(native);
				expect(existsSync(join(root, ".cline"))).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	},
);
