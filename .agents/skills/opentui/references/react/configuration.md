# React Configuration

## Project Setup

### Quick Start

```bash
bunx create-tui@latest -t react my-app
cd my-app && bun install
```

The CLI creates the `my-app` directory for you - it must **not already exist**.

Options: `--no-git` (skip git init), `--no-install` (skip bun install)

### Manual Setup

```bash
mkdir my-tui && cd my-tui
bun init
bun install @opentui/react @opentui/core react
```

## TypeScript Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",

    "jsx": "react-jsx",
    "jsxImportSource": "@opentui/react",

    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

**Critical settings:**
- `jsx: "react-jsx"` - Use the new JSX transform
- `jsxImportSource: "@opentui/react"` - Import JSX runtime from OpenTUI
- `module` / `moduleResolution: "NodeNext"` - Recommended for OpenTUI compatibility

### Why DOM lib?

The `DOM` lib is needed for React types. OpenTUI's JSX types extend React's.

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
    "build": "bun build src/index.tsx --outdir=dist --target=bun"
  },
  "dependencies": {
    "@opentui/core": "latest",
    "@opentui/react": "latest",
    "react": ">=19.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": ">=19.0.0",
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
│   ├── hooks/
│   │   └── useAppState.ts
│   ├── App.tsx
│   └── index.tsx
├── package.json
└── tsconfig.json
```

### Entry Point (src/index.tsx)

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./App"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
})

createRoot(renderer).render(<App />)
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

### createCliRenderer Options

```tsx
import { createCliRenderer, ConsolePosition } from "@opentui/core"

const renderer = await createCliRenderer({
  // Rendering
  targetFPS: 60,

  // Behavior
  exitOnCtrlC: true,        // Set false to handle Ctrl+C yourself
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

## Building for Distribution

### Bundling with Bun

```typescript
// build.ts
await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  target: "bun",
  minify: true,
})
```

Run: `bun run build.ts`

### Creating Executables

```typescript
// build.ts
await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  target: "bun",
  compile: {
    target: "bun-darwin-arm64",  // or bun-linux-x64, etc.
    outfile: "my-app",
  },
})
```

## Environment Variables

Create `.env` for development:

```env
# Debug settings
OTUI_SHOW_STATS=false
SHOW_CONSOLE=false

# App settings
API_URL=https://api.example.com
```

Bun auto-loads `.env` files. Access via `process.env`:

```tsx
const apiUrl = process.env.API_URL
```

## React DevTools

OpenTUI React supports React DevTools for debugging.

### Setup

1. Install DevTools as a dev dependency (must use version 7):
   ```bash
   bun add react-devtools-core@7 -d
   ```

2. Run DevTools standalone app:
   ```bash
   npx react-devtools@7
   ```

3. Start your app with `DEV=true` environment variable:
   ```bash
   DEV=true bun run src/index.tsx
   ```

**Important**: Auto-connect to DevTools ONLY happens when `DEV=true` is set. Without this environment variable, the DevTools connection code is not loaded.

### How It Works

OpenTUI checks for `process.env["DEV"] === "true"` at startup. When true, it dynamically imports `react-devtools-core` and connects to the standalone DevTools app.

## Testing Configuration

### Test Setup

```typescript
// src/test-utils.tsx
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"

export async function renderForTest(
  element: React.ReactElement,
  options = { width: 80, height: 24 }
) {
  const testSetup = await createTestRenderer(options)
  createRoot(testSetup.renderer).render(element)
  return testSetup
}
```

### Test Example

```typescript
// src/components/Counter.test.tsx
import { test, expect } from "bun:test"
import { renderForTest } from "../test-utils"
import { Counter } from "./Counter"

test("Counter renders initial value", async () => {
  const { snapshot } = await renderForTest(<Counter initialValue={5} />)
  expect(snapshot()).toContain("Count: 5")
})
```

## Common Issues

### JSX Types Not Working

Ensure `jsxImportSource` is set:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@opentui/react"
  }
}
```

### React Version Mismatch

Ensure React 19+:

```bash
bun install react@19 @types/react@19
```

### Module Resolution Errors

Use `moduleResolution: "bundler"` for Bun compatibility.
