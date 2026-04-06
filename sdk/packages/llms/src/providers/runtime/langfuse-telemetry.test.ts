import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registerDisposableSpy } = vi.hoisted(() => ({
	registerDisposableSpy: vi.fn(),
}));

const { addSpanProcessorSpy, forceFlushSpy, shutdownSpy, getDelegateSpy } =
	vi.hoisted(() => ({
		addSpanProcessorSpy: vi.fn(),
		forceFlushSpy: vi.fn(async () => undefined),
		shutdownSpy: vi.fn(async () => undefined),
		getDelegateSpy: vi.fn(),
	}));

class MockNodeTracerProvider {
	register = vi.fn();
}

vi.mock("@clinebot/shared", () => ({
	registerDisposable: registerDisposableSpy,
}));

vi.mock("@langfuse/otel", () => ({
	LangfuseSpanProcessor: class MockLangfuseSpanProcessor {},
}));

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracerProvider: () => ({
			addSpanProcessor: addSpanProcessorSpy,
			getDelegate: getDelegateSpy,
		}),
	},
}));

vi.mock("@opentelemetry/sdk-trace-node", () => ({
	NodeTracerProvider: MockNodeTracerProvider,
}));

import {
	disposeLangfuseTelemetry,
	ensureLangfuseTelemetry,
	resetLangfuseTelemetryForTests,
} from "./langfuse-telemetry";

describe("langfuse telemetry", () => {
	beforeEach(() => {
		resetLangfuseTelemetryForTests();
		registerDisposableSpy.mockReset();
		addSpanProcessorSpy.mockReset();
		forceFlushSpy.mockReset();
		forceFlushSpy.mockResolvedValue(undefined);
		shutdownSpy.mockReset();
		shutdownSpy.mockResolvedValue(undefined);
		getDelegateSpy.mockReset();
		getDelegateSpy.mockReturnValue({
			constructor: { name: "NodeTracerProvider" },
			forceFlush: forceFlushSpy,
			shutdown: shutdownSpy,
		});
		process.env.LANGFUSE_BASE_URL = "https://langfuse.example";
		process.env.LANGFUSE_PUBLIC_KEY = "public-key";
		process.env.LANGFUSE_SECRET_KEY = "secret-key";
	});

	afterEach(() => {
		delete process.env.LANGFUSE_BASE_URL;
		delete process.env.LANGFUSE_PUBLIC_KEY;
		delete process.env.LANGFUSE_SECRET_KEY;
		resetLangfuseTelemetryForTests();
	});

	it("does not poison the readiness cache for non-cline providers", async () => {
		await expect(ensureLangfuseTelemetry("openrouter")).resolves.toBe(false);
		await expect(ensureLangfuseTelemetry("cline")).resolves.toBe(true);

		expect(registerDisposableSpy).toHaveBeenCalledTimes(1);
		expect(addSpanProcessorSpy).toHaveBeenCalledTimes(1);
	});

	it("flushes before shutdown during disposal", async () => {
		await disposeLangfuseTelemetry();

		expect(forceFlushSpy).toHaveBeenCalledTimes(1);
		expect(shutdownSpy).toHaveBeenCalledTimes(1);
		expect(forceFlushSpy.mock.invocationCallOrder[0]).toBeLessThan(
			shutdownSpy.mock.invocationCallOrder[0],
		);
	});
});
