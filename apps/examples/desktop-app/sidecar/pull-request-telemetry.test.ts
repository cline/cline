import type { ITelemetryService } from "@cline/shared";
import { expect, it, vi } from "vitest";
import { capturePullRequestEvent } from "./pull-request-telemetry";

const event = {
	action: "open_clicked",
	prState: "open",
	ciState: "success",
	mergeTone: "success",
};
function service(enabled = true) {
	const capture = vi.fn();
	return {
		capture,
		telemetry: {
			capture,
			isEnabled: () => enabled,
		} as unknown as ITelemetryService,
	};
}

it("captures only allowlisted status categories and strips identifiers", () => {
	const { capture, telemetry } = service();
	capturePullRequestEvent(telemetry, {
		...event,
		repository: "private/repo",
		cwd: "/private/path",
		url: "https://github.com/private/repo",
		title: "Secret",
		number: 42,
	});
	expect(capture).toHaveBeenCalledExactlyOnceWith({
		event: "desktop.pull_request.open_clicked",
		properties: {
			prState: "open",
			ciState: "success",
			mergeTone: "success",
		},
	});
});

it.each([
	{ ...event, action: "arbitrary.event" },
	{ ...event, prState: "private/repo" },
	{ ...event, ciState: "test name" },
	{ ...event, mergeTone: "secret" },
	{},
	null,
])("drops invalid payloads", (input) => {
	const { capture, telemetry } = service();
	capturePullRequestEvent(telemetry, input);
	expect(capture).not.toHaveBeenCalled();
});

it("respects telemetry opt-out", () => {
	const { capture, telemetry } = service(false);
	capturePullRequestEvent(telemetry, event);
	expect(capture).not.toHaveBeenCalled();
	expect(() => capturePullRequestEvent(undefined, event)).not.toThrow();
});

it("does not fail the command when the provider throws", () => {
	const { capture, telemetry } = service();
	capture.mockImplementation(() => {
		throw new Error("Telemetry unavailable");
	});
	expect(() => capturePullRequestEvent(telemetry, event)).not.toThrow();
});
