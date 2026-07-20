import { describe, expect, it, vi } from "vitest";

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

describe("hub server fetch wiring", () => {
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
});
