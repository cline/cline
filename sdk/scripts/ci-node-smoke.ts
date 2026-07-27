#!/usr/bin/env bun

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function runCommand(
	cmd: string[],
	options: {
		cwd: string;
		env?: Record<string, string | undefined>;
		captureStdout?: boolean;
		timeoutMs?: number;
	},
): Promise<string> {
	const captureStdout = options.captureStdout === true;
	let timedOut = false;
	const proc = Bun.spawn(cmd, {
		cwd: options.cwd,
		env: {
			...process.env,
			...options.env,
		},
		stdout: captureStdout ? "pipe" : "inherit",
		stderr: "inherit",
	});
	const stdoutPromise =
		captureStdout && proc.stdout
			? new Response(proc.stdout).text()
			: Promise.resolve("");
	const timeout = setTimeout(
		() => {
			timedOut = true;
			proc.kill();
		},
		options.timeoutMs ?? 5 * 60_000,
	);
	timeout.unref();
	const exitCode = await proc.exited.finally(() => clearTimeout(timeout));
	const stdout = await stdoutPromise;
	if (exitCode !== 0) {
		if (timedOut) {
			throw new Error(
				`${cmd.join(" ")} timed out after ${options.timeoutMs ?? 5 * 60_000}ms`,
			);
		}
		throw new Error(`${cmd.join(" ")} exited with code ${exitCode}`);
	}
	return stdout.trim();
}

async function packWorkspace(
	workspace: "core" | "agents" | "llms" | "shared",
	packDir: string,
): Promise<string> {
	const destination = await mkdtemp(join(packDir, `${workspace}-`));
	await runCommand(["bun", "pm", "pack", "--destination", destination], {
		cwd: join(root, `packages/${workspace}`),
		timeoutMs: 2 * 60_000,
	});
	const files = (await readdir(destination)).filter((file) =>
		file.endsWith(".tgz"),
	);
	if (files.length !== 1) {
		throw new Error(
			`Expected one tarball for ${workspace}, found ${files.length}`,
		);
	}
	return join(destination, files[0]);
}

async function main(): Promise<void> {
	const packDir = await mkdtemp(
		join(tmpdir(), "bedrock-coder-node-smoke-packs-"),
	);
	const smokeDir = await mkdtemp(join(tmpdir(), "bedrock-coder-node-smoke-"));
	const sessionsDir = await mkdtemp(
		join(tmpdir(), "bedrock-coder-node-sessions-"),
	);
	const bunCacheDir = await mkdtemp(
		join(tmpdir(), "bedrock-coder-node-bun-cache-"),
	);
	const bunEnv = { BUN_INSTALL_CACHE_DIR: bunCacheDir };

	try {
		console.log("Packing smoke-test tarballs with Bun...");
		const tarballs = {
			core: await packWorkspace("core", packDir),
			agents: await packWorkspace("agents", packDir),
			llms: await packWorkspace("llms", packDir),
			shared: await packWorkspace("shared", packDir),
		};
		const localPackages = {
			"@bedrock-coder/core": `file:${tarballs.core}`,
			"@bedrock-coder/agents": `file:${tarballs.agents}`,
			"@bedrock-coder/llms": `file:${tarballs.llms}`,
			"@bedrock-coder/shared": `file:${tarballs.shared}`,
		};

		await writeFile(
			join(smokeDir, "package.json"),
			`${JSON.stringify(
				{
					name: "bedrock-coder-node-smoke",
					private: true,
					type: "module",
					dependencies: localPackages,
					overrides: localPackages,
				},
				null,
				2,
			)}\n`,
		);

		console.log("Installing smoke-test dependencies...");
		await runCommand(["bun", "install"], {
			cwd: smokeDir,
			env: bunEnv,
			timeoutMs: 10 * 60_000,
		});

		const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
		const smokeSource =
			nodeMajor >= 24
				? `
					const { SqliteSessionStore } = await import("@bedrock-coder/core");
					const store = new SqliteSessionStore({ sessionsDir: process.env.BEDROCK_CODER_DATA_DIR });
					try {
						store.init();
						console.log("SQLite smoke test passed");
					} finally {
						store.close();
					}
				`
				: `
					const { resolveSessionBackend } = await import("@bedrock-coder/core");
					await resolveSessionBackend({ backendMode: "local" });
					console.log("Node compatibility smoke test passed");
				`;
		const smokeFile = join(smokeDir, "smoke.mjs");
		await writeFile(smokeFile, `${smokeSource.trim()}\n`);

		console.log("Running smoke test...");
		await runCommand(["node", smokeFile], {
			cwd: smokeDir,
			env: {
				...bunEnv,
				BEDROCK_CODER_DATA_DIR: sessionsDir,
			},
			timeoutMs: 2 * 60_000,
		});
	} finally {
		await rm(packDir, { recursive: true, force: true });
		await rm(smokeDir, { recursive: true, force: true });
		await rm(sessionsDir, { recursive: true, force: true });
		await rm(bunCacheDir, { recursive: true, force: true });
	}
}

await main();
