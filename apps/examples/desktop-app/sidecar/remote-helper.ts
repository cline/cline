import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
	type RemoteHelperTarget,
	remoteHelperBinaryFilename,
} from "@cline/core";
import { resolveDesktopCliPath } from "./cli-runtime";
import { desktopRuntimeInstallers } from "./runtime-installer";

const execFileAsync = promisify(execFile);
function isUniversalMacCli(path: string): boolean {
	try {
		const fd = openSync(path, "r");
		try {
			const header = Buffer.alloc(4);
			readSync(fd, header, 0, 4, 0);
			return header.readUInt32BE(0) === 0xcafebabe;
		} finally {
			closeSync(fd);
		}
	} catch {
		return false;
	}
}

/** Install an SSH runtime from the same release as the desktop backend. */
export async function resolveDesktopRemoteHelper(
	target: RemoteHelperTarget,
	options: {
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
		arch?: string;
		probeRuntime?: (path: string) => Promise<{ cpuBaseline?: boolean }>;
		runInstaller?: (
			script: string,
			release: string,
			target: string,
			directory: string,
		) => Promise<void>;
	} = {},
): Promise<string | undefined> {
	const env = options.env ?? process.env;
	if (env.CLINE_REMOTE_HELPER_BINARY) return env.CLINE_REMOTE_HELPER_BINARY;
	if (env.CLINE_REMOTE_HELPER_DIRECTORY) {
		const path = join(
			env.CLINE_REMOTE_HELPER_DIRECTORY,
			remoteHelperBinaryFilename(target),
		);
		if (existsSync(path)) return path;
	}
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const cli = resolveDesktopCliPath(env);
	let portableCpu = target.platform !== "linux" || target.arch !== "x64";
	if (!portableCpu && cli && platform === "linux" && arch === "x64") {
		try {
			const info = options.probeRuntime
				? await options.probeRuntime(cli)
				: JSON.parse(
						(
							await execFileAsync(cli, ["--runtime-info"], {
								env: {
									...env,
									BUN_BE_BUN: undefined,
									CLINE_NO_AUTO_UPDATE: "1",
								},
								timeout: 5000,
							})
						).stdout,
					);
			portableCpu = info.cpuBaseline === true;
		} catch {}
	}
	const installerDir = env.CLINE_DESKTOP_INSTALLER_DIRECTORY;
	const runtimeDir = env.CLINE_DESKTOP_RUNTIME_DIRECTORY;
	if (installerDir && runtimeDir) {
		const release = (
			await readFile(join(installerDir, "release.txt"), "utf8")
		).trim();
		if (!/^cli-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release))
			throw new Error("Desktop CLI release manifest is invalid");
		const triple =
			target.platform === "darwin"
				? `${target.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
				: remoteHelperBinaryFilename(target).slice("cline-".length);
		// The host CLI is shared with terminal use; never download a duplicate
		// for an SSH target that this same executable can run on.
		if (
			cli &&
			portableCpu &&
			platform === target.platform &&
			(arch === target.arch ||
				(platform === "darwin" && isUniversalMacCli(cli)))
		)
			return cli;
		const directory = join(runtimeDir, release, triple);
		const run =
			options.runInstaller ??
			(async (script, release, triple, directory) => {
				if (platform === "win32")
					throw new Error(
						"Standalone SSH downloads are not available on Windows; supply a local runtime directory",
					);
				const identity = JSON.parse(
					await readFile(join(installerDir, "identity.json"), "utf8"),
				);
				if (typeof identity.buildId !== "string" || !identity.buildId.trim())
					throw new Error("Desktop SDK identity manifest is invalid");
				await desktopRuntimeInstallers.run(
					"/bin/bash",
					[
						script,
						"--release",
						release,
						"--target",
						triple,
						"--install-dir",
						directory,
						"--no-modify-path",
					],
					{
						...env,
						CLINE_INSTALL_BUILD_ID: identity.buildId,
						CLINE_INSTALL_BUILD_EPOCH_MS: undefined,
					},
				);
			});
		await run(join(installerDir, "install.sh"), release, triple, directory);
		const installed = join(directory, "cline");
		if (!existsSync(installed))
			throw new Error(`CLI installer did not create ${installed}`);
		return installed;
	}
	// Source development uses the locally compiled host CLI. Other targets
	// can be supplied explicitly without depending on release infrastructure.
	if (
		cli &&
		portableCpu &&
		platform === target.platform &&
		(arch === target.arch || (platform === "darwin" && isUniversalMacCli(cli)))
	)
		return cli;
	if (
		cli &&
		platform === "darwin" &&
		target.platform === "darwin" &&
		existsSync(join(dirname(cli), "cline-cli-universal-apple-darwin"))
	) {
		return join(dirname(cli), "cline-cli-universal-apple-darwin");
	}
	return undefined;
}
