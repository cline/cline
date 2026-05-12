# Solid Patterns

## Reactive State

### Signals

Basic reactive state with signals:

```tsx
import { createSignal } from "solid-js"

function Counter() {
  const [count, setCount] = createSignal(0)

  return (
    <box flexDirection="row" gap={2}>
      <text>Count: {count()}</text>
      <box border onMouseDown={() => setCount(c => c - 1)}>
        <text>-</text>
      </box>
      <box border onMouseDown={() => setCount(c => c + 1)}>
        <text>+</text>
      </box>
    </box>
  )
}
```

### Derived State

Compute values from signals:

```tsx
import { createSignal, createMemo } from "solid-js"

function PriceCalculator() {
  const [quantity, setQuantity] = createSignal(1)
  const [price, setPrice] = createSignal(9.99)

  // Derived value - only recalculates when dependencies change
  const total = createMemo(() => quantity() * price())
  const formatted = createMemo(() => `$${total().toFixed(2)}`)

  return (
    <box flexDirection="column">
      <text>Quantity: {quantity()}</text>
      <text>Price: ${price()}</text>
      <text>Total: {formatted()}</text>
    </box>
  )
}
```

### Effects

React to state changes:

```tsx
import { createSignal, createEffect, onCleanup } from "solid-js"

function AutoSave() {
  const [content, setContent] = createSignal("")

  createEffect(() => {
    const text = content()

    // Debounced save
    const timeout = setTimeout(() => {
      saveToFile(text)
    }, 1000)

    // Cleanup on next run or disposal
    onCleanup(() => clearTimeout(timeout))
  })

  return (
    <textarea
      value={content()}
      onInput={setContent}
      placeholder="Auto-saves after 1 second..."
    />
  )
}
```

## Stores

### createStore for Complex State

```tsx
import { createStore } from "solid-js/store"

interface AppState {
  user: { name: string; email: string } | null
  items: Array<{ id: number; name: string; done: boolean }>
  settings: { theme: "dark" | "light" }
}

function App() {
  const [state, setState] = createStore<AppState>({
    user: null,
    items: [],
    settings: { theme: "dark" },
  })

  const addItem = (name: string) => {
    setState("items", items => [
      ...items,
      { id: Date.now(), name, done: false }
    ])
  }

  const toggleItem = (id: number) => {
    setState("items", item => item.id === id, "done", done => !done)
  }

  const setTheme = (theme: "dark" | "light") => {
    setState("settings", "theme", theme)
  }

  return (
    <box backgroundColor={state.settings.theme === "dark" ? "#1a1a2e" : "#f0f0f0"}>
      <For each={state.items}>
        {(item) => (
          <text
            fg={item.done ? "#888" : "#fff"}
            onMouseDown={() => toggleItem(item.id)}
          >
            {item.done ? "[x]" : "[ ]"} {item.name}
          </text>
        )}
      </For>
    </box>
  )
}
```

### Store with Context

Share state across components:

```tsx
import { createStore } from "solid-js/store"
import { createContext, useContext, ParentComponent } from "solid-js"

interface Store {
  count: number
  items: string[]
}

type StoreContextValue = [
  Store,
  {
    increment: () => void
    addItem: (item: string) => void
  }
]

const StoreContext = createContext<StoreContextValue>()

const StoreProvider: ParentComponent = (props) => {
  const [state, setState] = createStore<Store>({
    count: 0,
    items: [],
  })

  const actions = {
    increment: () => setState("count", c => c + 1),
    addItem: (item: string) => setState("items", i => [...i, item]),
  }

  return (
    <StoreContext.Provider value={[state, actions]}>
      {props.children}
    </StoreContext.Provider>
  )
}

function useStore() {
  const context = useContext(StoreContext)
  if (!context) throw new Error("useStore must be used within StoreProvider")
  return context
}

// Usage
function Counter() {
  const [state, { increment }] = useStore()
  return (
    <box onMouseDown={increment}>
      <text>Count: {state.count}</text>
    </box>
  )
}
```

## Control Flow

### Conditional Rendering with Show

```tsx
import { Show, createSignal } from "solid-js"

function ToggleableContent() {
  const [visible, setVisible] = createSignal(false)

  return (
    <box flexDirection="column">
      <box border onMouseDown={() => setVisible(v => !v)}>
        <text>Toggle</text>
      </box>

      <Show
        when={visible()}
        fallback={<text fg="#888">Content is hidden</text>}
      >
        <text fg="#0f0">Content is visible!</text>
      </Show>
    </box>
  )
}
```

### Lists with For

```tsx
import { For, createSignal } from "solid-js"

function TodoList() {
  const [todos, setTodos] = createSignal([
    { id: 1, text: "Learn Solid", done: false },
    { id: 2, text: "Build TUI", done: false },
  ])

  const toggle = (id: number) => {
    setTodos(todos =>
      todos.map(t =>
        t.id === id ? { ...t, done: !t.done } : t
      )
    )
  }

  return (
    <box flexDirection="column">
      <For each={todos()}>
        {(todo) => (
          <box onMouseDown={() => toggle(todo.id)}>
            <text fg={todo.done ? "#888" : "#fff"}>
              {todo.done ? "[x]" : "[ ]"} {todo.text}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
```

### Index for Primitive Arrays

Use `Index` when array items are primitives:

```tsx
import { Index, createSignal } from "solid-js"

function StringList() {
  const [items, setItems] = createSignal(["apple", "banana", "cherry"])

  return (
    <box flexDirection="column">
      <Index each={items()}>
        {(item, index) => (
          <text>{index}: {item()}</text>
        )}
      </Index>
    </box>
  )
}
```

### Switch/Match for Multiple Conditions

```tsx
import { Switch, Match, createSignal } from "solid-js"

type Status = "idle" | "loading" | "success" | "error"

function StatusDisplay() {
  const [status, setStatus] = createSignal<Status>("idle")

  return (
    <Switch>
      <Match when={status() === "idle"}>
        <text>Ready</text>
      </Match>
      <Match when={status() === "loading"}>
        <text fg="#ff0">Loading...</text>
      </Match>
      <Match when={status() === "success"}>
        <text fg="#0f0">Success!</text>
      </Match>
      <Match when={status() === "error"}>
        <text fg="#f00">Error occurred</text>
      </Match>
    </Switch>
  )
}
```

## Focus Management

### Focus State

```tsx
import { createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"

function FocusableForm() {
  const [focusIndex, setFocusIndex] = createSignal(0)
  const fields = ["name", "email", "message"]

  useKeyboard((key) => {
    if (key.name === "tab") {
      setFocusIndex(i => (i + 1) % fields.length)
    }
    if (key.shift && key.name === "tab") {
      setFocusIndex(i => (i - 1 + fields.length) % fields.length)
    }
  })

  return (
    <box flexDirection="column" gap={1}>
      <Index each={fields}>
        {(field, i) => (
          <input
            placeholder={`Enter ${field()}...`}
            focused={i === focusIndex()}
          />
        )}
      </Index>
    </box>
  )
}
```

## Keyboard Navigation

### Global Shortcuts

```tsx
import { useKeyboard } from "@opentui/solid"

function App() {
  const renderer = useRenderer()

  useKeyboard((key) => {
    if (key.name === "escape") {
      renderer.destroy()  // Never use process.exit() directly!
    }

    if (key.ctrl && key.name === "s") {
      save()
    }

    // Vim-style
    if (key.name === "j") moveDown()
    if (key.name === "k") moveUp()
  })

  return <box>{/* ... */}</box>
}
```

## Responsive Design

### Terminal-size Responsive

```tsx
import { useTerminalDimensions } from "@opentui/solid"

function ResponsiveLayout() {
  const dims = useTerminalDimensions()

  return (
    <box flexDirection={dims().width > 80 ? "row" : "column"}>
      <box flexGrow={1}>
        <text>Panel 1</text>
      </box>
      <box flexGrow={1}>
        <text>Panel 2</text>
      </box>
    </box>
  )
}
```

## Async Data

### Resources

```tsx
import { createResource, Suspense } from "solid-js"

async function fetchData() {
  const response = await fetch("https://api.example.com/data")
  return response.json()
}

function DataDisplay() {
  const [data] = createResource(fetchData)

  return (
    <Suspense fallback={<text>Loading...</text>}>
      <Show when={data()}>
        {(items) => (
          <For each={items()}>
            {(item) => <text>{item.name}</text>}
          </For>
        )}
      </Show>
    </Suspense>
  )
}
```

### Error Handling

```tsx
import { createResource, Show, ErrorBoundary } from "solid-js"

function SafeDataDisplay() {
  const [data] = createResource(fetchData)

  return (
    <ErrorBoundary fallback={(err) => <text fg="red">Error: {err.message}</text>}>
      <Show
        when={!data.loading}
        fallback={<text>Loading...</text>}
      >
        <Show
          when={!data.error}
          fallback={<text fg="red">Failed to load</text>}
        >
          <For each={data()}>
            {(item) => <text>{item.name}</text>}
          </For>
        </Show>
      </Show>
    </ErrorBoundary>
  )
}
```

## Component Composition

### Props and Children

```tsx
import { ParentComponent, JSX } from "solid-js"

interface PanelProps {
  title: string
  children: JSX.Element
}

const Panel: ParentComponent<{ title: string }> = (props) => {
  return (
    <box border padding={1} flexDirection="column">
      <text fg="#0ff">{props.title}</text>
      <box marginTop={1}>
        {props.children}
      </box>
    </box>
  )
}

// Usage
<Panel title="Settings">
  <text>Panel content here</text>
</Panel>
```

### Spread Props

```tsx
import { splitProps } from "solid-js"

interface ButtonProps {
  label: string
  onClick: () => void
  // ...rest goes to box
}

function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["label", "onClick"])

  return (
    <box border onMouseDown={local.onClick} {...rest}>
      <text>{local.label}</text>
    </box>
  )
}
```

## Animation

### With Timeline

```tsx
import { createSignal, onMount } from "solid-js"
import { useTimeline } from "@opentui/solid"

function AnimatedProgress() {
  const [width, setWidth] = createSignal(0)

  const timeline = useTimeline({
    duration: 2000,
  })

  onMount(() => {
    timeline.add(
      { value: 0 },
      {
        value: 50,
        duration: 2000,
        ease: "easeOutQuad",
        onUpdate: (anim) => {
          setWidth(Math.round(anim.targets[0].value))
        },
      }
    )
  })

  return (
    <box flexDirection="column" gap={1}>
      <text>Progress: {width()}%</text>
      <box width={50} height={1} backgroundColor="#333">
        <box width={width()} height={1} backgroundColor="#0f0" />
      </box>
    </box>
  )
}
```

### Interval-based

```tsx
import { createSignal, onCleanup } from "solid-js"

function Clock() {
  const [time, setTime] = createSignal(new Date())

  const interval = setInterval(() => {
    setTime(new Date())
  }, 1000)

  onCleanup(() => clearInterval(interval))

  return <text>{time().toLocaleTimeString()}</text>
}
```
