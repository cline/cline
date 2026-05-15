# Solid Gotchas

## Critical

### Never use `process.exit()` directly

**This is the most common mistake.** Using `process.exit()` leaves the terminal in a broken state (cursor hidden, raw mode, alternate screen).

```tsx
// WRONG - Terminal left in broken state
process.exit(0)

// CORRECT - Use renderer.destroy()
import { useRenderer } from "@opentui/solid"

function App() {
  const renderer = useRenderer()

  const handleExit = () => {
    renderer.destroy()  // Cleans up and exits properly
  }
}
```

`renderer.destroy()` restores the terminal (exits alternate screen, restores cursor, etc.) before exiting.

## Configuration Issues

### Missing bunfig.toml

**Symptom**: JSX syntax errors, components not rendering

```
SyntaxError: Unexpected token '<'
```

**Fix**: Create `bunfig.toml` in project root:

```toml
preload = ["@opentui/solid/preload"]
```

### Wrong JSX Settings

**Symptom**: JSX compiles to React, errors about React not found

**Fix**: Ensure tsconfig.json has:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

### Build Without Plugin

**Symptom**: Built bundle has raw JSX

**Fix**: Add Solid plugin to build:

```typescript
import solidPlugin from "@opentui/solid/bun-plugin"

await Bun.build({
  // ...
  plugins: [solidPlugin],
})
```

## Reactivity Issues

### Accessing Signals Without Calling

**Symptom**: Value never updates, shows `[Function]`

```tsx
// WRONG - Missing ()
const [count, setCount] = createSignal(0)
<text>Count: {count}</text>  // Shows [Function]

// CORRECT
<text>Count: {count()}</text>
```

### Breaking Reactivity with Destructuring

**Symptom**: Props stop being reactive

```tsx
// WRONG - Breaks reactivity
function Component(props: { value: number }) {
  const { value } = props  // Destructured once, never updates!
  return <text>{value}</text>
}

// CORRECT - Keep props reactive
function Component(props: { value: number }) {
  return <text>{props.value}</text>
}

// OR use splitProps
function Component(props: { value: number; other: string }) {
  const [local, rest] = splitProps(props, ["value"])
  return <text>{local.value}</text>
}
```

### Effects Not Running

**Symptom**: createEffect doesn't trigger

```tsx
// WRONG - Signal not accessed in effect
const [count, setCount] = createSignal(0)

createEffect(() => {
  console.log("Count changed")  // Never runs after initial!
})

// CORRECT - Access the signal
createEffect(() => {
  console.log("Count:", count())  // Runs when count changes
})
```

## HTML Entity Decoding

Solid's reconciler automatically decodes HTML entities in JSX text content. This means `&lt;`, `&gt;`, `&amp;`, etc. render as their literal characters:

```tsx
// These render correctly in Solid
<text>Use &lt;box&gt; for containers</text>  // Displays: Use <box> for containers
<text>A &amp; B</text>                        // Displays: A & B
```

This applies to text nodes, the `content` prop, and the `text` prop.

## Component Naming

### Underscore vs Hyphen

Solid uses underscores for multi-word component names:

```tsx
// WRONG - React-style naming
<tab-select />    // Error!
<ascii-font />    // Error!
<line-number />   // Error!

// CORRECT - Solid naming
<tab_select />
<ascii_font />
<line_number />
```

**Component mapping:**
| Concept | React | Solid |
|---------|-------|-------|
| Tab Select | `<tab-select>` | `<tab_select>` |
| ASCII Font | `<ascii-font>` | `<ascii_font>` |
| Line Number | `<line-number>` | `<line_number>` |

## Focus Issues

### Focus Not Working

Components need explicit focus:

```tsx
// WRONG
<input placeholder="Type here..." />

// CORRECT
<input placeholder="Type here..." focused />
```

### Select Not Responding

```tsx
// WRONG
<select options={["a", "b"]} />

// CORRECT
<select
  options={[
    { name: "A", description: "Option A", value: "a" },
    { name: "B", description: "Option B", value: "b" },
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
  options={options()}
  onChange={(i, opt) => submitForm(opt)}  // This fires on arrow keys!
/>

// CORRECT
<select
  options={options()}
  onSelect={(i, opt) => submitForm(opt)}   // Enter pressed - submit
  onChange={(i, opt) => showPreview(opt)}  // Arrow keys - preview
/>
```

## Control Flow Issues

### For vs Index

Use `For` for arrays of objects, `Index` for primitives:

```tsx
// For objects - item is reactive
<For each={objects()}>
  {(obj) => <text>{obj.name}</text>}
</For>

// For primitives - use Index, item() is reactive
<Index each={strings()}>
  {(str, index) => <text>{index}: {str()}</text>}
</Index>
```

### Missing Fallback

Show requires fallback for proper rendering:

```tsx
// May cause issues
<Show when={data()}>
  <Component />
</Show>

// Better - explicit fallback
<Show when={data()} fallback={<text>Loading...</text>}>
  <Component />
</Show>
```

## Cleanup Issues

### Forgetting onCleanup

**Symptom**: Memory leaks, multiple intervals running

```tsx
// WRONG - Interval never cleared
function Timer() {
  const [time, setTime] = createSignal(0)

  setInterval(() => setTime(t => t + 1), 1000)

  return <text>{time()}</text>
}

// CORRECT
function Timer() {
  const [time, setTime] = createSignal(0)

  const interval = setInterval(() => setTime(t => t + 1), 1000)
  onCleanup(() => clearInterval(interval))

  return <text>{time()}</text>
}
```

### Effect Cleanup

```tsx
createEffect(() => {
  const subscription = subscribe(data())

  // WRONG - No cleanup
  // subscription stays active

  // CORRECT
  onCleanup(() => subscription.unsubscribe())
})
```

## Store Issues

### Mutating Store Directly

**Symptom**: Changes don't trigger updates

```tsx
const [state, setState] = createStore({ items: [] })

// WRONG - Direct mutation
state.items.push(newItem)  // Won't trigger updates!

// CORRECT - Use setState
setState("items", items => [...items, newItem])
```

### Nested Updates

```tsx
const [state, setState] = createStore({
  user: { profile: { name: "John" } }
})

// WRONG
state.user.profile.name = "Jane"

// CORRECT
setState("user", "profile", "name", "Jane")
```

## Debugging

### Console Not Visible

OpenTUI captures console output:

```tsx
import { useRenderer } from "@opentui/solid"
import { onMount } from "solid-js"

function App() {
  const renderer = useRenderer()

  onMount(() => {
    renderer.console.show()
    console.log("Now visible!")
  })

  return <box>{/* ... */}</box>
}
```

### Tracking Reactivity

Use `createEffect` to debug:

```tsx
createEffect(() => {
  console.log("State:", {
    count: count(),
    items: items(),
  })
})
```

## Runtime Issues

### Use Bun

```bash
# WRONG
node src/index.tsx
npm run start

# CORRECT
bun run src/index.tsx
bun run start
```

### Async render()

The render function is async when creating a renderer:

```tsx
// This is fine - Bun supports top-level await
render(() => <App />)

// If you need the renderer
import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"

const renderer = await createCliRenderer()
render(() => <App />, renderer)
```

## Common Error Messages

### "Cannot read properties of undefined"

Usually a missing reactive access:

```tsx
// Check if signal is being called
<text>{count()}</text>  // Note the ()

// Check if props are being accessed correctly
<text>{props.value}</text>  // Not destructured
```

### "JSX element has no corresponding closing tag"

Check component naming:

```tsx
// Wrong
<tab-select></tab-select>

// Correct
<tab_select></tab_select>
```

### "store is not a function"

Stores aren't called like signals:

```tsx
const [store, setStore] = createStore({ count: 0 })

// WRONG
<text>{store().count}</text>

// CORRECT
<text>{store.count}</text>
```
