# Proto Conversion Patterns

Complete patterns for bidirectional TypeScript↔Proto conversions.

## Enum Conversion Template

Every enum that exists in both TypeScript and Proto needs a bidirectional mapping.

```typescript
// src/shared/proto-conversions/cline-message.ts

import { ClineSay as ClineSayProto } from "@/generated/grpc-js/cline/ui";
import type { ClineSay } from "@/shared/ExtensionMessage";

/**
 * Convert TypeScript enum to Proto enum.
 *
 * IMPORTANT: This function MUST have a case for every TypeScript value.
 * Missing cases cause the value to hit `default` and return undefined behavior.
 */
export function convertClineSayToProto(say: ClineSay): ClineSayProto {
  switch (say) {
    case "text":
      return ClineSayProto.TEXT;
    case "tool":
      return ClineSayProto.TOOL;
    case "error":
      return ClineSayProto.ERROR;
    case "completion_result":
      return ClineSayProto.COMPLETION_RESULT;
    case "api_req_started":
      return ClineSayProto.API_REQ_STARTED;
    case "api_req_finished":
      return ClineSayProto.API_REQ_FINISHED;
    case "user_feedback":
      return ClineSayProto.USER_FEEDBACK;
    case "user_feedback_diff":
      return ClineSayProto.USER_FEEDBACK_DIFF;
    case "shell_integration_warning":
      return ClineSayProto.SHELL_INTEGRATION_WARNING;
    case "browser_action":
      return ClineSayProto.BROWSER_ACTION;
    case "browser_action_result":
      return ClineSayProto.BROWSER_ACTION_RESULT;
    case "checkpoint_saved":
      return ClineSayProto.CHECKPOINT_SAVED;
    case "command_output":
      return ClineSayProto.COMMAND_OUTPUT;
    case "mcp_server_request_started":
      return ClineSayProto.MCP_SERVER_REQUEST_STARTED;
    case "mcp_server_response":
      return ClineSayProto.MCP_SERVER_RESPONSE;
    case "reasoning":
      return ClineSayProto.REASONING;
    case "clinemessage_migration_info":
      return ClineSayProto.CLINEMESSAGE_MIGRATION_INFO;
    case "load_mcp_documentation":
      return ClineSayProto.LOAD_MCP_DOCUMENTATION;
    case "generate_explanation":
      return ClineSayProto.GENERATE_EXPLANATION;
    // Add new cases here when adding ClineSay types
    default:
      // This should never happen if all cases are covered
      console.error(`Unknown ClineSay type: ${say}`);
      return ClineSayProto.TEXT; // Fallback
  }
}

/**
 * Convert Proto enum to TypeScript enum.
 *
 * IMPORTANT: This function MUST have a case for every Proto value.
 * Missing cases cause silent data corruption.
 */
export function convertProtoToClineSay(proto: ClineSayProto): ClineSay {
  switch (proto) {
    case ClineSayProto.TEXT:
      return "text";
    case ClineSayProto.TOOL:
      return "tool";
    case ClineSayProto.ERROR:
      return "error";
    case ClineSayProto.COMPLETION_RESULT:
      return "completion_result";
    case ClineSayProto.API_REQ_STARTED:
      return "api_req_started";
    case ClineSayProto.API_REQ_FINISHED:
      return "api_req_finished";
    case ClineSayProto.USER_FEEDBACK:
      return "user_feedback";
    case ClineSayProto.USER_FEEDBACK_DIFF:
      return "user_feedback_diff";
    case ClineSayProto.SHELL_INTEGRATION_WARNING:
      return "shell_integration_warning";
    case ClineSayProto.BROWSER_ACTION:
      return "browser_action";
    case ClineSayProto.BROWSER_ACTION_RESULT:
      return "browser_action_result";
    case ClineSayProto.CHECKPOINT_SAVED:
      return "checkpoint_saved";
    case ClineSayProto.COMMAND_OUTPUT:
      return "command_output";
    case ClineSayProto.MCP_SERVER_REQUEST_STARTED:
      return "mcp_server_request_started";
    case ClineSayProto.MCP_SERVER_RESPONSE:
      return "mcp_server_response";
    case ClineSayProto.REASONING:
      return "reasoning";
    case ClineSayProto.CLINEMESSAGE_MIGRATION_INFO:
      return "clinemessage_migration_info";
    case ClineSayProto.LOAD_MCP_DOCUMENTATION:
      return "load_mcp_documentation";
    case ClineSayProto.GENERATE_EXPLANATION:
      return "generate_explanation";
    // Add new cases here when adding ClineSay types
    default:
      console.error(`Unknown ClineSayProto value: ${proto}`);
      return "text"; // Fallback
  }
}
```

## API Provider Conversion Pattern

API providers are particularly tricky because missing conversions cause silent resets to Anthropic.

```typescript
// src/shared/proto-conversions/models/api-configuration-conversion.ts

import { ApiProvider as ApiProviderProto } from "@/generated/grpc-js/cline/models";

/**
 * Convert string provider ID to Proto enum.
 *
 * WARNING: Missing cases return ANTHROPIC by default.
 * This is intentional for backwards compatibility but means
 * new providers SILENTLY fail if not added here.
 */
export function convertApiProviderToProto(provider: string): ApiProviderProto {
  switch (provider) {
    case "anthropic":
      return ApiProviderProto.ANTHROPIC;
    case "openai":
      return ApiProviderProto.OPENAI;
    case "openai-native":
      return ApiProviderProto.OPENAI_NATIVE;
    case "openai-codex":
      return ApiProviderProto.OPENAI_CODEX;
    case "azure":
      return ApiProviderProto.AZURE;
    case "vertex":
      return ApiProviderProto.VERTEX;
    case "bedrock":
      return ApiProviderProto.BEDROCK;
    case "glama":
      return ApiProviderProto.GLAMA;
    case "gemini":
      return ApiProviderProto.GEMINI;
    case "deepseek":
      return ApiProviderProto.DEEPSEEK;
    case "ollama":
      return ApiProviderProto.OLLAMA;
    case "lmstudio":
      return ApiProviderProto.LMSTUDIO;
    case "openrouter":
      return ApiProviderProto.OPENROUTER;
    case "litellm":
      return ApiProviderProto.LITELLM;
    case "xai":
      return ApiProviderProto.XAI;
    case "sambanova":
      return ApiProviderProto.SAMBANOVA;
    case "cerebras":
      return ApiProviderProto.CEREBRAS;
    case "mistral":
      return ApiProviderProto.MISTRAL;
    case "vscode-lm":
      return ApiProviderProto.VSCODE_LM;
    case "cline":
      return ApiProviderProto.CLINE;
    case "human-relay":
      return ApiProviderProto.HUMAN_RELAY;
    case "fake-ai":
      return ApiProviderProto.FAKE_AI;
    // ADD NEW PROVIDERS HERE
    default:
      console.warn(`Unknown provider "${provider}", defaulting to ANTHROPIC`);
      return ApiProviderProto.ANTHROPIC;
  }
}

/**
 * Convert Proto enum to string provider ID.
 */
export function convertProtoToApiProvider(proto: ApiProviderProto): string {
  switch (proto) {
    case ApiProviderProto.ANTHROPIC:
      return "anthropic";
    case ApiProviderProto.OPENAI:
      return "openai";
    case ApiProviderProto.OPENAI_NATIVE:
      return "openai-native";
    case ApiProviderProto.OPENAI_CODEX:
      return "openai-codex";
    case ApiProviderProto.AZURE:
      return "azure";
    case ApiProviderProto.VERTEX:
      return "vertex";
    case ApiProviderProto.BEDROCK:
      return "bedrock";
    case ApiProviderProto.GLAMA:
      return "glama";
    case ApiProviderProto.GEMINI:
      return "gemini";
    case ApiProviderProto.DEEPSEEK:
      return "deepseek";
    case ApiProviderProto.OLLAMA:
      return "ollama";
    case ApiProviderProto.LMSTUDIO:
      return "lmstudio";
    case ApiProviderProto.OPENROUTER:
      return "openrouter";
    case ApiProviderProto.LITELLM:
      return "litellm";
    case ApiProviderProto.XAI:
      return "xai";
    case ApiProviderProto.SAMBANOVA:
      return "sambanova";
    case ApiProviderProto.CEREBRAS:
      return "cerebras";
    case ApiProviderProto.MISTRAL:
      return "mistral";
    case ApiProviderProto.VSCODE_LM:
      return "vscode-lm";
    case ApiProviderProto.CLINE:
      return "cline";
    case ApiProviderProto.HUMAN_RELAY:
      return "human-relay";
    case ApiProviderProto.FAKE_AI:
      return "fake-ai";
    case ApiProviderProto.UNSPECIFIED:
    default:
      return "anthropic";
  }
}
```

## Complex Message Conversion

For messages with nested types:

```typescript
// Example: Converting a complex configuration object

import { ApiConfiguration as ApiConfigProto } from "@/generated/grpc-js/cline/models";
import type { ApiConfiguration } from "@/shared/api";

export function convertApiConfigurationToProto(
  config: ApiConfiguration
): ApiConfigProto {
  return ApiConfigProto.create({
    apiProvider: convertApiProviderToProto(config.apiProvider ?? "anthropic"),
    apiModelId: config.apiModelId,
    apiKey: config.apiKey,
    // Handle optional nested objects
    modelInfo: config.modelInfo
      ? convertModelInfoToProto(config.modelInfo)
      : undefined,
    // Handle arrays
    customHeaders: config.customHeaders?.map(convertHeaderToProto) ?? [],
  });
}

export function convertProtoToApiConfiguration(
  proto: ApiConfigProto
): ApiConfiguration {
  return {
    apiProvider: convertProtoToApiProvider(proto.apiProvider),
    apiModelId: proto.apiModelId,
    apiKey: proto.apiKey,
    modelInfo: proto.modelInfo
      ? convertProtoToModelInfo(proto.modelInfo)
      : undefined,
    customHeaders: proto.customHeaders.map(convertProtoToHeader),
  };
}
```

## Checklist: Adding New Enum Values

1. Add to `.proto` file (use next available number)
2. Run `npm run protos`
3. Add to TypeScript union type in `src/shared/`
4. Add `toProto` case in conversion file
5. Add `fromProto` case in conversion file
6. Test round-trip: TS → Proto → TS

## Common Mistakes

### Missing Default Case
```typescript
// BAD: No default, TypeScript might not catch missing cases
switch (say) {
  case "text": return ClineSayProto.TEXT;
  // Missing "tool" case - no error!
}

// GOOD: Explicit default with warning
switch (say) {
  case "text": return ClineSayProto.TEXT;
  case "tool": return ClineSayProto.TOOL;
  default:
    console.error(`Unhandled ClineSay: ${say}`);
    return ClineSayProto.TEXT;
}
```

### Proto Number Reuse
```protobuf
// BAD: Reusing number 5
enum Status {
  PENDING = 5;
  RUNNING = 5;  // ERROR: duplicate number
}

// GOOD: Unique numbers
enum Status {
  PENDING = 5;
  RUNNING = 6;
}
```

### String vs Enum Mismatch
```typescript
// BAD: Using string comparison with proto enum
if (proto === "TEXT") { ... }  // Always false!

// GOOD: Compare to enum value
if (proto === ClineSayProto.TEXT) { ... }
```
