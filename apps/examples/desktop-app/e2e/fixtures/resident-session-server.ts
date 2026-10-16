// Real Hub + sidecar + CLI session client. Only the model endpoint is a fixture.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const root = process.env.CLINE_E2E_ROOT;
if (!root) throw new Error("CLINE_E2E_ROOT must name test-owned storage");
const workspace = join(root, "workspace");
await mkdir(workspace);
process.env.CLINE_DIR = join(root, "cline");
process.env.CLINE_HUB_DISCOVERY_PATH = join(root, "hub.json");
process.env.DO_NOT_TRACK = "1";
// Load SDK/storage only after installing the isolated paths.
const { startHubWebSocketServer, createLocalHubScheduleRuntimeHandlers } =
	await import("@cline/core/hub");
const { createCliCore } = await import("../../../../cli/src/session/session");
let cli: Awaited<ReturnType<typeof createCliCore>> | undefined;
let sidecar: ReturnType<typeof Bun.spawn> | undefined;
let endpoint = "";
const requests: unknown[] = [];
const model = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		if (request.method === "GET")
			return new Response(
				"<!doctype html><title>Session lifecycle E2E</title>",
				{ headers: { "content-type": "text/html" } },
			);
		const body = (await request.json()) as { messages: unknown[] };
		requests.push(body.messages);
		const text = `Fixture response ${requests.length}`;
		const chunk = (delta: object, finish_reason: string | null = null) => ({
			id: `turn-${requests.length}`,
			object: "chat.completion.chunk",
			created: 1,
			model: "fixture-model",
			choices: [{ index: 0, delta, finish_reason }],
		});
		return new Response(
			[
				`data: ${JSON.stringify(chunk({ role: "assistant", content: text }))}\n\n`,
				`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`,
				"data: [DONE]\n\n",
			].join(""),
			{ headers: { "content-type": "text/event-stream" } },
		);
	},
});
const hub = await startHubWebSocketServer({
	host: "127.0.0.1",
	port: 0,
	workspaceRoot: workspace,
	runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
});
process.env.CLINE_HUB_PORT = String(hub.port);
const config = {
	provider: "openai-compatible",
	model: "fixture-model",
	apiKey: "fixture-key",
	baseUrl: `http://127.0.0.1:${model.port}/v1`,
	cwd: workspace,
	workspaceRoot: workspace,
	systemPrompt: "Reply briefly without tools.",
	enableTools: false,
	enableSpawnAgent: false,
	enableAgentTeams: false,
};
async function launchSidecar() {
	const reservation = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});
	const port = reservation.port;
	await reservation.stop(true);
	sidecar = Bun.spawn([process.execPath, "run", "sidecar/index.ts"], {
		cwd: resolve(import.meta.dir, "../.."),
		env: {
			...process.env,
			CLINE_SIDECAR_PORT: String(port),
			CLINE_SIDECAR_TRUSTED_ORIGINS: `http://127.0.0.1:${model.port}`,
			CLINE_SIDECAR_APPROVAL_TOKEN: "fixture-approval",
		},
		stdout: "pipe",
		stderr: "inherit",
	});
	const child = sidecar;
	endpoint = await new Promise<string>((resolveReady, reject) => {
		const lines = createInterface({
			input: Readable.fromWeb(child.stdout as never),
		});
		const deadline = setTimeout(
			() => reject(new Error("Sidecar startup timed out")),
			60_000,
		);
		lines.on("line", (line) => {
			try {
				const value = JSON.parse(line);
				if (value.type === "ready") {
					clearTimeout(deadline);
					resolveReady(value.wsEndpoint);
				}
			} catch {
				/* Other startup diagnostics are not protocol messages. */
			}
		});
		void child.exited.then((code) => {
			clearTimeout(deadline);
			reject(new Error(`Sidecar exited: ${code}`));
		});
	});
	return endpoint;
}
await launchSidecar();
const control = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		try {
			const path = new URL(request.url).pathname;
			if (path === "/shutdown") {
				setTimeout(() => void close(), 0);
				return Response.json({ stopping: true });
			}
			if (path === "/restart") {
				sidecar?.kill();
				await sidecar?.exited;
				return Response.json({ endpoint: await launchSidecar() });
			}
			if (path === "/cli-resume") {
				const { sessionId } = (await request.json()) as { sessionId: string };
				cli = await createCliCore({
					backendMode: "hub",
					cwd: workspace,
					workspaceRoot: workspace,
				});
				const initialMessages = await cli.readMessages(sessionId);
				await cli.start({
					config: {
						...config,
						providerId: config.provider,
						modelId: config.model,
						sessionId,
					},
					interactive: true,
					initialMessages,
				});
				await cli.send({ sessionId, prompt: "Follow-up from CLI" });
				return Response.json({ sessionId });
			}
			if (path === "/requests") return Response.json(requests);
			return new Response("Unknown fixture command", { status: 404 });
		} catch (error) {
			// Keep error details (which may include stack traces) server-side.
			console.error("Fixture control command failed:", error);
			return new Response("Fixture control command failed", { status: 500 });
		}
	},
});
let closing = false;
async function close() {
	if (closing) return;
	closing = true;
	sidecar?.kill();
	await sidecar?.exited;
	await cli?.dispose();
	await hub.close();
	await control.stop(true);
	await model.stop(true);
	process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
process.stdin.resume();
process.stdin.on("end", () => void close());
console.log(
	JSON.stringify({
		type: "fixture-ready",
		endpoint,
		config,
		control: `http://127.0.0.1:${control.port}`,
	}),
);
