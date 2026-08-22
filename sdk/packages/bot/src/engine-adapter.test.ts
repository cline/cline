/**
 * Composition proof: the bot domain drives the REAL `@cline/engine`
 * through its execution port, with a scripted model (no providers).
 */

import type { AgentModel, AgentModelEvent } from "@cline/engine";
import type { AgentMessage, AgentModelRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { Bot } from "./bot";
import { createEngineExecutionPort } from "./engine-adapter";
import {
	createSequentialIdSource,
	createStepClock,
	InMemoryBotRepository,
	InMemoryRunRepository,
	InMemorySessionRepository,
} from "./in-memory";
import type { BotPorts } from "./ports";
import { BotRegistry } from "./registry";

function scriptedModel(turns: AgentModelEvent[][]): AgentModel {
	let call = 0;
	return {
		stream() {
			const turn = turns[Math.min(call, turns.length - 1)];
			call += 1;
			return (async function* () {
				for (const event of turn) {
					yield event;
				}
			})();
		},
	};
}

function textTurn(text: string): AgentModelEvent[] {
	return [
		{ type: "text-delta", text },
		{ type: "finish", reason: "stop" },
	];
}

function setup(model: AgentModel) {
	const engine = createEngineExecutionPort({
		model: () => ({ kind: "model", model }),
	});
	const ports: BotPorts = {
		clock: createStepClock(),
		ids: createSequentialIdSource(),
		bots: new InMemoryBotRepository(),
		sessions: new InMemorySessionRepository(),
		runs: new InMemoryRunRepository(),
		engine,
	};
	const registry = new BotRegistry(ports);
	const lead = registry.bootstrap();
	const bot = new Bot(lead.identity.botId, ports);
	return { ports, bot };
}

describe("bot -> engine composition", () => {
	it("forwards persisted session history into the engine", async () => {
		const requests: AgentModelRequest[] = [];
		const model: AgentModel = {
			stream(request) {
				requests.push(request);
				return (async function* () {
					yield* textTurn("continued");
				})();
			},
		};
		const history: AgentMessage[] = [
			{
				id: "msg_user_1",
				role: "user",
				content: [{ type: "text", text: "prior question" }],
				createdAt: 1,
			},
			{
				id: "msg_assistant_1",
				role: "assistant",
				content: [{ type: "text", text: "prior answer" }],
				createdAt: 2,
			},
		];
		const ids = createSequentialIdSource();
		const engine = createEngineExecutionPort({
			model: () => ({ kind: "model", model }),
		});
		const handle = engine.start({
			runId: ids.runId(),
			sessionId: ids.sessionId(),
			botId: ids.botId(),
			input: "continue",
			workspaceRoot: "/repo/x",
			initialMessages: history,
			effectiveConfig: {},
		});

		await handle.result;

		expect(requests).toHaveLength(1);
		expect(requests[0].messages.slice(0, 2)).toEqual(history);
		expect(requests[0].messages.at(-1)).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "continue" }],
		});
	});

	it("runs a prompt end-to-end through the real engine", async () => {
		const { ports, bot } = setup(scriptedModel([textTurn("engine says hi")]));
		const ack = bot.submitPrompt("hello engine", {
			workspace: { rootPath: "/repo/x" },
		});
		expect(ack.queuePosition).toBe(0);

		await bot.whenIdle();

		const run = ports.runs.get(ack.runId);
		expect(run?.state).toBe("completed");
		expect(run?.outputText).toBe("engine says hi");
		expect(bot.session?.state).toBe("active");
	});

	it("processes queued prompts sequentially through separate engines", async () => {
		const { ports, bot } = setup(scriptedModel([textTurn("answer")]));
		const first = bot.submitPrompt("one");
		const second = bot.submitPrompt("two");
		expect(second.queuePosition).toBe(1);

		await bot.whenIdle();

		expect(ports.runs.get(first.runId)?.state).toBe("completed");
		expect(ports.runs.get(second.runId)?.state).toBe("completed");
		const firstRun = ports.runs.get(first.runId);
		const secondRun = ports.runs.get(second.runId);
		if (!firstRun?.endedAt || !secondRun?.startedAt) {
			throw new Error("expected run timing to be recorded");
		}
		// Strict FIFO: the second run starts only after the first ends.
		expect(secondRun.startedAt).toBeGreaterThan(firstRun.endedAt);
	});

	it("engine failures surface as failed runs with the error retained", async () => {
		const { ports, bot } = setup(
			scriptedModel([
				[{ type: "finish", reason: "error", error: "model blew up" }],
			]),
		);
		const ack = bot.submitPrompt("doomed");
		await bot.whenIdle();
		const run = ports.runs.get(ack.runId);
		expect(run?.state).toBe("failed");
		expect(run?.error?.message).toContain("model blew up");
	});
});
