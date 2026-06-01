/**
 * Quick diagnostic: start sidecar, create session, send a prompt, capture logs.
 * Run: bun run sidecar/chat-test.ts
 */
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";

const TIMEOUT = 60_000;
const cwd = join(import.meta.dir, "..");

let child: ChildProcess | null = null;
let wsEndpoint = "";
const stderrLines: string[] = [];

function startSidecar(): Promise<string> {
	return new Promise((resolve, reject) => {
		child = spawn("bun", ["run", "sidecar/index.ts"], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});
		const timer = setTimeout(
			() => reject(new Error("sidecar did not become ready")),
			20_000,
		);
		child.stdout?.on("data", (chunk) => {
			for (const line of String(chunk).split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const parsed = JSON.parse(trimmed);
					if (parsed.type === "ready" && parsed.wsEndpoint) {
						clearTimeout(timer);
						resolve(parsed.wsEndpoint);
						return;
					}
				} catch {}
			}
		});
		child.stderr?.on("data", (chunk) => {
			const text = String(chunk).trim();
			if (text) {
				stderrLines.push(text);
				process.stderr.write(`[sidecar-stderr] ${text}\n`);
			}
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`sidecar exited with code ${code}`));
		});
	});
}

function sendWsCommand<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<{ result: T; events: Array<Record<string, unknown>> }> {
	return new Promise((resolve, reject) => {
		const events: Array<Record<string, unknown>> = [];
		const socket = new WebSocket(wsEndpoint);
		const timer = setTimeout(() => {
			socket.close();
			reject(
				new Error(`timed out waiting for ${command} (events=${events.length})`),
			);
		}, TIMEOUT);
		socket.onopen = () => {
			socket.send(
				JSON.stringify({ type: "command", id: "test", command, args }),
			);
		};
		socket.onmessage = (event) => {
			const parsed = JSON.parse(String(event.data));
			if (parsed.type === "event") {
				events.push(parsed.event as Record<string, unknown>);
				return;
			}
			if (parsed.type === "response" && parsed.id === "test") {
				clearTimeout(timer);
				socket.close();
				if (!parsed.ok) {
					reject(new Error(parsed.error || `${command} failed`));
					return;
				}
				resolve({ result: parsed.result as T, events });
			}
		};
		socket.onerror = () => {
			clearTimeout(timer);
			reject(new Error(`websocket error during ${command}`));
		};
	});
}

async function main() {
	console.log("Starting sidecar...");
	wsEndpoint = await startSidecar();
	console.log(`Sidecar ready at ${wsEndpoint}`);

	// Step 1: Start a session
	console.log("\n=== Step 1: Start session ===");
	const { result: startResult } = await sendWsCommand<{ sessionId: string }>(
		"chat_session_command",
		{
			request: {
				action: "start",
				config: {
					provider: "cline",
					model: "claude-sonnet-4-20250514",
					apiKey: process.env.CLINE_API_KEY || "",
					workspaceRoot: cwd,
					cwd: cwd,
					mode: "act",
					enableTools: false,
					enableSpawn: false,
					enableTeams: false,
				},
			},
		},
	);
	console.log("Start result:", JSON.stringify(startResult, null, 2));
	const sessionId = startResult.sessionId;
	if (!sessionId) {
		throw new Error("No sessionId returned from start");
	}

	// Step 2: Send a prompt
	console.log("\n=== Step 2: Send prompt ===");
	const { result: sendResult, events } = await sendWsCommand<unknown>(
		"chat_session_command",
		{
			request: {
				action: "send",
				sessionId,
				prompt: "Say hello in one short sentence.",
			},
		},
	);
	console.log("Send result:", JSON.stringify(sendResult, null, 2));
	console.log(`Events received during send: ${events.length}`);
	for (const evt of events.slice(0, 20)) {
		const payload =
			evt.payload && typeof evt.payload === "object"
				? (evt.payload as Record<string, unknown>)
				: {};
		console.log(
			`  event: ${evt.name} payload.stream=${payload.stream ?? "N/A"} chunk=${String(payload.chunk ?? "").slice(0, 80)}`,
		);
	}

	console.log("\n=== Stderr lines ===");
	for (const line of stderrLines) {
		if (line.includes("[sidecar:")) {
			console.log(`  ${line}`);
		}
	}

	console.log("\nDone.");
}

main()
	.catch((err) => {
		console.error("FAILED:", err.message);
		console.log("\n=== Stderr lines ===");
		for (const line of stderrLines) {
			if (
				line.includes("[sidecar:") ||
				line.includes("error") ||
				line.includes("Error")
			) {
				console.log(`  ${line}`);
			}
		}
	})
	.finally(() => {
		child?.kill("SIGTERM");
		process.exit(0);
	});
