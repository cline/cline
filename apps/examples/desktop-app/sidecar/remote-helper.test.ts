import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { resolveDesktopRemoteHelper } from "./remote-helper";

it("downloads only the requested SSH target from the desktop's exact release", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-runtime-"));
	try {
		const installerDir = join(root, "installer");
		mkdirSync(installerDir);
		writeFileSync(
			join(installerDir, "release.txt"),
			"desktop-v0.0.43-beta.1\n",
		);
		const directory = join(root, "cache", "aarch64-unknown-linux-gnu");
		const runInstaller = vi.fn(async () => {
			mkdirSync(directory, { recursive: true });
			writeFileSync(join(directory, "cline"), "runtime");
		});
		await expect(
			resolveDesktopRemoteHelper(
				{ platform: "linux", arch: "arm64" },
				{
					platform: "win32",
					env: {
						CLINE_DESKTOP_INSTALLER_DIRECTORY: installerDir,
						CLINE_DESKTOP_RUNTIME_DIRECTORY: join(root, "cache"),
					},
					runInstaller,
				},
			),
		).resolves.toBe(join(directory, "cline"));
		expect(runInstaller).toHaveBeenCalledWith(
			join(installerDir, "install.ps1"),
			"desktop-v0.0.43-beta.1",
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
				env: { CLINE_DESKTOP_CLI_PATH: "/dev/cline" },
			},
		),
	).resolves.toBeUndefined();
});

it("propagates installation failures instead of uploading a missing runtime", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-runtime-"));
	try {
		writeFileSync(join(root, "release.txt"), "desktop-v0.0.43\n");
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
		writeFileSync(join(root, "release.txt"), "desktop-v0.0.43\n");
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
