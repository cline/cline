import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
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
			CLINE_INSTALL_BUILD_EPOCH_MS: "10",
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
	test("repairs an interrupted cache with missing or invalid epoch metadata", () =>
		fixture((root, env) => {
			const directory = join(root, "runtime");
			execFileSync("bash", args(directory), { env });
			for (const epoch of [undefined, "invalid"]) {
				const metadata = join(directory, "cline.build-epoch");
				if (epoch) writeFileSync(metadata, epoch);
				else rmSync(metadata);
				execFileSync("bash", args(directory), { env });
				expect(readFileSync(metadata, "utf8").trim()).toBe("10");
				execFileSync("bash", args(directory), {
					env: { ...env, FAIL_DOWNLOAD: "1" },
				});
			}
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
			const report = `#!/bin/sh\ncase "$1" in --runtime-target) echo x86_64-unknown-linux-gnu ;; --runtime-build-id) echo sdk-fixture ;; --runtime-path) printf '%s\\n' '${native}' ;; *) exit 1 ;; esac\n`;
			writeFileSync(native, report);
			chmodSync(native, 0o755);
			const wrapper = join(root, "commands", "cline");
			writeFileSync(wrapper, report);
			chmodSync(wrapper, 0o755);
			const result = execFileSync(
				"bash",
				[script, "--binary", native, "--target", target, "--no-modify-path"],
				{ env, encoding: "utf8" },
			);
			expect(result.trim()).toBe(native);
			expect(existsSync(join(root, ".cline", "bin", "cline"))).toBe(false);
			expect(existsSync(join(root, "requests"))).toBe(false);
			writeFileSync(
				wrapper,
				report.replace("echo sdk-fixture", "echo incompatible-sdk"),
			);
			const mismatch = spawnSync(
				"bash",
				[script, "--binary", native, "--target", target, "--no-modify-path"],
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
				`#!/bin/sh\ncase "$1" in --runtime-target) echo x86_64-unknown-linux-gnu ;; --runtime-build-id) echo sdk-fixture ;; --runtime-path) printf '%s\\n' '${native}' ;; *) exit 1 ;; esac\n`,
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
	test("recovers an abandoned install lock and blocks a downgrade under the lock", () =>
		fixture((root, env) => {
			const directory = join(root, "runtime");
			const lock = join(directory, ".install-lock");
			mkdirSync(lock, { recursive: true });
			writeFileSync(join(lock, "owner"), "99999999 dead-process");
			execFileSync("bash", args(directory), { env });
			expect(existsSync(lock)).toBe(false);
			const before = readFileSync(join(directory, "cline"));
			writeFileSync(join(directory, "cline.build-epoch"), "20");
			const result = spawnSync(
				"bash",
				[
					...args(directory).slice(0, -1),
					"--binary",
					join(directory, "cline"),
					"--no-modify-path",
				],
				{ env, encoding: "utf8" },
			);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("no downgrade");
			expect(readFileSync(join(directory, "cline"))).toEqual(before);
			expect(existsSync(lock)).toBe(false);
		}));
	test("recovers an abandoned lock for a relative install directory and reuses its cache offline", () =>
		fixture((root, env) => {
			const directory = join(root, "runtime");
			const options = {
				cwd: root,
				env,
				encoding: "utf8" as const,
				timeout: 3000,
			};
			execFileSync("bash", args("runtime"), options);
			const lock = join(directory, ".install-lock");
			mkdirSync(lock);
			writeFileSync(join(lock, "owner"), "99999999 dead-process");
			const result = execFileSync("bash", args("runtime"), {
				...options,
				env: { ...env, FAIL_DOWNLOAD: "1" },
			});
			expect(realpathSync(result.trim())).toBe(
				realpathSync(join(directory, "cline")),
			);
			expect(existsSync(lock)).toBe(false);
			expect(readFileSync(join(directory, "cline"), "utf8")).toBe(content);
		}));
	test("recovers interrupted claims including nested and ownerless recovery directories", () =>
		fixture((root, env) => {
			const directory = join(root, "runtime");
			const lock = join(directory, ".install-lock");
			const claim = join(lock, "reclaim");
			const nested = join(claim, "reclaim");
			mkdirSync(nested, { recursive: true });
			writeFileSync(join(lock, "owner"), "99999999 dead-process");
			writeFileSync(join(claim, "owner"), "99999998 dead-process");
			const old = new Date(Date.now() - 3600000);
			utimesSync(nested, old, old);
			execFileSync("bash", args(directory), { env, timeout: 3000 });
			expect(existsSync(lock)).toBe(false);
			expect(readFileSync(join(directory, "cline"), "utf8")).toBe(content);
		}));
	test("preserves a live recovery claim while its parent owner is dead", () =>
		fixture((root, env) => {
			const directory = join(root, "runtime");
			const lock = join(directory, ".install-lock");
			const claim = join(lock, "reclaim");
			mkdirSync(claim, { recursive: true });
			writeFileSync(join(lock, "owner"), "99999999 dead-process");
			const owner = `${process.pid} ${execFileSync("ps", ["-p", String(process.pid), "-o", "lstart="], { env: { ...env, TZ: "UTC" }, encoding: "utf8" }).trimEnd()}`;
			writeFileSync(join(claim, "owner"), owner);
			const sleep = join(root, "commands", "sleep");
			writeFileSync(sleep, "#!/bin/sh\nexit 1\n");
			chmodSync(sleep, 0o755);
			const result = spawnSync("bash", args(directory), {
				env,
				timeout: 3000,
				encoding: "utf8",
			});
			expect(existsSync(claim), result.stderr).toBe(true);
			expect(result.status).not.toBe(0);
			expect(readFileSync(join(claim, "owner"), "utf8")).toBe(owner);
			expect(existsSync(join(directory, "cline"))).toBe(false);
		}));
	test("preserves a live successor when stale-lock recovery races another installer", () =>
		fixture((root, env) => {
			const directory = join(root, "runtime");
			const lock = join(directory, ".install-lock");
			mkdirSync(lock, { recursive: true });
			writeFileSync(join(lock, "owner"), "99999999 dead-process");
			const owner = `${process.pid} ${execFileSync("ps", ["-p", String(process.pid), "-o", "lstart="], { env: { ...env, TZ: "UTC" }, encoding: "utf8" }).trimEnd()}`;
			const commands = join(root, "commands");
			writeFileSync(
				join(commands, "ps"),
				`#!/bin/bash
if [[ "$*" == "-p 99999999 -o lstart=" ]]; then
 /bin/mv "$TEST_LOCK" "$TEST_LOCK.old"
 /bin/mkdir "$TEST_LOCK"
 printf '%s\\n' "$TEST_OWNER" > "$TEST_LOCK/owner"
 exit 1
fi
exec /bin/ps "$@"
`,
			);
			// End the wait after checking recovery; the live owner must retain its lock.
			writeFileSync(join(commands, "sleep"), "#!/bin/sh\nexit 1\n");
			chmodSync(join(commands, "ps"), 0o755);
			chmodSync(join(commands, "sleep"), 0o755);
			const result = spawnSync("bash", args(directory), {
				env: { ...env, TEST_LOCK: lock, TEST_OWNER: owner },
				encoding: "utf8",
			});
			expect(result.status).not.toBe(0);
			expect(readFileSync(join(lock, "owner"), "utf8").trimEnd()).toBe(owner);
			expect(existsSync(join(lock, "reclaim"))).toBe(false);
			expect(existsSync(join(directory, "cline"))).toBe(false);
		}));
	test("rejects an external CLI for a different requested target", () =>
		fixture((root, env) => {
			const existing = join(root, "commands", "cline");
			writeFileSync(existing, "#!/bin/sh\necho x86_64-unknown-linux-gnu\n");
			chmodSync(existing, 0o755);
			const result = spawnSync(
				"bash",
				[
					script,
					"--release",
					release,
					"--target",
					"aarch64-unknown-linux-gnu",
					"--no-modify-path",
				],
				{ env, encoding: "utf8" },
			);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("does not match requested");
			expect(existsSync(join(root, ".cline"))).toBe(false);
		}));
	test("activates versioned releases through the default command across directory and PATH changes", () =>
		fixture((root, env) => {
			const binary = join(root, "local-cline");
			const report = (epoch: number, build = "sdk-fixture") =>
				`#!/bin/sh\ncase "$1" in --runtime-build-id) echo ${build} ;; --runtime-build-epoch) echo ${epoch} ;; --runtime-target) echo ${target} ;; *) echo works ;; esac\n`;
			writeFileSync(binary, report(10));
			chmodSync(binary, 0o755);
			const install = [
				script,
				"--binary",
				binary,
				"--target",
				target,
				"--replace-existing",
			];
			const first = execFileSync("bash", install, {
				env,
				encoding: "utf8",
			}).trim();
			expect(first).toBe(join(root, ".local", "bin", "cline"));
			const firstRelease = realpathSync(first);
			expect(firstRelease).toContain(
				"/.cline/packages/standalone/releases/local-",
			);
			writeFileSync(binary, report(20));
			execFileSync("bash", install, {
				env: { ...env, CLINE_INSTALL_BUILD_EPOCH_MS: "20" },
			});
			const secondRelease = realpathSync(first);
			expect(secondRelease).not.toBe(firstRelease);
			expect(existsSync(firstRelease)).toBe(true);
			const config = readFileSync(join(root, ".zshrc"), "utf8");
			expect(config.match(/# Cline/g)).toHaveLength(1);
			const output = execFileSync(
				"bash",
				["-c", 'source "$HOME/.zshrc"; cd /; cline'],
				{
					env: { ...env, PATH: "/usr/bin:/bin" },
					encoding: "utf8",
				},
			);
			expect(output.trim()).toBe("works");
			writeFileSync(binary, report(10));
			const downgrade = spawnSync("bash", install, { env, encoding: "utf8" });
			expect(downgrade.status).not.toBe(0);
			expect(downgrade.stderr).toContain("no downgrade");
			expect(realpathSync(first)).toBe(secondRelease);
			writeFileSync(binary, report(30, "wrong-sdk"));
			const mismatch = spawnSync("bash", install, {
				env: {
					...env,
					CLINE_INSTALL_BUILD_EPOCH_MS: "30",
					CLINE_INSTALL_BUILD_ID: "sdk-fixture",
				},
				encoding: "utf8",
			});
			expect(mismatch.status).not.toBe(0);
			expect(mismatch.stderr).toContain("incompatible SDK build");
			expect(realpathSync(first)).toBe(secondRelease);
		}));
	test("reuses a managed release offline and rejects activating an older cached release", () =>
		fixture((root, env) => {
			const binary = join(root, "native-cline");
			const report = (epoch: number) =>
				`#!/bin/sh\ncase "$1" in --runtime-build-id) echo sdk-fixture ;; --runtime-build-epoch) echo ${epoch} ;; --runtime-target) echo ${target} ;; esac\n`;
			writeFileSync(binary, report(10));
			chmodSync(binary, 0o755);
			writeFileSync(
				join(root, "commands", "curl"),
				`#!/bin/bash
set -euo pipefail
[[ "\${FAIL_DOWNLOAD:-}" != 1 ]] || exit 22
printf '%s\\n' "$*" >> "$TEST_ROOT/requests"
while [[ $# -gt 0 ]]; do
 case "$1" in -o) output="$2"; shift 2 ;; https://*) url="$1"; shift ;; *) shift ;; esac
done
case "$url" in
 *.build-id) echo sdk-fixture ;;
 *.sha256) echo "$EXPECTED_HASH runtime" > "$output" ;;
 *) cp "$NETWORK_BINARY" "$output" ;;
esac
`,
			);
			const transport = {
				...env,
				NETWORK_BINARY: binary,
				EXPECTED_HASH: createHash("sha256")
					.update(readFileSync(binary))
					.digest("hex"),
			};
			const install = [
				script,
				"--release",
				release,
				"--target",
				target,
				"--replace-existing",
				"--no-modify-path",
			];
			const entry = execFileSync("bash", install, {
				env: transport,
				encoding: "utf8",
			}).trim();
			const requests = readFileSync(join(root, "requests"), "utf8");
			execFileSync("bash", install, {
				env: { ...transport, FAIL_DOWNLOAD: "1" },
			});
			expect(readFileSync(join(root, "requests"), "utf8")).toBe(requests);
			writeFileSync(binary, report(20));
			execFileSync(
				"bash",
				[
					script,
					"--binary",
					binary,
					"--target",
					target,
					"--replace-existing",
					"--no-modify-path",
				],
				{ env: { ...transport, CLINE_INSTALL_BUILD_EPOCH_MS: "20" } },
			);
			const newer = realpathSync(entry);
			const older = spawnSync("bash", install, {
				env: { ...transport, FAIL_DOWNLOAD: "1" },
				encoding: "utf8",
			});
			expect(older.status).not.toBe(0);
			expect(older.stderr).toContain("no downgrade");
			expect(realpathSync(entry)).toBe(newer);
		}));

	test("never overwrites an unrelated command or uninstalls packages without a terminal", () =>
		fixture((root, env) => {
			const binary = join(root, "local-cline");
			writeFileSync(binary, "#!/bin/sh\necho 10\n");
			chmodSync(binary, 0o755);
			const directory = join(root, ".local", "bin");
			mkdirSync(directory, { recursive: true });
			const entry = join(directory, "cline");
			writeFileSync(entry, "unrelated command");
			const result = spawnSync(
				"bash",
				[script, "--binary", binary, "--target", target, "--replace-existing"],
				{ env, encoding: "utf8" },
			);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("unrelated file");
			expect(readFileSync(entry, "utf8")).toBe("unrelated command");
			const packageDir = join(root, "node_modules", "cline", "bin");
			mkdirSync(packageDir, { recursive: true });
			const oldCli = join(packageDir, "cline");
			writeFileSync(oldCli, "#!/bin/sh\nexit 1\n");
			chmodSync(oldCli, 0o755);
			const removal = join(root, "commands", "npm");
			writeFileSync(removal, '#!/bin/sh\ntouch "$TEST_ROOT/uninstalled"\n');
			chmodSync(removal, 0o755);
			const conflict = spawnSync(
				"bash",
				[script, "--binary", binary, "--target", target],
				{
					env: { ...env, PATH: `${packageDir}:${env.PATH}` },
					encoding: "utf8",
				},
			);
			expect(conflict.status).not.toBe(0);
			expect(conflict.stderr).toContain("npm uninstall -g cline");
			expect(existsSync(join(root, "uninstalled"))).toBe(false);
			expect(existsSync(oldCli)).toBe(true);
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
