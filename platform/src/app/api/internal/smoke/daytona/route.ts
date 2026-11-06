import { Daytona } from "@daytona/sdk";
import { ApiError, handleApiError, jsonOk } from "@/lib/api";
import { getServerEnv } from "@/lib/env";
import { requireInternalSecret } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sanitize(value: string): string {
	return value
		.replace(/dtn_[A-Za-z0-9]+/g, "dtn_[redacted]")
		.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

/**
 * Creates a real, ephemeral Daytona sandbox, exercises file I/O and command
 * execution, then deletes it. Nothing about this endpoint is simulated.
 */
export async function POST(request: Request) {
	let sandboxId: string | null = null;
	let daytona: Daytona | null = null;
	try {
		requireInternalSecret(request);
		const env = getServerEnv();
		if (!env.DAYTONA_API_KEY) {
			throw new ApiError(503, "daytona_not_configured", "DAYTONA_API_KEY is not configured.");
		}

		daytona = new Daytona({
			apiKey: env.DAYTONA_API_KEY,
			...(env.DAYTONA_API_URL ? { apiUrl: env.DAYTONA_API_URL } : {}),
			...(env.DAYTONA_TARGET ? { target: env.DAYTONA_TARGET } : {}),
		});

		const started = Date.now();
		const sandbox = await daytona.create(
			{
				name: `a21-smoke-${Date.now().toString(36)}`,
				language: "typescript",
				ephemeral: true,
				labels: { app: "21-agent", kind: "smoke" },
				autoStopInterval: 10,
			},
			{ timeout: 180 },
		);
		sandboxId = sandbox.id;

		const pwd = await sandbox.process.executeCommand("pwd");
		const root = `${pwd.result.trim()}/workspace`;
		await sandbox.process.executeCommand(`mkdir -p '${root}'`);
		await sandbox.fs.uploadFile(Buffer.from("real file io\n"), `${root}/probe.txt`);
		const roundTrip = (await sandbox.fs.downloadFile(`${root}/probe.txt`)).toString("utf8").trim();

		const node = await sandbox.process.executeCommand(
			'node -e "console.log(6*7)"',
			root,
			undefined,
			60,
		);
		const python = await sandbox.process.executeCommand(
			'python3 -c "print(sum(range(5)))"',
			root,
			undefined,
			60,
		);
		const exit = await sandbox.process.executeCommand("exit 9", root, undefined, 30);

		return jsonOk({
			sandboxId,
			createdInMs: Date.now() - started,
			fileRoundTrip: roundTrip,
			node: {
				exitCode: node.exitCode,
				output: sanitize(node.result).trim().split("\n")[0] ?? "",
			},
			python: {
				exitCode: python.exitCode,
				output: sanitize(python.result).trim().split("\n")[0] ?? "",
			},
			exitCodePropagation: exit.exitCode,
		});
	} catch (error) {
		return handleApiError(error);
	} finally {
		if (daytona && sandboxId) {
			try {
				const sandbox = await daytona.get(sandboxId);
				await daytona.delete(sandbox, 120, true);
			} catch {
				console.error("[21-agent] smoke sandbox cleanup failed:", sandboxId);
			}
		}
	}
}
