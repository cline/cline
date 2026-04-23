import type { SessionHistoryRecord } from "@clinebot/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const useInputMock = vi.hoisted(() => vi.fn());
const useStateMock = vi.hoisted(() => vi.fn());
const useMemoMock = vi.hoisted(() => vi.fn());

vi.mock("ink", async () => {
	const actual = await vi.importActual<typeof import("ink")>("ink");
	return {
		...actual,
		useInput: useInputMock,
	};
});

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		default: {
			createElement: vi.fn(() => null),
		},
		useMemo: useMemoMock,
		useState: useStateMock,
	};
});

import { HistoryListView } from "./HistoryListView";

function createHistoryRow(
	overrides: Partial<SessionHistoryRecord> = {},
): SessionHistoryRecord {
	return {
		sessionId: "sess_1",
		source: "cli",
		pid: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
		status: "completed",
		interactive: false,
		provider: "mock-provider",
		model: "mock-model",
		cwd: "/tmp/workspace",
		workspaceRoot: "/tmp/workspace",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		prompt: "hello world",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("HistoryListView", () => {
	afterEach(() => {
		useInputMock.mockReset();
		useMemoMock.mockReset();
		useStateMock.mockReset();
	});

	it("exports the highlighted session when pressing right arrow", async () => {
		const onExport = vi.fn(async () => "/tmp/sess_1.html");
		useMemoMock.mockImplementation((factory: () => unknown) => factory());
		useStateMock
			.mockImplementationOnce((value: unknown) => [value, vi.fn()])
			.mockImplementationOnce((value: unknown) => [value, vi.fn()])
			.mockImplementationOnce((value: unknown) => [value, vi.fn()])
			.mockImplementationOnce((value: unknown) => [value, vi.fn()]);

		HistoryListView({
			rows: [createHistoryRow()],
			onSelect: vi.fn(),
			onExport,
			onExit: vi.fn(),
		});

		const handler = useInputMock.mock.calls[0]?.[0] as
			| ((input: string, key: Record<string, boolean>) => void)
			| undefined;
		expect(handler).toBeTypeOf("function");

		handler?.("", { rightArrow: true });
		await Promise.resolve();

		expect(onExport).toHaveBeenCalledWith("sess_1");
	});
});
