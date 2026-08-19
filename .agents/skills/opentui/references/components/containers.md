# Container Components

Components for grouping and organizing content in OpenTUI.

## Box Component

The primary container component with borders, backgrounds, and layout capabilities.

### Basic Usage

```tsx
// React/Solid
<box>
  <text>Content inside box</text>
</box>

// Core
const box = new BoxRenderable(renderer, {
  id: "container",
})
box.add(child)
```

### Borders

```tsx
<box border>
  Simple border
</box>

<box
  border
  borderStyle="single"    // single | double | rounded | bold | none
  borderColor="#FFFFFF"
>
  Styled border
</box>

// Individual borders
<box
  borderTop
  borderBottom
  borderLeft={false}
  borderRight={false}
>
  Top and bottom only
</box>
```

**Border Styles:**

| Style | Appearance |
|-------|------------|
| `single` | `┌─┐│ │└─┘` |
| `double` | `╔═╗║ ║╚═╝` |
| `rounded` | `╭─╮│ │╰─╯` |
| `bold` | `┏━┓┃ ┃┗━┛` |

### Title

```tsx
<box
  border
  title="Settings"
  titleAlignment="center"   // left | center | right
>
  Panel content
</box>
```

### Background

```tsx
<box backgroundColor="#1a1a2e">
  Dark background
</box>

<box backgroundColor="transparent">
  No background
</box>
```

### Layout

Boxes are flex containers by default:

```tsx
<box
  flexDirection="row"       // row | column | row-reverse | column-reverse
  justifyContent="center"   // flex-start | flex-end | center | space-between | space-around
  alignItems="center"       // flex-start | flex-end | center | stretch | baseline
  gap={2}                   // Space between children
>
  <text>Item 1</text>
  <text>Item 2</text>
</box>
```

### Spacing

```tsx
<box
  padding={2}               // All sides
  paddingTop={1}
  paddingRight={2}
  paddingBottom={1}
  paddingLeft={2}
  paddingX={2}              // Horizontal (left + right)
  paddingY={1}              // Vertical (top + bottom)
  margin={1}
  marginTop={1}
  marginX={2}               // Horizontal (left + right)
  marginY={1}               // Vertical (top + bottom)
>
  Spaced content
</box>
```

### Dimensions

```tsx
<box
  width={40}                // Fixed width
  height={10}               // Fixed height
  width="50%"               // Percentage of parent
  minWidth={20}             // Minimum width
  maxWidth={80}             // Maximum width
  flexGrow={1}              // Grow to fill space
>
  Sized box
</box>
```

### Mouse Events

```tsx
<box
  onMouseDown={(event) => {
    console.log("Clicked at:", event.x, event.y)
  }}
  onMouseUp={(event) => {}}
  onMouseMove={(event) => {}}
>
  Clickable box
</box>
```

### Focusable Boxes

By default, Box elements are not focusable. Set the `focusable` prop to enable focus behavior:

```tsx
// Make a box focusable - it can receive focus via mouse click
<box focusable border>
  <text>Click to focus</text>
</box>

// Controlled focus state
const [focused, setFocused] = useState(false)

<box
  focusable
  focused={focused}
  border
  borderColor={focused ? "#00ff00" : "#888"}
>
  <text>{focused ? "Focused!" : "Not focused"}</text>
</box>
```

When a focusable Box is clicked, focus bubbles up from the click target to the nearest focusable parent. Use `event.preventDefault()` in `onMouseDown` to prevent auto-focus.

## ScrollBox Component

A scrollable container for content that exceeds the viewport.

### Basic Usage

```tsx
// React
<scrollbox height={10}>
  {items.map((item, i) => (
    <text key={i}>{item}</text>
  ))}
</scrollbox>

// Solid
<scrollbox height={10}>
  <For each={items()}>
    {(item) => <text>{item}</text>}
  </For>
</scrollbox>

// Core
const scrollbox = new ScrollBoxRenderable(renderer, {
  id: "list",
  height: 10,
})
items.forEach(item => {
  scrollbox.add(new TextRenderable(renderer, { content: item }))
})
```

### Focus for Keyboard Scrolling

```tsx
<scrollbox focused height={20}>
  {/* Use arrow keys to scroll */}
</scrollbox>
```

### Scrollbar Styling

```tsx
// React
<scrollbox
  style={{
    rootOptions: {
      backgroundColor: "#24283b",
    },
    wrapperOptions: {
      backgroundColor: "#1f2335",
    },
    viewportOptions: {
      backgroundColor: "#1a1b26",
    },
    contentOptions: {
      backgroundColor: "#16161e",
    },
    scrollbarOptions: {
      showArrows: true,
      trackOptions: {
        foregroundColor: "#7aa2f7",
        backgroundColor: "#414868",
      },
    },
  }}
>
  {content}
</scrollbox>
```

### Scroll Position (Core)

```typescript
const scrollbox = new ScrollBoxRenderable(renderer, {
  id: "list",
  height: 20,
})

// Scroll programmatically
scrollbox.scrollTo(0)           // Scroll to top
scrollbox.scrollTo(100)         // Scroll to position
scrollbox.scrollBy(10)          // Scroll relative
scrollbox.scrollToBottom()      // Scroll to end

// Scroll a child into view (nearest alignment)
scrollbox.scrollChildIntoView("child-id")  // Searches descendants by ID
```

`scrollChildIntoView(childId)` scrolls the minimum amount needed to make the identified descendant visible. It mirrors `Element.scrollIntoView({ block: "nearest" })` from the CSSOM View spec. Works with nested descendants and handles both horizontal and vertical scrolling.

## Composition Patterns

### Card Component

```tsx
function Card({ title, children }) {
  return (
    <box
      border
      borderStyle="rounded"
      padding={2}
      marginBottom={1}
    >
      {title && (
        <text fg="#00FFFF" bold>
          {title}
        </text>
      )}
      <box marginTop={title ? 1 : 0}>
        {children}
      </box>
    </box>
  )
}
```

### Panel Component

```tsx
function Panel({ title, children, width = 40 }) {
  return (
    <box
      border
      borderStyle="double"
      width={width}
      backgroundColor="#1a1a2e"
    >
      {title && (
        <box
          borderBottom
          padding={1}
          backgroundColor="#2a2a4e"
        >
          <text bold>{title}</text>
        </box>
      )}
      <box padding={2}>
        {children}
      </box>
    </box>
  )
}
```

### List Container

```tsx
function List({ items, renderItem }) {
  return (
    <scrollbox height={15} focused>
      {items.map((item, i) => (
        <box
          key={i}
          padding={1}
          backgroundColor={i % 2 === 0 ? "#222" : "#333"}
        >
          {renderItem(item, i)}
        </box>
      ))}
    </scrollbox>
  )
}
```

## Nesting Containers

```tsx
<box flexDirection="column" height="100%">
  {/* Header */}
  <box height={3} border>
    <text>Header</text>
  </box>

  {/* Main area with sidebar */}
  <box flexDirection="row" flexGrow={1}>
    <box width={20} border>
      <text>Sidebar</text>
    </box>
    <box flexGrow={1}>
      <scrollbox height="100%">
        {/* Scrollable content */}
      </scrollbox>
    </box>
  </box>

  {/* Footer */}
  <box height={1}>
    <text>Footer</text>
  </box>
</box>
```

## Gotchas

### Percentage Dimensions Need Parent Size

```tsx
// WRONG - parent has no explicit size
<box>
  <box width="50%">Won't work</box>
</box>

// CORRECT
<box width="100%">
  <box width="50%">Works</box>
</box>
```

### FlexGrow Needs Sized Parent

```tsx
// WRONG
<box>
  <box flexGrow={1}>Won't grow</box>
</box>

// CORRECT
<box height="100%">
  <box flexGrow={1}>Will grow</box>
</box>
```

### ScrollBox Needs Height

```tsx
// WRONG - no height constraint
<scrollbox>
  {items}
</scrollbox>

// CORRECT
<scrollbox height={20}>
  {items}
</scrollbox>
```

### Borders Add to Size

Borders take up space inside the box:

```tsx
<box width={10} border>
  {/* Inner content area is 8 chars (10 - 2 for borders) */}
</box>
```
