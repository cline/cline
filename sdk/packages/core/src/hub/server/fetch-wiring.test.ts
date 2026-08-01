import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeCapabilities } from "../../runtime/capabilities/runtime-capabilities";

const localRuntimeHostMock = vi.hoisted(() =>
	vi.fn().mockImplementation(function (this: unknown, _options: unknown) {
		const instance = this as Record<string, unknown>;
		instance.subscribe = vi.fn(() => () => {});
		instance.dispose = vi.fn(async () => {});
		instance.start = vi.fn();
		instance.send = vi.fn();
		instance.abort = vi.fn();
		instance.stop = vi.fn();
		instance.runtimeAddress = undefined;
	}),
);

vi.mock("../../runtime/host/local-runtime-host", () => ({
	LocalRuntimeHost: localRuntimeHostMock,
}));

describe("hub runtime wiring", () => {
	it("forwards observability into the internal LocalRuntimeHost", async () => {
		localRuntimeHostMock.mockClear();
		const { HubServerTransport } = (await import(".")) as unknown as {
			HubServerTransport: new (options: unknown) => unknown;
		};
		const logger = { debug: vi.fn(), log: vi.fn(), error: vi.fn() };
		const telemetry = { capture: vi.fn() };

		new HubServerTransport({
			runtimeHandlers: {
				startSession: vi.fn(),
				sendSession: vi.fn(),
				abortSession: vi.fn(),
				stopSession: vi.fn(),
			},
			logger,
			telemetry,
		});

		expect(localRuntimeHostMock).toHaveBeenCalledWith(
			expect.objectContaining({ logger, telemetry }),
		);
	});

	it("forwards HubWebSocketServerOptions.fetch into the internal LocalRuntimeHost", async () => {
		localRuntimeHostMock.mockClear();
		const { HubServerTransport } = (await import(".")) as unknown as {
			HubServerTransport: new (
				options: unknown,
			) => {
				stop(): Promise<void>;
			};
		};

		const customFetch = (async () => new Response()) as unknown as typeof fetch;

		const transport = new HubServerTransport({
			runtimeHandlers: {
				startSession: vi.fn(),
				sendSession: vi.fn(),
				abortSession: vi.fn(),
				stopSession: vi.fn(),
			},
			scheduleOptions: { dbPath: ":memory:" },
			fetch: customFetch,
		});

		try {
			expect(localRuntimeHostMock).toHaveBeenCalledTimes(1);
			const constructorArgs = localRuntimeHostMock.mock.calls[0]?.[0] as {
				fetch?: typeof fetch;
			};
			expect(constructorArgs.fetch).toBe(customFetch);
		} finally {
			await transport.stop();
		}
	});

	it("does not construct a default LocalRuntimeHost when sessionHost is supplied", async () => {
		localRuntimeHostMock.mockClear();
		const { HubServerTransport } = (await import(".")) as unknown as {
			HubServerTransport: new (
				options: unknown,
			) => {
				stop(): Promise<void>;
			};
		};

		const suppliedHost = {
			subscribe: vi.fn(() => () => {}),
			dispose: vi.fn(async () => {}),
			runtimeAddress: undefined,
		};

		const transport = new HubServerTransport({
			sessionHost: suppliedHost,
			runtimeHandlers: {
				startSession: vi.fn(),
				sendSession: vi.fn(),
				abortSession: vi.fn(),
				stopSession: vi.fn(),
			},
			scheduleOptions: { dbPath: ":memory:" },
			fetch: (async () => new Response()) as unknown as typeof fetch,
		});

		try {
			expect(localRuntimeHostMock).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});

	it("forwards createLocalHubScheduleRuntimeHandlers fetch into its internal LocalRuntimeHost", async () => {
		localRuntimeHostMock.mockClear();
		const { createLocalHubScheduleRuntimeHandlers } = await import(
			"../daemon/runtime-handlers"
		);

		const customFetch = (async () => new Response()) as unknown as typeof fetch;
		createLocalHubScheduleRuntimeHandlers({ fetch: customFetch });

		expect(localRuntimeHostMock).toHaveBeenCalledTimes(1);
		const constructorArgs = localRuntimeHostMock.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(constructorArgs.fetch).toBe(customFetch);
	});

	it("leaves fetch undefined when createLocalHubScheduleRuntimeHandlers is called without one", async () => {
		localRuntimeHostMock.mockClear();
		const { createLocalHubScheduleRuntimeHandlers } = await import(
			"../daemon/runtime-handlers"
		);

		createLocalHubScheduleRuntimeHandlers();

		expect(localRuntimeHostMock).toHaveBeenCalledTimes(1);
		const constructorArgs = localRuntimeHostMock.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(constructorArgs.fetch).toBeUndefined();
	});

	it("provides an executable headless completion tool to the real yolo runtime builder", async () => {
		localRuntimeHostMock.mockClear();
		const { createLocalHubScheduleRuntimeHandlers } = await import(
			"../daemon/runtime-handlers"
		);
		const { DefaultRuntimeBuilder } = await import(
			"../../runtime/orchestration/runtime-builder"
		);

		createLocalHubScheduleRuntimeHandlers();

		const constructorArgs = localRuntimeHostMock.mock.calls[0]?.[0] as {
			capabilities?: RuntimeCapabilities;
		};
		const toolExecutors = constructorArgs.capabilities?.toolExecutors;
		expect(toolExecutors?.submit).toBeTypeOf("function");

		const runtime = await new DefaultRuntimeBuilder().build({
			config: {
				providerId: "cline",
				modelId: CLINE_DEFAULT_MODEL_ID,
				cwd: process.cwd(),
				workspaceRoot: process.cwd(),
				systemPrompt: "Run unattended.",
				mode: "yolo",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			toolExecutors,
			toolPolicies: {
				"*": { enabled: false, autoApprove: true },
				submit_and_exit: { enabled: true, autoApprove: true },
				ask_question: { enabled: false, autoApprove: true },
			},
		});

		try {
			const toolNames = runtime.tools.map((tool) => tool.name);
			expect(toolNames).toContain("submit_and_exit");
			expect(toolNames).not.toContain("ask_question");
			const submitTool = runtime.tools.find(
				(tool) => tool.name === "submit_and_exit",
			);
			if (!submitTool) {
				throw new Error("Expected submit_and_exit to be available.");
			}
			expect(submitTool.lifecycle).toEqual({ completesRun: true });
			expect(runtime.completionPolicy).toEqual({
				requireCompletionTool: true,
			});
			await expect(
				submitTool.execute(
					{
						summary: "Scheduled work completed successfully.",
						verified: true,
					},
					{
						agentId: "scheduled-agent",
						conversationId: "scheduled-conversation",
						iteration: 1,
					},
				),
			).resolves.toBe("Scheduled work completed successfully.");
		} finally {
			await runtime.shutdown("test complete");
		}
	});
});
