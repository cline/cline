import type { ITelemetryService } from "@clinebot/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	emitWorkspaceLifecycleTelemetry,
	resetWorkspaceTelemetryForTests,
} from "./workspace-telemetry";

interface TelemetryStub {
	telemetry: ITelemetryService;
	capture: ReturnType<typeof vi.fn>;
	captureRequired: ReturnType<typeof vi.fn>;
}

function createTelemetryStub(): TelemetryStub {
	const capture = vi.fn();
	const captureRequired = vi.fn();
	const telemetry = {
		capture,
		captureRequired,
		setDistinctId: vi.fn(),
		updateCommonProperties: vi.fn(),
		identify: vi.fn(),
	} as unknown as ITelemetryService;
	return { telemetry, capture, captureRequired };
}

function findCalls(
	stub: TelemetryStub,
	event: string,
): { event: string; properties?: Record<string, unknown> }[] {
	return stub.capture.mock.calls
		.filter(([arg]) => (arg as { event: string }).event === event)
		.map(
			([arg]) => arg as { event: string; properties?: Record<string, unknown> },
		);
}

describe("emitWorkspaceLifecycleTelemetry", () => {
	beforeEach(() => {
		resetWorkspaceTelemetryForTests();
	});

	afterEach(() => {
		resetWorkspaceTelemetryForTests();
	});

	test("emits workspace.initialized once per process per workspace path", () => {
		const stub = createTelemetryStub();
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/repo",
			vcsType: "git",
			rootCount: 1,
			durationMs: 12,
		});
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/repo",
			vcsType: "git",
			rootCount: 1,
			durationMs: 12,
		});
		const initialized = findCalls(stub, "workspace.initialized");
		expect(initialized).toHaveLength(1);
	});

	test("emits separate workspace.initialized events for distinct paths", () => {
		const stub = createTelemetryStub();
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/repo-a",
			vcsType: "git",
			rootCount: 1,
		});
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/repo-b",
			vcsType: "none",
			rootCount: 1,
		});
		expect(findCalls(stub, "workspace.initialized")).toHaveLength(2);
	});

	test("emits workspace.init_error only when diagnostics report a failure", () => {
		const stub = createTelemetryStub();
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/healthy",
			vcsType: "git",
		});
		expect(findCalls(stub, "workspace.init_error")).toHaveLength(0);

		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/broken",
			vcsType: "none",
			initError: { errorType: "GitProbeError", message: "permission denied" },
		});
		const errors = findCalls(stub, "workspace.init_error");
		expect(errors).toHaveLength(1);
		expect(errors[0]?.properties?.error_type).toBe("GitProbeError");
		expect(errors[0]?.properties?.fallback_to_single_root).toBe(true);
	});

	test("does not emit raw workspace path in event properties", () => {
		const stub = createTelemetryStub();
		const rootPath = "/tmp/super-secret-repo-name";
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath,
			vcsType: "git",
			rootCount: 1,
		});
		expect(stub.captureRequired).not.toHaveBeenCalled();
		for (const call of stub.capture.mock.calls) {
			const arg = call[0] as {
				event: string;
				properties?: Record<string, unknown>;
			};
			expect(JSON.stringify(arg.properties ?? {})).not.toContain(rootPath);
		}
	});

	test("emits derived has_git/has_mercurial/is_multi_root flags", () => {
		const stub = createTelemetryStub();
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/multi",
			rootCount: 2,
			vcsTypes: ["git", "hg"],
		});
		const initialized = findCalls(stub, "workspace.initialized");
		expect(initialized).toHaveLength(1);
		const props = initialized[0]?.properties as Record<string, unknown>;
		expect(props.is_multi_root).toBe(true);
		expect(props.has_git).toBe(true);
		expect(props.has_mercurial).toBe(true);
		expect(props.vcs_types).toEqual(["git", "hg"]);
	});

	test("no-ops when telemetry is undefined", () => {
		expect(() =>
			emitWorkspaceLifecycleTelemetry({
				telemetry: undefined,
				rootPath: "/tmp/quiet",
				vcsType: "none",
			}),
		).not.toThrow();
	});

	test("resetWorkspaceTelemetryForTests clears the dedup cache", () => {
		const stub = createTelemetryStub();
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/repo",
			vcsType: "git",
		});
		resetWorkspaceTelemetryForTests();
		emitWorkspaceLifecycleTelemetry({
			telemetry: stub.telemetry,
			rootPath: "/tmp/repo",
			vcsType: "git",
		});
		expect(findCalls(stub, "workspace.initialized")).toHaveLength(2);
	});
});
