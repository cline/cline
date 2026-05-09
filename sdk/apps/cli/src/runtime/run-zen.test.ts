import { afterEach, describe, expect, it, vi } from "vitest";

const {
	connect,
	close,
	startRuntimeSession,
	sendRuntimeSession,
	buildUserInputMessage,
	ensureCliHubServer,
	emitJsonLine,
	writeErr,
	writeln,
} = vi.hoisted(() => ({
	connect: vi.fn<() => Promise<void>>(),
	close: vi.fn(),
	startRuntimeSession: vi.fn(),
	sendRuntimeSession: vi.fn(),
	buildUserInputMessage: vi.fn(),
	ensureCliHubServer: vi.fn(),
	emitJsonLine: vi.fn(),
	writeErr: vi.fn(),
	writeln: vi.fn(),
}));

vi.mock("@clinebot/core", () => ({
	HubSessionClient: class {
		connect = connect;
		close = close;
		startRuntimeSession = startRuntimeSession;
		sendRuntimeSession = sendRuntimeSession;
	},
}));

vi.mock("./prompt", () => ({
	buildUserInputMessage,
}));

vi.mock("../utils/hub-runtime", () => ({
	ensureCliHubServer,
}));

vi.mock("../utils/output", () => ({
	c: { dim: "", reset: "" },
	emitJsonLine,
	writeErr,
	writeln,
}));

import { runZen } from "./run-zen";

describe("runZen", () => {
	afterEach(() => {
		delete process.env.CLINE_SESSION_BACKEND_MODE;
		vi.clearAllMocks();
	});

	it("waits for hub acknowledgement before closing the session client", async () => {
		let resolveDispatch: (() => void) | undefined;
		sendRuntimeSession.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveDispatch = () => resolve({ result: undefined });
				}),
		);
		connect.mockResolvedValue(undefined);
		startRuntimeSession.mockResolvedValue({ sessionId: "session-123" });
		buildUserInputMessage.mockResolvedValue({
			prompt: "ship it",
			userImages: [],
			userFiles: [],
		});
		ensureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});

		const run = runZen("ship it", {
			sandbox: false,
			workspaceRoot: "/workspace",
			cwd: "/workspace",
			providerId: "cline",
			modelId: "test-model",
			apiKey: "",
			systemPrompt: "",
			loggerConfig: undefined,
			outputMode: "text",
		} as never);

		await vi.waitFor(() => {
			expect(sendRuntimeSession).toHaveBeenCalledOnce();
		});
		expect(close).not.toHaveBeenCalled();

		resolveDispatch?.();
		await run;

		expect(startRuntimeSession).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "yolo",
				toolExecutors: ["submit"],
			}),
		);
		expect(sendRuntimeSession).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(writeErr).not.toHaveBeenCalled();
	});
});
