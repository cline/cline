import { afterEach, describe, expect, it, mock } from "bun:test"
import { isOtlpTraceRelayProvider } from "@cline/shared"
import { context, propagation, trace } from "@opentelemetry/api"
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node"
import * as exporterFactory from "../OpenTelemetryExporterFactory"

const exporters = new Map<string, InMemorySpanExporter>()
let exporterShutdown: (() => Promise<void>) | undefined
mock.module("../OpenTelemetryExporterFactory", () => ({
	...exporterFactory,
	createOTLPTraceExporter: (_protocol: string, endpoint: string) => {
		const exporter = new InMemorySpanExporter()
		if (exporterShutdown) {
			exporter.shutdown = exporterShutdown
		}
		exporters.set(endpoint, exporter)
		return exporter
	},
}))

import { OpenTelemetryClientProvider } from "../OpenTelemetryClientProvider"

const clients: OpenTelemetryClientProvider[] = []
function createClient(endpoint = "http://first:4318") {
	const client = new OpenTelemetryClientProvider({ enabled: true, tracesExporter: "otlp", otlpEndpoint: endpoint })
	clients.push(client)
	return client
}

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.dispose()))
	trace.disable()
	context.disable()
	propagation.disable()
	exporters.clear()
	exporterShutdown = undefined
})

describe("OpenTelemetryClientProvider tracer lifecycle", () => {
	it("disables tracing, then re-enables it at a new endpoint", async () => {
		const first = createClient()
		const cachedTracer = trace.getTracer("lifecycle-test")
		cachedTracer.startSpan("before-disable").end()
		await first.tracerProvider!.forceFlush()
		const oldExporter = exporters.get("http://first:4318")!
		expect(oldExporter.getFinishedSpans().map((span) => span.name)).toEqual(["before-disable"])
		const disposal = first.dispose()
		expect(first.dispose()).toBe(disposal)
		await disposal
		expect(isOtlpTraceRelayProvider(first.tracerProvider)).toBe(false)
		expect(trace.getTracer("lifecycle-test").startSpan("disabled").isRecording()).toBe(false)
		cachedTracer.startSpan("cached-after-disable").end()
		await first.tracerProvider!.forceFlush()
		// The in-memory exporter clears its buffer on shutdown.
		expect(oldExporter.getFinishedSpans()).toHaveLength(0)

		const replacement = createClient("http://second:4318")
		expect(replacement.tracerProvider).not.toBeNull()
		expect(isOtlpTraceRelayProvider(replacement.tracerProvider)).toBe(true)
		await trace.getTracer("lifecycle-test").startActiveSpan("parent", async (parent) => {
			await Promise.resolve()
			trace.getTracer("lifecycle-test").startSpan("child").end()
			parent.end()
		})
		await replacement.tracerProvider!.forceFlush()
		const spans = exporters.get("http://second:4318")!.getFinishedSpans()
		expect(spans.map((span) => span.name)).toEqual(["child", "parent"])
		expect(spans[0].parentSpanId).toBe(spans[1].spanContext().spanId)
		expect(oldExporter.getFinishedSpans()).toHaveLength(0)
	})

	it("discards rejected registrations without shutting down another owner", async () => {
		const owner = createClient()
		const rejected = createClient("http://rejected:4318")
		expect(rejected.tracerProvider).toBeNull()
		await rejected.dispose()
		trace.getTracer("lifecycle-test").startSpan("still-owned").end()
		await owner.tracerProvider!.forceFlush()
		expect(
			exporters
				.get("http://first:4318")!
				.getFinishedSpans()
				.map((span) => span.name),
		).toEqual(["still-owned"])
		expect(exporters.get("http://rejected:4318")!.getFinishedSpans()).toHaveLength(0)
	})

	it("does not unregister a foreign provider that has taken over the global slot", async () => {
		const old = createClient()
		trace.disable()
		const foreign = new NodeTracerProvider()
		const exporter = new InMemorySpanExporter()
		foreign.addSpanProcessor(new SimpleSpanProcessor(exporter))
		foreign.register()
		try {
			await old.dispose()
			trace.getTracer("lifecycle-test").startSpan("foreign").end()
			await foreign.forceFlush()
			expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["foreign"])
		} finally {
			await foreign.shutdown()
		}
	})

	it("awaits cleanup of an exporter whose registration was rejected", async () => {
		createClient()
		let release!: () => void
		const shutdown = new Promise<void>((resolve) => {
			release = resolve
		})
		let started!: () => void
		const shutdownStarted = new Promise<void>((resolve) => {
			started = resolve
		})
		exporterShutdown = () => {
			started()
			return shutdown
		}
		const rejected = createClient("http://rejected:4318")
		let disposed = false
		const disposal = rejected.dispose().then(() => {
			disposed = true
		})
		await shutdownStarted
		await new Promise((resolve) => setImmediate(resolve))
		expect(disposed).toBe(false)
		release()
		await disposal
		expect(disposed).toBe(true)
	})
})
