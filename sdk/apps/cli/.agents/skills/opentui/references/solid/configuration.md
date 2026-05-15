# Solid Configuration

## Project Setup

### Quick Start

```bash
bunx create-tui@latest -t solid my-app
cd my-app && bun install
```

The CLI creates the `my-app` directory for you - it must **not already exist**.

Options: `--no-git` (skip git init), `--no-install` (skip bun install)

### Manual Setup

```bash
mkdir my-tui && cd my-tui
bun init
bun install @opentui/solid @opentui/core solid-js
```

## TypeScript Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",

    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid",

    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

**Critical settings:**
- `jsx: "preserve"` - Let Solid's compiler handle JSX
- `jsxImportSource: "@opentui/solid"` - Import JSX runtime from OpenTUI Solid
- `module` / `moduleResolution: "NodeNext"` - Recommended for OpenTUI compatibility

## Bun Configuration

### bunfig.toml

**Required** for the Solid compiler:

```toml
preload = ["@opentui/solid/preload"]
```

This loads the Solid JSX transform before your code runs.

## Package Configuration

### package.json

```json
{
  "name": "my-tui-app",
  "type": "module",
  "scripts": {
    "start": "bun run src/index.tsx",
    "dev": "bun --watch run src/index.tsx",
    "test": "bun test",
    "build": "bun run build.ts"
  },
  "dependencies": {
    "@opentui/core": "latest",
    "@opentui/solid": "latest",
    "solid-js": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "latest"
  }
}
```

## Project Structure

Recommended structure:

```
my-tui-app/
├── src/
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   └── MainContent.tsx
│   ├── stores/
│   │   └── appStore.ts
│   ├── App.tsx
│   └── index.tsx
├── bunfig.toml           # Required!
├── package.json
└── tsconfig.json
```

### Entry Point (src/index.tsx)

```tsx
import { render } from "@opentui/solid"
import { App } from "./App"

render(() => <App />)
```

### App Component (src/App.tsx)

```tsx
import { Header } from "./components/Header"
import { Sidebar } from "./components/Sidebar"
import { MainContent } from "./components/MainContent"

export function App() {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header />
      <box flexDirection="row" flexGrow={1}>
        <Sidebar />
        <MainContent />
      </box>
    </box>
  )
}
```

## Renderer Configuration

### render() Options

```tsx
import { render } from "@opentui/solid"
import { ConsolePosition } from "@opentui/core"

render(() => <App />, {
  // Rendering
  targetFPS: 60,

  // Behavior
  exitOnCtrlC: true,
  autoFocus: true,          // Auto-focus elements on click (default: true)
  useMouse: true,           // Enable mouse support (default: true)

  // Debug console
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    sizePercent: 30,
    startInDebugMode: false,
  },

  // Cleanup
  onDestroy: () => {
    // Cleanup code
  },
})
```

### Using Existing Renderer

```tsx
import { render } from "@opentui/solid"
import { createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
})

render(() => <App />, renderer)
```

## Building for Distribution

### Build Script (build.ts)

```typescript
import solidPlugin from "@opentui/solid/bun-plugin"

await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  target: "bun",
  minify: true,
  plugins: [solidPlugin],
})

console.log("Build complete!")
```

Run: `bun run build.ts`

### Creating Executables

```typescript
import solidPlugin from "@opentui/solid/bun-plugin"

await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  plugins: [solidPlugin],
  compile: {
    target: "bun-darwin-arm64",  // or bun-linux-x64, etc.
    outfile: "my-app",
  },
})
```

**Available targets:**
- `bun-darwin-arm64` - macOS Apple Silicon
- `bun-darwin-x64` - macOS Intel
- `bun-linux-x64` - Linux x64
- `bun-linux-arm64` - Linux ARM64
- `bun-windows-x64` - Windows x64

## Environment Variables

Create `.env` for development:

```env
# Debug settings
OTUI_SHOW_STATS=false
SHOW_CONSOLE=false

# App settings
API_URL=https://api.example.com
```

Bun auto-loads `.env` files:

```tsx
const apiUrl = process.env.API_URL
```

## Testing Configuration

### Test Setup

```typescript
// src/test-utils.tsx
import { testRender } from "@opentui/solid"

export async function renderForTest(
  Component: () => JSX.Element,
  options = { width: 80, height: 24 }
) {
  return await testRender(Component, options)
}
```

### Test Example

```typescript
// src/components/Counter.test.tsx
import { test, expect } from "bun:test"
import { renderForTest } from "../test-utils"
import { Counter } from "./Counter"

test("Counter renders initial value", async () => {
  const { snapshot } = await renderForTest(() => <Counter initialValue={5} />)
  expect(snapshot()).toContain("Count: 5")
})
```

## Common Configuration Issues

### Missing bunfig.toml

**Symptom**: JSX not transformed, syntax errors

**Fix**: Create `bunfig.toml` with preload:

```toml
preload = ["@opentui/solid/preload"]
```

### Wrong JSX Settings

**Symptom**: JSX compiles to React calls

**Fix**: Ensure tsconfig has:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

### Build Missing Plugin

**Symptom**: Built output has untransformed JSX

**Fix**: Add Solid plugin to build:

```typescript
import solidPlugin from "@opentui/solid/bun-plugin"

await Bun.build({
  // ...
  plugins: [solidPlugin],
})
```
