import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { resolveDesktopRemoteHelper } from "./remote-helper";

it("honors a local helper directory before packaged installers even offline", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-local-helper-"));
	try {
		const helper = join(root, "cline-aarch64-unknown-linux-gnu");
		writeFileSync(helper, "local runtime");
		const runInstaller = vi.fn(async () => {
			throw new Error("offline");
		});
		await expect(
			resolveDesktopRemoteHelper(
				{ platform: "linux", arch: "arm64" },
				{
					platform: "darwin",
					arch: "arm64",
					env: {
						CLINE_REMOTE_HELPER_DIRECTORY: root,
						CLINE_DESKTOP_INSTALLER_DIRECTORY: "/missing/installer",
						CLINE_DESKTOP_RUNTIME_DIRECTORY: "/missing/cache",
					},
					runInstaller,
				},
			),
		).resolves.toBe(helper);
		expect(runInstaller).not.toHaveBeenCalled();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("downloads only the requested SSH target from the desktop's exact release", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-runtime-"));
	try {
		const installerDir = join(root, "installer");
		mkdirSync(installerDir);
		writeFileSync(join(installerDir, "release.txt"), "cli-v0.0.43-beta.1\n");
		const directory = join(
			root,
			"cache",
			"cli-v0.0.43-beta.1",
			"aarch64-unknown-linux-gnu",
		);
		const runInstaller = vi.fn(async () => {
			mkdirSync(directory, { recursive: true });
			writeFileSync(join(directory, "cline"), "runtime");
		});
		await expect(
			resolveDesktopRemoteHelper(
				{ platform: "linux", arch: "arm64" },
				{
					platform: "darwin",
					env: {
						CLINE_DESKTOP_INSTALLER_DIRECTORY: installerDir,
						CLINE_DESKTOP_RUNTIME_DIRECTORY: join(root, "cache"),
					},
					runInstaller,
				},
			),
		).resolves.toBe(join(directory, "cline"));
		expect(runInstaller).toHaveBeenCalledWith(
			join(installerDir, "install.sh"),
			"cli-v0.0.43-beta.1",
			"aarch64-unknown-linux-gnu",
			directory,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("uses a local CLI for a matching development SSH host", async () => {
	await expect(
		resolveDesktopRemoteHelper(
			{ platform: "linux", arch: "x64" },
			{
				platform: "linux",
				arch: "x64",
				probeRuntime: async () => ({ cpuBaseline: true }),
				env: { CLINE_DESKTOP_CLI_PATH: "/dev/cline" },
			},
		),
	).resolves.toBe("/dev/cline");
	await expect(
		resolveDesktopRemoteHelper(
			{ platform: "linux", arch: "arm64" },
			{
				platform: "linux",
				arch: "x64",
				probeRuntime: async () => ({ cpuBaseline: true }),
				env: { CLINE_DESKTOP_CLI_PATH: "/dev/cline" },
			},
		),
	).resolves.toBeUndefined();
});

it("propagates installation failures instead of uploading a missing runtime", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-runtime-"));
	try {
		writeFileSync(join(root, "release.txt"), "cli-v0.0.43\n");
		await expect(
			resolveDesktopRemoteHelper(
				{ platform: "darwin", arch: "arm64" },
				{
					env: {
						CLINE_DESKTOP_INSTALLER_DIRECTORY: root,
						CLINE_DESKTOP_RUNTIME_DIRECTORY: root,
					},
					runInstaller: async () => {
						throw new Error("checksum mismatch");
					},
				},
			),
		).rejects.toThrow("checksum mismatch");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("reuses the shared host CLI for SSH without downloading a second copy", async () => {
	const runInstaller = vi.fn(async () => {});
	const root = mkdtempSync(join(tmpdir(), "cline-shared-ssh-"));
	try {
		writeFileSync(join(root, "release.txt"), "cli-v0.0.43\n");
		const cli = join(root, "cline");
		writeFileSync(cli, Buffer.from("cafebabe00000002", "hex"));
		await expect(
			resolveDesktopRemoteHelper(
				{ platform: "darwin", arch: "x64" },
				{
					platform: "darwin",
					arch: "arm64",
					runInstaller,
					env: {
						CLINE_DESKTOP_CLI_PATH: cli,
						CLINE_DESKTOP_INSTALLER_DIRECTORY: root,
						CLINE_DESKTOP_RUNTIME_DIRECTORY: root,
					},
				},
			),
		).resolves.toBe(cli);
		expect(runInstaller).not.toHaveBeenCalled();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("downloads a baseline Linux x64 runtime instead of reusing a non-baseline CLI", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-baseline-"));
	try {
		writeFileSync(join(root, "release.txt"), "cli-v0.0.43\n");
		const directory = join(
			root,
			"cache",
			"cli-v0.0.43",
			"x86_64-unknown-linux-gnu",
		);
		const runInstaller = vi.fn(async () => {
			mkdirSync(directory, { recursive: true });
			writeFileSync(join(directory, "cline"), "baseline");
		});
		const result = await resolveDesktopRemoteHelper(
			{ platform: "linux", arch: "x64" },
			{
				platform: "linux",
				arch: "x64",
				probeRuntime: async () => ({ cpuBaseline: false }),
				runInstaller,
				env: {
					CLINE_DESKTOP_CLI_PATH: "/external/non-baseline",
					CLINE_DESKTOP_INSTALLER_DIRECTORY: root,
					CLINE_DESKTOP_RUNTIME_DIRECTORY: join(root, "cache"),
				},
			},
		);
		expect(result).toBe(join(directory, "cline"));
		expect(runInstaller).toHaveBeenCalledTimes(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("keeps stable and beta SSH releases separate across repeated connections", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-release-cache-"));
	try {
		const installs = new Map<string, string>();
		const runInstaller = async (
			_script: string,
			release: string,
			_target: string,
			directory: string,
		) => {
			const previous = installs.get(directory);
			if (previous && previous !== release)
				throw new Error("the installed CLI is newer");
			installs.set(directory, release);
			mkdirSync(directory, { recursive: true });
			writeFileSync(join(directory, "cline"), release);
		};
		const paths = [];
		for (const release of [
			"cli-v0.0.43",
			"cli-v0.0.44-beta.1",
			"cli-v0.0.43",
		]) {
			writeFileSync(join(root, "release.txt"), release);
			paths.push(
				await resolveDesktopRemoteHelper(
					{ platform: "linux", arch: "arm64" },
					{
						platform: "darwin",
						runInstaller,
						env: {
							CLINE_DESKTOP_INSTALLER_DIRECTORY: root,
							CLINE_DESKTOP_RUNTIME_DIRECTORY: join(root, "cache"),
						},
					},
				),
			);
		}
		expect(paths[0]).toBe(paths[2]);
		expect(paths[0]).not.toBe(paths[1]);
		expect(readFileSync(paths[0] ?? "", "utf8")).toBe("cli-v0.0.43");
		expect(readFileSync(paths[1] ?? "", "utf8")).toBe("cli-v0.0.44-beta.1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("rejects invalid release paths before invoking the SSH installer", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-release-path-"));
	try {
		writeFileSync(join(root, "release.txt"), "../../escape");
		const runInstaller = vi.fn(async () => {});
		await expect(
			resolveDesktopRemoteHelper(
				{ platform: "linux", arch: "arm64" },
				{
					platform: "darwin",
					runInstaller,
					env: {
						CLINE_DESKTOP_INSTALLER_DIRECTORY: root,
						CLINE_DESKTOP_RUNTIME_DIRECTORY: root,
					},
				},
			),
		).rejects.toThrow("release manifest is invalid");
		expect(runInstaller).not.toHaveBeenCalled();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
