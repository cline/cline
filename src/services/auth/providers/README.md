# Authentication Providers

This directory contains authentication provider implementations for Cline.

## Available Providers

### Firebase Auth Provider
- **File**: `FirebaseAuthProvider.ts`
- **Description**: Handles authentication using Firebase Auth with Google and GitHub OAuth providers
- **Configuration**: Requires Firebase project configuration (API key, project ID, etc.)

### WorkOS Auth Provider
- **File**: `WorkOSAuthProvider.ts`
- **Description**: Handles authentication using WorkOS AuthKit for enterprise SSO
- **Configuration**: Requires WorkOS API key and client ID

## Configuration

Authentication providers are configured in `src/config.ts`. Each environment (production, staging, local) can have different provider configurations.

### Environment Variables

For WorkOS provider, set the following environment variables:
- `WORKOS_API_KEY`: Your WorkOS API key
- `WORKOS_CLIENT_ID`: Your WorkOS client ID
- `CLINE_AUTH_PROVIDER`: Set to "workos" to use WorkOS as the default provider (optional, defaults to "firebase")

### Example Configuration

```typescript
// In config.ts
workos: {
    apiKey: process.env.WORKOS_API_KEY || "",
    clientId: process.env.WORKOS_CLIENT_ID || "",
}
```

## Usage

The authentication service automatically loads all configured providers. You can switch between providers using:

```typescript
const authService = AuthService.getInstance()

// Switch to WorkOS provider
authService.authProvider = "workos"

// Get available providers
const providers = authService.getAvailableProviders() // ["firebase", "workos"]

// Get current provider
const current = authService.getCurrentProvider() // "workos"
```

## Adding New Providers

To add a new authentication provider:

1. Create a new provider class that implements the same interface as existing providers:
   - `shouldRefreshIdToken(token: string): Promise<boolean>`
   - `retrieveClineAuthInfo(controller: Controller): Promise<ClineAuthInfo | null>`
   - `signIn(controller: Controller, token: string, provider: string): Promise<ClineAuthInfo | null>`

2. Add the provider to `availableAuthProviders` in `AuthService.ts`

3. Add configuration for the provider in `config.ts`

4. Add the provider to the `authProvidersConfigs` array in the AuthService constructor

## Authentication Flow

1. User initiates authentication via `createAuthRequest()`
2. System opens external browser with provider-specific auth URL
3. User completes authentication with the provider
4. Provider redirects back to Cline with authorization code/token
5. `handleAuthCallback()` processes the callback and exchanges code for tokens
6. User information is retrieved and stored
7. Authentication status is updated across the application

## Token Management

- **Access Tokens**: Short-lived tokens used for API requests
- **Refresh Tokens**: Long-lived tokens stored securely to refresh access tokens
- **Token Refresh**: Automatic refresh when tokens are about to expire (within 5 minutes)