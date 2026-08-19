# Solid API Reference

## Rendering

### render(node, rendererOrConfig?)

Renders a Solid component tree into a CLI renderer.

```tsx
import { render } from "@opentui/solid"

// Simple usage - creates renderer automatically
render(() => <App />)

// With config
render(() => <App />, {
  exitOnCtrlC: false,
  targetFPS: 60,
})

// With existing renderer
import { createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()
render(() => <App />, renderer)
```

### testRender(node, options?)

Create a test renderer for snapshots and tests.

```tsx
import { testRender } from "@opentui/solid"

const testSetup = await testRender(() => <App />, {
  width: 40,
  height: 10,
})

// Access test utilities
testSetup.snapshot()  // Get current render
testSetup.renderer    // Access renderer
```

### extend(components)

Register custom renderables as JSX intrinsic elements.

```tsx
import { extend } from "@opentui/solid"
import { CustomRenderable } from "./custom"

extend({
  custom: CustomRenderable,
})

// Now usable in JSX
<custom prop="value" />
```

### getComponentCatalogue()

Returns the current component catalogue.

```tsx
import { getComponentCatalogue } from "@opentui/solid"

const catalogue = getComponentCatalogue()
console.log(Object.keys(catalogue))
```

## Hooks

### useRenderer()

Access the OpenTUI renderer instance.

```tsx
import { useRenderer } from "@opentui/solid"
import { onMount } from "solid-js"

function App() {
  const renderer = useRenderer()

  onMount(() => {
    console.log(`Terminal: ${renderer.width}x${renderer.height}`)
    renderer.console.show()

    // Access theme mode (dark/light based on terminal settings)
    console.log(`Theme: ${renderer.themeMode}`)  // "dark" | "light" | null
  })

  return <text>Hello</text>
}

// Listen for theme mode changes
function ThemedApp() {
  const renderer = useRenderer()
  const [theme, setTheme] = createSignal(renderer.themeMode ?? "dark")

  onMount(() => {
    renderer.on("theme_mode", (mode: "dark" | "light") => setTheme(mode))
  })

  return (
    <box backgroundColor={theme() === "dark" ? "#1a1a2e" : "#ffffff"}>
      <text fg={theme() === "dark" ? "#fff" : "#000"}>
        Current theme: {theme()}
      </text>
    </box>
  )
}
```

### useKeyboard(handler, options?)

Handle keyboard events.

```tsx
import { useKeyboard, useRenderer } from "@opentui/solid"

function App() {
  const renderer = useRenderer()

  useKeyboard((key) => {
    if (key.name === "escape") {
      renderer.destroy()  // Never use process.exit() directly!
    }
    if (key.ctrl && key.name === "s") {
      saveDocument()
    }
  })

  return <text>Press ESC to exit</text>
}

// With release events
function GameControls() {
  const [pressed, setPressed] = createSignal(new Set<string>())

  useKeyboard(
    (event) => {
      setPressed(keys => {
        const newKeys = new Set(keys)
        if (event.eventType === "release") {
          newKeys.delete(event.name)
        } else {
          newKeys.add(event.name)
        }
        return newKeys
      })
    },
    { release: true }
  )

  return <text>Pressed: {Array.from(pressed()).join(", ")}</text>
}
```

### usePaste(handler)

Handle paste events. Receives a `PasteEvent` with raw bytes.

```tsx
import { usePaste } from "@opentui/solid"
import { decodePasteBytes } from "@opentui/core"

function PasteHandler() {
  usePaste((event) => {
    const text = decodePasteBytes(event.bytes)
    console.log("Pasted:", text)
  })

  return <text>Paste something</text>
}
```

### onResize(callback)

Handle terminal resize events.

```tsx
import { onResize } from "@opentui/solid"

function App() {
  onResize((width, height) => {
    console.log(`Resized to ${width}x${height}`)
  })

  return <text>Resize the terminal</text>
}
```

### useTerminalDimensions()

Get reactive terminal dimensions.

```tsx
import { useTerminalDimensions } from "@opentui/solid"

function ResponsiveLayout() {
  const dimensions = useTerminalDimensions()

  return (
    <box flexDirection={dimensions().width > 80 ? "row" : "column"}>
      <text>Width: {dimensions().width}</text>
      <text>Height: {dimensions().height}</text>
    </box>
  )
}
```

### onFocus(callback) / onBlur(callback)

Handle terminal window focus and blur events. Solid-only hooks.

```tsx
import { onFocus, onBlur } from "@opentui/solid"

function App() {
  onFocus(() => {
    console.log("Terminal window gained focus")
  })

  onBlur(() => {
    console.log("Terminal window lost focus")
  })

  return <text>Focus/blur tracking</text>
}
```

These hooks fire when the terminal emulator window gains or loses operating system focus. The renderer deduplicates events (won't re-emit the same focus state).

### useSelectionHandler(handler)

Handle text selection events. Fires when the user finishes a mouse selection (mouse-up). Solid-only hook - React does not have this.

```tsx
import { useSelectionHandler } from "@opentui/solid"
import type { Selection } from "@opentui/core"

function SelectableText() {
  const [selected, setSelected] = createSignal("")
  const renderer = useRenderer()

  useSelectionHandler((selection: Selection) => {
    const text = selection.getSelectedText()
    if (text) {
      setSelected(text)
      renderer.copyToClipboardOSC52(text)
    }
  })

  return (
    <box flexDirection="column">
      <text selectable>Select this text with your mouse</text>
      <text fg="#888">Selected: {selected()}</text>
    </box>
  )
}
```

The `Selection` object aggregates selected text from all selectable renderables in the tree. See `keyboard/REFERENCE.md` (selection) for full details on the selection API and traversal model.

### useTimeline(options?)

Create animations with the timeline system.

```tsx
import { useTimeline } from "@opentui/solid"
import { createSignal, onMount } from "solid-js"

function AnimatedBox() {
  const [width, setWidth] = createSignal(0)

  const timeline = useTimeline({
    duration: 2000,
    loop: false,
  })

  onMount(() => {
    timeline.add(
      { width: 0 },
      {
        width: 50,
        duration: 2000,
        ease: "easeOutQuad",
        onUpdate: (anim) => {
          setWidth(Math.round(anim.targets[0].width))
        },
      }
    )
  })

  return <box style={{ width: width(), height: 3, backgroundColor: "#6a5acd" }} />
}
```

## Components

### Text Component

```tsx
<text
  content="Hello"           // Or use children
  fg="#FFFFFF"              // Foreground color
  bg="#000000"              // Background color
  selectable={true}         // Allow text selection
>
  {/* Use nested modifier tags for styling */}
  <span fg="red">Red</span>
  <strong>Bold</strong>
  <em>Italic</em>
  <u>Underline</u>
  <br />
  <a href="https://...">Link</a>
</text>
```

> **Note**: Do NOT use `bold`, `italic`, `underline` as props on `<text>`. Use nested modifier tags like `<strong>`, `<em>`, `<u>` instead.

### Box Component

```tsx
<box
  // Borders
  border                    // Enable border
  borderStyle="single"      // single | double | rounded | bold
  borderColor="#FFFFFF"
  title="Title"
  titleAlignment="center"   // left | center | right

  // Colors
  backgroundColor="#1a1a2e"

  // Layout
  flexDirection="row"
  justifyContent="center"
  alignItems="center"
  gap={2}

  // Spacing
  padding={2}
  paddingX={2}              // Horizontal (left + right)
  paddingY={1}              // Vertical (top + bottom)
  margin={1}
  marginX={2}               // Horizontal (left + right)
  marginY={1}               // Vertical (top + bottom)

  // Dimensions
  width={40}
  height={10}
  flexGrow={1}

  // Focus
  focusable                 // Allow box to receive focus
  focused={isFocused()}     // Controlled focus state

  // Events
  onMouseDown={(e) => {}}
  onMouseUp={(e) => {}}
>
  {children}
</box>
```

### Scrollbox Component

```tsx
<scrollbox
  focused                   // Enable keyboard scrolling
  style={{
    scrollbarOptions: {
      showArrows: true,
      trackOptions: {
        foregroundColor: "#7aa2f7",
        backgroundColor: "#414868",
      },
    },
  }}
>
  <For each={items()}>
    {(item) => <text>{item}</text>}
  </For>
</scrollbox>
```

### Input Component

```tsx
<input
  value={value()}
  onInput={(newValue) => setValue(newValue)}
  placeholder="Enter text..."
  focused
  width={30}
/>
```

### Textarea Component

```tsx
<textarea
  value={text()}
  onInput={(newValue) => setText(newValue)}
  placeholder="Enter multiple lines..."
  focused
  width={40}
  height={10}
/>
```

### Select Component

```tsx
<select
  options={[
    { name: "Option 1", description: "First", value: "1" },
    { name: "Option 2", description: "Second", value: "2" },
  ]}
  onChange={(index, option) => setSelected(option)}
  selectedIndex={0}
  focused
/>
```

### Tab Select Component (Note: underscore)

```tsx
<tab_select
  options={[
    { name: "Home", description: "Dashboard" },
    { name: "Settings", description: "Configuration" },
  ]}
  onChange={(index, option) => setTab(option)}
  tabWidth={20}
  focused
/>
```

### ASCII Font Component (Note: underscore)

```tsx
<ascii_font
  text="TITLE"
  font="tiny"               // tiny | block | slick | shade
  color="#FFFFFF"
/>
```

### Code Component

```tsx
<code
  code={sourceCode}
  language="typescript"
/>
```

### Line Number Component (Note: underscore)

```tsx
<line_number
  code={sourceCode}
  language="typescript"
  startLine={1}
  highlightedLines={[5]}
/>
```

### Diff Component

```tsx
<diff
  oldCode={originalCode}
  newCode={modifiedCode}
  language="typescript"
  mode="unified"            // unified | split
  syncScroll                // Sync scroll between split view panes
/>
```

## Control Flow

Solid's control flow components work with OpenTUI:

### For

```tsx
import { For } from "solid-js"

<For each={items()}>
  {(item, index) => (
    <box key={index()}>
      <text>{item.name}</text>
    </box>
  )}
</For>
```

### Show

```tsx
import { Show } from "solid-js"

<Show when={isVisible()} fallback={<text>Hidden</text>}>
  <text>Visible content</text>
</Show>
```

### Switch/Match

```tsx
import { Switch, Match } from "solid-js"

<Switch>
  <Match when={status() === "loading"}>
    <text>Loading...</text>
  </Match>
  <Match when={status() === "error"}>
    <text fg="red">Error!</text>
  </Match>
  <Match when={status() === "success"}>
    <text fg="green">Success!</text>
  </Match>
</Switch>
```

### Index

```tsx
import { Index } from "solid-js"

<Index each={items()}>
  {(item, index) => (
    <text>{index}: {item().name}</text>
  )}
</Index>
```

## Special Components

### Portal

```tsx
import { Portal } from "@opentui/solid"

<Portal mount={targetNode}>
  <box>Portal content</box>
</Portal>
```

### Dynamic

```tsx
import { Dynamic } from "@opentui/solid"

<Dynamic
  component={isMultiline() ? "textarea" : "input"}
  placeholder="Enter text..."
  focused
/>
```
