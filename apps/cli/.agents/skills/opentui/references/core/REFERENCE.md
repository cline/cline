# OpenTUI Core (@opentui/core)

The foundational library for building terminal user interfaces. Provides an imperative API with all primitives, giving you maximum control over rendering, state, and behavior.

## Overview

OpenTUI Core runs on Bun with native Zig bindings for performance-critical operations:
- **Renderer**: Manages terminal output, input events, and the rendering loop
- **Renderables**: Hierarchical UI building blocks with Yoga layout
- **Constructs**: Declarative wrappers for composing Renderables
- **FrameBuffer**: Low-level 2D rendering surface for custom graphics

## When to Use Core

Use the core imperative API when:
- Building a library or framework on top of OpenTUI
- Need maximum control over rendering and state
- Want smallest possible bundle size (no React/Solid runtime)
- Building performance-critical applications
- Integrating with existing imperative codebases

## When NOT to Use Core

| Scenario | Use Instead |
|----------|-------------|
| Familiar with React patterns | `@opentui/react` |
| Want fine-grained reactivity | `@opentui/solid` |
| Building typical applications | React or Solid reconciler |
| Rapid prototyping | React or Solid reconciler |

## Quick Start

### Using create-tui (Recommended)

```bash
bunx create-tui@latest -t core my-app
cd my-app
bun run src/index.ts
```

The CLI creates the `my-app` directory for you - it must **not already exist**.

**Agent guidance**: Always use autonomous mode with `-t <template>` flag. Never use interactive mode (`bunx create-tui@latest my-app` without `-t`) as it requires user prompts that agents cannot respond to.

### Manual Setup

```bash
mkdir my-tui && cd my-tui
bun init
bun install @opentui/core
```

```typescript
import { createCliRenderer, TextRenderable, BoxRenderable } from "@opentui/core"

const renderer = await createCliRenderer()

// Create a box container
const container = new BoxRenderable(renderer, {
  id: "container",
  width: 40,
  height: 10,
  border: true,
  borderStyle: "rounded",
  padding: 1,
})

// Create text inside the box
const greeting = new TextRenderable(renderer, {
  id: "greeting",
  content: "Hello, OpenTUI!",
  fg: "#00FF00",
})

// Compose the tree
container.add(greeting)
renderer.root.add(container)
```

## Core Concepts

### Renderer

The `CliRenderer` orchestrates everything:
- Manages the terminal viewport and alternate screen
- Handles input events (keyboard, mouse, paste)
- Runs the rendering loop (configurable FPS)
- Provides the root node for the renderable tree

### Renderables vs Constructs

| Renderables (Imperative) | Constructs (Declarative) |
|--------------------------|--------------------------|
| `new TextRenderable(renderer, {...})` | `Text({...})` |
| Requires renderer at creation | Creates VNode, instantiated later |
| Direct mutation via methods | Chained calls recorded, replayed on instantiation |
| Full control | Cleaner composition |

### Storage Options

Renderables can be composed in two ways:
1. **Imperative**: Create instances, call `.add()` to compose
2. **Declarative (Constructs)**: Create VNodes, pass children as arguments

## Essential Commands

```bash
bun install @opentui/core     # Install
bun run src/index.ts          # Run directly (no build needed)
bun test                      # Run tests
```

## Runtime Requirements

OpenTUI runs on Bun and uses Zig for native builds.

```bash
# Package management
bun install @opentui/core

# Running
bun run src/index.ts
bun test

# Building (only needed for native code changes)
bun run build
```

**Zig** is required for building native components.

## In This Reference

- [Configuration](./configuration.md) - Renderer options, environment variables
- [API](./api.md) - Renderer, Renderables, types, utilities
- [Patterns](./patterns.md) - Composition, events, state management
- [Gotchas](./gotchas.md) - Common issues, debugging, limitations

## See Also

- [React](../react/REFERENCE.md) - React reconciler for declarative TUI
- [Solid](../solid/REFERENCE.md) - Solid reconciler for declarative TUI
- [Layout](../layout/REFERENCE.md) - Yoga/Flexbox layout system
- [Components](../components/REFERENCE.md) - Component reference by category
- [Keyboard](../keyboard/REFERENCE.md) - Input handling and shortcuts
- [Testing](../testing/REFERENCE.md) - Test renderer and snapshots
