import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const createCore = vi.fn();
const getCliTelemetryService = vi.fn(() => undefined);

vi.mock("@clinebot/core", async () => {
	const actual =
		await vi.importActual<typeof import("@clinebot/core")>("@clinebot/core");
	return {
		...actual,
		ClineCore: {
			create: createCore,
		},
	};
});

vi.mock("../utils/telemetry", () => ({
	getCliTelemetryService,
}));

describe("createCliCore", () => {
	let sessionModule: typeof import("./session");
	const envSnapshot = {
		CLINE_RPC_ADDRESS: process.env.CLINE_RPC_ADDRESS,
		CLINE_SESSION_BACKEND_MODE: process.env.CLINE_SESSION_BACKEND_MODE,
		CLINE_VCR: process.env.CLINE_VCR,
	};

	beforeAll(async () => {
		sessionModule = await import("./session");
	});

	beforeEach(() => {
		createCore.mockReset();
		createCore.mockResolvedValue({
			runtimeAddress: "127.0.0.1:4317",
			start: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stop: vi.fn(),
			dispose: vi.fn(),
			get: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
			update: vi.fn(),
			readMessages: vi.fn(),
			readTranscript: vi.fn(),
			handleHookEvent: vi.fn(),
			subscribe: vi.fn(),
			updateSessionModel: vi.fn(),
		});
		delete process.env.CLINE_RPC_ADDRESS;
		delete process.env.CLINE_SESSION_BACKEND_MODE;
		delete process.env.CLINE_VCR;
	});

	afterEach(() => {
		process.env.CLINE_RPC_ADDRESS = envSnapshot.CLINE_RPC_ADDRESS;
		process.env.CLINE_SESSION_BACKEND_MODE =
			envSnapshot.CLINE_SESSION_BACKEND_MODE;
		process.env.CLINE_VCR = envSnapshot.CLINE_VCR;
	});

	it("treats an explicit rpc address as a shared server to attach to", async () => {
		process.env.CLINE_RPC_ADDRESS = "127.0.0.1:5001";

		await sessionModule.createCliCore();

		expect(createCore).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
			}),
		);
	});

	it("prefers the shared hub backend by default", async () => {
		await sessionModule.createCliCore();

		expect(createCore).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
				hub: expect.objectContaining({
					clientType: "cli",
					displayName: "Cline CLI",
				}),
			}),
		);
	});

	it("forces the local backend when requested by the caller", async () => {
		await sessionModule.createCliCore({ forceLocalBackend: true });

		expect(createCore).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "local",
			}),
		);
	});

	it("keeps the shared hub backend when custom tool executors are provided", async () => {
		await sessionModule.createCliCore({
			defaultToolExecutors: {
				submit: vi.fn(),
			},
		});

		expect(createCore).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
				hub: expect.objectContaining({
					clientType: "cli",
					displayName: "Cline CLI",
				}),
			}),
		);
	});

	it("passes env-managed routing through to core when local is requested via env", async () => {
		process.env.CLINE_SESSION_BACKEND_MODE = "local";

		await sessionModule.createCliCore();

		expect(createCore).toHaveBeenCalledWith(
			expect.not.objectContaining({
				backendMode: expect.anything(),
			}),
		);
	});

	it("passes env-managed routing through to core when vcr is enabled", async () => {
		process.env.CLINE_VCR = "1";

		await sessionModule.createCliCore();

		expect(createCore).toHaveBeenCalledWith(
			expect.not.objectContaining({
				backendMode: expect.anything(),
			}),
		);
	});

	it("logs the selected backend through the injected logger", async () => {
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};

		await sessionModule.createCliCore({ logger });

		expect(logger.log).toHaveBeenCalledWith(
			"CLI core runtime routing selected",
			{
				backendMode: "hub",
				rpcAddress: "127.0.0.1:4317",
				forceLocalBackend: false,
			},
		);
	});
});
