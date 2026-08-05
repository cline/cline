import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
	deterministicText,
	encodeReplayToken,
	normalizeScenarioSpec,
	replayModel,
	replaySpecFromModel,
	requiresExtremeOptIn,
	scenarioFingerprint,
	splitUtf8,
} from "./scenario-spec.mjs";
import {
	resolveScenario,
	SCENARIOS,
	scenarioLimits,
	scenarioNames,
} from "./scenarios.mjs";

const JSON_LIMIT_BYTES = 80 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export async function createHarnessServer(options = {}) {
	const host = options.host ?? "127.0.0.1";
	if (!LOOPBACK_HOSTS.has(host) && !options.allowRemote) {
		throw new Error(
			`Refusing to bind to non-loopback host ${host}; pass allowRemote explicitly`,
		);
	}

	const limits = options.limits ?? scenarioLimits(options.env);
	const allowExtreme = options.allowExtreme === true;
	const allowUnreachableReplayCallbacks =
		options.allowUnreachableReplayCallbacks === true;
	const startedAt = performance.now();
	const traces = [];
	const traceStream = options.traceFile
		? createWriteStream(options.traceFile, { flags: "a" })
		: undefined;
	const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
	eventLoopDelay.enable();

	let server;
	let origin;
	let eventSequence = 0;
	let closePromise;

	const record = (traceId, event, data = {}) => {
		const memory = process.memoryUsage();
		const entry = {
			sequence: ++eventSequence,
			traceId,
			event,
			at: new Date().toISOString(),
			elapsedMs: round(performance.now() - startedAt),
			memory: {
				rssBytes: memory.rss,
				heapUsedBytes: memory.heapUsed,
				externalBytes: memory.external,
			},
			eventLoopDelayMs: {
				mean: finiteRound(eventLoopDelay.mean / 1e6),
				max: finiteRound(eventLoopDelay.max / 1e6),
				p99: finiteRound(eventLoopDelay.percentile(99) / 1e6),
			},
			...data,
		};
		traces.push(entry);
		const line = `${JSON.stringify(entry)}\n`;
		traceStream?.write(line);
		options.onTrace?.(entry);
		return entry;
	};

	server = createHttpServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", origin);
			if (request.method === "GET" && url.pathname === "/health") {
				return sendJson(response, 200, {
					ok: true,
					scenarios: scenarioNames(),
				});
			}
			if (request.method === "GET" && url.pathname === "/v1/models") {
				return sendJson(response, 200, {
					object: "list",
					data: scenarioNames().map((name) => ({
						id: `harness/${name}`,
						object: "model",
						owned_by: "cline",
					})),
				});
			}
			if (request.method === "GET" && url.pathname === "/__harness/traces") {
				const traceId = url.searchParams.get("traceId");
				return sendJson(
					response,
					200,
					traceId
						? traces.filter((entry) => entry.traceId === traceId)
						: traces,
				);
			}
			if (request.method === "GET" && url.pathname === "/__harness/marker") {
				const traceId = sanitizeTraceId(url.searchParams.get("traceId"));
				record(traceId, "command_callback_received", {
					round: parseRound(url.searchParams.get("round")),
				});
				return sendJson(response, 200, { ok: true, traceId });
			}
			if (
				request.method === "POST" &&
				url.pathname === "/v1/chat/completions"
			) {
				const body = await readJson(request);
				return await handleCompletion({
					request,
					response,
					body,
					limits,
					origin,
					record,
					allowExtreme,
					allowUnreachableReplayCallbacks,
				});
			}
			sendJson(response, 404, {
				error: { message: "Not found", type: "invalid_request_error" },
			});
		} catch (error) {
			if (!response.headersSent) {
				sendJson(response, error?.code === "BODY_TOO_LARGE" ? 413 : 400, {
					error: {
						message: error instanceof Error ? error.message : String(error),
						type: "invalid_request_error",
					},
				});
			} else if (!response.destroyed) {
				response.destroy(error instanceof Error ? error : undefined);
			}
		}
	});

	try {
		server.listen(options.port ?? 4319, host);
		await once(server, "listening");
	} catch (error) {
		eventLoopDelay.disable();
		await endTraceStream(traceStream);
		throw error;
	}
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Harness server did not receive a TCP address");
	origin = `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
	record("server", "server_started", { origin, limits });

	return {
		origin,
		traces,
		async close() {
			closePromise ??= closeHarnessServer(server, eventLoopDelay, traceStream);
			await closePromise;
		},
	};
}

async function handleCompletion({
	request,
	response,
	body,
	limits,
	origin,
	record,
	allowExtreme,
	allowUnreachableReplayCallbacks,
}) {
	const scenarioName = resolveScenario(body.model);
	const scenario = SCENARIOS[scenarioName];
	const scenarioSpec = resolveRequestSpec(
		body.model,
		scenarioName,
		scenario,
		limits,
	);
	const isReplay = replaySpecFromModel(body.model) !== undefined;
	if (isReplay && requiresExtremeOptIn(scenarioSpec) && !allowExtreme) {
		throw new Error(
			"Replay scenario requires explicit extreme opt-in when starting the harness",
		);
	}
	if (
		isReplay &&
		isToolScenario(scenarioSpec) &&
		origin !== "http://127.0.0.1:4319" &&
		!allowUnreachableReplayCallbacks
	) {
		throw new Error(
			"Replay tool callbacks target http://127.0.0.1:4319 for byte-stable execution; start the harness on the standard executable endpoint",
		);
	}
	const replayToken = encodeReplayToken(scenarioSpec);
	const fingerprint = scenarioFingerprint(scenarioSpec);
	const correlated = findCorrelation(body.messages);
	const traceId =
		correlated.traceId ??
		(isReplay ? fingerprint : randomUUID().replaceAll("-", "").slice(0, 16));
	const roundNumber = correlated.round + 1;
	record(traceId, "completion_request_received", {
		scenario: scenarioName,
		scenarioSpec,
		replayToken,
		replayModel: replayModel(scenarioSpec),
		fingerprint,
		round: roundNumber,
		messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
		toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
	});

	if (body.stream !== true) {
		return sendJson(response, 400, {
			error: {
				message: "The harness requires stream=true",
				type: "invalid_request_error",
			},
		});
	}

	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"x-cline-harness-scenario": scenarioName,
		"x-cline-harness-trace-id": traceId,
		"x-cline-harness-replay": replayToken,
		"x-cline-harness-fingerprint": fingerprint,
	});
	response.flushHeaders();
	record(traceId, "response_headers_sent", {
		scenario: scenarioName,
		round: roundNumber,
	});

	const stream = createSseWriter(
		response,
		traceId,
		scenarioName,
		roundNumber,
		record,
	);
	if (scenarioSpec.scenario === "stall") {
		await stream.delta(
			{
				role: "assistant",
				tool_calls: [toolCallStart(traceId, roundNumber, "run_commands")],
			},
			"tool_call_started",
		);
		record(traceId, "tool_call_started", { round: roundNumber });
		record(traceId, "stream_stalled", { round: roundNumber });
		await onceClosed(request, response);
		return;
	}
	if (scenarioSpec.scenario === "disconnect") {
		await stream.delta(
			{
				role: "assistant",
				tool_calls: [toolCallStart(traceId, roundNumber, "run_commands")],
			},
			"tool_call_started",
		);
		record(traceId, "tool_call_started", { round: roundNumber });
		record(traceId, "stream_disconnected", { round: roundNumber });
		response.destroy();
		return;
	}
	if (scenarioSpec.scenario === "text") {
		const text = deterministicText(scenarioSpec.size, scenarioSpec.seed);
		for (const chunkText of splitUtf8(text, scenarioSpec.chunkBytes)) {
			const written = await stream.delta(
				{ content: chunkText },
				"burst_text",
				scenarioSpec.delayMs,
			);
			if (!written) return;
		}
		await stream.finish("stop");
		return;
	}

	const toolName =
		scenarioSpec.scenario === "editor-old-text" ? "editor" : "run_commands";
	if (!hasTool(body.tools, toolName)) {
		await stream.delta(
			{
				content: `Harness requires the ${toolName} tool; no tool call was emitted.`,
			},
			"missing_tool_notice",
		);
		await stream.finish("stop");
		return;
	}

	if (correlated.round >= scenarioSpec.rounds) {
		await stream.delta(
			{
				content: `Completed ${scenarioSpec.rounds} deterministic harness round(s).`,
			},
			"completion_text",
		);
		await stream.finish("stop");
		return;
	}
	const delayMs = scenarioSpec.delayMs;
	await stream.delta({ role: "assistant" }, "assistant_started", delayMs);
	const parallel =
		scenarioSpec.scenario === "parallel-tools" ? scenarioSpec.parallel : 1;
	const starts = Array.from({ length: parallel }, (_, index) =>
		toolCallStart(traceId, roundNumber, toolName, index),
	);
	await stream.delta({ tool_calls: starts }, "tool_call_started", delayMs);
	record(traceId, "tool_call_started", { round: roundNumber });
	let totalArgumentBytes = 0;
	for (let index = 0; index < parallel; index++) {
		const input = JSON.stringify(
			buildToolInput({
				scenarioSpec,
				// Replay output includes the callback URL, so pin its origin to the
				// documented endpoint. A token then reproduces identical bytes across
				// server processes, not merely within one process.
				origin: isReplay ? "http://127.0.0.1:4319" : origin,
				traceId,
				roundNumber,
				index,
			}),
		);
		totalArgumentBytes += Buffer.byteLength(input);
		for (const inputChunk of splitUtf8(input, scenarioSpec.chunkBytes)) {
			const written = await stream.delta(
				{ tool_calls: [toolCallArguments(inputChunk, index)] },
				"tool_arguments_fragment",
				delayMs,
			);
			if (!written) return;
		}
	}
	record(traceId, "tool_arguments_complete", {
		round: roundNumber,
		argumentBytes: totalArgumentBytes,
		parallel,
	});
	await stream.finish("tool_calls", delayMs);
}

function resolveRequestSpec(model, scenarioName, scenario, limits) {
	const replaySpec = replaySpecFromModel(model);
	if (replaySpec) return replaySpec;
	const legacy = {
		baseline: {},
		"fragmented-tool-call": {
			chunkBytes: 1,
			delayMs: limits.fragmentDelayMs,
		},
		"slow-chunks": { chunkBytes: 1, delayMs: limits.slowChunkDelayMs },
		"stall-after-tool-start": { scenario: "stall" },
		"disconnect-after-tool-start": { scenario: "disconnect" },
		"burst-output": {
			scenario: "text",
			size: limits.burstBytes,
			chunkBytes: 1024,
		},
		"repeated-safe-tools": { rounds: limits.repeatedToolCalls },
	};
	return normalizeScenarioSpec({
		scenario:
			scenario.kind === "stall"
				? "stall"
				: scenario.kind === "disconnect"
					? "disconnect"
					: "baseline",
		...(legacy[scenarioName] ?? {}),
	});
}

function hasTool(tools, toolName) {
	return (
		Array.isArray(tools) &&
		tools.some(
			(tool) => tool?.function?.name === toolName || tool?.name === toolName,
		)
	);
}

function buildToolInput({ scenarioSpec, origin, traceId, roundNumber, index }) {
	if (scenarioSpec.scenario === "editor-old-text") {
		return {
			path: "deterministic-harness-fixture.txt",
			old_text: deterministicText(scenarioSpec.size, scenarioSpec.seed),
			new_text: `harness replacement ${scenarioSpec.seed}`,
		};
	}
	const command = callbackCommand(origin, traceId, roundNumber, index);
	return {
		commands: [command],
		...(scenarioSpec.scenario === "tool-arguments"
			? {
					harness_padding: deterministicText(
						scenarioSpec.size,
						scenarioSpec.seed,
					),
				}
			: {}),
	};
}

function isToolScenario(spec) {
	return (
		spec.scenario !== "text" &&
		spec.scenario !== "stall" &&
		spec.scenario !== "disconnect"
	);
}

function createSseWriter(response, traceId, scenario, roundNumber, record) {
	let chunkSequence = 0;
	let totalBytes = 0;
	const write = async (payload, phase, delayMs = 0) => {
		if (delayMs > 0) {
			const remainedOpen = await delayOrClose(delayMs, response);
			if (!remainedOpen) return false;
		}
		if (response.destroyed) return false;
		const data = `data: ${JSON.stringify(payload)}\n\n`;
		const canContinue = response.write(data);
		chunkSequence++;
		totalBytes += Buffer.byteLength(data);
		// A burst should pressure the client, not fill the harness trace with
		// one memory snapshot per KiB and make the harness its own bottleneck.
		if (
			chunkSequence === 1 ||
			chunkSequence % 256 === 0 ||
			phase === "finish"
		) {
			record(traceId, "sse_chunk_sent", {
				scenario,
				round: roundNumber,
				chunkSequence,
				phase,
				bytes: Buffer.byteLength(data),
			});
		}
		if (!canContinue && !response.destroyed)
			await waitForDrainOrClose(response);
		return !response.destroyed;
	};
	return {
		delta(delta, phase, delayMs) {
			return write(completionChunk(delta, null), phase, delayMs);
		},
		async finish(reason, delayMs = 0) {
			await write(completionChunk({}, reason), "finish", delayMs);
			record(traceId, "stream_summary", {
				round: roundNumber,
				chunkCount: chunkSequence,
				bytes: totalBytes,
			});
			await writeDone(response, traceId, roundNumber, record);
		},
	};
}

function completionChunk(delta, finishReason) {
	return {
		id: "chatcmpl-cline-harness",
		object: "chat.completion.chunk",
		created: 1,
		model: "cline-harness",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	};
}

async function writeDone(response, traceId, roundNumber, record) {
	if (!response.destroyed) {
		response.end("data: [DONE]\n\n");
		record(traceId, "stream_finished", { round: roundNumber });
	}
}

function toolCallStart(traceId, roundNumber, toolName, index = 0) {
	return {
		index,
		id: `call_harness_${traceId}_${roundNumber}_${index}`,
		type: "function",
		function: { name: toolName, arguments: "" },
	};
}

function toolCallArguments(argumentsText, index = 0) {
	return { index, function: { arguments: argumentsText } };
}

export function callbackCommand(origin, traceId, roundNumber, index = 0) {
	const marker = `${origin}/__harness/marker?traceId=${encodeURIComponent(traceId)}&round=${roundNumber}&index=${index}`;
	return `node -e "fetch('${marker}').then(r=>{if(!r.ok)throw Error(String(r.status))}).catch(e=>{console.error(e);process.exit(1)})"`;
}

function findCorrelation(messages) {
	if (!Array.isArray(messages)) return { round: 0 };
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		const ids = [message?.tool_call_id];
		if (Array.isArray(message?.tool_calls))
			ids.push(...message.tool_calls.map((call) => call?.id));
		if (Array.isArray(message?.content)) {
			ids.push(
				...message.content.map(
					(part) => part?.toolCallId ?? part?.tool_call_id,
				),
			);
		}
		for (const id of ids) {
			const match = /^call_harness_([A-Za-z0-9]+)_(\d+)(?:_\d+)?$/.exec(
				id ?? "",
			);
			if (match) return { traceId: match[1], round: Number(match[2]) };
		}
	}
	return { round: 0 };
}

async function readJson(request) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		bytes += chunk.length;
		if (bytes > JSON_LIMIT_BYTES) {
			const error = new Error(`Request body exceeds ${JSON_LIMIT_BYTES} bytes`);
			error.code = "BODY_TOO_LARGE";
			throw error;
		}
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, value) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(value));
}

function sanitizeTraceId(value) {
	return /^[A-Za-z0-9]{1,64}$/.test(value ?? "") ? value : "invalid";
}

function parseRound(value) {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function onceClosed(request, response) {
	return new Promise((resolve) => {
		if (request.destroyed || response.destroyed) return resolve();
		const done = () => resolve();
		request.once("aborted", done);
		request.once("close", done);
		response.once("close", done);
	});
}

function delayOrClose(milliseconds, response) {
	return new Promise((resolve) => {
		if (response.destroyed) return resolve(false);
		const timer = setTimeout(() => {
			cleanup();
			resolve(true);
		}, milliseconds);
		const onClose = () => {
			cleanup();
			resolve(false);
		};
		const cleanup = () => {
			clearTimeout(timer);
			response.off("close", onClose);
		};
		response.once("close", onClose);
	});
}

async function closeHarnessServer(server, eventLoopDelay, traceStream) {
	eventLoopDelay.disable();
	if (server.listening) {
		const closed = once(server, "close");
		server.close();
		// Stress scenarios deliberately keep connections open. Shutdown is a
		// consistency boundary: stop accepting work, then release every in-flight
		// response rather than waiting for the scenario to finish by itself.
		server.closeAllConnections();
		await closed;
	}
	await endTraceStream(traceStream);
}

function endTraceStream(traceStream) {
	if (!traceStream || traceStream.closed) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			traceStream.off("close", onClose);
			traceStream.off("error", onError);
		};
		const onClose = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		traceStream.once("close", onClose);
		traceStream.once("error", onError);
		traceStream.end();
	});
}

function waitForDrainOrClose(response) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			response.off("drain", onDrain);
			response.off("close", onClose);
			response.off("error", onError);
		};
		const onDrain = () => {
			cleanup();
			resolve();
		};
		const onClose = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		response.once("drain", onDrain);
		response.once("close", onClose);
		response.once("error", onError);
	});
}

function round(value) {
	return Math.round(value * 1_000) / 1_000;
}

function finiteRound(value) {
	return Number.isFinite(value) ? round(value) : 0;
}
