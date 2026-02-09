---
name: proto-integration
description: Work with gRPC/Protobuf communication between extension and webview. Use when adding RPC methods, ClineAsk/ClineSay enums, API providers, proto messages, or fixing conversion mappings. Triggers on "proto", "gRPC", "ClineAsk", "ClineSay", "ApiProvider", "conversion", "serialization", "npm run protos".
---

# Proto/gRPC Integration

Cline uses a gRPC-like protocol over VS Code's postMessage for extension↔webview communication. Proto files define the schema; TypeScript is generated from them.

## Architecture

```
┌────────────────────────┐     postMessage      ┌────────────────────────┐
│   Extension Host       │◄────────────────────►│   Webview (React)      │
│                        │                       │                        │
│  src/generated/hosts/  │                       │  webview-ui/src/       │
│  └── vscode/           │                       │  └── services/         │
│      └── protobus-*    │                       │      └── grpc-client   │
└────────────────────────┘                       └────────────────────────┘
           ▲                                                ▲
           │ generated from                                 │ generated from
           │                                                │
     ┌─────┴──────────────────────────────────────────────┴─────┐
     │                     proto/cline/*.proto                   │
     │                                                           │
     │  task.proto    - Task operations                          │
     │  ui.proto      - UI messages (ClineAsk, ClineSay)        │
     │  models.proto  - Data models (ApiConfiguration, etc.)    │
     │  account.proto - Authentication                          │
     │  state.proto   - Generated from state-keys.ts            │
     │  common.proto  - Shared simple types                     │
     └───────────────────────────────────────────────────────────┘
```

## Proto File Locations

| File | Purpose | Auto-generated? |
|------|---------|-----------------|
| `proto/cline/task.proto` | Task RPCs and messages | No |
| `proto/cline/ui.proto` | UI enums (ClineAsk, ClineSay) | No |
| `proto/cline/models.proto` | Data models | No |
| `proto/cline/state.proto` | Settings/state schema | **Yes** (from state-keys.ts) |
| `proto/cline/common.proto` | Shared types (Empty, StringRequest) | No |

## Generated Output

After running `npm run protos`:

| Output Location | Purpose |
|-----------------|---------|
| `src/shared/proto/` | Shared type definitions |
| `src/generated/grpc-js/` | Service implementations |
| `src/generated/nice-grpc/` | Promise-based clients |
| `src/generated/hosts/` | Handler scaffolding |

## Adding a New RPC Method

### Step 1: Define in Proto

In `proto/cline/task.proto` (or appropriate domain file):

```protobuf
// Add message types
message MyRequest {
  string id = 1;
  repeated string items = 2;
}

message MyResponse {
  bool success = 1;
  string message = 2;
}

// Add to service
service TaskService {
  // Existing methods...

  rpc MyNewMethod(MyRequest) returns (MyResponse);
}
```

### Step 2: Regenerate

```bash
npm run protos
```

### Step 3: Implement Handler

In `src/core/controller/task/` (create new file or add to existing):

```typescript
// src/core/controller/task/myNewMethod.ts
import { MyRequest, MyResponse } from "@/generated/grpc-js/cline/task";
import { Controller } from "../index";

export async function myNewMethod(
  controller: Controller,
  request: MyRequest
): Promise<MyResponse> {
  // Implementation
  const result = await controller.doSomething(request.id, request.items);

  return MyResponse.create({
    success: true,
    message: "Done",
  });
}
```

### Step 4: Register Handler

The handler is automatically wired if you follow the naming convention. Check `src/generated/hosts/` for the expected function signature.

### Step 5: Call from Webview

```typescript
// webview-ui/src/components/MyComponent.tsx
import { TaskServiceClient } from "@/services/grpc-client";
import { MyRequest } from "@/shared/proto/cline/task";

async function handleClick() {
  const response = await TaskServiceClient.myNewMethod(
    MyRequest.create({
      id: "123",
      items: ["a", "b", "c"],
    })
  );
  console.log(response.message);
}
```

## Adding a New Enum Value

Example: Adding a new `ClineSay` type.

### Step 1: Update Proto

In `proto/cline/ui.proto`:

```protobuf
enum ClineSay {
  // Existing values...
  TEXT = 1;
  TOOL = 2;

  // Add new value with next available number
  MY_NEW_SAY = 30;
}
```

### Step 2: Update TypeScript Type

In `src/shared/ExtensionMessage.ts`:

```typescript
export type ClineSay =
  | "text"
  | "tool"
  | "my_new_say"  // Add here
  // ...
```

### Step 3: Update Conversion Mapping

In `src/shared/proto-conversions/cline-message.ts`:

```typescript
// convertClineSayToProto()
export function convertClineSayToProto(say: ClineSay): ClineSayProto {
  switch (say) {
    case "my_new_say":
      return ClineSayProto.MY_NEW_SAY;
    // ... existing cases
  }
}

// convertProtoToClineSay()
export function convertProtoToClineSay(proto: ClineSayProto): ClineSay {
  switch (proto) {
    case ClineSayProto.MY_NEW_SAY:
      return "my_new_say";
    // ... existing cases
  }
}
```

### Step 4: Regenerate

```bash
npm run protos
```

## Adding API Provider (Proto-Specific Steps)

When adding a new API provider, update proto conversions in THREE places:

1. **Proto enum** in `proto/cline/models.proto`:
```protobuf
enum ApiProvider {
  // ...
  MY_NEW_PROVIDER = 40;
}
```

2. **To-proto conversion** in `src/shared/proto-conversions/models/api-configuration-conversion.ts`:
```typescript
function convertApiProviderToProto(provider: string): ApiProviderProto {
  switch (provider) {
    case "my-new-provider":
      return ApiProviderProto.MY_NEW_PROVIDER;
    // ...
  }
}
```

3. **From-proto conversion** in same file:
```typescript
function convertProtoToApiProvider(proto: ApiProviderProto): string {
  switch (proto) {
    case ApiProviderProto.MY_NEW_PROVIDER:
      return "my-new-provider";
    // ...
  }
}
```

**Critical:** Missing any of these causes the provider to silently reset to Anthropic.

## Streaming Responses

For long-running operations that need progress updates:

```protobuf
// In proto file
service TaskService {
  rpc LongOperation(LongRequest) returns (stream ProgressUpdate);
}

message ProgressUpdate {
  int32 percent = 1;
  string status = 2;
}
```

See `subscribeToAuthCallback` in `account.proto` for a working example.

## Common Issues

### Changes not reflected

1. Verify `npm run protos` ran successfully
2. Check for TypeScript errors in generated files
3. Restart VS Code Extension Development Host

### Conversion mapping mismatch

Symptom: Values silently change to defaults.

Fix: Ensure both `toProto` and `fromProto` mappings exist for all enum values.

### Proto compilation errors

Check:
- Enum values are unique within the enum
- Field numbers are unique within the message
- No syntax errors (missing semicolons, etc.)

## Debugging

### Inspect proto messages

```typescript
// In extension code
import { MyMessage } from "@/generated/grpc-js/cline/my_proto";

const msg = MyMessage.create({ field: "value" });
console.log("Proto JSON:", MyMessage.toJSON(msg));
console.log("Proto binary:", MyMessage.encode(msg).finish());
```

### Trace RPC calls

Add logging in handler:
```typescript
export async function myMethod(controller: Controller, request: MyRequest) {
  console.log("[gRPC] myMethod called with:", MyRequest.toJSON(request));
  // ...
}
```

## Additional Resources

- [references/conversion-patterns.md](references/conversion-patterns.md) - Bidirectional conversion templates
- [references/proto-schema-guide.md](references/proto-schema-guide.md) - Complete proto file reference
- `.clinerules/general.md` - "gRPC/Protobuf Communication" section
- `plans/cline-beads-integration-findings.md` - Proto changes needed for beads
