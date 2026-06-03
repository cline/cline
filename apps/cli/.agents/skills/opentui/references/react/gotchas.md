# React Gotchas

## Critical

### Never use `process.exit()` directly

**This is the most common mistake.** Using `process.exit()` leaves the terminal in a broken state (cursor hidden, raw mode, alternate screen).

```tsx
// WRONG - Terminal left in broken state
process.exit(0)

// CORRECT - Use renderer.destroy()
import { useRenderer } from "@opentui/react"

function App() {
  const renderer = useRenderer()

  const handleExit = () => {
    renderer.destroy()  // Cleans up and exits properly
  }
}
```

`renderer.destroy()` restores the terminal (exits alternate screen, restores cursor, etc.) before exiting.

### Signal Handling

OpenTUI automatically handles cleanup for these signals:
- `SIGINT` (Ctrl+C), `SIGTERM`, `SIGQUIT` - Standard termination
- `SIGHUP` - Terminal closed/hangup
- `SIGBREAK` - Ctrl+Break (Windows)
- `SIGPIPE` - Broken pipe (output closed)
- `SIGBUS`, `SIGFPE` - Hardware errors

This ensures terminal state is restored even on unexpected termination. If you need custom signal handling, use `exitOnCtrlC: false` and handle signals yourself while still calling `renderer.destroy()`.

## JSX Configuration

### Missing jsxImportSource

**Symptom**: JSX elements have wrong types, components don't render

```
// Error: Property 'text' does not exist on type 'JSX.IntrinsicElements'
```

**Fix**: Configure tsconfig.json:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@opentui/react"
  }
}
```

### HTML Elements vs TUI Elements

OpenTUI's JSX elements are **not** HTML elements:

```tsx
// WRONG - These are HTML concepts
<div>Not supported</div>
<button>Not supported</button>
<span>Only works inside <text></span>

// CORRECT - OpenTUI elements
<box>Container</box>
<text>Display text</text>
<text><span>Inline styled</span></text>
```

## Component Issues

### Text Modifiers Outside Text

Text modifiers only work inside `<text>`:

```tsx
// WRONG
<box>
  <strong>This won't work</strong>
</box>

// CORRECT
<box>
  <text>
    <strong>This works</strong>
  </text>
</box>
```

### Focus Not Working

Components must be explicitly focused:

```tsx
// WRONG - Won't receive keyboard input
<input placeholder="Type here..." />

// CORRECT
<input placeholder="Type here..." focused />

// Or manage focus state
const [isFocused, setIsFocused] = useState(true)
<input placeholder="Type here..." focused={isFocused} />
```

### Select Not Responding

Select requires focus and proper options format:

```tsx
// WRONG - Missing required properties
<select options={["a", "b", "c"]} />

// CORRECT
<select
  options={[
    { name: "Option A", description: "First option", value: "a" },
    { name: "Option B", description: "Second option", value: "b" },
  ]}
  onSelect={(index, option) => {
    // Called when Enter is pressed
    console.log("Selected:", option.name)
  }}
  focused
/>
```

### Select Events Confusion

Remember: `onSelect` fires on Enter (selection confirmed), `onChange` fires on navigation:

```tsx
// WRONG - expecting onChange to fire on Enter
<select
  options={options}
  onChange={(i, opt) => submitForm(opt)}  // This fires on arrow keys!
/>

// CORRECT
<select
  options={options}
  onSelect={(i, opt) => submitForm(opt)}   // Enter pressed - submit
  onChange={(i, opt) => showPreview(opt)}  // Arrow keys - preview
/>
```

## Hook Issues

### useKeyboard Not Firing

Multiple `useKeyboard` hooks can conflict:

```tsx
// Both handlers fire - may cause issues
function App() {
  useKeyboard((key) => { /* parent handler */ })
  return <ChildWithKeyboard />
}

function ChildWithKeyboard() {
  useKeyboard((key) => { /* child handler */ })
  return <text>Child</text>
}
```

**Solution**: Use a single keyboard handler or implement event stopping:

```tsx
function App() {
  const [handled, setHandled] = useState(false)

  useKeyboard((key) => {
    if (handled) {
      setHandled(false)
      return
    }
    // Handle at app level
  })

  return <Child onKeyHandled={() => setHandled(true)} />
}
```

### useEffect Cleanup

Always clean up intervals and listeners:

```tsx
// WRONG - Memory leak
useEffect(() => {
  setInterval(() => updateData(), 1000)
}, [])

// CORRECT
useEffect(() => {
  const interval = setInterval(() => updateData(), 1000)
  return () => clearInterval(interval)  // Cleanup!
}, [])
```

## Styling Issues

### Colors Not Applying

Check color format:

```tsx
// CORRECT formats
<text fg="#FF0000">Red</text>
<text fg="red">Red</text>
<box backgroundColor="#1a1a2e">Box</box>

// WRONG
<text fg="FF0000">Missing #</text>
<text color="#FF0000">Wrong prop name (use fg)</text>
```

### Layout Not Working

Ensure parent has dimensions:

```tsx
// WRONG - Parent has no height
<box flexDirection="column">
  <box flexGrow={1}>Won't grow</box>
</box>

// CORRECT
<box flexDirection="column" height="100%">
  <box flexGrow={1}>Will grow</box>
</box>
```

### Percentage Widths Not Working

Parent must have explicit dimensions:

```tsx
// WRONG
<box>
  <box width="50%">Won't work</box>
</box>

// CORRECT
<box width="100%">
  <box width="50%">Works</box>
</box>
```

## Performance Issues

### Too Many Re-renders

Avoid inline objects/functions in props:

```tsx
// WRONG - New object every render
<box style={{ padding: 2 }}>Content</box>

// BETTER - Use direct props
<box padding={2}>Content</box>

// OR memoize style objects
const style = useMemo(() => ({ padding: 2 }), [])
<box style={style}>Content</box>
```

### Heavy Components

Use React.memo for expensive components:

```tsx
const ExpensiveList = React.memo(function ExpensiveList({
  items
}: {
  items: Item[]
}) {
  return (
    <box flexDirection="column">
      {items.map(item => (
        <text key={item.id}>{item.name}</text>
      ))}
    </box>
  )
})
```

### State Updates During Render

Don't update state during render:

```tsx
// WRONG
function Component({ value }: { value: number }) {
  const [count, setCount] = useState(0)

  // This causes infinite loop!
  if (value > 10) {
    setCount(value)
  }

  return <text>{count}</text>
}

// CORRECT
function Component({ value }: { value: number }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (value > 10) {
      setCount(value)
    }
  }, [value])

  return <text>{count}</text>
}
```

## Debugging

### Console Not Visible

OpenTUI captures console output. Show the overlay:

```tsx
import { useRenderer } from "@opentui/react"
import { useEffect } from "react"

function App() {
  const renderer = useRenderer()

  useEffect(() => {
    renderer.console.show()
    console.log("Now you can see this!")
  }, [renderer])

  return <box>{/* ... */}</box>
}
```

### Component Not Rendering

Check if component is in the tree:

```tsx
// WRONG - Conditional returns nothing
function MaybeComponent({ show }: { show: boolean }) {
  if (!show) return  // Returns undefined!
  return <text>Visible</text>
}

// CORRECT
function MaybeComponent({ show }: { show: boolean }) {
  if (!show) return null  // Explicit null
  return <text>Visible</text>
}
```

### Events Not Firing

Check event handler names:

```tsx
// WRONG
<box onClick={() => {}}>Click</box>  // No onClick in TUI

// CORRECT
<box onMouseDown={() => {}}>Click</box>
<box onMouseUp={() => {}}>Click</box>
```

## Runtime Issues

### Use Bun, Not Node

```bash
# WRONG
node src/index.tsx
npm run start

# CORRECT
bun run src/index.tsx
bun run start
```

### Async Top-level

Bun supports top-level await, but be careful:

```tsx
// index.tsx - This works in Bun
const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)

// If you need to handle errors
try {
  const renderer = await createCliRenderer()
  createRoot(renderer).render(<App />)
} catch (error) {
  console.error("Failed to initialize:", error)
  process.exit(1)
}
```

## Common Error Messages

### "Cannot read properties of undefined (reading 'root')"

Renderer not initialized:

```tsx
// WRONG
const renderer = createCliRenderer()  // Missing await!
createRoot(renderer).render(<App />)

// CORRECT
const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

### "Invalid hook call"

Hooks called outside component:

```tsx
// WRONG
const dimensions = useTerminalDimensions()  // Outside component!

function App() {
  return <text>{dimensions.width}</text>
}

// CORRECT
function App() {
  const dimensions = useTerminalDimensions()
  return <text>{dimensions.width}</text>
}
```
