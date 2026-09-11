import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

/**
 * Static packaging smoke only, not evidence of consent, sampling, content capture,
 * tracer registration or delivery. Inspect executable bytes, never source maps.
 * Property/string literals survive current Bun/esbuild identifier minification;
 * property mangling or compressed bytecode will require a different check.
 */
export function assertTraceArtifact(bundle) {
	// Check direct process.env reads, not legitimate OTel config property names.
	// This smoke does not analyze aliased env objects. Never print artifact text.
	for (const name of ["OTEL_TRACES_EXPORTER", "CLINE_TRACE_RECORD_CONTENT"]) {
		const env = String.raw`\bprocess\s*(?:\?\.|\.)\s*env\s*`
		const access = String.raw`(?:(?:\?\.|\.)\s*${name}\b|(?:\?\.)?\[\s*["']${name}["']\s*\])`
		if (new RegExp(env + access).test(bundle)) {
			throw new Error(`Unresolved activation env name: ${name}`)
		}
	}
	// Generic "otlp" matches logs/metrics too and says nothing about traces.
	if (!/(?:\btracesExporter|["']tracesExporter["'])\s*:\s*["']otlp["']/.test(bundle)) {
		throw new Error("Missing trace-specific build config: tracesExporter: otlp")
	}
	if (!/["']cline-provider-langfuse["']/.test(bundle)) {
		throw new Error("Missing relay instrumentation scope: cline-provider-langfuse")
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const files = process.argv.slice(2)
	if (files.length === 0) throw new Error("Usage: check-trace-artifact.mjs <bundle-or-binary>... (or - for stdin)")
	for (const file of files) {
		assertTraceArtifact(readFileSync(file === "-" ? 0 : file, "utf8"))
		console.log(`Trace packaging smoke passed: ${file} (static evidence only)`)
	}
}
