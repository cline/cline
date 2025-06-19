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

Here’s how to add a new RPC, using `accountEmailIdentified` as an example.

### 1. Define the RPC in a `.proto` File

Add your service method to the appropriate file in the `proto/` directory.

**File: `proto/account.proto`**
```proto
service AccountService {
  // ... other RPCs
  // Identifies a user by their email for telemetry purposes.
  rpc accountEmailIdentified(StringRequest) returns (Empty);
}
```
Here, we use the common `StringRequest` and `Empty` types.

### 2. Compile Definitions

After editing a `.proto` file, regenerate the TypeScript code. From the project root, run:
```bash
npm run protos
```
This command compiles all `.proto` files and outputs the generated code to `src/generated/` and `src/shared/`. Do not edit these generated files manually.

### 3. Implement the Backend Handler

Create the RPC implementation in the backend. Handlers are located in `src/core/controller/[service-name]/`.

**File: `src/core/controller/account/accountEmailIdentified.ts`**
```typescript
import { Controller } from "../index"
import { Empty, StringRequest } from "../../../shared/proto/common"

export async function accountEmailIdentified(controller: Controller, request: StringRequest): Promise<Empty> {
  const email = request.value;
  console.log(`Identifying user with email: ${email}`);
  // controller.telemetry.identify(email);
  return Empty.create({});
}
```

### 4. Call the RPC from the Webview

Call the new RPC from a React component in `webview-ui/`. The generated client makes this simple.

**File: `webview-ui/src/components/SomeComponent.tsx`** (Example)
```tsx
import { accountServiceClient } from '../../services/grpc';
import { StringRequest } from '../../../../src/shared/proto/common';

const handleIdentifyClick = async () => {
  try {
    const request = StringRequest.create({ value: "test@example.com" });
    await accountServiceClient.accountEmailIdentified(request, {});
    console.log('Successfully identified email.');
  } catch (error) {
    console.error('Failed to identify email:', error);
  }
};
