# Core Configuration

## Renderer Configuration

### createCliRenderer Options

```typescript
import { createCliRenderer, ConsolePosition } from "@opentui/core"

const renderer = await createCliRenderer({
  // Rendering
  targetFPS: 60,                    // Target frames per second (default: 60)

  // Behavior
  exitOnCtrlC: true,                // Exit on Ctrl+C (default: true)

  // Console overlay
  consoleOptions: {
    position: ConsolePosition.BOTTOM,  // BOTTOM | TOP | LEFT | RIGHT
    sizePercent: 30,                   // Percentage of screen
    colorInfo: "#00FFFF",
    colorWarn: "#FFFF00",
    colorError: "#FF0000",
    colorDebug: "#888888",
    startInDebugMode: false,
  },

  // Lifecycle
  onDestroy: () => {
    // Cleanup callback
  },
})
```

## Environment Variables

OpenTUI respects several environment variables for configuration and debugging.

### Debug & Development

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTUI_DEBUG` | boolean | false | Enable debug mode, capture raw input |
| `OTUI_DEBUG_FFI` | boolean | false | Debug logging for FFI bindings |
| `OTUI_TRACE_FFI` | boolean | false | Tracing for FFI bindings |
| `OTUI_SHOW_STATS` | boolean | false | Show debug overlay at startup |
| `OTUI_DUMP_CAPTURES` | boolean | false | Dump captured output on exit |

### Console

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTUI_USE_CONSOLE` | boolean | true | Enable console capture |
| `SHOW_CONSOLE` | boolean | false | Show console at startup |

### Rendering

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTUI_NO_NATIVE_RENDER` | boolean | false | Disable ANSI output (for debugging) |
| `OTUI_USE_ALTERNATE_SCREEN` | boolean | true | Use alternate screen buffer |
| `OTUI_OVERRIDE_STDOUT` | boolean | true | Override stdout stream |

### Terminal Capabilities

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OPENTUI_NO_GRAPHICS` | boolean | false | Disable Kitty graphics protocol |
| `OPENTUI_FORCE_UNICODE` | boolean | false | Force Mode 2026 Unicode support |
| `OPENTUI_FORCE_WCWIDTH` | boolean | false | Use wcwidth for character width |
| `OPENTUI_FORCE_NOZWJ` | boolean | false | Disable ZWJ emoji joining |
| `OPENTUI_FORCE_EXPLICIT_WIDTH` | string | - | Force explicit width ("true"/"false") |

### Tree-sitter (Syntax Highlighting)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTUI_TS_STYLE_WARN` | boolean | false | Warn on missing syntax styles |
| `OTUI_TREE_SITTER_WORKER_PATH` | string | "" | Custom tree-sitter worker path |

### XDG Paths

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `XDG_CONFIG_HOME` | string | "" | User config directory |
| `XDG_DATA_HOME` | string | "" | User data directory |

## Usage Examples

### Development Mode

```bash
# Show debug overlay and console
OTUI_SHOW_STATS=true SHOW_CONSOLE=true bun run src/index.ts

# Debug FFI issues
OTUI_DEBUG_FFI=true OTUI_TRACE_FFI=true bun run src/index.ts

# Disable native rendering for testing
OTUI_NO_NATIVE_RENDER=true bun run src/index.ts
```

### Terminal Compatibility

```bash
# Force wcwidth for problematic terminals
OPENTUI_FORCE_WCWIDTH=true bun run src/index.ts

# Disable graphics for SSH sessions
OPENTUI_NO_GRAPHICS=true bun run src/index.ts
```

## Project Setup

### package.json

```json
{
  "name": "my-tui-app",
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@opentui/core": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "latest"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

> **Note**: OpenTUI uses `NodeNext` module resolution. All internal imports use `.js` extensions. If you use `bundler` resolution, imports still work but `NodeNext` is recommended for compatibility.

## Building Native Code

Native code changes require rebuilding:

```bash
# From repo root (if developing OpenTUI itself)
bun run build

# Zig is required for native compilation
# Install: https://ziglang.org/learn/getting-started/
```

**Note**: TypeScript changes do NOT require building. Bun runs TypeScript directly.
