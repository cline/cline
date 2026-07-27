# OpenTUI Layout System

OpenTUI uses the Yoga layout engine, providing CSS Flexbox-like capabilities for positioning and sizing components in the terminal.

## Overview

Key concepts:
- **Flexbox model**: Familiar CSS Flexbox properties
- **Yoga engine**: Facebook's cross-platform layout engine
- **Terminal units**: Dimensions are in character cells (columns x rows)
- **Percentage support**: Relative sizing based on parent

## Flex Container Properties

### flexDirection

Controls the main axis direction:

```tsx
// Row (default) - children flow horizontally
<box flexDirection="row">
  <text>1</text>
  <text>2</text>
  <text>3</text>
</box>
// Output: 1 2 3

// Column - children flow vertically
<box flexDirection="column">
  <text>1</text>
  <text>2</text>
  <text>3</text>
</box>
// Output:
// 1
// 2
// 3

// Reverse variants
<box flexDirection="row-reverse">...</box>     // 3 2 1
<box flexDirection="column-reverse">...</box>  // Bottom to top
```

### justifyContent

Aligns children along the main axis:

```tsx
<box flexDirection="row" width={40} justifyContent="flex-start">
  {/* Children at start (left for row) */}
</box>

<box flexDirection="row" width={40} justifyContent="flex-end">
  {/* Children at end (right for row) */}
</box>

<box flexDirection="row" width={40} justifyContent="center">
  {/* Children centered */}
</box>

<box flexDirection="row" width={40} justifyContent="space-between">
  {/* First at start, last at end, rest evenly distributed */}
</box>

<box flexDirection="row" width={40} justifyContent="space-around">
  {/* Equal space around each child */}
</box>

<box flexDirection="row" width={40} justifyContent="space-evenly">
  {/* Equal space between all children and edges */}
</box>
```

### alignItems

Aligns children along the cross axis:

```tsx
<box flexDirection="row" height={10} alignItems="flex-start">
  {/* Children at top */}
</box>

<box flexDirection="row" height={10} alignItems="flex-end">
  {/* Children at bottom */}
</box>

<box flexDirection="row" height={10} alignItems="center">
  {/* Children vertically centered */}
</box>

<box flexDirection="row" height={10} alignItems="stretch">
  {/* Children stretch to fill height */}
</box>

<box flexDirection="row" height={10} alignItems="baseline">
  {/* Children aligned by text baseline */}
</box>
```

### flexWrap

Controls whether children wrap to new lines:

```tsx
<box flexDirection="row" flexWrap="nowrap" width={20}>
  {/* Children overflow (default) */}
</box>

<box flexDirection="row" flexWrap="wrap" width={20}>
  {/* Children wrap to next row */}
</box>

<box flexDirection="row" flexWrap="wrap-reverse" width={20}>
  {/* Children wrap upward */}
</box>
```

### gap

Space between children:

```tsx
<box flexDirection="row" gap={2}>
  <text>A</text>
  <text>B</text>
  <text>C</text>
</box>
// Output: A  B  C (2 spaces between)
```

## Flex Item Properties

### flexGrow

How much a child should grow relative to siblings:

```tsx
<box flexDirection="row" width={30}>
  <box flexGrow={1}><text>1</text></box>
  <box flexGrow={2}><text>2</text></box>
  <box flexGrow={1}><text>1</text></box>
</box>
// Widths: 7.5 | 15 | 7.5 (1:2:1 ratio)
```

### flexShrink

How much a child should shrink when space is limited:

```tsx
<box flexDirection="row" width={20}>
  <box width={15} flexShrink={1}><text>Shrinks</text></box>
  <box width={15} flexShrink={0}><text>Fixed</text></box>
</box>
```

### flexBasis

Initial size before growing/shrinking:

```tsx
<box flexDirection="row">
  <box flexBasis={20} flexGrow={1}>Starts at 20, can grow</box>
  <box flexBasis="50%">Half of parent</box>
</box>
```

### alignSelf

Override parent's alignItems for this child:

```tsx
<box flexDirection="row" height={10} alignItems="center">
  <text>Centered</text>
  <text alignSelf="flex-start">Top</text>
  <text alignSelf="flex-end">Bottom</text>
</box>
```

## Dimensions

### Fixed Dimensions

```tsx
<box width={40} height={10}>
  {/* Exactly 40 columns by 10 rows */}
</box>
```

### Percentage Dimensions

Parent must have explicit size:

```tsx
<box width="100%" height="100%">
  <box width="50%" height="50%">
    {/* Half of parent */}
  </box>
</box>
```

### Min/Max Constraints

```tsx
<box
  minWidth={20}
  maxWidth={60}
  minHeight={5}
  maxHeight={20}
>
  {/* Constrained sizing */}
</box>
```

## Spacing

### Padding (inside)

```tsx
// All sides
<box padding={2}>Content</box>

// Individual sides
<box
  paddingTop={1}
  paddingRight={2}
  paddingBottom={1}
  paddingLeft={2}
>
  Content
</box>
```

### Margin (outside)

```tsx
// All sides
<box margin={1}>Content</box>

// Individual sides
<box
  marginTop={1}
  marginRight={2}
  marginBottom={1}
  marginLeft={2}
>
  Content
</box>
```

## Positioning

### Relative (default)

Element flows in normal document order:

```tsx
<box position="relative">
  {/* Normal flow */}
</box>
```

### Absolute

Element positioned relative to nearest positioned ancestor:

```tsx
<box position="relative" width="100%" height="100%">
  <box
    position="absolute"
    left={10}
    top={5}
    width={20}
    height={5}
  >
    Positioned at (10, 5)
  </box>
</box>
```

### Position Properties

```tsx
<box
  position="absolute"
  left={10}      // From left edge
  top={5}        // From top edge
  right={10}     // From right edge
  bottom={5}     // From bottom edge
>
  Content
</box>
```

## Display

### Visibility Control

```tsx
// Visible (default)
<box display="flex">Visible</box>

// Hidden (removed from layout)
<box display="none">Hidden</box>
```

## Overflow

```tsx
<box overflow="visible">
  {/* Content can extend beyond bounds (default) */}
</box>

<box overflow="hidden">
  {/* Content clipped at bounds */}
</box>

<box overflow="scroll">
  {/* Scrollable when content exceeds bounds */}
</box>
```

## Z-Index

Control stacking order for overlapping elements:

```tsx
<box position="relative">
  <box position="absolute" zIndex={1}>Behind</box>
  <box position="absolute" zIndex={2}>In front</box>
</box>
```

## See Also

- [Layout Patterns](./patterns.md) - Common layout recipes
- [Components/Containers](../components/containers.md) - Box and ScrollBox details
