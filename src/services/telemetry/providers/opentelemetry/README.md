# OpenTelemetry Telemetry Provider

This directory contains the OpenTelemetry implementation for Cline's telemetry system. It supports both metrics and logs/events collection with multiple export options.

## Configuration

OpenTelemetry is configured via standard environment variables. Set these in your `.env` file or launch configuration.

### Basic Setup

Enable telemetry:
```bash
export OTEL_TELEMETRY_ENABLED=1
```

### Metrics Exporters

#### Console (for debugging)
Export metrics to console with 1-second intervals:
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=console
export OTEL_METRIC_EXPORT_INTERVAL=1000
```

#### OTLP with gRPC
Export to an OTLP-compatible backend (e.g., Grafana, Jaeger, OpenTelemetry Collector):
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

#### OTLP with HTTP/JSON
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

#### OTLP with HTTP/Protobuf
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

#### Prometheus
Expose metrics on a Prometheus scrape endpoint:
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=prometheus
```

#### Multiple Exporters
Export to multiple backends simultaneously:
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=console,otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### Logs/Events Exporters

#### Console
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_LOGS_EXPORTER=console
```

#### OTLP
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

### Advanced Configuration

#### Separate Endpoints for Metrics and Logs
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://metrics.example.com:4318
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://logs.example.com:4317
```

#### Metrics Only (No Events/Logs)
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

#### Events/Logs Only (No Metrics)
```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

## Environment Variables Reference

| Variable | Description | Values |
|----------|-------------|--------|
| `OTEL_TELEMETRY_ENABLED` | Enable/disable telemetry | `1` (enabled), `0` or unset (disabled) |
| `OTEL_METRICS_EXPORTER` | Metrics exporter type(s) | `console`, `otlp`, `prometheus` (comma-separated) |
| `OTEL_LOGS_EXPORTER` | Logs exporter type(s) | `console`, `otlp` (comma-separated) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Default OTLP protocol | `grpc`, `http/json`, `http/protobuf` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Default OTLP endpoint | URL (e.g., `http://localhost:4317`) |
| `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | Metrics-specific protocol | `grpc`, `http/json`, `http/protobuf` |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Metrics-specific endpoint | URL |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | Logs-specific protocol | `grpc`, `http/json`, `http/protobuf` |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Logs-specific endpoint | URL |
| `OTEL_METRIC_EXPORT_INTERVAL` | Metric export interval | Milliseconds (e.g., `1000` for 1 second) |

## VSCode Launch Configuration

Add to your `.vscode/launch.json`:

```json
{
  "type": "extensionHost",
  "request": "launch",
  "name": "Launch Extension with OpenTelemetry",
  "runtimeExecutable": "${execPath}",
  "args": [
    "--extensionDevelopmentPath=${workspaceFolder}"
  ],
  "env": {
    "OTEL_TELEMETRY_ENABLED": "1",
    "OTEL_METRICS_EXPORTER": "console",
    "OTEL_LOGS_EXPORTER": "console",
    "OTEL_METRIC_EXPORT_INTERVAL": "1000"
  }
}
```

## Using with OpenTelemetry Collector

1. Install and run the [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)

2. Configure the collector to receive OTLP data and export to your backend:

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  logging:
    loglevel: debug
  # Add your backend exporters here (Prometheus, Jaeger, etc.)

service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [logging]
    logs:
      receivers: [otlp]
      exporters: [logging]
```

3. Set Cline to export to the collector:

```bash
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

## Dual Provider Setup

OpenTelemetry can run alongside PostHog. Both providers will be active if configured:

```bash
# PostHog configuration
export TELEMETRY_SERVICE_API_KEY=your_posthog_key

# OpenTelemetry configuration
export OTEL_TELEMETRY_ENABLED=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

## What Gets Tracked

### Metrics
- Event counters with attributes:
  - `event_name`: The telemetry event name
  - `distinct_id`: User's distinct ID
  - All event properties (flattened)
  - User attributes (if identified)

### Logs
- Event logs with structured attributes
- User identification events
- All properties are flattened into dot-notation for compatibility

## Architecture

- **OpenTelemetryClientProvider**: Singleton managing MeterProvider and LoggerProvider
- **OpenTelemetryTelemetryProvider**: Implements ITelemetryProvider interface
- **otel-config.ts**: Configuration management from environment variables

## Troubleshooting

### No telemetry data appearing

1. Verify at least one exporter is configured
2. Check console for error messages
3. Ensure your OTLP endpoint is reachable

### Type errors with PrometheusExporter

This is expected due to version differences between OpenTelemetry packages. The code uses type assertions to work around this.

### Console exporter not showing data

Make sure `OTEL_METRIC_EXPORT_INTERVAL` is set to a low value (e.g., 1000ms) for debugging.
