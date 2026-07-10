# XML Tool Calling

Drives Cline's tools through XML tags in plain assistant text — the format the
legacy Cline extension used before native function calling — instead of
provider-native tool schemas. Local and weaker models that fumble native tool
calling tend to handle this format far better.

## How it works

The plugin is a pure translation shim at the model boundary. Internal session
state stays in native form; only the provider-bound request is translated, so
approvals, tool executors, completion tools, events, and persistence all work
exactly as they do with native tool calling.

Per model call:

1. **`beforeModel`** strips the native tool schemas from the request
   (`tools: []`), appends a `TOOL USE` section to the system prompt with
   per-tool XML documentation generated from the live tool registry (including
   tools contributed by other plugins), and rewrites prior turns in the
   provider-bound history — native tool calls become XML text, tool results
   become plain user messages.
2. The model replies with tool uses as XML tags:

   ```
   I'll read that file.
   <read_files>
   <paths>["src/main.ts"]</paths>
   </read_files>
   ```

3. **`afterModel`** parses the XML out of the assistant text and replaces the
   message with one carrying native `tool-call` parts, which the runtime then
   executes through the ordinary tool pipeline.

Parameter values are coerced to the tool's JSON Schema types: numbers,
booleans, and JSON for `array`/`object` params. Values that fail coercion pass
through as raw strings so the tool's own input validation produces an error
the model can react to.

The parser is a port of the legacy extension's `parseAssistantMessageV2`,
generalized from a fixed tool list to schema-derived tool and parameter names.
It keeps the legacy recovery trick for parameter values that contain their own
closing tag (e.g. file content containing `</content>`), generalized to every
parameter.

## Install

```bash
cline plugin install ./sdk/examples/plugins/xml-tool-calling
cline -i "..."
```

Or from an SDK host, pass it via `extensions`:

```typescript
import xmlToolCalling from "./sdk/examples/plugins/xml-tool-calling/index.ts";

await host.start({
	config: {
		// a local model that struggles with native tool calling
		providerId: "ollama",
		modelId: "qwen3:8b",
		extensions: [xmlToolCalling],
		// ...
	},
	// ...
});
```

Requires an SDK build where `beforeModel` hook results support `systemPrompt`
and `afterModel` hook results support `message` replacement.

## Caveats

- **Streaming**: text streams as raw `assistant-text-delta` events before
  `afterModel` runs, so live UIs show the XML while it streams. The final
  persisted message is clean (tool calls become native parts).
- **Unclosed tool uses** (max-tokens truncation, malformed XML) are kept as
  raw text and not executed.
- **Plain-text replies end the run**, same as a native model turn without tool
  calls. Pair with a completion policy that requires a completion tool if you
  want the runtime to nudge the model instead.
- Tool results are rendered as text; image outputs are JSON-stringified rather
  than passed as image blocks.

## Test

```bash
bun test
```

Covers the parser, prompt generation, schema coercion, history rewriting, and
an end-to-end run through `AgentRuntime` with a scripted model.
