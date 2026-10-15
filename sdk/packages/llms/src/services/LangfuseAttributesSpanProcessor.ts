import { getPropagatedAttributesFromContext } from "@langfuse/core";
import type { Context } from "@opentelemetry/api";
import type { Span, SpanProcessor } from "@opentelemetry/sdk-trace-node";

/** Copies Langfuse context onto relay spans without creating an exporter. */
export class LangfuseAttributesSpanProcessor implements SpanProcessor {
	onStart(span: Span, parentContext: Context): void {
		if (span.instrumentationScope.name !== "cline-provider-langfuse") return;
		const attributes = getPropagatedAttributesFromContext(parentContext);
		for (const [key, value] of Object.entries(attributes)) {
			// Explicit span attributes (for example prompt metadata) take priority.
			if (span.attributes[key] === undefined) span.setAttribute(key, value);
		}
	}

	onEnd(): void {}
	async forceFlush(): Promise<void> {}
	async shutdown(): Promise<void> {}
}
