# Core Patterns

## Composition Patterns

### Imperative Composition

Create renderables and compose with `.add()`:

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable } from "@opentui/core"

const renderer = await createCliRenderer()

// Create parent
const container = new BoxRenderable(renderer, {
  id: "container",
  flexDirection: "column",
  padding: 1,
})

// Create children
const header = new TextRenderable(renderer, {
  id: "header",
  content: "Header",
  fg: "#00FF00",
})

const body = new TextRenderable(renderer, {
  id: "body",
  content: "Body content",
})

// Compose tree
container.add(header)
container.add(body)
renderer.root.add(container)
```

### Declarative Composition (Constructs)

Use VNode functions for cleaner composition:

```typescript
import { createCliRenderer, Box, Text, Input, delegate } from "@opentui/core"

const renderer = await createCliRenderer()

// Compose as function calls
const ui = Box(
  { flexDirection: "column", padding: 1 },
  Text({ content: "Header", fg: "#00FF00" }),
  Box(
    { flexDirection: "row", gap: 2 },
    Text({ content: "Name:" }),
    Input({ id: "name", placeholder: "Enter name..." }),
  ),
)

renderer.root.add(ui)
```

### Reusable Components

Create factory functions for reusable UI pieces:

```typescript
// Imperative factory
function createLabeledInput(
  renderer: RenderContext,
  props: { id: string; label: string; placeholder: string }
) {
  const container = new BoxRenderable(renderer, {
    id: `${props.id}-container`,
    flexDirection: "row",
    gap: 1,
  })

  container.add(new TextRenderable(renderer, {
    id: `${props.id}-label`,
    content: props.label,
  }))

  container.add(new InputRenderable(renderer, {
    id: `${props.id}-input`,
    placeholder: props.placeholder,
    width: 20,
  }))

  return container
}

// Declarative factory
function LabeledInput(props: { id: string; label: string; placeholder: string }) {
  return delegate(
    { focus: `${props.id}-input` },
    Box(
      { flexDirection: "row", gap: 1 },
      Text({ content: props.label }),
      Input({
        id: `${props.id}-input`,
        placeholder: props.placeholder,
        width: 20,
      }),
    ),
  )
}
```

### Focus Delegation

Route focus calls to nested elements:

```typescript
import { delegate, Box, Input, Text } from "@opentui/core"

const form = delegate(
  {
    focus: "email-input",     // Route .focus() to this child
    blur: "email-input",      // Route .blur() to this child
  },
  Box(
    { border: true, padding: 1 },
    Text({ content: "Email:" }),
    Input({ id: "email-input", placeholder: "you@example.com" }),
  ),
)

// This focuses the input inside, not the box
form.focus()
```

## Event Handling

### Keyboard Events

```typescript
const renderer = await createCliRenderer()

// Global keyboard handler
renderer.keyInput.on("keypress", (key) => {
  if (key.name === "escape") {
    renderer.destroy()
    process.exit(0)
  }

  if (key.ctrl && key.name === "c") {
    // Ctrl+C handling (if exitOnCtrlC is false)
  }

  if (key.name === "tab") {
    // Tab navigation
    focusNext()
  }
})

// Paste events
renderer.keyInput.on("paste", (event) => {
  const text = decodePasteBytes(event.bytes)
  currentInput?.setValue(currentInput.value + text)
})
```

### Component Events

```typescript
import { InputRenderable, InputRenderableEvents } from "@opentui/core"

const input = new InputRenderable(renderer, {
  id: "search",
  placeholder: "Search...",
})

input.on(InputRenderableEvents.CHANGE, (value) => {
  performSearch(value)
})

// Select events
const select = new SelectRenderable(renderer, {
  id: "menu",
  options: [...],
})

select.on(SelectRenderableEvents.ITEM_SELECTED, (index, option) => {
  handleSelection(option)
})

select.on(SelectRenderableEvents.SELECTION_CHANGED, (index, option) => {
  showPreview(option)
})
```

### Mouse Events

```typescript
const button = new BoxRenderable(renderer, {
  id: "button",
  border: true,
  onMouseDown: (event) => {
    button.setBackgroundColor("#444444")
  },
  onMouseUp: (event) => {
    button.setBackgroundColor("#222222")
    handleClick()
  },
  onMouseMove: (event) => {
    // Hover effect
  },
})
```

## State Management

### Local State

Manage state in closures or objects:

```typescript
// Closure-based state
function createCounter(renderer: RenderContext) {
  let count = 0

  const display = new TextRenderable(renderer, {
    id: "count",
    content: `Count: ${count}`,
  })

  const increment = () => {
    count++
    display.setContent(`Count: ${count}`)
  }

  return { display, increment }
}

// Class-based state
class CounterWidget {
  private count = 0
  private display: TextRenderable

  constructor(renderer: RenderContext) {
    this.display = new TextRenderable(renderer, {
      id: "count",
      content: this.formatCount(),
    })
  }

  private formatCount() {
    return `Count: ${this.count}`
  }

  increment() {
    this.count++
    this.display.setContent(this.formatCount())
  }

  getRenderable() {
    return this.display
  }
}
```

### Focus Management

Track and manage focus across components:

```typescript
class FocusManager {
  private focusables: Renderable[] = []
  private currentIndex = 0

  register(renderable: Renderable) {
    this.focusables.push(renderable)
  }

  focusNext() {
    this.focusables[this.currentIndex]?.blur()
    this.currentIndex = (this.currentIndex + 1) % this.focusables.length
    this.focusables[this.currentIndex]?.focus()
  }

  focusPrevious() {
    this.focusables[this.currentIndex]?.blur()
    this.currentIndex = (this.currentIndex - 1 + this.focusables.length) % this.focusables.length
    this.focusables[this.currentIndex]?.focus()
  }
}

// Usage
const focusManager = new FocusManager()
focusManager.register(input1)
focusManager.register(input2)
focusManager.register(select1)

renderer.keyInput.on("keypress", (key) => {
  if (key.name === "tab") {
    key.shift ? focusManager.focusPrevious() : focusManager.focusNext()
  }
})
```

## Lifecycle Patterns

### Cleanup

Always clean up resources:

```typescript
const renderer = await createCliRenderer()

// Track intervals/timeouts
const intervals: Timer[] = []

intervals.push(setInterval(() => {
  updateClock()
}, 1000))

// Cleanup on exit
process.on("SIGINT", () => {
  intervals.forEach(clearInterval)
  renderer.destroy()
  process.exit(0)
})

// Or use onDestroy callback
const renderer = await createCliRenderer({
  onDestroy: () => {
    intervals.forEach(clearInterval)
  },
})
```

### Dynamic Updates

Update UI based on external data:

```typescript
async function createDashboard(renderer: RenderContext) {
  const statsText = new TextRenderable(renderer, {
    id: "stats",
    content: "Loading...",
  })

  // Poll for updates
  const updateStats = async () => {
    const data = await fetchStats()
    statsText.setContent(`CPU: ${data.cpu}% | Memory: ${data.memory}%`)
  }

  // Initial load
  await updateStats()

  // Periodic updates
  setInterval(updateStats, 5000)

  return statsText
}
```

## Layout Patterns

### Responsive Layout

Adapt to terminal size:

```typescript
const renderer = await createCliRenderer()

const mainPanel = new BoxRenderable(renderer, {
  id: "main",
  width: "100%",
  height: "100%",
  flexDirection: renderer.width > 80 ? "row" : "column",
})

// Listen for resize
process.stdout.on("resize", () => {
  mainPanel.setFlexDirection(renderer.width > 80 ? "row" : "column")
})
```

### Split Panels

```typescript
function createSplitView(renderer: RenderContext, ratio = 0.3) {
  const container = new BoxRenderable(renderer, {
    id: "split",
    flexDirection: "row",
    width: "100%",
    height: "100%",
  })

  const left = new BoxRenderable(renderer, {
    id: "left",
    width: `${ratio * 100}%`,
    border: true,
  })

  const right = new BoxRenderable(renderer, {
    id: "right",
    flexGrow: 1,
    border: true,
  })

  container.add(left)
  container.add(right)

  return { container, left, right }
}
```

## Debugging Patterns

### Console Overlay

Use the built-in console for debugging:

```typescript
const renderer = await createCliRenderer({
  consoleOptions: {
    startInDebugMode: true,
  },
})

// Show console
renderer.console.show()

// All console methods work
console.log("Debug info")
console.warn("Warning")
console.error("Error")

// Toggle with keyboard
renderer.keyInput.on("keypress", (key) => {
  if (key.name === "f12") {
    renderer.console.toggle()
  }
})
```

### State Inspection

```typescript
function debugState(label: string, state: unknown) {
  console.log(`[${label}]`, JSON.stringify(state, null, 2))
}

// In your update logic
debugState("form", { name: nameInput.value, email: emailInput.value })
```
