import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Run: bun sdk/scripts/inspect-hub-session.ts [sessionId] [discoveryFile]
// Reads an existing hub only; does not start a hub or execute an agent turn.
const [requestedSessionId, discoveryFile] = process.argv.slice(2);
const dataDir =
	process.env.CLINE_DATA_DIR ||
	join(process.env.CLINE_DIR || join(homedir(), ".cline"), "data");
const discoveryDir = join(dataDir, "locks", "hub");
const outputDir = join(tmpdir(), "cline-hub-session-inspection");
const clientId = `session-inspector-${crypto.randomUUID()}`;

type Frame = {
	kind: string;
	envelope: {
		requestId?: string;
		ok?: boolean;
		error?: { code: string; message: string };
		payload?: Record<string, unknown>;
	};
};

async function connect(path: string): Promise<WebSocket> {
	const record = JSON.parse(await readFile(path, "utf8"));
	if (typeof record.url !== "string" || typeof record.authToken !== "string") {
		throw new Error(`Invalid hub discovery record: ${path}`);
	}
	const ws = new WebSocket(record.url, [`cline-hub-auth.${record.authToken}`]);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error("Connection timed out"));
		}, 2_000);
		ws.addEventListener(
			"open",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
		ws.addEventListener(
			"error",
			() => {
				clearTimeout(timer);
				reject(new Error("Connection failed"));
			},
			{ once: true },
		);
	});
	console.log(`Connected to ${record.url}\nDiscovery: ${path}`);
	return ws;
}

async function findHub(): Promise<WebSocket> {
	if (discoveryFile || process.env.CLINE_HUB_DISCOVERY_PATH) {
		return connect(discoveryFile || process.env.CLINE_HUB_DISCOVERY_PATH!);
	}
	const owners = await readdir(join(discoveryDir, "owners")).catch(
		() => [] as string[],
	);
	const candidates = [
		join(discoveryDir, "production.json"),
		...owners
			.filter((name) => name.endsWith(".json"))
			.map((name) => join(discoveryDir, "owners", name)),
	];
	for (const path of candidates) {
		try {
			return await connect(path);
		} catch {
			/* Skip absent or stale records. */
		}
	}
	throw new Error(
		"No running local hub found. Start cline dashboard or supply a discovery file.",
	);
}

function request(
	ws: WebSocket,
	command: string,
	payload?: Record<string, unknown>,
	sessionId?: string,
	print = false,
): Promise<Frame> {
	const requestId = crypto.randomUUID();
	const frame = {
		kind: "command",
		envelope: {
			version: "v1",
			requestId,
			clientId,
			command,
			sessionId,
			payload,
		},
	};
	if (print) console.log("\nRequest:\n" + JSON.stringify(frame, null, 2));
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			ws.removeEventListener("message", onMessage);
			ws.removeEventListener("close", onClose);
		};
		const onClose = () => {
			cleanup();
			reject(new Error("Hub connection closed"));
		};
		const onMessage = (event: MessageEvent) => {
			let reply: Frame;
			try {
				reply = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (reply.kind !== "reply" || reply.envelope.requestId !== requestId)
				return;
			cleanup();
			if (!reply.envelope.ok)
				reject(new Error(JSON.stringify(reply.envelope.error)));
			else resolve(reply);
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`${command} timed out`));
		}, 10_000);
		ws.addEventListener("message", onMessage);
		ws.addEventListener("close", onClose);
		ws.send(JSON.stringify(frame));
	});
}

const ws = await findHub();
try {
	await request(ws, "client.register", {
		clientId,
		clientType: "session-monitor",
		displayName: "Session Inspector",
	});
	let sessionId = requestedSessionId;
	if (!sessionId) {
		const listReply = await request(ws, "session.list", { limit: 20 });
		const sessions = (listReply.envelope.payload?.sessions ?? []) as Array<{
			sessionId: string;
			status: string;
			updatedAt: number;
		}>;
		sessions.sort((a, b) => b.updatedAt - a.updatedAt);
		console.log("\nRecent sessions:");
		console.table(
			sessions.map((s) => ({
				sessionId: s.sessionId,
				status: s.status,
				updatedAt: new Date(s.updatedAt).toISOString(),
			})),
		);
		sessionId = sessions[0]?.sessionId;
		if (!sessionId) throw new Error("Hub returned no sessions to inspect.");
	}
	const reply = await request(
		ws,
		"session.get",
		{ includeSnapshot: true },
		sessionId,
		true,
	);
	console.log("\nResponse:\n" + JSON.stringify(reply, null, 2));
	await mkdir(outputDir, { recursive: true });
	const outputFile = join(outputDir, "session-response.json");
	await writeFile(outputFile, JSON.stringify(reply, null, 2) + "\n");
	console.log(`\nSaved response: ${outputFile}`);
} finally {
	if (ws.readyState === WebSocket.OPEN) {
		await request(ws, "client.unregister").catch(() => {});
	}
	ws.close();
}
