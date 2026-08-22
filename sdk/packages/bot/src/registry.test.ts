import { describe, expect, it } from "vitest";
import {
	DelegationNotAllowedError,
	MessagingNotAllowedError,
	RoleImmutableError,
} from "./errors";
import type { BotRole } from "./identity";
import { createInMemoryPorts } from "./in-memory";
import { BotRegistry } from "./registry";

function setup() {
	const ports = createInMemoryPorts();
	const registry = new BotRegistry(ports);
	return { ports, registry };
}

describe("bootstrap", () => {
	it("the first bot is `cline` with role `lead` and no parent", () => {
		const { registry } = setup();
		const first = registry.bootstrap();
		expect(first.identity.name).toBe("cline");
		expect(first.identity.role).toBe("lead");
		expect(first.identity.parentBotId).toBeNull();
		expect(first.identity.provenance.createdBy).toBe("bootstrap");
	});

	it("is idempotent — a second bootstrap returns the same lead", () => {
		const { registry } = setup();
		const first = registry.bootstrap();
		const again = registry.bootstrap();
		expect(again.identity.botId).toBe(first.identity.botId);
		expect(registry.list()).toHaveLength(1);
	});

	it("identity records are frozen", () => {
		const { registry } = setup();
		const first = registry.bootstrap();
		expect(Object.isFrozen(first.identity)).toBe(true);
		expect(Object.isFrozen(first.identity.provenance)).toBe(true);
	});
});

describe("role immutability", () => {
	it("the repository rejects saves that change role or parent — no worker promotion", () => {
		const { ports, registry } = setup();
		const lead = registry.bootstrap();
		const worker = registry.delegate(lead.identity.botId, {
			name: "helper",
			role: "worker",
		});
		expect(() =>
			ports.bots.save({
				...worker,
				identity: { ...worker.identity, role: "lead" as BotRole },
			}),
		).toThrow(RoleImmutableError);
		expect(() =>
			ports.bots.save({
				...worker,
				identity: { ...worker.identity, parentBotId: null },
			}),
		).toThrow(RoleImmutableError);
		// Status/config changes remain allowed.
		expect(() =>
			ports.bots.save({ ...worker, status: "retired", revision: 1 }),
		).not.toThrow();
	});

	it("the registry exposes no role mutation API", () => {
		const { registry } = setup();
		const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(registry));
		expect(surface).not.toContain("setRole");
		expect(surface).not.toContain("promote");
		expect(surface).not.toContain("changeRole");
	});
});

describe("delegation", () => {
	it("a lead delegates workers and contractors", () => {
		const { registry } = setup();
		const lead = registry.bootstrap();
		const worker = registry.delegate(lead.identity.botId, {
			name: "helper",
			role: "worker",
		});
		const contractor = registry.delegate(lead.identity.botId, {
			name: "one-off",
			role: "contractor",
			reason: "single refactor task",
		});
		expect(worker.identity.role).toBe("worker");
		expect(worker.identity.parentBotId).toBe(lead.identity.botId);
		expect(contractor.identity.role).toBe("contractor");
		expect(contractor.identity.provenance.createdBy).toBe(lead.identity.botId);
	});

	it("workers and contractors cannot delegate by default", () => {
		const { registry } = setup();
		const lead = registry.bootstrap();
		const worker = registry.delegate(lead.identity.botId, {
			name: "helper",
			role: "worker",
		});
		const contractor = registry.delegate(lead.identity.botId, {
			name: "one-off",
			role: "contractor",
		});
		expect(() =>
			registry.delegate(worker.identity.botId, { name: "sub", role: "worker" }),
		).toThrow(DelegationNotAllowedError);
		expect(() =>
			registry.delegate(contractor.identity.botId, {
				name: "sub",
				role: "contractor",
			}),
		).toThrow(DelegationNotAllowedError);
	});

	it("delegation never creates a lead", () => {
		const { registry } = setup();
		const lead = registry.bootstrap();
		expect(() =>
			registry.delegate(lead.identity.botId, {
				name: "usurper",
				// biome-ignore lint/suspicious/noExplicitAny: deliberately bypassing the type guard
				role: "lead" as any,
			}),
		).toThrow(DelegationNotAllowedError);
	});

	it("retired bots cannot delegate", () => {
		const { registry } = setup();
		const lead = registry.bootstrap();
		registry.retire(lead.identity.botId);
		expect(() =>
			registry.delegate(lead.identity.botId, { name: "x", role: "worker" }),
		).toThrow(DelegationNotAllowedError);
	});
});

describe("messaging topology", () => {
	it("a worker messages its lead; a lead messages its children", () => {
		const { registry } = setup();
		const lead = registry.bootstrap();
		const worker = registry.delegate(lead.identity.botId, {
			name: "helper",
			role: "worker",
		});
		const up = registry.routeMessage(
			worker.identity.botId,
			lead.identity.botId,
			"status: done",
		);
		expect(up.toBotId).toBe(lead.identity.botId);
		const down = registry.routeMessage(
			lead.identity.botId,
			worker.identity.botId,
			"please continue",
		);
		expect(down.toBotId).toBe(worker.identity.botId);
	});

	it("worker-to-worker messaging is rejected by default", () => {
		const { registry } = setup();
		const lead = registry.bootstrap();
		const workerA = registry.delegate(lead.identity.botId, {
			name: "a",
			role: "worker",
		});
		const workerB = registry.delegate(lead.identity.botId, {
			name: "b",
			role: "worker",
		});
		expect(() =>
			registry.routeMessage(
				workerA.identity.botId,
				workerB.identity.botId,
				"psst",
			),
		).toThrow(MessagingNotAllowedError);
	});
});
