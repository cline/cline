import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSessionService } from "../session/file-session-service";

const sqliteInitMock = vi.hoisted(() => vi.fn());
const ensureCompatibleLocalHubUrlMock = vi.hoisted(() => vi.fn());
const resolveCompatibleLocalHubUrlMock = vi.hoisted(() => vi.fn());
const hubConnectMock = vi.hoisted(() => vi.fn());

vi.mock("../hub/client", async () => {
	const actual =
		await vi.importActual<typeof import("../hub/client")>("../hub/client");
	return {
		...actual,
		NodeHubClient: class {
			connect = hubConnectMock;
			command = vi.fn();
			subscribe = vi.fn(() => () => {});
			close = vi.fn();
		},
		ensureCompatibleLocalHubUrl: ensureCompatibleLocalHubUrlMock,
		resolveCompatibleLocalHubUrl: resolveCompatibleLocalHubUrlMock,
	};
});

vi.mock("../services/storage/sqlite-session-store", () => ({
	SqliteSessionStore: class {
		init(): void {
			sqliteInitMock();
		}
	},
}));

describe("runtime host resolution", () => {
	const logger = {
		debug: vi.fn(),
		log: vi.fn(),
		error: vi.fn(),
	};

	afterEach(() => {
		sqliteInitMock.mockReset();
		ensureCompatibleLocalHubUrlMock.mockReset();
		resolveCompatibleLocalHubUrlMock.mockReset();
		hubConnectMock.mockReset();
		logger.debug.mockReset();
		logger.log.mockReset();
		logger.error.mockReset();
		delete process.env.CLINE_SESSION_BACKEND_MODE;
		delete process.env.CLINE_VCR;
		vi.resetModules();
	});

	it("falls back to file session storage when sqlite initialization fails", async () => {
		sqliteInitMock.mockImplementation(() => {
			throw new Error("sqlite unavailable");
		});
		const { resolveSessionBackend } = await import("../runtime/host");

		const backend = await resolveSessionBackend({ backendMode: "local" });
		expect(backend.constructor.name).toBe("FileSessionService");
	});

	it("silently falls back to file session storage when node:sqlite is unavailable", async () => {
		sqliteInitMock.mockImplementation(() => {
			const error = new Error(
				"No such built-in module: node:sqlite",
			) as Error & {
				code?: string;
			};
			error.code = "ERR_UNKNOWN_BUILTIN_MODULE";
			throw error;
		});
		const { resolveSessionBackend } = await import("../runtime/host");

		const backend = await resolveSessionBackend({ backendMode: "local" });
		expect(backend.constructor.name).toBe("FileSessionService");
	});

	it("honors env-managed local mode inside core backend resolution", async () => {
		process.env.CLINE_SESSION_BACKEND_MODE = "local";
		const { resolveSessionBackend } = await import("../runtime/host");

		const backend = await resolveSessionBackend({});

		expect(backend).not.toBeInstanceOf(FileSessionService);
	});

	it("forces local backend when vcr is enabled", async () => {
		process.env.CLINE_VCR = "1";
		const { resolveSessionBackend } = await import("../runtime/host");

		const backend = await resolveSessionBackend({});

		expect(backend).not.toBeInstanceOf(FileSessionService);
	});

	it("prefers a compatible local hub when backendMode is auto", async () => {
		const { createRuntimeHost } = await import("../runtime/host");
		const { HubRuntimeHost } = await import("../transports/hub");
		resolveCompatibleLocalHubUrlMock.mockResolvedValue(
			"ws://127.0.0.1:25463/hub",
		);
		hubConnectMock.mockResolvedValue(undefined);

		const host = await createRuntimeHost({
			backendMode: "auto",
			logger,
			hub: {
				strategy: "prefer-hub",
			},
		});

		expect(host).toBeInstanceOf(HubRuntimeHost);
		expect(resolveCompatibleLocalHubUrlMock).toHaveBeenCalledWith({
			endpoint: undefined,
			strategy: "prefer-hub",
		});
		expect(ensureCompatibleLocalHubUrlMock).not.toHaveBeenCalled();
		expect(logger.log).toHaveBeenCalledWith(
			"Using discovered local hub runtime host",
			{
				url: "ws://127.0.0.1:25463/hub",
			},
		);
	});

	it("falls back to local runtime when auto hub discovery fails", async () => {
		const { createRuntimeHost } = await import("../runtime/host");
		const { LocalRuntimeHost } = await import("../transports/local");
		resolveCompatibleLocalHubUrlMock.mockResolvedValue(undefined);

		const host = await createRuntimeHost({
			backendMode: "auto",
			logger,
		});

		expect(host).toBeInstanceOf(LocalRuntimeHost);
		expect(resolveCompatibleLocalHubUrlMock).toHaveBeenCalledWith({
			endpoint: undefined,
			strategy: "prefer-hub",
		});
		expect(ensureCompatibleLocalHubUrlMock).not.toHaveBeenCalled();
		expect(logger.log).toHaveBeenCalledWith(
			"Falling back to local runtime host",
			{
				reason: "compatible_hub_unavailable",
				severity: "warn",
			},
		);
	});

	it("falls back to local runtime when auto hub connect fails", async () => {
		const { createRuntimeHost } = await import("../runtime/host");
		const { LocalRuntimeHost } = await import("../transports/local");
		resolveCompatibleLocalHubUrlMock.mockResolvedValue(
			"ws://127.0.0.1:25463/hub",
		);
		hubConnectMock.mockRejectedValue(new Error("connect failed"));

		const host = await createRuntimeHost({
			backendMode: "auto",
			logger,
		});

		expect(host).toBeInstanceOf(LocalRuntimeHost);
		expect(logger.log).toHaveBeenCalledWith(
			"Falling back to local runtime host",
			expect.objectContaining({
				reason: "hub_connect_failed",
				severity: "warn",
			}),
		);
	});

	it("uses a hub runtime host when backendMode is hub", async () => {
		const { createRuntimeHost } = await import("../runtime/host");
		const { HubRuntimeHost } = await import("../transports/hub");
		ensureCompatibleLocalHubUrlMock.mockResolvedValue(
			"ws://127.0.0.1:25463/hub",
		);

		const host = await createRuntimeHost({
			backendMode: "hub",
		});

		expect(host).toBeInstanceOf(HubRuntimeHost);
		expect(ensureCompatibleLocalHubUrlMock).toHaveBeenCalledWith({
			strategy: "require-hub",
		});
	});

	it("uses a remote runtime host when backendMode is remote", async () => {
		const { createRuntimeHost } = await import("../runtime/host");
		const { RemoteRuntimeHost } = await import("../transports/remote");

		const host = await createRuntimeHost({
			backendMode: "remote",
			remote: {
				endpoint: "https://remote.example.com/hub",
			},
			logger,
		});

		expect(host).toBeInstanceOf(RemoteRuntimeHost);
		expect(ensureCompatibleLocalHubUrlMock).not.toHaveBeenCalled();
		expect(logger.log).toHaveBeenCalledWith("Using remote runtime host", {
			endpoint: "https://remote.example.com/hub",
		});
	});

	it("allows default tool executors in remote runtime mode", async () => {
		const { createRuntimeHost } = await import("../runtime/host");
		const { RemoteRuntimeHost } = await import("../transports/remote");

		const host = await createRuntimeHost({
			backendMode: "remote",
			remote: {
				endpoint: "https://remote.example.com/hub",
			},
			defaultToolExecutors: {
				askQuestion: vi.fn(async () => "yes"),
			},
		});

		expect(host).toBeInstanceOf(RemoteRuntimeHost);
	});

	it("requires a remote endpoint when backendMode is remote", async () => {
		const { createRuntimeHost } = await import("../runtime/host");

		await expect(
			createRuntimeHost({
				backendMode: "remote",
			}),
		).rejects.toThrow(
			"Remote runtime mode requires `remote.endpoint` to be configured.",
		);
	});
});
