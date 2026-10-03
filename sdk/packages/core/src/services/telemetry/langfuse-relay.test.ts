import { createServer } from "node:http";
import { withLangfuseTraceAttributes } from "@cline/llms";
import { context, trace } from "@opentelemetry/api";
import { expect, it } from "vitest";
import { OpenTelemetryProvider } from "./OpenTelemetryProvider";

it("exports user/session attributes through OTLP and isolates concurrent sessions", async () => {
	type WireSpan = {
		name: string;
		attributes: { key: string; value: { stringValue?: string } }[];
	};
	const spans: WireSpan[] = [];
	const requests: string[] = [];
	const server = createServer(async (request, response) => {
		requests.push(request.url ?? "");
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const payload = JSON.parse(Buffer.concat(chunks).toString());
		for (const resource of payload.resourceSpans) {
			for (const scope of resource.scopeSpans) spans.push(...scope.spans);
		}
		response.writeHead(200, { "content-type": "application/json" });
		response.end("{}");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No address");
	trace.disable();
	context.disable();
	const provider = new OpenTelemetryProvider({
		tracesExporter: "otlp",
		otlpEndpoint: `http://127.0.0.1:${address.port}`,
	});
	try {
		const tracer = provider.getTracer("cline-provider-langfuse");
		await Promise.all(
			["a", "b"].map((id) =>
				withLangfuseTraceAttributes(
					true,
					{
						userId: `user-${id}`,
						sessionId: `session-${id}`,
						tags: ["relay"],
						metadata: { runId: `run-${id}` },
					},
					() =>
						tracer.startActiveSpan(`root-${id}`, async (root) => {
							await new Promise<void>((resolve) => setImmediate(resolve));
							for (const name of ["step", "generation", "tool"]) {
								tracer.startSpan(`${name}-${id}`).end();
							}
							root.end();
						}),
				),
			),
		);
		tracer.startSpan("outside-context").end();
		await withLangfuseTraceAttributes(
			true,
			{ userId: "unrelated-user" },
			async () => {
				provider.getTracer("unrelated").startSpan("unrelated").end();
			},
		);
		await provider.tracerProvider?.forceFlush();
		expect(requests).toEqual(["/v1/traces"]);
		expect(spans).toHaveLength(10);
		for (const span of spans) {
			const attributes = Object.fromEntries(
				span.attributes.map(({ key, value }) => [key, value.stringValue]),
			);
			if (["outside-context", "unrelated"].includes(span.name)) {
				expect(attributes["user.id"]).toBeUndefined();
				expect(attributes["session.id"]).toBeUndefined();
			} else {
				const id = span.name.slice(-1);
				expect(attributes["user.id"]).toBe(`user-${id}`);
				expect(attributes["session.id"]).toBe(`session-${id}`);
				expect(attributes["langfuse.trace.metadata.runId"]).toBe(`run-${id}`);
			}
		}
	} finally {
		await provider.dispose();
		trace.disable();
		context.disable();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
