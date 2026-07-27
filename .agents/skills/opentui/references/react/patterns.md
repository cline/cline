# React Patterns

## State Management

### Local State with useState

```tsx
import { useState } from "react"

function Counter() {
  const [count, setCount] = useState(0)

  return (
    <box flexDirection="row" gap={2}>
      <text>Count: {count}</text>
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

### Complex State with useReducer

```tsx
import { useReducer } from "react"

type State = {
  items: string[]
  selectedIndex: number
}

type Action =
  | { type: "ADD_ITEM"; item: string }
  | { type: "REMOVE_ITEM"; index: number }
  | { type: "SELECT"; index: number }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_ITEM":
      return { ...state, items: [...state.items, action.item] }
    case "REMOVE_ITEM":
      return {
        ...state,
        items: state.items.filter((_, i) => i !== action.index),
      }
    case "SELECT":
      return { ...state, selectedIndex: action.index }
  }
}

function ItemList() {
  const [state, dispatch] = useReducer(reducer, {
    items: [],
    selectedIndex: 0,
  })

  // Use state and dispatch...
}
```

### Context for Global State

```tsx
import { createContext, useContext, useState, ReactNode } from "react"

type Theme = "dark" | "light"

const ThemeContext = createContext<{
  theme: Theme
  setTheme: (theme: Theme) => void
} | null>(null)

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark")

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used within ThemeProvider")
  return context
}

// Usage
function App() {
  return (
    <ThemeProvider>
      <ThemedBox />
    </ThemeProvider>
  )
}

function ThemedBox() {
  const { theme } = useTheme()
  return (
    <box backgroundColor={theme === "dark" ? "#1a1a2e" : "#f0f0f0"}>
      <text fg={theme === "dark" ? "#fff" : "#000"}>
        Current theme: {theme}
      </text>
    </box>
  )
}
```

## Focus Management

### Focus State

```tsx
import { useState } from "react"
import { useKeyboard } from "@opentui/react"

function FocusableForm() {
  const [focusIndex, setFocusIndex] = useState(0)
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
      {fields.map((field, i) => (
        <input
          key={field}
          placeholder={`Enter ${field}...`}
          focused={i === focusIndex}
        />
      ))}
    </box>
  )
}
```

### Ref-based Focus

```tsx
import { useRef, useEffect } from "react"

function AutoFocusInput() {
  const inputRef = useRef<any>(null)

  useEffect(() => {
    // Focus on mount
    inputRef.current?.focus()
  }, [])

  return <input ref={inputRef} placeholder="Auto-focused" />
}
```

## Keyboard Navigation

### Global Shortcuts

```tsx
import { useKeyboard, useRenderer } from "@opentui/react"

function App() {
  const renderer = useRenderer()

  useKeyboard((key) => {
    // Quit on Escape or Ctrl+C - use renderer.destroy(), never process.exit()
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
      return
    }

    // Toggle help on ?
    if (key.name === "?" || (key.shift && key.name === "/")) {
      setShowHelp(h => !h)
    }

    // Vim-style navigation
    if (key.name === "j") moveDown()
    if (key.name === "k") moveUp()
  })

  return <box>{/* ... */}</box>
}
```

### Component-level Shortcuts

```tsx
function Editor() {
  const [mode, setMode] = useState<"normal" | "insert">("normal")

  useKeyboard((key) => {
    if (mode === "normal") {
      if (key.name === "i") setMode("insert")
      if (key.name === "escape") setMode("normal")
    } else {
      if (key.name === "escape") setMode("normal")
      // Handle text input in insert mode
    }
  })

  return (
    <box>
      <text>Mode: {mode}</text>
      <textarea focused={mode === "insert"} />
    </box>
  )
}
```

## Form Handling

### Controlled Inputs

```tsx
import { useState } from "react"

function LoginForm() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = () => {
    console.log("Login:", { username, password })
  }

  return (
    <box flexDirection="column" gap={1} padding={2} border>
      <text>Login</text>

      <box flexDirection="row" gap={1}>
        <text>Username:</text>
        <input
          value={username}
          onChange={setUsername}
          width={20}
        />
      </box>

      <box flexDirection="row" gap={1}>
        <text>Password:</text>
        <input
          value={password}
          onChange={setPassword}
          width={20}
        />
      </box>

      <box border onMouseDown={handleSubmit}>
        <text>Submit</text>
      </box>
    </box>
  )
}
```

### Form Validation

```tsx
function ValidatedForm() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")

  const validateEmail = (value: string) => {
    if (!value.includes("@")) {
      setError("Invalid email address")
    } else {
      setError("")
    }
    setEmail(value)
  }

  return (
    <box flexDirection="column" gap={1}>
      <input
        value={email}
        onChange={validateEmail}
        placeholder="Email"
      />
      {error && <text fg="red">{error}</text>}
    </box>
  )
}
```

## Responsive Design

### Terminal-size Responsive

```tsx
import { useTerminalDimensions } from "@opentui/react"

function ResponsiveLayout() {
  const { width } = useTerminalDimensions()

  // Stack vertically on narrow terminals
  const isNarrow = width < 80

  return (
    <box flexDirection={isNarrow ? "column" : "row"}>
      <box flexGrow={isNarrow ? 0 : 1} height={isNarrow ? 10 : "100%"}>
        <text>Sidebar</text>
      </box>
      <box flexGrow={1}>
        <text>Main Content</text>
      </box>
    </box>
  )
}
```

### Dynamic Layouts

```tsx
function DynamicGrid({ items }: { items: string[] }) {
  const { width } = useTerminalDimensions()
  const columns = Math.max(1, Math.floor(width / 20))

  return (
    <box flexDirection="row" flexWrap="wrap">
      {items.map((item, i) => (
        <box key={i} width={`${100 / columns}%`} padding={1}>
          <text>{item}</text>
        </box>
      ))}
    </box>
  )
}
```

## Async Data Loading

### Loading States

```tsx
import { useState, useEffect } from "react"

function DataDisplay() {
  const [data, setData] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("https://api.example.com/data")
        const json = await response.json()
        setData(json.items)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return <text>Loading...</text>
  }

  if (error) {
    return <text fg="red">Error: {error}</text>
  }

  return (
    <box flexDirection="column">
      {data?.map((item, i) => (
        <text key={i}>{item}</text>
      ))}
    </box>
  )
}
```

## Animation Patterns

### Simple Animations

```tsx
import { useState, useEffect } from "react"
import { useTimeline } from "@opentui/react"

function ProgressBar() {
  const [progress, setProgress] = useState(0)

  const timeline = useTimeline({ duration: 3000 })

  useEffect(() => {
    timeline.add(
      { value: 0 },
      {
        value: 100,
        duration: 3000,
        ease: "linear",
        onUpdate: (anim) => {
          setProgress(Math.round(anim.targets[0].value))
        },
      }
    )
  }, [])

  return (
    <box flexDirection="column" gap={1}>
      <text>Progress: {progress}%</text>
      <box width={50} height={1} backgroundColor="#333">
        <box
          width={`${progress}%`}
          height={1}
          backgroundColor="#00ff00"
        />
      </box>
    </box>
  )
}
```

### Interval-based Updates

```tsx
function Clock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return <text>{time.toLocaleTimeString()}</text>
}
```

## Component Composition

### Render Props

```tsx
function Focusable({
  children
}: {
  children: (focused: boolean) => React.ReactNode
}) {
  const [focused, setFocused] = useState(false)

  return (
    <box
      onMouseDown={() => setFocused(true)}
      onMouseUp={() => setFocused(false)}
    >
      {children(focused)}
    </box>
  )
}

// Usage
<Focusable>
  {(focused) => (
    <text fg={focused ? "#00ff00" : "#ffffff"}>
      {focused ? "Focused!" : "Click me"}
    </text>
  )}
</Focusable>
```

### Higher-Order Components

```tsx
function withBorder<P extends object>(
  Component: React.ComponentType<P>,
  borderStyle: string = "single"
) {
  return function BorderedComponent(props: P) {
    return (
      <box border borderStyle={borderStyle} padding={1}>
        <Component {...props} />
      </box>
    )
  }
}

// Usage
const BorderedText = withBorder(({ content }: { content: string }) => (
  <text>{content}</text>
))

<BorderedText content="Hello!" />
```
