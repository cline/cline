import { describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../../../types/session";
import { AgentEventBridge, type AgentEventBridgeDeps } from "./agent-event-bridge";

function createTelemetryStub() {
	return {
		capture: vi.fn(),
		captureRequired: vi.fn(),
		recordCounter: vi.fn(),
		recordHistogram: vi.fn(),
		recordGauge: vi.fn(),
	};
}

function createBridge(telemetry: ReturnType<typeof createTelemetryStub> | undefined) {
	const session = telemetry
		? ({ config: { telemetry } } as unknown as ActiveSession)
		: undefined;
	const deps = {
		getSession: () => session,
	} as unknown as AgentEventBridgeDeps;
	return new AgentEventBridge(deps);
}

describe("AgentEventBridge.handlePluginTelemetry", () => {
	it("routes plugin capture calls into the session telemetry service", () => {
		const telemetry = createTelemetryStub();
		const bridge = createBridge(telemetry);

		bridge.handlePluginTelemetry("session-1", {
			pluginName: "weather",
			kind: "event",
			event: "topic_used",
			properties: { topic: "sunny" },
		});

		expect(telemetry.capture).toHaveBeenCalledWith({
			event: "plugin.topic_used",
			properties: {
				topic: "sunny",
				plugin_name: "weather",
				session_id: "session-1",
			},
		});
	});

	it("routes required events through captureRequired", () => {
		const telemetry = createTelemetryStub();
		const bridge = createBridge(telemetry);

		bridge.handlePluginTelemetry("session-1", {
			pluginName: "weather",
			kind: "event",
			event: "billing_used",
			required: true,
		});

		expect(telemetry.captureRequired).toHaveBeenCalledWith(
			"plugin.billing_used",
			{ plugin_name: "weather", session_id: "session-1" },
		);
		expect(telemetry.capture).not.toHaveBeenCalled();
	});

	it("routes metrics to the matching recorder with a namespaced name", () => {
		const telemetry = createTelemetryStub();
		const bridge = createBridge(telemetry);

		bridge.handlePluginTelemetry("session-1", {
			pluginName: "weather",
			kind: "metric",
			metric: "counter",
			name: "tool_calls",
			value: 2,
			attributes: { tool_name: "get_weather" },
		});

		expect(telemetry.recordCounter).toHaveBeenCalledWith(
			"plugin.tool_calls",
			2,
			{ tool_name: "get_weather", plugin_name: "weather" },
			undefined,
			false,
		);
	});

	it("falls back to host telemetry for setup-time events emitted before session registration", () => {
		const fallback = createTelemetryStub();
		// Plugin setup() runs during bootstrap, before sessions.set(): the
		// session lookup misses and only the fallback can receive the event.
		const bridge = createBridge(undefined);

		bridge.handlePluginTelemetry(
			"session-1",
			{
				pluginName: "weather",
				kind: "event",
				event: "plugin_setup",
			},
			fallback as never,
		);

		expect(fallback.capture).toHaveBeenCalledWith({
			event: "plugin.plugin_setup",
			properties: { plugin_name: "weather", session_id: "session-1" },
		});
	});

	it("drops malformed payloads and missing telemetry without throwing", () => {
		const telemetry = createTelemetryStub();
		const bridge = createBridge(telemetry);

		bridge.handlePluginTelemetry("session-1", null);
		bridge.handlePluginTelemetry("session-1", { kind: "event", event: "  " });
		bridge.handlePluginTelemetry("session-1", {
			kind: "metric",
			metric: "counter",
			name: "",
			value: 1,
		});
		expect(telemetry.capture).not.toHaveBeenCalled();
		expect(telemetry.recordCounter).not.toHaveBeenCalled();

		const withoutTelemetry = createBridge(undefined);
		expect(() =>
			withoutTelemetry.handlePluginTelemetry("session-1", {
				kind: "event",
				event: "topic_used",
			}),
		).not.toThrow();
	});
});
