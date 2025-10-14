# OpenTelemetry Settings Integration - Implementation Plan

## Overview

This document outlines the plan to integrate OpenTelemetry configuration into Cline's settings and remote configuration system. The implementation enables OpenTelemetry to be configured via remote config (for enterprise deployments) while maintaining backward compatibility with environment variables.

## Architecture Principles

### Configuration Precedence (lowest to highest priority)
1. **Build-time env vars** - Baked into extension via esbuild during CI/CD
2. **Startup env vars** - Set when VSCode launches
3. **Settings in GlobalState** - User-configured or from previous remote config
4. **Remote config** - When organization is active and values are non-empty

### Design Principles
1. **Self-contained validation** - Each provider manages its own config comparison
2. **Generic interface** - TelemetryService doesn't know about specific provider types
3. **Separation of concerns** - Fetching, applying, and reinitialization are separate
4. **Minimal coupling** - Remote config system just applies settings

## Implementation: 6 PRs

All branches should follow the naming convention: `nighttrek/<branchName>`

---

## PR #1: Add Generic Provider Reinitialization Interface

**Branch**: `nighttrek/telemetry-reinit-interface`

**Goal**: Establish the reinitialization pattern without any OpenTelemetry-specific changes

### Changes

#### 1. Update `ITelemetryProvider` interface
Add new method to the interface:
```typescript
/**
 * Reinitialize the provider if configuration has changed.
 * Provider internally compares current config with new config
 * and only reinitializes if necessary.
 * 
 * @returns Promise<boolean> - true if reinitialized, false if no change needed
 */
reinitializeIfNeeded(): Promise<boolean>
```

#### 2. Implement in `NoOpTelemetryProvider`
```typescript
public async reinitializeIfNeeded(): Promise<boolean> {
  Logger.info("[NoOpTelemetryProvider] reinitializeIfNeeded called (no-op)")
  return false
}
```

#### 3. Implement in `PostHogTelemetryProvider`
Add config tracking and comparison:
```typescript
private currentConfig: any = null

public async reinitializeIfNeeded(): Promise<boolean> {
  // Get new config from posthog-config
  const newConfig = posthogConfig
  
  // Compare with current config
  if (JSON.stringify(this.currentConfig) === JSON.stringify(newConfig)) {
    return false
  }
  
  // Update current config
  this.currentConfig = { ...newConfig }
  
  // For now, just log - actual reinitialization can be added later
  console.log("[PostHogTelemetryProvider] Config changed, would reinitialize")
  return false
}
```

#### 4. Add `TelemetryService.reinitializeAllProviders()`
```typescript
/**
 * Reinitialize all telemetry providers if their configuration has changed.
 * Each provider decides internally whether reinitialization is needed.
 * 
 * @returns Promise<void>
 */
public async reinitializeAllProviders(): Promise<void> {
  console.log("[TelemetryService] Checking all providers for reinitialization...")
  
  const results = await Promise.all(
    this.providers.map(async (provider) => {
      try {
        return await provider.reinitializeIfNeeded()
      } catch (error) {
        console.error("[TelemetryService] Error reinitializing provider:", error)
        return false
      }
    })
  )
  
  const reinitializedCount = results.filter(r => r).length
  console.log(`[TelemetryService] Reinitialized ${reinitializedCount} of ${this.providers.length} provider(s)`)
}
```

### Files Modified
- `src/services/telemetry/providers/ITelemetryProvider.ts`
- `src/services/telemetry/TelemetryProviderFactory.ts`
- `src/services/telemetry/providers/posthog/PostHogTelemetryProvider.ts`
- `src/services/telemetry/TelemetryService.ts`

### Testing
- Unit tests for `reinitializeIfNeeded()` in each provider
- Unit tests for `TelemetryService.reinitializeAllProviders()`
- Verify no-op behavior when config hasn't changed

---

## PR #2: Add OpenTelemetry Settings to State Schema

**Branch**: `nighttrek/otel-settings-schema`

**Goal**: Add all OpenTelemetry configuration fields to the settings system

### Changes

#### 1. Update `state-keys.ts` - Add to `Settings` interface
```typescript
// OpenTelemetry configuration settings
otelTelemetryEnabled: boolean | undefined
otelMetricsExporter: string | undefined
otelLogsExporter: string | undefined
otelExporterOtlpProtocol: string | undefined
otelExporterOtlpEndpoint: string | undefined
otelExporterOtlpMetricsProtocol: string | undefined
otelExporterOtlpMetricsEndpoint: string | undefined
otelExporterOtlpLogsProtocol: string | undefined
otelExporterOtlpLogsEndpoint: string | undefined
otelMetricExportInterval: number | undefined
otelExporterOtlpInsecure: boolean | undefined
otelLogBatchSize: number | undefined
otelLogBatchTimeout: number | undefined
otelLogMaxQueueSize: number | undefined
otelExporterOtlpHeaders: string | undefined
```

#### 2. Update `ApiConfiguration` type in `api.ts`
Add the same 15 fields to the ApiConfiguration interface

#### 3. Update `StateManager.getApiConfiguration()`
Add OpenTelemetry fields to the returned configuration:
```typescript
// OpenTelemetry settings
otelTelemetryEnabled: this.getGlobalSettingsKey('otelTelemetryEnabled'),
otelMetricsExporter: this.getGlobalSettingsKey('otelMetricsExporter'),
// ... all 15 fields
```

#### 4. Update `StateManager.setApiConfiguration()`
Extract and set OpenTelemetry fields:
```typescript
const {
  // ... existing fields ...
  otelTelemetryEnabled,
  otelMetricsExporter,
  // ... all 15 fields
} = apiConfiguration

this.setGlobalStateBatch({
  // ... existing fields ...
  otelTelemetryEnabled,
  otelMetricsExporter,
  // ... all 15 fields
})
```

### Files Modified
- `src/shared/storage/state-keys.ts`
- `src/shared/api.ts`
- `src/core/storage/StateManager.ts`

### Testing
- Unit tests for StateManager get/set with OpenTelemetry fields
- Verify fields persist correctly to globalState
- Test batch operations with OpenTelemetry fields

---

## PR #3: Refactor OpenTelemetry Config Resolution

**Branch**: `nighttrek/otel-config-resolution`

**Goal**: Change from static `process.env` reading to layered config resolution

### Changes

#### 1. Refactor `otel-config.ts`

Add cache clearing function:
```typescript
/**
 * Clear the cached OpenTelemetry configuration.
 * Should be called when settings change to force re-evaluation.
 */
export function clearOtelConfigCache(): void {
  otelConfig = null
}
```

Update `getOtelConfig()` to accept StateManager:
```typescript
function getOtelConfig(stateManager?: StateManager): OpenTelemetryClientConfig {
  if (!otelConfig) {
    // Layer 1: Build-time defaults (from process.env at build time)
    const buildTimeConfig = getBuildTimeConfig()
    
    // Layer 2: Startup env vars (from process.env at runtime)
    const startupConfig = getStartupEnvConfig()
    
    // Layer 3: Settings from StateManager (if provided)
    const settingsConfig = stateManager ? getSettingsConfig(stateManager) : {}
    
    // Merge with precedence: build < startup < settings
    otelConfig = {
      ...buildTimeConfig,
      ...startupConfig,
      ...settingsConfig,
    }
  }
  return otelConfig
}
```

Add helper functions:
```typescript
/**
 * Get build-time configuration from process.env.
 * These are the values baked into the extension at build time.
 */
function getBuildTimeConfig(): OpenTelemetryClientConfig {
  return {
    enabled: process.env.OTEL_TELEMETRY_ENABLED === "1",
    metricsExporter: process.env.OTEL_METRICS_EXPORTER,
    logsExporter: process.env.OTEL_LOGS_EXPORTER,
    otlpProtocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpMetricsProtocol: process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL,
    otlpMetricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    otlpLogsProtocol: process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL,
    otlpLogsEndpoint: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    metricExportInterval: process.env.OTEL_METRIC_EXPORT_INTERVAL
      ? parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL, 10)
      : undefined,
    otlpInsecure: process.env.OTEL_EXPORTER_OTLP_INSECURE === "true",
    logBatchSize: process.env.OTEL_LOG_BATCH_SIZE
      ? Math.max(1, parseInt(process.env.OTEL_LOG_BATCH_SIZE, 10))
      : undefined,
    logBatchTimeout: process.env.OTEL_LOG_BATCH_TIMEOUT
      ? Math.max(1, parseInt(process.env.OTEL_LOG_BATCH_TIMEOUT, 10))
      : undefined,
    logMaxQueueSize: process.env.OTEL_LOG_MAX_QUEUE_SIZE
      ? Math.max(1, parseInt(process.env.OTEL_LOG_MAX_QUEUE_SIZE, 10))
      : undefined,
  }
}

/**
 * Get startup environment variable configuration.
 * These override build-time values if set at VSCode launch.
 */
function getStartupEnvConfig(): Partial<OpenTelemetryClientConfig> {
  const config: Partial<OpenTelemetryClientConfig> = {}
  
  // Only include values that are actually set at startup
  if (process.env.OTEL_TELEMETRY_ENABLED !== undefined) {
    config.enabled = process.env.OTEL_TELEMETRY_ENABLED === "1"
  }
  if (process.env.OTEL_METRICS_EXPORTER !== undefined) {
    config.metricsExporter = process.env.OTEL_METRICS_EXPORTER
  }
  // ... check all other env vars
  
  return config
}

/**
 * Get configuration from StateManager settings.
 * These override both build-time and startup env vars.
 */
function getSettingsConfig(stateManager: StateManager): Partial<OpenTelemetryClientConfig> {
  const config: Partial<OpenTelemetryClientConfig> = {}
  
  const enabled = stateManager.getGlobalSettingsKey('otelTelemetryEnabled')
  if (enabled !== undefined) {
    config.enabled = enabled
  }
  
  const metricsExporter = stateManager.getGlobalSettingsKey('otelMetricsExporter')
  if (metricsExporter !== undefined) {
    config.metricsExporter = metricsExporter
  }
  
  // ... map all 15 fields
  
  return config
}
```

#### 2. Update `getValidOpenTelemetryConfig()`
```typescript
export function getValidOpenTelemetryConfig(stateManager?: StateManager): OpenTelemetryClientValidConfig | null {
  const config = getOtelConfig(stateManager)
  return isOpenTelemetryConfigValid(config) ? config : null
}
```

#### 3. Update `OpenTelemetryClientProvider` constructor
Pass StateManager to config resolution:
```typescript
private constructor() {
  this.config = getValidOpenTelemetryConfig(StateManager.get())
  // ... rest of initialization
}
```

### Files Modified
- `src/shared/services/config/otel-config.ts`
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryClientProvider.ts`

### Testing
- Unit tests for three-layer config resolution
- Test precedence: build-time < startup < settings
- Test that undefined values don't override lower layers
- Test cache clearing

---

## PR #4: Implement OpenTelemetry Provider Reinitialization

**Branch**: `nighttrek/otel-provider-reinit`

**Goal**: Enable OpenTelemetry to reinitialize when settings change

### Changes

#### 1. Add config tracking to `OpenTelemetryClientProvider`
```typescript
export class OpenTelemetryClientProvider {
  private static currentConfig: OpenTelemetryClientValidConfig | null = null
  
  /**
   * Check if OpenTelemetry configuration has changed.
   * Compares current config with new config from StateManager.
   */
  public static hasConfigChanged(): boolean {
    const newConfig = getValidOpenTelemetryConfig(StateManager.get())
    const changed = JSON.stringify(OpenTelemetryClientProvider.currentConfig) !== JSON.stringify(newConfig)
    
    if (changed) {
      console.log("[OTEL] Configuration has changed")
    }
    
    return changed
  }
  
  private constructor() {
    this.config = getValidOpenTelemetryConfig(StateManager.get())
    
    // Store current config for comparison
    OpenTelemetryClientProvider.currentConfig = this.config
    
    // ... rest of initialization
  }
}
```

#### 2. Add `reinitialize()` method to `OpenTelemetryClientProvider`
```typescript
/**
 * Reinitialize the OpenTelemetry client providers.
 * Disposes existing providers and creates new ones with updated config.
 */
public static async reinitialize(): Promise<void> {
  console.log("[OTEL] Reinitializing OpenTelemetry providers...")
  
  const instance = OpenTelemetryClientProvider.getInstance()
  
  // Dispose existing providers
  await instance.dispose()
  
  // Clear singleton instance
  OpenTelemetryClientProvider._instance = null
  OpenTelemetryClientProvider.currentConfig = null
  
  // Clear config cache to force re-evaluation
  clearOtelConfigCache()
  
  console.log("[OTEL] OpenTelemetry providers reinitialized")
}
```

#### 3. Implement `reinitializeIfNeeded()` in `OpenTelemetryTelemetryProvider`
```typescript
/**
 * Reinitialize the OpenTelemetry provider if configuration has changed.
 * Checks if config changed and reinitializes the underlying client if needed.
 */
public async reinitializeIfNeeded(): Promise<boolean> {
  // Check if config has changed
  if (!OpenTelemetryClientProvider.hasConfigChanged()) {
    return false
  }
  
  console.log("[OpenTelemetryTelemetryProvider] Config changed, reinitializing...")
  
  // Reinitialize the client provider
  await OpenTelemetryClientProvider.reinitialize()
  
  // Get new provider instances
  const meterProvider = OpenTelemetryClientProvider.getMeterProvider()
  const loggerProvider = OpenTelemetryClientProvider.getLoggerProvider()
  
  // Update this provider's references
  if (meterProvider) {
    this.meter = meterProvider.getMeter('cline')
    console.log("[OpenTelemetryTelemetryProvider] Meter provider updated")
  } else {
    this.meter = null
  }
  
  if (loggerProvider) {
    this.logger = loggerProvider.getLogger('cline')
    console.log("[OpenTelemetryTelemetryProvider] Logger provider updated")
  } else {
    this.logger = null
  }
  
  return true
}
```

### Files Modified
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryClientProvider.ts`
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts`
- `src/shared/services/config/otel-config.ts` (export clearOtelConfigCache)

### Testing
- Unit tests for config change detection
- Integration tests for reinitialization flow
- Verify providers are properly disposed and recreated
- Test that no reinitialization occurs when config unchanged

---

## PR #5: Add OpenTelemetry to Remote Config Schema

**Branch**: `nighttrek/otel-remote-config-schema`

**Goal**: Enable OpenTelemetry settings to be configured via remote config

### Changes

#### 1. Add `OpenTelemetrySettingsSchema` to `remote-config/schema.ts`
```typescript
// OpenTelemetry settings schema
export const OpenTelemetrySettingsSchema = z.object({
  otelTelemetryEnabled: z.boolean().optional(),
  otelMetricsExporter: z.string().optional(),
  otelLogsExporter: z.string().optional(),
  otelExporterOtlpProtocol: z.string().optional(),
  otelExporterOtlpEndpoint: z.string().optional(),
  otelExporterOtlpMetricsProtocol: z.string().optional(),
  otelExporterOtlpMetricsEndpoint: z.string().optional(),
  otelExporterOtlpLogsProtocol: z.string().optional(),
  otelExporterOtlpLogsEndpoint: z.string().optional(),
  otelMetricExportInterval: z.number().optional(),
  otelExporterOtlpInsecure: z.boolean().optional(),
  otelLogBatchSize: z.number().optional(),
  otelLogBatchTimeout: z.number().optional(),
  otelLogMaxQueueSize: z.number().optional(),
  otelExporterOtlpHeaders: z.string().optional(),
})

export type OpenTelemetrySettings = z.infer<typeof OpenTelemetrySettingsSchema>
```

#### 2. Add to `RemoteConfigSchema`
```typescript
export const RemoteConfigSchema = z.object({
  version: z.string(),
  telemetryEnabled: z.boolean().optional(),
  mcpMarketplaceEnabled: z.boolean().optional(),
  yoloModeAllowed: z.boolean().optional(),
  openTelemetrySettings: OpenTelemetrySettingsSchema.optional(), // NEW
  providerSettings: ProviderSettingsSchema.optional(),
})
```

#### 3. Update `transformRemoteConfigToStateShape()` in `remote-config/utils.ts`
```typescript
export function transformRemoteConfigToStateShape(remoteConfig: RemoteConfig): Partial<GlobalStateAndSettings> {
  const transformed: Partial<GlobalStateAndSettings> = {}
  
  // ... existing mappings ...
  
  // Map OpenTelemetry settings (only if defined)
  const otelSettings = remoteConfig.openTelemetrySettings
  if (otelSettings) {
    if (otelSettings.otelTelemetryEnabled !== undefined) {
      transformed.otelTelemetryEnabled = otelSettings.otelTelemetryEnabled
    }
    if (otelSettings.otelMetricsExporter !== undefined) {
      transformed.otelMetricsExporter = otelSettings.otelMetricsExporter
    }
    if (otelSettings.otelLogsExporter !== undefined) {
      transformed.otelLogsExporter = otelSettings.otelLogsExporter
    }
    if (otelSettings.otelExporterOtlpProtocol !== undefined) {
      transformed.otelExporterOtlpProtocol = otelSettings.otelExporterOtlpProtocol
    }
    if (otelSettings.otelExporterOtlpEndpoint !== undefined) {
      transformed.otelExporterOtlpEndpoint = otelSettings.otelExporterOtlpEndpoint
    }
    if (otelSettings.otelExporterOtlpMetricsProtocol !== undefined) {
      transformed.otelExporterOtlpMetricsProtocol = otelSettings.otelExporterOtlpMetricsProtocol
    }
    if (otelSettings.otelExporterOtlpMetricsEndpoint !== undefined) {
      transformed.otelExporterOtlpMetricsEndpoint = otelSettings.otelExporterOtlpMetricsEndpoint
    }
    if (otelSettings.otelExporterOtlpLogsProtocol !== undefined) {
      transformed.otelExporterOtlpLogsProtocol = otelSettings.otelExporterOtlpLogsProtocol
    }
    if (otelSettings.otelExporterOtlpLogsEndpoint !== undefined) {
      transformed.otelExporterOtlpLogsEndpoint = otelSettings.otelExporterOtlpLogsEndpoint
    }
    if (otelSettings.otelMetricExportInterval !== undefined) {
      transformed.otelMetricExportInterval = otelSettings.otelMetricExportInterval
    }
    if (otelSettings.otelExporterOtlpInsecure !== undefined) {
      transformed.otelExporterOtlpInsecure = otelSettings.otelExporterOtlpInsecure
    }
    if (otelSettings.otelLogBatchSize !== undefined) {
      transformed.otelLogBatchSize = otelSettings.otelLogBatchSize
    }
    if (otelSettings.otelLogBatchTimeout !== undefined) {
      transformed.otelLogBatchTimeout = otelSettings.otelLogBatchTimeout
    }
    if (otelSettings.otelLogMaxQueueSize !== undefined) {
      transformed.otelLogMaxQueueSize = otelSettings.otelLogMaxQueueSize
    }
    if (otelSettings.otelExporterOtlpHeaders !== undefined) {
      transformed.otelExporterOtlpHeaders = otelSettings.otelExporterOtlpHeaders
    }
  }
  
  return transformed
}
```

### Files Modified
- `src/shared/remote-config/schema.ts`
- `src/core/storage/remote-config/utils.ts`

### Testing
- Unit tests for schema validation
- Test that valid OpenTelemetry configs pass validation
- Test that invalid configs are rejected
- Test transformation to state shape
- Test that undefined values don't override

---

## PR #6: Wire Up Reinitialization Triggers

**Branch**: `nighttrek/otel-reinit-triggers`

**Goal**: Trigger telemetry reinitialization at appropriate lifecycle points

### Changes

#### 1. Update `applyRemoteConfig()` in `remote-config/utils.ts`
```typescript
export async function applyRemoteConfig(remoteConfig?: RemoteConfig): Promise<void> {
  const stateManager = StateManager.get()
  
  // If no remote config provided, clear the cache
  if (!remoteConfig) {
    stateManager.clearRemoteConfig()
    
    // Reinitialize telemetry to fall back to env vars
    const telemetryService = await getTelemetryService()
    await telemetryService.reinitializeAllProviders()
    return
  }
  
  // Transform remote config to state shape
  const transformed = transformRemoteConfigToStateShape(remoteConfig)
  
  // Clear existing remote config cache
  stateManager.clearRemoteConfig()
  
  // Populate remote config cache with transformed values
  for (const [key, value] of Object.entries(transformed)) {
    stateManager.setRemoteConfigField(key as keyof GlobalStateAndSettings, value)
  }
  
  // Reinitialize all telemetry providers with new config
  const telemetryService = await getTelemetryService()
  await telemetryService.reinitializeAllProviders()
}
```

#### 2. Update `setUserOrganization.ts`
Already calls `fetchRemoteConfig()` which will trigger reinitialization via `applyRemoteConfig()`

#### 3. Handle logout in `AuthService.ts`
```typescript
public async logout(reason: LogoutReason): Promise<void> {
  // ... existing logout logic ...
  
  // Clear remote config and reinitialize telemetry
  StateManager.get().clearRemoteConfig()
  const telemetryService = await getTelemetryService()
  await telemetryService.reinitializeAllProviders()
  
  // ... rest of logout
}
```

#### 4. Update `Controller` initialization
Ensure telemetry is initialized after remote config fetch:
```typescript
// In Controller constructor or init
await this.startRemoteConfigTimer()
```

### Files Modified
- `src/core/storage/remote-config/utils.ts`
- `src/services/auth/AuthService.ts`
- `src/core/controller/index.ts` (if needed)

### Testing
- Integration tests for organization switch
- Test logout resets to env vars
- Test initial load with remote config
- Test remote config updates trigger reinitialization
- Test that reinitialization only happens when config actually changes

---

## Testing Strategy

### Unit Tests
Each PR should include unit tests for:
- New methods and functions
- Config resolution logic
- Schema validation
- State transformations

### Integration Tests
- Full flow: remote config → settings → provider reinitialization
- Organization switching
- Logout behavior
- Config precedence validation

### Manual Testing
- Test with build-time env vars only
- Test with startup env vars overriding build-time
- Test with remote config overriding all
- Test organization switching
- Test logout
- Verify telemetry data flows correctly after reinitialization

---

## Rollout Plan

1. **PR #1**: Foundation - can be merged independently
2. **PR #2**: Schema changes - can be merged independently
3. **PR #3**: Config resolution - depends on PR #2
4. **PR #4**: Provider reinitialization - depends on PR #1 and PR #3
5. **PR #5**: Remote config schema - depends on PR #2
6. **PR #6**: Wire everything together - depends on all previous PRs

Each PR should be reviewed and merged before starting the next one to minimize conflicts and ensure incremental progress.

---

## Security Considerations

- `OTEL_EXPORTER_OTLP_HEADERS` may contain bearer tokens
- Stored in GlobalState (not encrypted)
- Transmitted via remote config API
- This is acceptable per requirements, but should be documented
- Future enhancement: Move to Secrets store if needed

---

## Future Enhancements

1. Hot-reloading without VSCode restart
2. UI for configuring OpenTelemetry settings
3. Move bearer tokens to Secrets store
4. Support for multiple OpenTelemetry providers
5. Enhanced validation and error messages
6. Telemetry dashboard integration
