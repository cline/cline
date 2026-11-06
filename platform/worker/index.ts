import { hostname } from "node:os";
import { config } from "dotenv";
import { getServerEnv } from "@/lib/env";
import { runTick } from "./tick";

config({ path: ".env.local" });
config();

async function main() {
	const env = getServerEnv();
	if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
		console.error("[21-agent worker] SUPABASE_SERVICE_ROLE_KEY is required.");
		process.exit(1);
	}
	if (!env.DAYTONA_API_KEY) {
		console.error("[21-agent worker] DAYTONA_API_KEY is required for cloud execution.");
		process.exit(1);
	}

	const workerId = process.env.WORKER_ID ?? `worker-${hostname()}-${process.pid}`;
	let stopping = false;

	const stop = (signal: string) => {
		if (stopping) return;
		stopping = true;
		console.log(`[21-agent worker] ${signal} received; finishing the current job and exiting.`);
	};
	process.on("SIGINT", () => stop("SIGINT"));
	process.on("SIGTERM", () => stop("SIGTERM"));

	console.log(
		`[21-agent worker] ${workerId} online — polling every ${env.WORKER_POLL_MS}ms, lease ${env.WORKER_LEASE_SECONDS}s`,
	);

	while (!stopping) {
		const started = Date.now();
		try {
			const result = await runTick(workerId, env.WORKER_LEASE_SECONDS);
			if (result.processed) {
				console.log(
					`[21-agent worker] job ${result.jobId} task ${result.taskId} → ${result.outcome}${
						result.error ? ` (${result.error.slice(0, 300)})` : ""
					}`,
				);
			}
		} catch (error) {
			console.error(
				"[21-agent worker] Loop error:",
				error instanceof Error ? error.message : String(error),
			);
		}

		if (stopping) break;
		const elapsed = Date.now() - started;
		const wait = Math.max(500, env.WORKER_POLL_MS - (elapsed < 3_000 ? 0 : elapsed - 3_000));
		await new Promise((resolve) => setTimeout(resolve, wait));
	}

	console.log("[21-agent worker] stopped.");
}

main().catch((error) => {
	console.error("[21-agent worker] Fatal:", error instanceof Error ? error.message : String(error));
	process.exit(1);
});
