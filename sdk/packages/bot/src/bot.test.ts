import { describe, expect, it } from "vitest";
import { Bot } from "./bot";
import {
	ContractorTaskError,
	RunAdmissionError,
	WorkspaceImmutableError,
} from "./errors";
import { createInMemoryPorts, type InMemoryBotPorts } from "./in-memory";
import { BotRegistry } from "./registry";

function setup() {
	const ports: InMemoryBotPorts = createInMemoryPorts();
	const registry = new BotRegistry(ports);
	const lead = registry.bootstrap();
	const bot = new Bot(lead.identity.botId, ports);
	return { ports, registry, lead, bot };
}

describe("lazy sessions", () => {
	it("a new bot has no session until a prompt is accepted", () => {
		const { bot } = setup();
		expect(bot.session).toBeUndefined();
	});

	it("a rejected prompt never creates a session", () => {
		const { ports, bot } = setup();
		expect(() => bot.submitPrompt("   ")).toThrow(RunAdmissionError);
		expect(bot.session).toBeUndefined();
		expect(ports.sessions.listByBot(bot.record.identity.botId)).toHaveLength(0);
	});

	it("the first accepted prompt creates the session with its workspace", () => {
		const { bot } = setup();
		const ack = bot.submitPrompt("hello", {
			workspace: { rootPath: "/repo/a" },
		});
		expect(ack.queuePosition).toBe(0);
		expect(ack.acceptedAt).toBeGreaterThan(0);
		expect(bot.session?.workspace.rootPath).toBe("/repo/a");
		expect(bot.session?.state).toBe("active");
	});

	it("a closed session admits no further runs", async () => {
		const { ports, bot } = setup();
		ports.engine.autoOutcome = () => ({ outputText: "ok" });
		bot.submitPrompt("hello");
		await bot.whenIdle();
		bot.closeSession();
		expect(() => bot.submitPrompt("again")).toThrow(RunAdmissionError);
	});
});

describe("immutable workspace", () => {
	it("rejects a prompt naming a different workspace after session creation", () => {
		const { bot } = setup();
		bot.submitPrompt("first", { workspace: { rootPath: "/repo/a" } });
		expect(() =>
			bot.submitPrompt("second", { workspace: { rootPath: "/repo/b" } }),
		).toThrow(WorkspaceImmutableError);
		// Same workspace (or none) is fine.
		expect(() =>
			bot.submitPrompt("third", { workspace: { rootPath: "/repo/a" } }),
		).not.toThrow();
		expect(() => bot.submitPrompt("fourth")).not.toThrow();
	});

	it("the session repository is a backstop against workspace mutation", () => {
		const { ports, bot } = setup();
		bot.submitPrompt("first", { workspace: { rootPath: "/repo/a" } });
		const session = bot.session;
		if (!session) throw new Error("expected session");
		expect(() =>
			ports.sessions.save({
				...session,
				workspace: { rootPath: "/repo/hijacked" },
				revision: session.revision + 1,
			}),
		).toThrow(WorkspaceImmutableError);
	});
});

describe("FIFO run admission", () => {
	it("acks immediately with increasing queue positions and runs in order", async () => {
		const { ports, bot } = setup();
		const first = bot.submitPrompt("one");
		const second = bot.submitPrompt("two");
		const third = bot.submitPrompt("three");
		expect(first.queuePosition).toBe(0);
		expect(second.queuePosition).toBe(1);
		expect(third.queuePosition).toBe(2);
		expect(first.runId).not.toBe(second.runId);

		// Only the first run started; the rest are queued.
		expect(ports.engine.handles).toHaveLength(1);
		expect(ports.runs.get(first.runId)?.state).toBe("running");
		expect(ports.runs.get(second.runId)?.state).toBe("queued");
		expect(ports.runs.get(third.runId)?.state).toBe("queued");

		// Settle them one at a time; admission stays FIFO.
		ports.engine.handles[0].settle({ outputText: "done one" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ports.engine.handles).toHaveLength(2);
		expect(ports.engine.handles[1].invocation.input).toBe("two");
		expect(ports.runs.get(first.runId)?.state).toBe("completed");
		expect(ports.runs.get(first.runId)?.outputText).toBe("done one");

		ports.engine.handles[1].settle({});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ports.engine.handles[2].invocation.input).toBe("three");
		ports.engine.handles[2].settle({});
		await bot.whenIdle();
		expect(ports.runs.get(third.runId)?.state).toBe("completed");
	});

	it("cancelQueued aborts a queued run without starting it", async () => {
		const { ports, bot } = setup();
		bot.submitPrompt("one");
		const second = bot.submitPrompt("two");
		expect(bot.cancelQueued(second.runId)).toBe(true);
		expect(ports.runs.get(second.runId)?.state).toBe("aborted");
		ports.engine.handles[0].settle({});
		await bot.whenIdle();
		// The cancelled run never reached the engine.
		expect(ports.engine.handles).toHaveLength(1);
	});
});

describe("steering, interruption, disconnects", () => {
	it("steering merges into the active run", () => {
		const { ports, bot } = setup();
		bot.submitPrompt("go");
		expect(bot.steer("also check tests")).toBe(true);
		expect(ports.engine.handles[0].steers).toEqual(["also check tests"]);
	});

	it("steering with no active run is refused", () => {
		const { bot } = setup();
		expect(bot.steer("into the void")).toBe(false);
	});

	it("interrupt and abort forward to the active run and settle its state", async () => {
		const { ports, bot } = setup();
		const ack = bot.submitPrompt("go");
		expect(bot.interrupt("pause please")).toBe(true);
		const handle = ports.engine.handles[0];
		expect(handle.interrupted).toBe(true);
		handle.settle({ status: "interrupted" });
		await bot.whenIdle();
		expect(ports.runs.get(ack.runId)?.state).toBe("interrupted");
	});

	it("disconnect never implies abort", async () => {
		const { ports, bot } = setup();
		const ack = bot.submitPrompt("long task");
		bot.clientDisconnected();
		const handle = ports.engine.handles[0];
		expect(handle.aborted).toBe(false);
		expect(handle.interrupted).toBe(false);
		expect(ports.runs.get(ack.runId)?.state).toBe("running");
		handle.settle({ outputText: "survived the disconnect" });
		await bot.whenIdle();
		expect(ports.runs.get(ack.runId)?.state).toBe("completed");
	});
});

describe("per-turn overrides", () => {
	it("apply to one run only and never mutate the bot config", async () => {
		const { ports, registry, lead } = setup();
		ports.bots.save({
			...registry.get(lead.identity.botId),
			config: { modelId: "base-model", systemPrompt: "base prompt" },
		});
		const bot = new Bot(lead.identity.botId, ports);

		bot.submitPrompt("one", { overrides: { modelId: "fancy-model" } });
		bot.submitPrompt("two");

		expect(ports.engine.handles[0].invocation.effectiveConfig.modelId).toBe(
			"fancy-model",
		);
		expect(
			ports.engine.handles[0].invocation.effectiveConfig.systemPrompt,
		).toBe("base prompt");

		ports.engine.handles[0].settle({});
		await new Promise((resolve) => setTimeout(resolve, 0));
		// The next run reverts to the bot config.
		expect(ports.engine.handles[1].invocation.effectiveConfig.modelId).toBe(
			"base-model",
		);
		expect(registry.get(lead.identity.botId).config.modelId).toBe("base-model");
	});
});

describe("contractor lifecycle", () => {
	function contractorSetup() {
		const ports = createInMemoryPorts();
		const registry = new BotRegistry(ports);
		const lead = registry.bootstrap();
		const contractorRecord = registry.delegate(lead.identity.botId, {
			name: "one-off",
			role: "contractor",
		});
		const contractor = new Bot(contractorRecord.identity.botId, ports);
		return { ports, registry, contractor, contractorRecord };
	}

	it("accepts exactly one task", () => {
		const { contractor } = contractorSetup();
		contractor.submitPrompt("the one task");
		expect(() => contractor.submitPrompt("a second task")).toThrow(
			ContractorTaskError,
		);
	});

	it("tears down after its run: retired with retention, session closed", async () => {
		const { ports, registry, contractor, contractorRecord } = contractorSetup();
		contractor.submitPrompt("the one task");
		ports.engine.handles[0].settle({ outputText: "task done" });
		await contractor.whenIdle();

		const after = registry.get(contractorRecord.identity.botId);
		expect(after.status).toBe("retired");
		// Retention: identity and provenance survive teardown.
		expect(after.identity.provenance.createdBy).toBe(
			contractorRecord.identity.parentBotId,
		);
		expect(contractor.session?.state).toBe("closed");
		expect(() => contractor.submitPrompt("anything else")).toThrow(
			RunAdmissionError,
		);
	});
});

describe("memories", () => {
	it("discovers markdown memories under memories/ through the port", () => {
		const ports = createInMemoryPorts({
			memories: {
				list: () => [
					{ path: "memories/style.md", content: "# Style" },
					{ path: "memories/nested/decisions.md", content: "# Decisions" },
					{ path: "memories/notes.txt", content: "not markdown" },
					{ path: "docs/style.md", content: "outside memories/" },
				],
			},
		});
		const registry = new BotRegistry(ports);
		const lead = registry.bootstrap();
		const bot = new Bot(lead.identity.botId, ports);
		const memories = bot.discoverMemories();
		expect(memories.map((memory) => memory.name)).toEqual([
			"nested/decisions",
			"style",
		]);
		expect(memories[1].content).toBe("# Style");
	});

	it("returns nothing when no memory port is bound", () => {
		const { bot } = setup();
		expect(bot.discoverMemories()).toEqual([]);
	});
});

describe("identity survives reattachment", () => {
	it("a new Bot facade reattaches to the existing active session", () => {
		const { ports, lead, bot } = setup();
		bot.submitPrompt("start", { workspace: { rootPath: "/repo/a" } });
		const reattached = new Bot(lead.identity.botId, ports);
		expect(reattached.session?.sessionId).toBe(bot.session?.sessionId);
		expect(reattached.session?.workspace.rootPath).toBe("/repo/a");
	});
});

describe("retired bots", () => {
	it("reject prompt admission", () => {
		const { registry, lead, bot } = setup();
		registry.retire(lead.identity.botId);
		expect(() => bot.submitPrompt("anything")).toThrow(RunAdmissionError);
		expect(bot.session).toBeUndefined();
	});
});

describe("crash recovery re-admission (Gateway RFC, Phase 3)", () => {
	it("re-admits committed queued runs in call order and executes them FIFO", () => {
		const { ports, lead, bot } = setup();
		// Simulate a previous process: the session and two queued run
		// records are durable, but the new Bot facade has an empty queue.
		bot.submitPrompt("held", { workspace: { rootPath: "/repo/a" } });
		const ackA = bot.submitPrompt("recovered A");
		const ackB = bot.submitPrompt("recovered B");
		const recordA = ports.runs.get(ackA.runId);
		const recordB = ports.runs.get(ackB.runId);
		if (!recordA || !recordB) {
			throw new Error("run records missing");
		}

		const restarted = new Bot(lead.identity.botId, ports);
		restarted.recoverQueuedRun(recordA);
		restarted.recoverQueuedRun(recordB);
		// Duplicate recovery is a no-op, not a duplicate admission.
		restarted.recoverQueuedRun(recordA);

		// The restarted facade starts A first (FIFO), then B.
		const started = ports.engine.handles.map(
			(handle) => handle.invocation.input,
		);
		expect(started[started.length - 1]).toBe("recovered A");
		expect(ports.runs.get(ackA.runId)?.state).toBe("running");
		expect(ports.runs.get(ackB.runId)?.state).toBe("queued");
	});

	it("rejects records that are not queued or belong elsewhere", () => {
		const { ports, lead, bot } = setup();
		ports.engine.autoOutcome = () => ({ outputText: "done" });
		const ack = bot.submitPrompt("finish", {
			workspace: { rootPath: "/repo/a" },
		});
		const running = ports.runs.get(ack.runId);
		if (!running) {
			throw new Error("run record missing");
		}
		const restarted = new Bot(lead.identity.botId, ports);
		expect(() => restarted.recoverQueuedRun(running)).toThrow(
			RunAdmissionError,
		);
	});
});
