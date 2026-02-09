# Cline Extension Patterns

Detailed implementation patterns for common modifications.

## Adding a New ClineAsk/ClineSay Type

### Step 1: Define TypeScript Type

In `src/shared/ExtensionMessage.ts`:

```typescript
// Add to ClineAsk union type
export type ClineAsk =
  | "my_new_ask"    // <-- Add here
  | "followup"
  | "tool"
  | "command"
  // ... existing types

// Add to ClineSay union type
export type ClineSay =
  | "my_new_say"    // <-- Add here
  | "text"
  | "tool"
  // ... existing types

// If the say type has structured data, add a type for it
export interface ClineSayMyNewSay {
  field1: string;
  field2: number;
}
```

### Step 2: Add Proto Enum Value

In `proto/cline/ui.proto`:

```protobuf
enum ClineAsk {
  // ... existing values
  MY_NEW_ASK = 30;  // Use next available number
}

enum ClineSay {
  // ... existing values
  MY_NEW_SAY = 30;  // Use next available number
}
```

### Step 3: Add Conversion Mapping

In `src/shared/proto-conversions/cline-message.ts`:

```typescript
// In convertClineAskToProto()
export function convertClineAskToProto(ask: ClineAsk): ClineAskProto {
  switch (ask) {
    case "my_new_ask":
      return ClineAskProto.MY_NEW_ASK;
    // ... existing cases
  }
}

// In convertProtoToClineAsk()
export function convertProtoToClineAsk(proto: ClineAskProto): ClineAsk {
  switch (proto) {
    case ClineAskProto.MY_NEW_ASK:
      return "my_new_ask";
    // ... existing cases
  }
}

// Same pattern for ClineSay...
```

### Step 4: Regenerate Protos

```bash
npm run protos
```

### Step 5: Handle in UI

In `webview-ui/src/components/chat/ChatRow.tsx`:

```typescript
// In the render logic
case "my_new_say":
  const myData = JSON.parse(message.text) as ClineSayMyNewSay;
  return <MyNewSayComponent data={myData} />;
```

---

## Adding Global State

### Step 1: Add to Schema

In `src/shared/storage/state-keys.ts`:

```typescript
export interface Settings {
  // ... existing fields
  myNewSetting: boolean;
}

export interface GlobalState {
  // ... existing fields
  myNewState: string;
}
```

### Step 2: Add Reader in State Helpers

In `src/core/storage/utils/state-helpers.ts`:

```typescript
export async function readGlobalStateFromDisk(
  context: vscode.ExtensionContext
): Promise<GlobalStateAndSettings> {
  // ... existing reads

  // Add your new state read
  const myNewSetting = context.globalState.get<GlobalStateAndSettings["myNewSetting"]>("myNewSetting");
  const myNewState = context.globalState.get<GlobalStateAndSettings["myNewState"]>("myNewState");

  return {
    // ... existing returns
    myNewSetting: myNewSetting ?? false,  // Provide default
    myNewState: myNewState ?? "",
  };
}
```

### Step 3: Regenerate Protos

```bash
npm run protos
```

### Step 4: Use in Code

```typescript
// Reading
const value = controller.stateManager.getGlobalStateKey("myNewSetting");

// Writing
await controller.stateManager.setGlobalState("myNewSetting", true);
```

---

## Adding a Tool to System Prompt

### Step 1: Add Tool Enum

In `src/shared/tools.ts`:

```typescript
export enum ClineDefaultTool {
  // ... existing tools
  MY_NEW_TOOL = "my_new_tool",
}
```

### Step 2: Create Tool Definition

Create `src/core/prompts/system-prompt/tools/my_new_tool.ts`:

```typescript
import { ClineDefaultTool } from "@/shared/tools";
import { ModelFamily, ToolVariant } from "../types";

const GENERIC: ToolVariant = {
  family: ModelFamily.GENERIC,
  tool: ClineDefaultTool.MY_NEW_TOOL,
  spec: `
## my_new_tool
Description: Describe what this tool does.

Parameters:
- param1: (required) Description of param1
- param2: (optional) Description of param2

Usage:
<my_new_tool>
<param1>value here</param1>
<param2>optional value</param2>
</my_new_tool>

Rules:
- Rule 1 for using this tool
- Rule 2 for using this tool
`,
};

// Add variants for other model families if needed
const NATIVE_NEXT_GEN: ToolVariant = {
  family: ModelFamily.NATIVE_NEXT_GEN,
  tool: ClineDefaultTool.MY_NEW_TOOL,
  spec: {
    name: "my_new_tool",
    description: "Describe what this tool does.",
    inputSchema: {
      type: "object",
      properties: {
        param1: { type: "string", description: "Description of param1" },
        param2: { type: "string", description: "Description of param2" },
      },
      required: ["param1"],
    },
  },
};

export const my_new_tool_variants = [GENERIC, NATIVE_NEXT_GEN];
```

### Step 3: Register Tool

In `src/core/prompts/system-prompt/tools/init.ts`:

```typescript
import { my_new_tool_variants } from "./my_new_tool";

export const allToolVariants = [
  // ... existing tool variants
  ...my_new_tool_variants,
];
```

### Step 4: Add to Variant Configs

For each variant in `src/core/prompts/system-prompt/variants/*/config.ts`:

```typescript
// In generic/config.ts, next-gen/config.ts, etc.
.tools([
  // ... existing tools
  ClineDefaultTool.MY_NEW_TOOL,
])
```

### Step 5: Create Handler

Create `src/core/task/tools/handlers/my_new_tool.ts`:

```typescript
import { ToolHandler, ToolResult } from "../types";

export const myNewToolHandler: ToolHandler = async (params, context) => {
  const { param1, param2 } = params;

  // Implement tool logic

  return {
    success: true,
    output: "Tool result here",
  };
};
```

### Step 6: Update Snapshots

```bash
UPDATE_SNAPSHOTS=true npm run test:unit
```

---

## Webview Communication

### Extension → Webview

```typescript
// In Controller or related class
this.postMessageToWebview({
  type: 'my_message_type',
  payload: { data: 'here' }
});
```

### Webview → Extension (Simple)

```typescript
// In React component
import { useVSCode } from '@/hooks/useVSCode';

function MyComponent() {
  const vscode = useVSCode();

  const handleClick = () => {
    vscode.postMessage({
      type: 'my_request',
      payload: { action: 'do_something' }
    });
  };
}
```

### Webview → Extension (gRPC)

```typescript
// In React component
import { UiServiceClient } from '@/services/grpc-client';
import { MyRequest } from '@/shared/proto/cline/my_proto';

async function handleAction() {
  const response = await UiServiceClient.myMethod(
    MyRequest.create({ field: 'value' })
  );
  console.log(response);
}
```
