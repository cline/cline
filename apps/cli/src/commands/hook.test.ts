import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSessionHookEvent } from "../session/session";
import {
	appendHookAudit,
	parseCliHookPayload,
	readStdinUtf8,
	writeHookJson,
} from "../utils/helpers";
import { runHookCommand } from "./hook";

// The command must go through the real shared hook parser (that is the
// contract under regression here); only its process effects — stdin reads,
// the audit log, stdout JSON, and session fan-out — are mocked.
vi.mock("../utils/helpers", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/helpers")>();
	return {
		...actual,
		readStdinUtf8: vi.fn(),
		appendHookAudit: vi.fn(),
		writeHookJson: vi.fn(),
	};
});

vi.mock("../session/session", () => ({
	handleSessionHookEvent: vi.fn(),
}));

// Exact payload from https://github.com/cline/cline/issues/14808: the shared
// schema accepts it (hookName "agent_error"), so the hook command must too.
const AGENT_ERROR_PAYLOAD = {
	clineVersion: "3.0.62",
	hookName: "agent_error",
	timestamp: "2000-01-01T00:00:00.000Z",
	taskId: "t",
	workspaceRoots: [] as string[],
	userId: "u",
	agent_id: "a",
	parent_agent_id: null,
	iteration: 0,
	error: { name: "Error", message: "fixture failure" },
};

function mockStdin(payload: unknown) {
	vi.mocked(readStdinUtf8).mockResolvedValue(JSON.stringify(payload));
}

afterEach(() => {
	vi.clearAllMocks();
});

describe("runHookCommand", () => {
	it("accepts the schema-valid agent_error payload", async () => {
		const payload = await parseCliHookPayload(AGENT_ERROR_PAYLOAD);
		expect(payload?.hookName).toBe("agent_error");
	});

	it("exits 0 with a JSON response for an agent_error event", async () => {
		mockStdin(AGENT_ERROR_PAYLOAD);
		const io = { writeln: vi.fn(), writeErr: vi.fn() };

		const auditOrder = vi.mocked(appendHookAudit).mockResolvedValue();
		const sessionOrder = vi.mocked(handleSessionHookEvent).mockResolvedValue();
		const jsonOrder = vi.mocked(writeHookJson);

		await expect(runHookCommand(io)).resolves.toBe(0);

		expect(io.writeErr).not.toHaveBeenCalled();
		expect(jsonOrder).toHaveBeenCalledWith({});
		// Audit log and session fan-out still run, in the usual order, before
		// the response is written.
		expect(auditOrder).toHaveBeenCalledTimes(1);
		expect(sessionOrder).toHaveBeenCalledTimes(1);
		expect(auditOrder.mock.invocationCallOrder[0]).toBeLessThan(
			sessionOrder.mock.invocationCallOrder[0],
		);
		expect(sessionOrder.mock.invocationCallOrder[0]).toBeLessThan(
			jsonOrder.mock.invocationCallOrder[0],
		);
	});

	it("still rejects unknown hook names before audit or session handling", async () => {
		mockStdin({ ...AGENT_ERROR_PAYLOAD, hookName: "bogus_event" });
		const io = { writeln: vi.fn(), writeErr: vi.fn() };

		await expect(runHookCommand(io)).resolves.toBe(1);

		expect(io.writeErr).toHaveBeenCalledWith("invalid hook payload");
		expect(appendHookAudit).not.toHaveBeenCalled();
		expect(handleSessionHookEvent).not.toHaveBeenCalled();
		expect(writeHookJson).not.toHaveBeenCalled();
	});
});
