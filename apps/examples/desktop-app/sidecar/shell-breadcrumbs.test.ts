import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import type { ITelemetryService } from "@cline/core";
import { reportShellBreadcrumbs } from "./shell-breadcrumbs";

let tempDir: string;
let breadcrumbPath: string;
let capture: ReturnType<typeof vi.fn>;
let telemetry: ITelemetryService;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.isTelemetryOptedOutGlobally.mockReturnValue(false);
	tempDir = mkdtempSync(join(tmpdir(), "shell-breadcrumbs-"));
	breadcrumbPath = join(tempDir, "shell-breadcrumbs.jsonl");
	capture = vi.fn();
	telemetry = { capture } as unknown as ITelemetryService;
});

afterEach(() => {
	rmSync(tempDir, { force: true, recursive: true });
});

describe("reportShellBreadcrumbs", () => {
	it("reports each valid line and truncates the file", () => {
		writeFileSync(
			breadcrumbPath,
			[
				JSON.stringify({
					ts: 1_700_000_000_000,
					event: "sidecar_exited",
					exit_code: 137,
					restart_count: 1,
				}),
				JSON.stringify({
					ts: 1_700_000_005_000,
					event: "sidecar_spawn_failed",
					restart_count: 1,
					detail: "failed to start desktop backend sidecar: not found",
				}),
				"",
			].join("\n"),
		);

		const reported = reportShellBreadcrumbs(
			telemetry,
			undefined,
			breadcrumbPath,
		);
		expect(reported).toBe(2);
		expect(capture).toHaveBeenCalledTimes(2);
		expect(capture.mock.calls[0][0]).toEqual({
			event: "desktop.shell_breadcrumb",
			properties: {
				component: "desktop.shell",
				breadcrumb_event: "sidecar_exited",
				occurred_at: new Date(1_700_000_000_000).toISOString(),
				exit_code: 137,
				restart_count: 1,
			},
		});
		expect(capture.mock.calls[1][0].properties.breadcrumb_event).toBe(
			"sidecar_spawn_failed",
		);
		expect(capture.mock.calls[1][0].properties.detail).toBe(
			"failed to start desktop backend sidecar: not found",
		);
		expect(existsSync(breadcrumbPath)).toBe(false);
	});

	it("drops malformed lines silently and still reports valid ones", () => {
		writeFileSync(
			breadcrumbPath,
			[
				"not json at all",
				'{"truncated": ',
				JSON.stringify(["an", "array"]),
				JSON.stringify({ event: "NOT A VALID EVENT NAME!" }),
				JSON.stringify({ no_event_field: true }),
				JSON.stringify({ event: "sidecar_exited", exit_code: "not-a-number" }),
			].join("\n"),
		);

		const reported = reportShellBreadcrumbs(
			telemetry,
			undefined,
			breadcrumbPath,
		);
		// Only the last line is valid; its bogus exit_code is dropped but the
		// event itself still reports.
		expect(reported).toBe(1);
		expect(capture.mock.calls[0][0].properties).toEqual({
			component: "desktop.shell",
			breadcrumb_event: "sidecar_exited",
		});
		expect(existsSync(breadcrumbPath)).toBe(false);
	});

	it("returns 0 without a breadcrumb file", () => {
		expect(reportShellBreadcrumbs(telemetry, undefined, breadcrumbPath)).toBe(
			0,
		);
		expect(capture).not.toHaveBeenCalled();
	});

	it("caps a crash-loop file to the newest 50 breadcrumbs", () => {
		const lines = Array.from({ length: 80 }, (_, index) =>
			JSON.stringify({
				ts: 1_700_000_000_000 + index,
				event: "sidecar_exited",
				restart_count: index + 1,
			}),
		);
		writeFileSync(breadcrumbPath, `${lines.join("\n")}\n`);

		const reported = reportShellBreadcrumbs(
			telemetry,
			undefined,
			breadcrumbPath,
		);
		expect(reported).toBe(50);
		expect(capture.mock.calls[0][0].properties.restart_count).toBe(31);
		expect(capture.mock.calls.at(-1)?.[0].properties.restart_count).toBe(80);
	});

	it("drops an oversized file unparsed", () => {
		writeFileSync(
			breadcrumbPath,
			`${JSON.stringify({ event: "sidecar_exited" })}\n`.repeat(10_000),
		);
		expect(reportShellBreadcrumbs(telemetry, undefined, breadcrumbPath)).toBe(
			0,
		);
		expect(capture).not.toHaveBeenCalled();
		expect(existsSync(breadcrumbPath)).toBe(false);
	});

	it("truncates without reporting when telemetry is opted out", () => {
		writeFileSync(
			breadcrumbPath,
			`${JSON.stringify({ event: "sidecar_exited" })}\n`,
		);
		mocks.isTelemetryOptedOutGlobally.mockReturnValue(true);
		expect(reportShellBreadcrumbs(telemetry, undefined, breadcrumbPath)).toBe(
			0,
		);
		expect(capture).not.toHaveBeenCalled();
		expect(existsSync(breadcrumbPath)).toBe(false);
	});

	it("redacts filesystem paths in spawn-failure details", () => {
		writeFileSync(
			breadcrumbPath,
			`${JSON.stringify({
				event: "sidecar_spawn_failed",
				detail:
					"sidecar not found under workspace_root=/Users/janedoe/dev/cline",
			})}\n`,
		);
		reportShellBreadcrumbs(telemetry, undefined, breadcrumbPath);
		const detail = capture.mock.calls[0][0].properties.detail;
		expect(detail).toContain("/Users/[redacted]");
		expect(detail).not.toContain("janedoe");
	});

	it("never throws, even when capture throws", () => {
		writeFileSync(
			breadcrumbPath,
			`${JSON.stringify({ event: "sidecar_exited" })}\n`,
		);
		capture.mockImplementation(() => {
			throw new Error("exporter exploded");
		});
		expect(() =>
			reportShellBreadcrumbs(telemetry, undefined, breadcrumbPath),
		).not.toThrow();
	});
});
