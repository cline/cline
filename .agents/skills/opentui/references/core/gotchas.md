# Core Gotchas

## Runtime Environment

### Use Bun, Not Node.js

OpenTUI is built for Bun. Always use Bun commands:

```bash
# CORRECT
bun install @opentui/core
bun run src/index.ts
bun test

# WRONG
npm install @opentui/core
node src/index.ts
npx jest
```

### Bun APIs to Use

Prefer Bun's built-in APIs for your application code:

```typescript
// CORRECT - Bun APIs
Bun.serve({ ... })                // Instead of express
Bun.$`ls -la`                     // Instead of execa
import { Database } from "bun:sqlite"  // Instead of better-sqlite3

// WRONG - Node.js patterns
import express from "express"
```

> **Note**: OpenTUI itself uses `node:fs` internally for file I/O (for broader compatibility), but your application code should still prefer Bun APIs where available.

### Avoid process.exit()

**Never use `process.exit()` directly** - it prevents proper terminal cleanup and can leave the terminal in a broken state (alternate screen mode, raw input mode, etc.).

```typescript
// WRONG - Terminal may be left in broken state
if (error) {
  console.error("Fatal error")
  process.exit(1)
}

// CORRECT - Use renderer.destroy() for cleanup
if (error) {
  console.error("Fatal error")
  await renderer.destroy()
  process.exit(1)  // Only after destroy
}

// BETTER - Let destroy handle exit
const renderer = await createCliRenderer({
  exitOnCtrlC: true,  // Handles Ctrl+C properly
})

// For programmatic exit
renderer.destroy()  // Cleans up and exits
```

`renderer.destroy()` restores the terminal to its original state before exiting.

### Environment Variables

Bun auto-loads `.env` files. Don't use dotenv:

```typescript
// CORRECT
const apiKey = process.env.API_KEY

// WRONG
import dotenv from "dotenv"
dotenv.config()
```

## Debugging TUIs

### Cannot See console.log Output

OpenTUI captures console output for the debug overlay. You can't see logs in the terminal while the TUI is running.

**Solutions:**

1. **Use the console overlay:**
   ```typescript
   const renderer = await createCliRenderer()
   renderer.console.show()
   console.log("This appears in the overlay")
   ```

2. **Toggle with keyboard:**
   ```typescript
   renderer.keyInput.on("keypress", (key) => {
     if (key.name === "f12") {
       renderer.console.toggle()
     }
   })
   ```

3. **Write to a file:**
   ```typescript
   import { appendFileSync } from "node:fs"
   function debugLog(msg: string) {
     appendFileSync("debug.log", `${new Date().toISOString()} ${msg}\n`)
   }
   ```

4. **Disable console capture:**
   ```bash
   OTUI_USE_CONSOLE=false bun run src/index.ts
   ```

### Reproduce Issues in Tests

Don't guess at bugs. Create a reproducible test:

```typescript
import { test, expect } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"

test("reproduces the issue", async () => {
  const { renderer, snapshot } = await createTestRenderer({
    width: 40,
    height: 10,
  })

  // Setup that reproduces the bug
  const box = new BoxRenderable(renderer, { ... })
  renderer.root.add(box)

  // Verify with snapshot
  expect(snapshot()).toMatchSnapshot()
})
```

## Focus Management

### Components Must Be Focused

Input components only receive keyboard input when focused:

```typescript
const input = new InputRenderable(renderer, {
  id: "input",
  placeholder: "Type here...",
})

renderer.root.add(input)

// WRONG - input won't receive keystrokes
// (no focus call)

// CORRECT
input.focus()
```

### Focus in Nested Components

When a component is inside a container, focus the component directly:

```typescript
const container = new BoxRenderable(renderer, { id: "container" })
const input = new InputRenderable(renderer, { id: "input" })
container.add(input)
renderer.root.add(container)

// WRONG
container.focus()

// CORRECT
input.focus()

// Or use getRenderable
container.getRenderable("input")?.focus()

// Or use delegate (constructs)
const form = delegate(
  { focus: "input" },
  Box({}, Input({ id: "input" })),
)
form.focus()  // Routes to the input
```

## Build Requirements

### Zig is Required

Native code compilation requires Zig:

```bash
# Install Zig first
# macOS
brew install zig

# Linux
# Download from https://ziglang.org/download/

# Then build
bun run build
```

### When to Build

- **TypeScript changes**: NO build needed (Bun runs TS directly)
- **Native code changes**: Build required

```bash
# Only needed when changing native (Zig) code
cd packages/core
bun run build
```

## Common Errors

### "Cannot read properties of undefined"

Usually means a renderable wasn't added to the tree:

```typescript
// WRONG - not added to tree
const text = new TextRenderable(renderer, { content: "Hello" })
// text.someMethod() // May fail

// CORRECT
const text = new TextRenderable(renderer, { content: "Hello" })
renderer.root.add(text)
text.someMethod()
```

### Layout Not Updating

Yoga layout is calculated lazily. Force a recalculation:

```typescript
// After changing layout properties
box.setWidth(newWidth)
renderer.requestRender()
```

### Text Overflow/Clipping

Text doesn't wrap by default. Set explicit width:

```typescript
// May overflow
const text = new TextRenderable(renderer, {
  content: "Very long text that might overflow the terminal...",
})

// Contained within width
const text = new TextRenderable(renderer, {
  content: "Very long text that might overflow the terminal...",
  width: 40,  // Will clip or wrap based on parent
})
```

### Colors Not Showing

Check terminal capability and color format:

```typescript
// CORRECT formats
fg: "#FF0000"           // Hex
fg: "red"               // CSS color name
fg: RGBA.fromHex("#FF0000")

// WRONG
fg: "FF0000"            // Missing #
fg: 0xFF0000            // Number (not supported)
```

## Performance

### Avoid Frequent Re-renders

Batch updates when possible:

```typescript
// WRONG - multiple render calls
item1.setContent("...")
item2.setContent("...")
item3.setContent("...")

// BETTER - single render after all updates
// (OpenTUI batches automatically, but be mindful)
items.forEach((item, i) => {
  item.setContent(data[i])
})
```

### Minimize Tree Depth

Deep nesting impacts layout calculation:

```typescript
// Avoid unnecessary wrappers
// WRONG
Box({}, Box({}, Box({}, Text({ content: "Hello" }))))

// CORRECT
Box({}, Text({ content: "Hello" }))
```

### Use display: none

Hide elements instead of removing/re-adding:

```typescript
// For toggling visibility
element.setDisplay("none")   // Hidden
element.setDisplay("flex")   // Visible

// Instead of
parent.remove(element)
parent.add(element)
```

## Testing

### Test Runner

Use Bun's test runner:

```typescript
import { test, expect, beforeEach, afterEach } from "bun:test"

test("my test", () => {
  expect(1 + 1).toBe(2)
})
```

### Test from Package Directories

Run tests from the specific package directory:

```bash
# CORRECT
cd packages/core
bun test

# For native tests
cd packages/core
bun run test:native
```

### Filter Tests

```bash
# Bun test filter
bun test --filter "component name"

# Native test filter
bun run test:native -Dtest-filter="test name"
```

## Keyboard Handling

### Key Names

Common key names for `KeyEvent.name`:

```typescript
// Letters/numbers
"a", "b", ..., "z"
"1", "2", ..., "0"

// Special keys
"escape", "enter", "return", "tab", "backspace", "delete"
"up", "down", "left", "right"
"home", "end", "pageup", "pagedown"
"f1", "f2", ..., "f12"
"space"

// Modifiers (check boolean properties)
key.ctrl   // Ctrl held
key.shift  // Shift held
key.meta   // Alt held
key.option // Option held (macOS)
```

### Key Event Types

```typescript
renderer.keyInput.on("keypress", (key) => {
  // eventType: "press" | "release" | "repeat"
  if (key.eventType === "repeat") {
    // Key being held down
  }
})
```
