# Security Test Instructions

## Purpose
Validate that Unit 1 changes remain aligned with the enabled Security Baseline extension.

## Security Checks

### 1. Dependency and Supply-Chain Check
```bash
npm audit
```

- **Focus**:
  - note current dependency vulnerabilities
  - confirm any external CLI/runtime expansion work has not yet introduced new binary trust paths in Unit 1

### 2. Credential Boundary Check
- Review changed files:
  - `src/core/api/runtime/contracts.ts`
  - `src/core/api/runtime/registry.ts`
  - `src/core/api/runtime/legacy-provider-mapping.ts`
  - `src/shared/api.ts`
  - `src/shared/storage/provider-keys.ts`
- **Expected**:
  - no credentials are hardcoded
  - runtime contract layer does not take ownership of secret persistence

### 3. Fail-Closed Registration Check
- **Goal**: invalid runtime definitions should fail registration rather than degrade silently.
- **Method**:
  - review `RuntimeRegistry.register()`
  - confirm duplicate registrations and incomplete capability declarations throw errors

### 4. Misconfiguration Prevention Check
- **Goal**: future runtime IDs without legacy provider mappings should not resolve to arbitrary provider keys.
- **Method**:
  - review `getLegacyProviderForRuntimeId()`
  - review `getProviderModelIdKey()` fallback behavior
- **Expected**:
  - future runtimes without mappings fall back safely rather than to an unintended credential key

### 5. Logging / Data Exposure Review
- **Goal**: no new secret-bearing logs are introduced.
- **Method**:
  - inspect added runtime code for logging of paths, credentials, or raw secrets

## Security Outcome Recording
- Record:
  - audit status
  - any new vulnerabilities from `npm audit`
  - any secret-handling regressions
  - any fail-open behavior discovered during code review
