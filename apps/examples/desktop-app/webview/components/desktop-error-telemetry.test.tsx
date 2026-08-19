// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopErrorTelemetry } from "./desktop-error-telemetry";

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { reportError },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	reportError.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function renderTelemetry() {
	await act(async () => {
		root.render(<DesktopErrorTelemetry />);
	});
}

describe("DesktopErrorTelemetry", () => {
	it("attributes uncaught errors to their source URL and position", async () => {
		await renderTelemetry();

		// A script URL answered with HTML surfaces exactly like this: a parse
		// SyntaxError whose only pointer to the failing resource is filename.
		window.dispatchEvent(
			new ErrorEvent("error", {
				message: "Uncaught SyntaxError: Unexpected token '<'",
				filename: "tauri://localhost/_vercel/insights/script.js",
				lineno: 1,
				colno: 1,
			}),
		);

		expect(reportError).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: "webview.uncaught_error",
				handled: false,
				sourceUrl: "tauri://localhost/_vercel/insights/script.js",
				lineno: 1,
				colno: 1,
			}),
		);
	});

	it("omits attribution fields when the ErrorEvent carries none", async () => {
		await renderTelemetry();

		window.dispatchEvent(
			new ErrorEvent("error", {
				message: "boom",
				error: new Error("boom"),
			}),
		);

		expect(reportError).toHaveBeenCalledTimes(1);
		const report = reportError.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(report.operation).toBe("webview.uncaught_error");
		expect(report.sourceUrl).toBeUndefined();
		expect(report.lineno).toBeUndefined();
		expect(report.colno).toBeUndefined();
	});
});
