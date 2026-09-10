# AI trace relay: disable, replace, and roll back

Scope: the client pipeline in cline/cline#13974 and publish activation in
cline/cline#13982. The activation PR enables a build-configured exporter; it
does not turn remote configuration into a universal client kill switch.

## Choose the control by what must stop

| Control | Effect | Limit |
| --- | --- | --- |
| Collector Langfuse sampler at 0%, or remove Langfuse exporter from its pipeline | Stops new forwarding to Langfuse after the collector change takes effect | Clients still send to the collector; other pipelines, existing data, and queued/in-flight exports are not necessarily affected |
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
2. Set `probabilistic_sampler/langfuse` sampling to 0%, or remove
   `otlphttp/langfuse` from the `traces/langfuse` pipeline. Preserve unrelated
   pipelines unless the incident requires stopping their delivery too.
3. Apply through the normal infra review/deployment process. Confirm rollout
   completion and inspect collector queues, retries, and exporter failures.
4. Verify new Langfuse arrivals stop after accounting for buffers/in-flight
   exports. Verify collector ingress separately: continued ingress is expected.
5. Restore the approved sampling/exporter configuration only after the incident
   owner authorizes it. This runbook does not authorize production changes.

## Remote-config-owned extension tracing

The shared remote-config schema is also consumed by the API server. Coordinate
the server deployment for `openTelemetryTracesExporter` before using the field;
older schema parsers may discard it. Deploy the client fix before relying on
remote disable/replacement. Remote fetch/apply timing is not an instant guarantee.

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