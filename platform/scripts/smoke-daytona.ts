/**
 * Real Daytona smoke test. It creates an ephemeral sandbox, writes and reads a
 * file, executes commands in several runtimes, and then deletes the sandbox.
 *
 * Usage: DAYTONA_API_KEY=... npm run smoke:daytona
 */
import { Daytona } from "@daytona/sdk";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

function sanitize(value: string): string {
	return value
		.replace(/dtn_[A-Za-z0-9]+/g, "dtn_[redacted]")
		.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

async function main() {
	const apiKey = process.env.DAYTONA_API_KEY;
	if (!apiKey) {
		console.error("DAYTONA_API_KEY is not set.");
		process.exit(2);
	}

	const daytona = new Daytona({
		apiKey,
		...(process.env.DAYTONA_API_URL ? { apiUrl: process.env.DAYTONA_API_URL } : {}),
		...(process.env.DAYTONA_TARGET ? { target: process.env.DAYTONA_TARGET } : {}),
	});

	console.log("Creating ephemeral Daytona sandbox…");
	const sandbox = await daytona.create(
		{
			name: `a21-smoke-${Date.now().toString(36)}`,
			language: "typescript",
			ephemeral: true,
			labels: { app: "21-agent", kind: "smoke-test" },
			autoStopInterval: 10,
		},
		{ timeout: 180 },
	);
	console.log(`Sandbox ready: ${sandbox.id}`);

	const results: Record<string, unknown> = {};
	try {
		const pwd = await sandbox.process.executeCommand("pwd");
		const root = `${pwd.result.trim()}/workspace`;
		await sandbox.process.executeCommand(`mkdir -p '${root}'`);
		await sandbox.fs.uploadFile(
			Buffer.from("21 Agent checks real sandbox file I/O.\n"),
			`${root}/smoke.txt`,
		);
		const readBack = await sandbox.fs.downloadFile(`${root}/smoke.txt`);
		results.fileRoundTrip = readBack.toString("utf8").trim();

		for (const [label, command] of [
			["node", "node --version"],
			["python", "python3 --version"],
			["gcc", "gcc --version | head -1"],
			["java", "java -version 2>&1 | head -1"],
			["go", "go version"],
			["rust", "rustc --version"],
			["php", "php --version | head -1"],
			["ruby", "ruby --version"],
		] as const) {
			const response = await sandbox.process.executeCommand(command, root, undefined, 30);
			results[label] = {
				exitCode: response.exitCode,
				output: sanitize(response.result).trim().split("\n")[0] ?? "",
			};
		}

		const writeAndRead = await sandbox.process.executeCommand(
			"echo 'console.log(6*7)' > smoke.mjs && node smoke.mjs",
			root,
			undefined,
			30,
		);
		results.execution = {
			exitCode: writeAndRead.exitCode,
			output: sanitize(writeAndRead.result).trim(),
		};

		const failed = await sandbox.process.executeCommand("exit 7", root, undefined, 10);
		results.exitCodePropagation = failed.exitCode;

		console.log(JSON.stringify({ ok: true, sandboxId: sandbox.id, results }, null, 2));
	} finally {
		await daytona.delete(sandbox, 120, true);
		console.log("Sandbox deleted.");
	}
}

main().catch((error) => {
	console.error(
		"Daytona smoke test failed:",
		sanitize(error instanceof Error ? error.message : String(error)),
	);
	process.exit(1);
});
