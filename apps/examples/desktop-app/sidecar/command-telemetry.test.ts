import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const mocks = vi.hoisted(() => ({
	isTelemetryOptedOutGlobally: vi.fn(() => false),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		isTelemetryOptedOutGlobally: mocks.isTelemetryOptedOutGlobally,
	};
});

import {
	dispatchCommandWithTelemetry,
	recordCommandOutcome,
	SLOW_COMMAND_THRESHOLD_MS,
} from "./command-telemetry";

function createContext(): {
	ctx: SidecarContext;
	capture: ReturnType<typeof vi.fn>;
} {
	const capture = vi.fn();
	const ctx = {
		telemetry: { capture },
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn() },
	} as unknown as SidecarContext;
	return { ctx, capture };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.isTelemetryOptedOutGlobally.mockReturnValue(false);
});

describe("recordCommandOutcome", () => {
	it("reports handler failures with normalized error fields", () => {
		const { ctx, capture } = createContext();
		recordCommandOutcome(
			ctx,
			"delete_chat_session",
			42.6,
			Object.assign(new TypeError("api_key=oops it broke"), {}),
		);
		expect(capture).toHaveBeenCalledTimes(1);
		const { event, properties } = capture.mock.calls[0][0];
		expect(event).toBe("desktop.command_failed");
		expect(properties.component).toBe("desktop.sidecar");
		expect(properties.command).toBe("delete_chat_session");
		expect(properties.duration_ms).toBe(43);
		expect(properties.error_type).toBe("TypeError");
		expect(properties.error_message).toBe("api_key=[redacted] it broke");
	});

	it("reports slow successful commands past the threshold", () => {
		const { ctx, capture } = createContext();
		recordCommandOutcome(ctx, "list_chat_sessions", SLOW_COMMAND_THRESHOLD_MS);
		expect(capture).toHaveBeenCalledTimes(1);
		const { event, properties } = capture.mock.calls[0][0];
		expect(event).toBe("desktop.command_slow");
		expect(properties).toEqual({
			component: "desktop.sidecar",
			command: "list_chat_sessions",
			duration_ms: SLOW_COMMAND_THRESHOLD_MS,
		});
	});

	it("stays silent for fast successful commands", () => {
		const { ctx, capture } = createContext();
		recordCommandOutcome(
			ctx,
			"list_chat_sessions",
			SLOW_COMMAND_THRESHOLD_MS - 1,
		);
		expect(capture).not.toHaveBeenCalled();
	});

	it("never flags interactive or long-running-by-design commands as slow", () => {
		const { ctx, capture } = createContext();
		for (const command of [
			"pick_workspace_directory",
			"run_provider_oauth_login",
			"chat_session_command",
		]) {
			recordCommandOutcome(ctx, command, 5 * 60_000);
		}
		expect(capture).not.toHaveBeenCalled();

		// ...but their failures still report.
		recordCommandOutcome(
			ctx,
			"pick_workspace_directory",
			500,
			new Error("picker exploded"),
		);
		expect(capture).toHaveBeenCalledTimes(1);
		expect(capture.mock.calls[0][0].event).toBe("desktop.command_failed");
	});

	it("clamps unknown command names to keep cardinality bounded", () => {
		const { ctx, capture } = createContext();
		recordCommandOutcome(ctx, "DROP TABLE; --", 100, new Error("nope"));
		recordCommandOutcome(ctx, undefined, 100, new Error("nope"));
		expect(capture.mock.calls[0][0].properties.command).toBe(
			"invalid_command_name",
		);
		expect(capture.mock.calls[1][0].properties.command).toBe(
			"invalid_command_name",
		);
	});

	it("respects the global telemetry opt-out", () => {
		const { ctx, capture } = createContext();
		mocks.isTelemetryOptedOutGlobally.mockReturnValue(true);
		recordCommandOutcome(ctx, "list_chat_sessions", 100, new Error("boom"));
		expect(capture).not.toHaveBeenCalled();
	});

	it("never throws, even when capture throws", () => {
		const { ctx, capture } = createContext();
		capture.mockImplementation(() => {
			throw new Error("exporter exploded");
		});
		expect(() =>
			recordCommandOutcome(ctx, "list_chat_sessions", 100, new Error("boom")),
		).not.toThrow();
	});
});

describe("dispatchCommandWithTelemetry", () => {
	it("returns the handler result and reports nothing for fast success", async () => {
		const { ctx, capture } = createContext();
		const result = await dispatchCommandWithTelemetry(
			ctx,
			"get_process_context",
			async () => ({ ok: true }),
		);
		expect(result).toEqual({ ok: true });
		expect(capture).not.toHaveBeenCalled();
	});

	it("re-throws handler errors after reporting them", async () => {
		const { ctx, capture } = createContext();
		await expect(
			dispatchCommandWithTelemetry(ctx, "checkout_git_branch", async () => {
				throw new Error("branch is required");
			}),
		).rejects.toThrow("branch is required");
		expect(capture).toHaveBeenCalledTimes(1);
		const { event, properties } = capture.mock.calls[0][0];
		expect(event).toBe("desktop.command_failed");
		expect(properties.command).toBe("checkout_git_branch");
		expect(properties.error_message).toBe("branch is required");
		expect(typeof properties.duration_ms).toBe("number");
	});

	it("reports slow successes with the measured duration", async () => {
		vi.useFakeTimers();
		try {
			const { ctx, capture } = createContext();
			const dispatch = dispatchCommandWithTelemetry(
				ctx,
				"search_workspace_files",
				() =>
					new Promise((resolve) =>
						setTimeout(() => resolve("done"), SLOW_COMMAND_THRESHOLD_MS + 500),
					),
			);
			await vi.advanceTimersByTimeAsync(SLOW_COMMAND_THRESHOLD_MS + 500);
			await expect(dispatch).resolves.toBe("done");
			expect(capture).toHaveBeenCalledTimes(1);
			const { event, properties } = capture.mock.calls[0][0];
			expect(event).toBe("desktop.command_slow");
			expect(properties.duration_ms).toBe(SLOW_COMMAND_THRESHOLD_MS + 500);
		} finally {
			vi.useRealTimers();
		}
	});
});
