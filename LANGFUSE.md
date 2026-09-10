# Langfuse and OpenTelemetry

## Goal

Cline emits AI SDK traces through its existing OpenTelemetry provider and OTLP
exporter. The OpenTelemetry backend stores the Langfuse credentials and
forwards selected traces to Langfuse. Direct `@cline/llms` consumers retain a
standalone Langfuse integration.

## Modes

`createConfiguredTelemetryHandle` supports three modes:

```ts
// Default for Cline: credentials live in the OTel backend.
createConfiguredTelemetryHandle({
  ...otelConfig,
  langfuse: { mode: "collector" },
});

// Optional direct application-to-Langfuse export.
createConfiguredTelemetryHandle({
  ...otelConfig,
  langfuse: { mode: "direct", publicKey, secretKey, baseUrl },
});

// No Langfuse instrumentation.
createConfiguredTelemetryHandle({ ...otelConfig, langfuse: false });
```

Collector mode is the default when `langfuse` is omitted. It registers the AI
SDK 7 Langfuse integration but does not install a local
`LangfuseSpanProcessor`. AI SDK spans flow through the normal Cline OTLP
exporter. When Cline telemetry is disabled, Langfuse instrumentation is also
disabled, including the standalone environment fallback.

Direct mode constructs a `LangfuseSpanProcessor` before the immutable OTel SDK
2.x tracer provider is created. The client provider owns its flush and
shutdown. Standalone `@cline/llms` uses an isolated provider only when it has
not been configured by a Cline host.

## Credential ownership

In collector mode, no Langfuse credentials are present in the Cline process,
session configuration, runtime context, RPC payloads, or model requests. The
OTel backend stores:

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`

It exports traces over OTLP/HTTP to
`<LANGFUSE_BASE_URL>/api/public/otel` using:

```yaml
headers:
  Authorization: "Basic ${env:LANGFUSE_BASIC_AUTH}"
  x-langfuse-ingestion-version: "4"
```

`LANGFUSE_BASIC_AUTH` is the Base64 encoding of
`<public-key>:<secret-key>`. It remains a secret even though it is encoded.

## Ownership rules

| Runtime | Provider owner | Langfuse export | Shutdown owner |
| --- | --- | --- | --- |
| Cline collector mode | Client/core | OTel backend | Client/core |
| Cline direct mode | Client/core | Injected Langfuse processor | Client/core |
| Standalone `@cline/llms` | `@cline/llms` | Isolated Langfuse provider | `@cline/llms` |
| Embedding application | Application | Application-composed processor | Application |

Only the provider owner may flush or shut it down. The LLM request path must
never inspect, mutate, replace, flush, or shut down an ambient global provider.

## Backend configuration

An OpenTelemetry Collector can fan traces out to the existing destination and
Langfuse:

```yaml
exporters:
  otlphttp/primary:
    endpoint: ${env:PRIMARY_OTEL_ENDPOINT}
  otlphttp/langfuse:
    endpoint: https://us.cloud.langfuse.com/api/public/otel
    headers:
      Authorization: "Basic ${env:LANGFUSE_BASIC_AUTH}"
      x-langfuse-ingestion-version: "4"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/primary, otlphttp/langfuse]
```

Use collector filters carefully. Langfuse needs the relevant root span to
reconstruct the trace, so filtering parent spans can orphan AI SDK model-call
spans.

## Content policy

Prompt, response, tool-input, and tool-output capture is separate from
transport configuration. Enabling collector or direct mode must not by itself
authorize content capture. Operational metadata such as model, usage, cost,
latency, finish reason, session, conversation, and run identifiers should be
handled independently from content-bearing fields.
