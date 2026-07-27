# OpenTUI Solid (@opentui/solid)

A SolidJS reconciler for building terminal user interfaces with fine-grained reactivity. Get optimal performance with Solid's signal-based approach.

## Overview

OpenTUI Solid provides:
- **Custom reconciler**: Solid components render to OpenTUI renderables
- **JSX intrinsics**: `<text>`, `<box>`, `<input>`, etc.
- **Hooks**: `useKeyboard`, `useRenderer`, `useTimeline`, etc.
- **Fine-grained reactivity**: Only what changes re-renders
- **Portal & Dynamic**: Advanced composition primitives

## When to Use Solid

Use the Solid reconciler when:
- You want optimal re-rendering performance
- You prefer signal-based reactivity
- You need fine-grained control over updates
- Building performance-critical applications
- You already know SolidJS

## When NOT to Use Solid

| Scenario | Use Instead |
|----------|-------------|
| Team knows React, not Solid | `@opentui/react` |
| Maximum control needed | `@opentui/core` |
| Smallest bundle size | `@opentui/core` |
| Building a framework/library | `@opentui/core` |

## Quick Start

```bash
bunx create-tui@latest -t solid my-app
cd my-app && bun install
```

The CLI creates the `my-app` directory for you - it must **not already exist**.

Options: `--no-git` (skip git init), `--no-install` (skip bun install)

**Agent guidance**: Always use autonomous mode with `-t <template>` flag. Never use interactive mode (`bunx create-tui@latest my-app` without `-t`) as it requires user prompts that agents cannot respond to.

Or manually:

```bash
bun install @opentui/solid @opentui/core solid-js
```

```tsx
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"

function App() {
  const [count, setCount] = createSignal(0)

  return (
    <box border padding={2}>
      <text>Count: {count()}</text>
      <box
        border
        onMouseDown={() => setCount(c => c + 1)}
      >
        <text>Click me!</text>
      </box>
    </box>
  )
}

render(() => <App />)
```

## Core Concepts

### Signals

Solid uses signals for reactive state:

```tsx
import { createSignal, createEffect } from "solid-js"

function Counter() {
  const [count, setCount] = createSignal(0)

  // Effect runs when count changes
  createEffect(() => {
    console.log("Count is now:", count())
  })

  return <text>Count: {count()}</text>
}
```

### JSX Elements

Solid maps JSX intrinsic elements to OpenTUI renderables:

```tsx
// Note: Some use underscores (Solid convention)
<text>Hello</text>           // TextRenderable
<box border>Content</box>    // BoxRenderable
<input placeholder="..." />  // InputRenderable
<select options={[...]} />   // SelectRenderable
<tab_select />               // TabSelectRenderable (underscore!)
<ascii_font />               // ASCIIFontRenderable (underscore!)
<line_number />              // LineNumberRenderable (underscore!)
```

### Text Modifiers

Inside `<text>`, use modifier elements:

```tsx
<text>
  <strong>Bold</strong>, <em>italic</em>, and <u>underlined</u>
  <span fg="red">Colored text</span>
  <br />
  New line with <a href="https://example.com">link</a>
</text>
```

## Available Components

### Layout & Display
- `<text>` - Styled text content
- `<box>` - Container with borders and layout
- `<scrollbox>` - Scrollable container
- `<ascii_font>` - ASCII art text (note underscore)

### Input
- `<input>` - Single-line text input
- `<textarea>` - Multi-line text input
- `<select>` - List selection
- `<tab_select>` - Tab-based selection (note underscore)

### Code & Diff
- `<code>` - Syntax-highlighted code
- `<line_number>` - Code with line numbers (note underscore)
- `<diff>` - Unified or split diff viewer

### Text Modifiers (inside `<text>`)
- `<span>` - Inline styled text
- `<strong>`, `<b>` - Bold
- `<em>`, `<i>` - Italic
- `<u>` - Underline
- `<br>` - Line break
- `<a>` - Link

## Special Components

### Portal

Render children to a different mount node:

```tsx
import { Portal } from "@opentui/solid"

function Overlay() {
  return (
    <Portal mount={renderer.root}>
      <box position="absolute" left={10} top={5} border>
        <text>Overlay content</text>
      </box>
    </Portal>
  )
}
```

### Dynamic

Render components dynamically:

```tsx
import { Dynamic } from "@opentui/solid"

function DynamicInput(props: { multiline: boolean }) {
  return (
    <Dynamic
      component={props.multiline ? "textarea" : "input"}
      placeholder="Enter text..."
    />
  )
}
```

## In This Reference

- [Configuration](./configuration.md) - Project setup, tsconfig, bunfig, building
- [API](./api.md) - Components, hooks, render function
- [Patterns](./patterns.md) - Signals, stores, control flow, composition
- [Gotchas](./gotchas.md) - Common issues, debugging, limitations

## See Also

- [Core](../core/REFERENCE.md) - Underlying imperative API
- [React](../react/REFERENCE.md) - Alternative declarative approach
- [Components](../components/REFERENCE.md) - Component reference by category
- [Layout](../layout/REFERENCE.md) - Flexbox layout system
- [Keyboard](../keyboard/REFERENCE.md) - Input handling and shortcuts
- [Testing](../testing/REFERENCE.md) - Test renderer and snapshots
