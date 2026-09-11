# AI trace relay: disable, replace, and roll back

Scope: the client pipeline in cline/cline#13974 and publish activation in
cline/cline#13982. The activation PR enables a build-configured exporter; it
does not turn remote configuration into a universal client kill switch.

## Choose the control by what must stop

| Control | Effect | Limit |
| --- | --- | --- |
| Production Langfuse sampler at 0%, or disable the Langfuse pipeline | Stops new forwarding to Langfuse after the collector change takes effect | Staging has no sampler. Clients still send to the collector; other pipelines, existing data, and queued/in-flight exports are not necessarily affected |
| Remove `openTelemetryTracesExporter` or set `openTelemetryEnabled: false` in extension remote config | Shuts down the **remote-config-owned** tracer when that configuration is fetched and applied | Requires a client with the lifecycle fix and coordinated schema deployment; does not disable build/runtime-configured exporters, CLI/hub processes, or direct Langfuse export |
| Remove build-time `OTEL_TRACES_EXPORTER`, or set build-time `CLINE_TRACE_SAMPLE_PERCENT: "0"` | Disables the relay for updated packaged clients | Requires a new build/release and users installing it; existing sessions are not remotely changed |
| Change runtime environment for a process you operate | Changes tracing at its next startup | Requires restarting that process; compiled-in values may take precedence |

Collector controls are **no-client-release mitigation**, not instantaneous
client shutdown. Account for deployment/configuration propagation and buffered
spans. A Langfuse-only rollback does not stop ClickHouse or other collector
destinations, nor any credentialed direct-to-Langfuse exporter.

## Collector-side mitigation

1. In the infra repository, review the active environment's collector values
   (production: `argocd/prod/values/otel-collector.yaml`).
2. Production has a `probabilistic_sampler/langfuse`: set its sampling to 0%
   under the approved mitigation process. Staging's proposed pipeline has no
   sampler; disable/remove its Langfuse pipeline/export path instead. Do not
   leave a pipeline with an empty exporter list. Preserve unrelated pipelines
   unless the incident requires stopping their delivery too.
3. Apply through the normal infra review/deployment process. Confirm rollout
   completion and inspect collector queues, retries, and exporter failures.
4. Verify new Langfuse arrivals stop after accounting for buffers/in-flight
   exports. Verify collector ingress separately: continued ingress is expected.
5. Restore the approved sampling/exporter configuration only after the incident
   owner authorizes it. This runbook does not authorize production changes.

## Remote-config-owned extension tracing

The backend schema/delivery follow-up is deferred and **non-blocking for the
build-configured activation**. It is a prerequisite for using remote trace
configuration, not a substitute for collector-side mitigation. On September 11,
2026, core-platform main `04b71b97` lacked `openTelemetryTracesExporter` in its
embedded core-api JSON schema and rejected unknown fields (`additionalProperties:
false`). Deployed backend revisions were not verified. Coordinate server schema,
dashboard editing, delivery and deployment before using this field. Deploy and
validate the client lifecycle fix before relying on remote disable/replacement.
Remote fetch/apply timing is not an instant guarantee.

1. Ensure no build/runtime/third-party tracer already owns the global slot.
   A rejected registration logs `Global tracer already owned`; the remote client
   discards its unused exporter instead of displacing the other owner.
2. Enable with `openTelemetryEnabled: true`,
   `openTelemetryTracesExporter: "otlp"`, and the appropriate
   `openTelemetryOtlpEndpoint`/protocol/headers. Trace-only clients are retained
   even without logs or metrics.
3. To disable only remote tracing, omit `openTelemetryTracesExporter` from the
   next full remote configuration. To disable all remote OTEL signals, set
   `openTelemetryEnabled: false`. Preserve other policy fields as appropriate.
4. Wait for fetch/apply. Removal detaches the event wrapper and awaits its owned
   client's shutdown. The client clears its relay marker and releases the global
   tracer slot **only if it still owns it**. Shutdown can flush queued spans;
   disable is not deletion of previously collected data.
5. Re-enable or change endpoint by publishing a subsequent full configuration.
   The previous client is disposed before the replacement is constructed.
   New tracer lookups use the new provider; previously cached tracers are not
   rebound and must be reacquired to resume export.

## Validation before relying on the control

- Exercise enable → disable → re-enable and endpoint A → endpoint B in a
  non-production client; observe fresh requests at the intended destination.
- Check that spans after completed shutdown do not reach the old exporter.
- Confirm parent/child context survives replacement and trace-only clients shut
  down on remote clear/sign-out.
- Test with an existing build/runtime tracer: remote changes must leave it alone.
- Keep collector-side mitigation available for older clients and build-enabled
  releases. Remote configuration is not a substitute for that control.

## AI SDK v7 integration and collector contract

Each enabled SDK stream supplies its selected Langfuse integration through
`telemetry.integrations`. Setting `isEnabled` without an integration does not
produce AI SDK v7 spans. Relay integrations acquire the current host tracer per
call, so replacing the remote-config provider also redirects subsequent streams.

The integration emits the v7 semantic attributes, including
`gen_ai.provider.name` and `gen_ai.request.model`, under the instrumentation scope
`cline-provider-langfuse`. It does not emit the old `ai.model.provider` attribute.
Before activation, update and validate the collector filter in cline/infra#547
against these actual spans. A filter requiring `ai.model.provider` drops them all.
Preserve child step/tool spans too: they share the dedicated instrumentation
scope but may not carry the model-provider attribute. Do not enable the publish
rollout until a real streamed response reaches the intended collector destination.

Direct `LANGFUSE_*` credentials remain supported for `cline` and `cline-pass`
when no host relay is registered. That path uses an isolated tracer provider and
per-call integration; it neither registers a global AI SDK integration nor alters
or shuts down another owner's tracer. When a relay is registered it takes
precedence, including after an earlier direct request. Relay opt-out, sampling
and content controls still apply, with no fallback to direct export when those
controls disable a request.

## Cross-repository fixture and staging acceptance

The real-stream integration test includes synthetic generation, step and tool
spans, asserts a single trace and intact parent IDs, and verifies the dedicated
scope on every span. Regenerate the infra OTLP JSON fixture from the SDK root:

```sh
CLINE_RELAY_FIXTURE_PATH=/tmp/cline-relay-fixture.json \
  bun -F @cline/llms test src/services/langfuse-telemetry.integration.test.ts
```

Copy the output to `cline/infra`'s `tests/fixtures/langfuse-relay-spans.json` and
refresh its provenance. The fixture preserves real span IDs, timestamps, names,
scope and string attributes; non-routing numeric/array attributes, events and
resource metadata are omitted. It contains synthetic data only. Frozen fixtures
do not detect future client changes: the client contract assertions and explicit
fixture refresh are both required when the integration changes.

Before activation, use the **existing** staging collector and synthetic data:
- Verify a packaged SDK extension/local task reaches Langfuse with its children.
- Run CLI normal mode and verify a second task actually executes in the hub
  daemon (not local fallback), using its resource identity and task/trace IDs.
- Verify unrelated scopes are excluded. HTTP acceptance alone is not evidence
  of destination ingestion. Record exact client artifact and collector revisions.
- Keep activation frozen until staging credentials, both host checks, and current
  stable/nightly/CLI artifact checks pass. No staging deployment is authorized by
  this runbook or by a passing local fixture test.
