# Cline Protobuf Development Guide

This guide outlines how to add new gRPC endpoints for communication between the webview (frontend) and the extension host (backend).

## Overview

Cline uses [Protobuf](https://protobuf.dev/) to define a strongly-typed API, ensuring efficient and type-safe communication. All definitions are in the `/proto` directory. The compiler and plugins are included as project dependencies, so no manual installation is needed.

## Key Concepts & Best Practices

-   **File Structure**: Each feature domain should have its own `.proto` file (e.g., `account.proto`, `task.proto`).
-   **Message Design**:
    -   For simple, single-value data, use the shared types in `proto/common.proto` (e.g., `StringRequest`, `Empty`, `Int64Request`). This promotes consistency.
    -   For complex data structures, define custom messages within the feature's `.proto` file (see `task.proto` for examples like `NewTaskRequest`).
-   **Naming Conventions**:
    -   Services: `PascalCaseService` (e.g., `AccountService`).
    -   RPCs: `camelCase` (e.g., `accountEmailIdentified`).
    -   Messages: `PascalCase` (e.g., `StringRequest`).
-   **Streaming**: For server-to-client streaming, use the `stream` keyword on the response type. See `subscribeToAuthCallback` in `account.proto` for an example.

---

## 4-Step Development Workflow

Here’s how to add a new RPC, using `scrollToSettings` as an example.

### 1. Define the RPC in a `.proto` File

Add your service method to the appropriate file in the `proto/` directory.

**File: `proto/ui.proto`**
```proto
service UiService {
  // ... other RPCs
  // Scrolls to a specific settings section in the settings view
  rpc scrollToSettings(StringRequest) returns (KeyValuePair);
}
```
Here, we use the common `StringRequest` and `KeyValuePair` types.

### 2. Compile Definitions

After editing a `.proto` file, regenerate the TypeScript code. From the project root, run:
```bash
npm run protos
```
This command compiles all `.proto` files and outputs the generated code to `src/generated/` and `src/shared/`. Do not edit these generated files manually.

### 3. Implement the Backend Handler

Create the RPC implementation in the backend. Handlers are located in `src/core/controller/[service-name]/`.

**File: `src/core/controller/ui/scrollToSettings.ts`**
```typescript
import { Controller } from ".."
import { StringRequest, KeyValuePair } from "../../../shared/proto/common"

/**
 * Executes a scroll to settings action
 * @param controller The controller instance
 * @param request The request containing the ID of the settings section to scroll to
 * @returns KeyValuePair with action and value fields for the UI to process
 */
export async function scrollToSettings(controller: Controller, request: StringRequest): Promise<KeyValuePair> {
	return KeyValuePair.create({
		key: "scrollToSettings",
		value: request.value || "",
	})
}
```

### 4. Call the RPC from the Webview

Call the new RPC from a React component in `webview-ui/`. The generated client makes this simple.

**File: `webview-ui/src/components/browser/BrowserSettingsMenu.tsx`** (Example)
```tsx
import { UiServiceClient } from "../../../services/grpc"
import { StringRequest } from "../../../../shared/proto/common"

// ... inside a React component
const handleMenuClick = async () => {
    try {
        await UiServiceClient.scrollToSettings(StringRequest.create({ value: "browser" }))
    } catch (error) {
        console.error("Error scrolling to browser settings:", error)
    }
}
```
