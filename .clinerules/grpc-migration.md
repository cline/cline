# Migrating VSCode Message Bus Messages to gRPC/Protobuf
This guide documents the step-by-step process for migrating a message type from the legacy VSCode message bus to the new gRPC/protobuf-based system. Follow these instructions to convert **one message type at a time**.
## Before Starting
Analyze the message you're migrating to understand:
- All parameters and their purposes in the current implementation
- Which webview components send this message
- The core functionality that needs to be preserved
**Reference previous migrations for concrete examples by viewing their diffs with the following git commands:**
- First migration: testBrowserConnection 
  `git show 2a80fedf7d4e1337d01076e14a9c2d2cd7d5def1 | cat`
- Second migration: checkpointDiff (2 commits)
  `git show 8978f49112bf0d1d85241d816ef8e4fc12ccd2f3 | cat`
  `git show dc64a08ba5ca924399743beea99ff9885eae4187 | cat`
- Migration for cancelTask:
  `git show 3817180bcf68a10fb4c0a5359eb922ca53b65e98 | cat`
- Migration for openFile:
  `git show cbb8217c4eeec71f390d6b32f04245e328627c9d | cat`
These commands will show you the exact code changes made in each migration. Use them as concrete examples for your own migration.
---
## Migration Steps
### 1. Define the gRPC Spec
- Determine if the message you are migrating belongs in an existing service (such as `browser.proto`) or if it requires a new service and proto file.
  - **If the message fits an existing service:** Add the rpc method and message types to the appropriate proto file (e.g., `proto/browser.proto`).
  - **If the message is unrelated to existing services:** Create a new proto file and define a new service.
- Define the service, rpc method, and message types for the message you are migrating.
- Map the current message parameters to appropriate protobuf field types:
  - For simple values (numbers, strings), use standard scalar types
  - For complex structures, define nested message types
  - Consider using optional fields for parameters that might be undefined
**Example (adding to an existing service in browser.proto):**
```proto
service BrowserService {
  rpc discoverBrowser(EmptyRequest) returns (BrowserDiscoveryResult);
}
```
**Example (creating a new service):**
```proto
service CheckpointsService {
  rpc checkpointDiff(Int64Request) returns (Empty);
}
```
### 2. Generate TypeScript Protobuf Types
Run the following command to generate/update TypeScript types:
```sh
npm run protos
```
This will update files in `src/shared/proto/`.
---
### 3. Implement the Handler
- Create a new file for the handler in a dedicated directory, e.g.:
  - `src/core/controller/checkpoints/checkpointDiff.ts`
- Implement the handler function, matching the gRPC method signature.
**Example:**
```ts
// src/core/controller/checkpoints/checkpointDiff.ts
import { Controller } from ".."
import { Empty, Int64Request } from "../../../shared/proto/common"
export async function checkpointDiff(controller: Controller, request: Int64Request): Promise<Empty> {
  if (request.value) {
    await controller.task?.presentMultifileDiff(request.value, false)
  }
  return Empty.create()
}
```
---
### 4. Register the Handler
- Add a `methods.ts` file in the service directory (if not present).
- Register the handler using the service registry.
**Example:**
```ts
// src/core/controller/checkpoints/methods.ts
import { registerMethod } from "./index"
import { checkpointDiff } from "./checkpointDiff"
export function registerAllMethods(): void {
  registerMethod("checkpointDiff", checkpointDiff)
}
```
- Ensure the service's `index.ts` calls `registerAllMethods()`.
---
### 5. Integrate with the gRPC Handler
- In `src/core/controller/grpc-handler.ts`, add a case for your new service in the main switch statement.
**Example:**
```ts
import { handleCheckpointsDiffServiceRequest } from "./checkpoints"
switch (service) {
  case "cline.CheckpointsService":
    return {
      message: await handleCheckpointsDiffServiceRequest(this.controller, method, message),
      request_id: requestId
    }
  // ...
}
```
---
### 6. Update the Webview to Use gRPC
- In the webview, replace any usage of `vscode.postMessage({ type: ... })` for this message with the appropriate gRPC client call.
- Import the generated client from `webview-ui/src/services/grpc-client.ts`.
- Map existing message parameters to the corresponding gRPC request fields.
- Add error handling for the gRPC calls.
**Example:**
```ts
import { CheckpointsServiceClient } from "@/services/grpc-client"
// Old:
vscode.postMessage({ type: "checkpointDiff", number: messageTs })
// New:
try {
  await CheckpointsServiceClient.checkpointDiff({ value: messageTs })
} catch (err) {
  console.error("CheckpointDiff error:", err)
}
```
---
### 7. Remove Legacy Message Passing
- Remove the old message handling case from `src/core/controller/index.ts` (the switch/case for the message type).
- Remove the message type from `src/shared/WebviewMessage.ts` and any related types/interfaces.
---
### 8. Test the Migration
- Ensure the new gRPC-based message works end-to-end.
- Verify the webview UI, controller, and service handler all function as expected.
- Test with both valid and invalid inputs to ensure error handling works correctly.
- Consider adding temporary logging to trace request flow during testing.
---
## Additional Notes
- If your service is new, add its directory to the `serviceDirs` array in `proto/build-proto.js` to ensure method registration is generated.
- Keep handler files focused: one file per method.
- Use the previous migrations as reference for code style and structure.
- For complex messages with multiple components, consider a phased approach:
  - Implement the gRPC handler without removing the legacy handler
  - Migrate one webview component at a time and test thoroughly
  - Only remove the legacy code after verifying all components work correctly
---
## Example PRs
- [testBrowserConnection migration](https://github.com/cline-ai/cline/commit/2a80fedf7d4e1337d01076e14a9c2d2cd7d5def1)
- [checkpointDiff migration](https://github.com/cline-ai/cline/commit/8978f49112bf0d1d85241d816ef8e4fc12ccd2f3)
---
**Follow this checklist for each message type you migrate.** This ensures a clean, modular, and maintainable transition to gRPC/protobuf messaging.