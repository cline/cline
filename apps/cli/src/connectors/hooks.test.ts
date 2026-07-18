import type { ConnectorAuthorizationRequest } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliLoggerAdapter } from "../logging/adapter";
import {
	authorizeConnectorEvent,
	type ConnectorHookDependencies,
} from "./hooks";

const request: ConnectorAuthorizationRequest = {
	actor: {
		participantKey: "telegram:user:123",
	},
	context: {
		source: "telegram",
		sourceEvent: "message.received",
		threadId: "thread-1",
		channelId: "channel-1",
		isDM: true,
	},
};

function createLogger(): {
	logger: CliLoggerAdapter;
	log: ReturnType<typeof vi.fn>;
} {
	const log = vi.fn();
	return {
		logger: { core: { log } } as unknown as CliLoggerAdapter,
		log,
	};
}

describe("authorizeConnectorEvent", () => {
	const runSubprocessEvent =
		vi.fn<ConnectorHookDependencies["runSubprocessEvent"]>();
	const dependencies: ConnectorHookDependencies = { runSubprocessEvent };

	beforeEach(() => {
		runSubprocessEvent.mockReset();
	});

	it("allows events when no authorization hook is configured", async () => {
		const { logger } = createLogger();
		await expect(
			authorizeConnectorEvent(
				undefined,
				{ adapter: "telegram", request },
				logger,
				dependencies,
			),
		).resolves.toEqual({ action: "allow" });
		expect(runSubprocessEvent).not.toHaveBeenCalled();
	});

	it("accepts an explicit successful authorization decision", async () => {
		runSubprocessEvent.mockResolvedValue({
			exitCode: 0,
			stdout: '{"action":"allow"}',
			stderr: "",
			parsedJson: { action: "allow" },
		});
		const { logger } = createLogger();

		await expect(
			authorizeConnectorEvent(
				"authorize-connector",
				{ adapter: "telegram", request },
				logger,
				dependencies,
			),
		).resolves.toEqual({ action: "allow" });
	});

	it("fails closed when the authorization hook exits non-zero", async () => {
		runSubprocessEvent.mockResolvedValue({
			exitCode: 7,
			stdout: '{"action":"allow"}',
			stderr: "authorization service unavailable",
			parsedJson: { action: "allow" },
		});
		const { logger, log } = createLogger();

		await expect(
			authorizeConnectorEvent(
				"authorize-connector",
				{ adapter: "telegram", request },
				logger,
				dependencies,
			),
		).resolves.toEqual({
			action: "deny",
			message: "Authorization check failed. Please try again later.",
			reason: "authorization_hook_failed",
		});
		expect(log).toHaveBeenCalledWith(
			"Connector authorization hook failed closed",
			expect.objectContaining({ severity: "warn", code: 7 }),
		);
	});

	it("fails closed when the hook omits an explicit action", async () => {
		runSubprocessEvent.mockResolvedValue({
			exitCode: 0,
			stdout: "{}",
			stderr: "",
			parsedJson: {},
		});
		const { logger } = createLogger();

		await expect(
			authorizeConnectorEvent(
				"authorize-connector",
				{ adapter: "telegram", request },
				logger,
				dependencies,
			),
		).resolves.toEqual(expect.objectContaining({ action: "deny" }));
	});

	it("fails closed when hook dispatch throws", async () => {
		runSubprocessEvent.mockRejectedValue(new Error("spawn failed"));
		const { logger, log } = createLogger();

		await expect(
			authorizeConnectorEvent(
				"authorize-connector",
				{ adapter: "telegram", request },
				logger,
				dependencies,
			),
		).resolves.toEqual(
			expect.objectContaining({
				action: "deny",
				reason: "authorization_hook_failed",
			}),
		);
		expect(log).toHaveBeenCalledWith(
			"Connector authorization hook dispatch failed",
			expect.objectContaining({ severity: "warn" }),
		);
	});
});
