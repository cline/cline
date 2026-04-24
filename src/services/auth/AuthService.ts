// Replaces classic src/services/auth/AuthService.ts (see origin/main)
//
// The AuthService class is now provided by the SDK adapter layer.
// All modules that import AuthService from this path continue to work
// because the SDK AuthService exposes the same interface.

export { AuthService, type ClineAccountOrganization, type ClineAccountUserInfo, type ClineAuthInfo } from "@/sdk/auth-service"

// ServiceConfig was defined in the classic AuthService but never imported
// by any other module. Re-export a compatible type for safety.
export type ServiceConfig = {
	URI?: string
	[key: string]: any
}
