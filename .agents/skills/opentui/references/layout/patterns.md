# Layout Patterns

Common layout recipes for terminal user interfaces.

## Full-Screen App

Fill the entire terminal:

```tsx
function App() {
  return (
    <box width="100%" height="100%">
      {/* Content fills terminal */}
    </box>
  )
}
```

## Header/Content/Footer

Classic app layout:

```tsx
function AppLayout() {
  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header - fixed height */}
      <box height={3} borderStyle="single" borderBottom>
        <text>Header</text>
      </box>

      {/* Content - fills remaining space */}
      <box flexGrow={1}>
        <text>Main Content</text>
      </box>

      {/* Footer - fixed height */}
      <box height={1}>
        <text>Status: Ready</text>
      </box>
    </box>
  )
}
```

## Sidebar Layout

```tsx
function SidebarLayout() {
  return (
    <box flexDirection="row" width="100%" height="100%">
      {/* Sidebar - fixed width */}
      <box width={25} borderStyle="single" borderRight>
        <text>Sidebar</text>
      </box>

      {/* Main - fills remaining space */}
      <box flexGrow={1}>
        <text>Main Content</text>
      </box>
    </box>
  )
}
```

## Resizable Sidebar

Responsive based on terminal width:

```tsx
function ResponsiveSidebar() {
  const dims = useTerminalDimensions()  // React: useTerminalDimensions()
  const showSidebar = dims.width > 60
  const sidebarWidth = Math.min(30, Math.floor(dims.width * 0.3))

  return (
    <box flexDirection="row" width="100%" height="100%">
      {showSidebar && (
        <box width={sidebarWidth} border>
          <text>Sidebar</text>
        </box>
      )}
      <box flexGrow={1}>
        <text>Main</text>
      </box>
    </box>
  )
}
```

## Centered Content

### Horizontally Centered

```tsx
<box width="100%" justifyContent="center">
  <box width={40}>
    <text>Centered horizontally</text>
  </box>
</box>
```

### Vertically Centered

```tsx
<box height="100%" alignItems="center">
  <text>Centered vertically</text>
</box>
```

### Both Axes

```tsx
<box
  width="100%"
  height="100%"
  justifyContent="center"
  alignItems="center"
>
  <box width={40} height={10} border>
    <text>Centered both ways</text>
  </box>
</box>
```

## Modal/Dialog

Centered overlay:

```tsx
function Modal({ children, visible }) {
  if (!visible) return null

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      backgroundColor="rgba(0,0,0,0.5)"
    >
      <box
        width={50}
        height={15}
        border
        borderStyle="double"
        backgroundColor="#1a1a2e"
        padding={2}
      >
        {children}
      </box>
    </box>
  )
}
```

## Grid Layout

Using flexWrap:

```tsx
function Grid({ items, columns = 3 }) {
  const itemWidth = `${Math.floor(100 / columns)}%`

  return (
    <box flexDirection="row" flexWrap="wrap" width="100%">
      {items.map((item, i) => (
        <box key={i} width={itemWidth} padding={1}>
          <text>{item}</text>
        </box>
      ))}
    </box>
  )
}
```

## Split Panels

### Horizontal Split

```tsx
function HorizontalSplit({ ratio = 0.5 }) {
  return (
    <box flexDirection="row" width="100%" height="100%">
      <box width={`${ratio * 100}%`} border>
        <text>Left Panel</text>
      </box>
      <box flexGrow={1} border>
        <text>Right Panel</text>
      </box>
    </box>
  )
}
```

### Vertical Split

```tsx
function VerticalSplit({ ratio = 0.5 }) {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <box height={`${ratio * 100}%`} border>
        <text>Top Panel</text>
      </box>
      <box flexGrow={1} border>
        <text>Bottom Panel</text>
      </box>
    </box>
  )
}
```

## Form Layout

Label + Input pairs:

```tsx
function FormField({ label, children }) {
  return (
    <box flexDirection="row" marginBottom={1}>
      <box width={15}>
        <text>{label}:</text>
      </box>
      <box flexGrow={1}>
        {children}
      </box>
    </box>
  )
}

function LoginForm() {
  return (
    <box flexDirection="column" padding={2} border width={50}>
      <FormField label="Username">
        <input placeholder="Enter username" />
      </FormField>
      <FormField label="Password">
        <input placeholder="Enter password" />
      </FormField>
      <box marginTop={2} justifyContent="flex-end">
        <box border padding={1}>
          <text>Login</text>
        </box>
      </box>
    </box>
  )
}
```

## Navigation Tabs

```tsx
function TabBar({ tabs, activeIndex, onSelect }) {
  return (
    <box flexDirection="row" borderBottom>
      {tabs.map((tab, i) => (
        <box
          key={i}
          padding={1}
          backgroundColor={i === activeIndex ? "#333" : "transparent"}
          onMouseDown={() => onSelect(i)}
        >
          <text fg={i === activeIndex ? "#fff" : "#888"}>
            {tab}
          </text>
        </box>
      ))}
    </box>
  )
}
```

## Sticky Footer

Footer always at bottom:

```tsx
function StickyFooterLayout() {
  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Content area */}
      <box flexGrow={1} flexDirection="column">
        {/* Your content here */}
        <text>Content that might be short</text>
      </box>

      {/* Footer pushed to bottom */}
      <box height={1}>
        <text fg="#888">Press ? for help | q to quit</text>
      </box>
    </box>
  )
}
```

## Absolute Positioning Overlay

Tooltip or popup:

```tsx
function Tooltip({ x, y, children }) {
  return (
    <box
      position="absolute"
      left={x}
      top={y}
      border
      backgroundColor="#333"
      padding={1}
      zIndex={100}
    >
      {children}
    </box>
  )
}
```

## Responsive Breakpoints

Different layouts based on terminal size:

```tsx
function ResponsiveApp() {
  const { width, height } = useTerminalDimensions()

  // Define breakpoints
  const isSmall = width < 60
  const isMedium = width >= 60 && width < 100
  const isLarge = width >= 100

  if (isSmall) {
    // Mobile-like: stacked layout
    return (
      <box flexDirection="column">
        <Navigation />
        <Content />
      </box>
    )
  }

  if (isMedium) {
    // Tablet-like: sidebar + content
    return (
      <box flexDirection="row">
        <box width={20}><Navigation /></box>
        <box flexGrow={1}><Content /></box>
      </box>
    )
  }

  // Large: full layout
  return (
    <box flexDirection="row">
      <box width={25}><Navigation /></box>
      <box flexGrow={1}><Content /></box>
      <box width={30}><Sidebar /></box>
    </box>
  )
}
```

## Equal Height Columns

```tsx
function EqualColumns() {
  return (
    <box flexDirection="row" alignItems="stretch" height={20}>
      <box flexGrow={1} border>
        <text>Short content</text>
      </box>
      <box flexGrow={1} border>
        <text>
          Longer content that
          spans multiple lines
          and takes up space
        </text>
      </box>
      <box flexGrow={1} border>
        <text>Medium content</text>
      </box>
    </box>
  )
}
```

## Spacing Utilities

Consistent spacing patterns:

```tsx
// Spacer component
function Spacer({ size = 1 }) {
  return <box height={size} width={size} />
}

// Divider component
function Divider() {
  return <box height={1} width="100%" backgroundColor="#333" />
}

// Usage
<box flexDirection="column">
  <text>Section 1</text>
  <Spacer size={2} />
  <Divider />
  <Spacer size={2} />
  <text>Section 2</text>
</box>
```

### Axis Shorthand Props

Use `paddingX`/`paddingY` and `marginX`/`marginY` for horizontal/vertical spacing:

```tsx
// Horizontal padding (left + right)
<box paddingX={4}>
  <text>4 chars padding left and right</text>
</box>

// Vertical padding (top + bottom)
<box paddingY={2}>
  <text>2 lines padding top and bottom</text>
</box>

// Horizontal margin for centering-like effect
<box marginX={10}>
  <text>Indented content</text>
</box>

// Combined for card-like spacing
<box paddingX={3} paddingY={1} marginY={1} border>
  <text>Nicely spaced card</text>
</box>
```

These are shorthand for:
- `paddingX={n}` = `paddingLeft={n}` + `paddingRight={n}`
- `paddingY={n}` = `paddingTop={n}` + `paddingBottom={n}`
- `marginX={n}` = `marginLeft={n}` + `marginRight={n}`
- `marginY={n}` = `marginTop={n}` + `marginBottom={n}`
