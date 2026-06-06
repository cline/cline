# Testing OpenTUI Applications

How to test terminal user interfaces built with OpenTUI.

## Overview

OpenTUI provides:
- **Test Renderer**: Headless renderer for testing
- **Snapshot Testing**: Verify visual output
- **Interaction Testing**: Simulate user input

## When to Use

Use this reference when you need snapshot tests, interaction testing, or renderer-based regression checks.

## Test Setup

### Bun Test Runner

OpenTUI uses Bun's built-in test runner:

```typescript
import { test, expect, beforeEach, afterEach } from "bun:test"
```

### Test Renderer

Create a test renderer for headless testing:

```typescript
import { createTestRenderer } from "@opentui/core/testing"

const testSetup = await createTestRenderer({
  width: 80,     // Terminal width
  height: 24,    // Terminal height
})
```

## Core Testing

### Basic Test

```typescript
import { test, expect } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { TextRenderable } from "@opentui/core"

test("renders text", async () => {
  const testSetup = await createTestRenderer({
    width: 40,
    height: 10,
  })

  const text = new TextRenderable(testSetup.renderer, {
    id: "greeting",
    content: "Hello, World!",
  })

  testSetup.renderer.root.add(text)
  await testSetup.renderOnce()

  expect(testSetup.captureCharFrame()).toContain("Hello, World!")
})
```

### Snapshot Testing

```typescript
import { test, expect, afterEach } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { BoxRenderable, TextRenderable } from "@opentui/core"

let testSetup: Awaited<ReturnType<typeof createTestRenderer>>

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
  }
})

test("component matches snapshot", async () => {
  testSetup = await createTestRenderer({
    width: 40,
    height: 10,
  })

  const box = new BoxRenderable(testSetup.renderer, {
    id: "box",
    border: true,
    width: 20,
    height: 5,
  })
  box.add(new TextRenderable(testSetup.renderer, {
    content: "Content",
  }))

  testSetup.renderer.root.add(box)
  await testSetup.renderOnce()

  expect(testSetup.captureCharFrame()).toMatchSnapshot()
})
```

## React Testing

### Test Utilities

React provides a built-in `testRender` utility via the `@opentui/react/test-utils` subpath export:

```tsx
import { testRender } from "@opentui/react/test-utils"
```

This utility:
- Creates a headless test renderer
- Sets up the React Act environment automatically
- Handles proper unmounting on destroy
- Returns the standard test setup object

### Basic Component Test

```tsx
import { test, expect } from "bun:test"
import { testRender } from "@opentui/react/test-utils"

function Greeting({ name }: { name: string }) {
  return <text>Hello, {name}!</text>
}

test("Greeting renders name", async () => {
  const testSetup = await testRender(
    <Greeting name="World" />,
    { width: 80, height: 24 }
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain("Hello, World!")
})
```

### Snapshot Testing

```tsx
import { test, expect, afterEach } from "bun:test"
import { testRender } from "@opentui/react/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
  }
})

test("component matches snapshot", async () => {
  testSetup = await testRender(
    <box style={{ width: 20, height: 5, border: true }}>
      <text>Content</text>
    </box>,
    { width: 25, height: 8 }
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  expect(frame).toMatchSnapshot()
})
```

### State Testing

```tsx
import { test, expect, afterEach } from "bun:test"
import { useState } from "react"
import { testRender } from "@opentui/react/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
  }
})

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <box>
      <text>Count: {count}</text>
    </box>
  )
}

test("Counter shows initial value", async () => {
  testSetup = await testRender(
    <Counter />,
    { width: 20, height: 5 }
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain("Count: 0")
})
```

### Test Setup/Teardown Pattern

For multiple tests, use beforeEach/afterEach to manage the renderer lifecycle:

```tsx
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { testRender } from "@opentui/react/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("MyComponent", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  test("renders correctly", async () => {
    testSetup = await testRender(<MyComponent />, {
      width: 40,
      height: 10,
    })

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()
    expect(frame).toMatchSnapshot()
  })
})
```

### Test Setup Return Object

The `testRender` function returns a test setup object with these properties:

| Property | Type | Description |
|----------|------|-------------|
| `renderer` | `Renderer` | The headless renderer instance |
| `renderOnce` | `() => Promise<void>` | Triggers a single render cycle |
| `captureCharFrame` | `() => string` | Captures current output as text |
| `resize` | `(width, height) => void` | Resize the virtual terminal |

## Solid Testing

### Test Utilities

Solid exports `testRender` directly from the main package:

```tsx
import { testRender } from "@opentui/solid"
```

Note: Unlike React, Solid's `testRender` takes a **function component** (not a JSX element).

### Basic Component Test

```tsx
import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"

function Greeting(props: { name: string }) {
  return <text>Hello, {props.name}!</text>
}

test("Greeting renders name", async () => {
  const testSetup = await testRender(
    () => <Greeting name="World" />,
    { width: 80, height: 24 }
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  expect(frame).toContain("Hello, World!")
})
```

### Snapshot Testing

```tsx
import { test, expect, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"

let testSetup: Awaited<ReturnType<typeof testRender>>

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
  }
})

test("component matches snapshot", async () => {
  testSetup = await testRender(
    () => (
      <box style={{ width: 20, height: 5, border: true }}>
        <text>Content</text>
      </box>
    ),
    { width: 25, height: 8 }
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  expect(frame).toMatchSnapshot()
})
```

## Snapshot Format

Snapshots capture the rendered terminal output as text:

```
┌──────────────────┐
│ Hello, World!    │
│                  │
└──────────────────┘
```

### Updating Snapshots

```bash
bun test --update-snapshots
```

## Interaction Testing

### Simulating Key Presses

```typescript
import { test, expect, afterEach } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"

let testSetup: Awaited<ReturnType<typeof createTestRenderer>>

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
  }
})

test("responds to keyboard", async () => {
  testSetup = await createTestRenderer({
    width: 40,
    height: 10,
  })

  // Create component that responds to keys
  // ...

  // Simulate keypress
  testSetup.renderer.keyInput.emit("keypress", {
    name: "enter",
    sequence: "\r",
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    eventType: "press",
    repeated: false,
  })

  // Render after the keypress
  await testSetup.renderOnce()

  expect(testSetup.captureCharFrame()).toContain("Selected")
})
```

### Testing Focus

```typescript
import { test, expect, afterEach } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { InputRenderable } from "@opentui/core"

let testSetup: Awaited<ReturnType<typeof createTestRenderer>>

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
  }
})

test("input receives focus", async () => {
  testSetup = await createTestRenderer({
    width: 40,
    height: 10,
  })

  const input = new InputRenderable(testSetup.renderer, {
    id: "test-input",
    placeholder: "Type here",
  })
  testSetup.renderer.root.add(input)

  input.focus()

  expect(input.isFocused()).toBe(true)
})
```

## Test Organization

### File Structure

```
src/
├── components/
│   ├── Button.tsx
│   └── Button.test.tsx
├── hooks/
│   ├── useCounter.ts
│   └── useCounter.test.ts
└── test-utils.tsx
```

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test src/components/Button.test.tsx

# Run with filter
bun test --filter "Button"

# Watch mode
bun test --watch
```

## Patterns

### Testing Conditional Rendering (React)

```tsx
import { test, expect, afterEach } from "bun:test"
import { testRender } from "@opentui/react/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
  }
})

test("shows loading state", async () => {
  testSetup = await testRender(
    <DataLoader loading={true} />,
    { width: 40, height: 10 }
  )

  await testSetup.renderOnce()
  expect(testSetup.captureCharFrame()).toContain("Loading...")
})

test("shows data when loaded", async () => {
  testSetup = await testRender(
    <DataLoader loading={false} data={["Item 1", "Item 2"]} />,
    { width: 40, height: 10 }
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()
  expect(frame).toContain("Item 1")
  expect(frame).toContain("Item 2")
})
```

### Testing Lists

```tsx
test("renders all items", async () => {
  const items = ["Apple", "Banana", "Cherry"]

  testSetup = await testRender(
    <ItemList items={items} />,
    { width: 40, height: 10 }
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  items.forEach(item => {
    expect(frame).toContain(item)
  })
})
```

### Testing Layouts

```tsx
test("matches layout snapshot", async () => {
  testSetup = await testRender(
    <AppLayout />,
    { width: 120, height: 40 }  // Larger viewport
  )

  await testSetup.renderOnce()
  expect(testSetup.captureCharFrame()).toMatchSnapshot()
})
```

## Debugging Tests

### Print Frame Output

```tsx
import { testRender } from "@opentui/react/test-utils"

test("debug output", async () => {
  const testSetup = await testRender(
    <MyComponent />,
    { width: 40, height: 10 }
  )

  await testSetup.renderOnce()
  const frame = testSetup.captureCharFrame()

  // Print to see what's rendered
  console.log(frame)

  expect(frame).toContain("expected")
})
```

### Verbose Mode

```bash
bun test --verbose
```

## Gotchas

### Async Rendering

Always call `renderOnce()` after setting up your component to ensure rendering is complete:

```typescript
const testSetup = await testRender(<MyComponent />, { width: 40, height: 10 })
await testSetup.renderOnce()  // Required before capturing frame
const frame = testSetup.captureCharFrame()
```

### Test Isolation and Cleanup

Always destroy the renderer after each test to avoid resource leaks:

```typescript
import { afterEach } from "bun:test"

let testSetup: Awaited<ReturnType<typeof testRender>>

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy()
  }
})

test("test 1", async () => {
  testSetup = await testRender(<Component1 />, { width: 40, height: 10 })
  // ...
})

test("test 2", async () => {
  testSetup = await testRender(<Component2 />, { width: 40, height: 10 })
  // ...
})
```

### Snapshot Dimensions

Be consistent with test dimensions for stable snapshots:

```typescript
const testSetup = await createTestRenderer({
  width: 80,   // Standard width
  height: 24,  // Standard height
})
```

### Running from Package Directory

Run tests from the package directory:

```bash
cd packages/core
bun test

# Not from repo root for package-specific tests
```

## See Also

- [Core API](../core/api.md) - `createTestRenderer` and renderable classes
- [React Configuration](../react/configuration.md) - React test setup
- [Solid Configuration](../solid/configuration.md) - Solid test setup
- [Keyboard](../keyboard/REFERENCE.md) - Simulating key events in tests
