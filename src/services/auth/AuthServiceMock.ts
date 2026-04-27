// Replaces classic src/services/auth/AuthServiceMock.ts (see origin/main)
//
// The classic AuthServiceMock extended the classic AuthService and was used
// for E2E testing (process.env.E2E_TEST). With the SDK migration, the
// AuthService class is now provided by the SDK adapter layer and the mock
// is no longer referenced. This file is kept as a stub for compatibility.
//
// If E2E test mocking is needed, implement it against the SDK AuthService
// in src/sdk/auth-service.ts instead.

export {}
