# Text & Display Components

Components for displaying text content in OpenTUI.

## Text Component

The primary component for displaying styled text.

### Basic Usage

```tsx
// React/Solid
<text>Hello, World!</text>

// With content prop
<text content="Hello, World!" />

// Core
const text = new TextRenderable(renderer, {
  id: "greeting",
  content: "Hello, World!",
})
```

### Styling (React/Solid)

For React and Solid, use **nested modifier tags** for text styling:

```tsx
<text fg="#FFFFFF" bg="#000000">
  <strong>Bold</strong>, <em>italic</em>, and <u>underlined</u>
</text>
```

> **Important**: Do NOT use `bold`, `italic`, `underline`, `dim`, `strikethrough` as props on `<text>` — they don't work. Always use nested tags like `<strong>`, `<em>`, `<u>`, or `<span>` with styling.

### Styling (Core) - Text Attributes

```typescript
import { TextRenderable, TextAttributes } from "@opentui/core"

const text = new TextRenderable(renderer, {
  content: "Styled",
  attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
})
```

**Available attributes:**
- `TextAttributes.BOLD`
- `TextAttributes.DIM`
- `TextAttributes.ITALIC`
- `TextAttributes.UNDERLINE`
- `TextAttributes.BLINK`
- `TextAttributes.INVERSE`
- `TextAttributes.HIDDEN`
- `TextAttributes.STRIKETHROUGH`

### Text Selection

```tsx
<text selectable>
  This text can be selected by the user
</text>

<text selectable={false}>
  This text cannot be selected
</text>
```

For copy-on-selection and the full selection API, see `keyboard/REFERENCE.md` (selection).

## Text Modifiers

Inline styling elements that must be used inside `<text>`:

### Span

Inline styled text:

```tsx
<text>
  Normal text with <span fg="red">red text</span> inline
</text>
```

### Bold/Strong

```tsx
<text>
  <strong>Bold text</strong>
  <b>Also bold</b>
</text>
```

### Italic/Emphasis

```tsx
<text>
  <em>Italic text</em>
  <i>Also italic</i>
</text>
```

### Underline

```tsx
<text>
  <u>Underlined text</u>
</text>
```

### Line Break

```tsx
<text>
  Line one
  <br />
  Line two
</text>
```

### Link

```tsx
<text>
  Visit <a href="https://example.com">our website</a>
</text>
```

### Combined Modifiers

```tsx
<text>
  <span fg="#00FF00">
    <strong>Bold green</strong>
  </span>
  and
  <span fg="#FF0000">
    <em><u>italic underlined red</u></em>
  </span>
</text>
```

## Styled Text Template (Core)

The `t` template literal for complex styling:

```typescript
import { t, bold, italic, underline, fg, bg, dim } from "@opentui/core"

const styled = t`
  ${bold("Bold")} and ${italic("italic")} text.
  ${fg("#FF0000")("Red text")} with ${bg("#0000FF")("blue background")}.
  ${dim("Dimmed")} and ${underline("underlined")}.
`

const text = new TextRenderable(renderer, {
  content: styled,
})
```

### Style Functions

| Function | Description |
|----------|-------------|
| `bold(text)` | Bold text |
| `italic(text)` | Italic text |
| `underline(text)` | Underlined text |
| `dim(text)` | Dimmed text |
| `strikethrough(text)` | Strikethrough text |
| `fg(color)(text)` | Set foreground color |
| `bg(color)(text)` | Set background color |

## ASCII Font Component

Display large ASCII art text banners.

### Basic Usage

```tsx
// React
<ascii-font text="TITLE" font="tiny" />

// Solid
<ascii_font text="TITLE" font="tiny" />

// Core
const title = new ASCIIFontRenderable(renderer, {
  id: "title",
  text: "TITLE",
  font: "tiny",
})
```

### Available Fonts

| Font | Description |
|------|-------------|
| `tiny` | Compact ASCII font |
| `block` | Block-style letters |
| `slick` | Sleek modern style |
| `shade` | Shaded 3D effect |

### Styling

```tsx
// React
<ascii-font
  text="HELLO"
  font="block"
  color="#00FF00"
/>

// Core
import { RGBA } from "@opentui/core"

const title = new ASCIIFontRenderable(renderer, {
  text: "HELLO",
  font: "block",
  color: RGBA.fromHex("#00FF00"),
})
```

### Example Output

```
Font: tiny
╭─╮╭─╮╭─╮╭╮╭╮╭─╮╶╮╶ ╶╮
│ ││─┘├┤ │╰╯││  │  │
╰─╯╵  ╰─╯╵  ╵╰─╯╶╯╶╰─╯

Font: block
█▀▀█ █▀▀█ █▀▀ █▀▀▄
█  █ █▀▀▀ █▀▀ █  █
▀▀▀▀ ▀    ▀▀▀ ▀  ▀
```

## Colors

### Color Formats

```tsx
// Hex colors
<text fg="#FF0000">Red</text>
<text fg="#F00">Short hex</text>

// Named colors
<text fg="red">Red</text>
<text fg="blue">Blue</text>

// Transparent
<text bg="transparent">No background</text>
```

### RGBA Class

The `RGBA` class from `@opentui/core` can be used in **all frameworks** (Core, React, Solid) for programmatic color manipulation:

```typescript
import { RGBA } from "@opentui/core"

// From hex string (most common)
const red = RGBA.fromHex("#FF0000")
const shortHex = RGBA.fromHex("#F00")       // Short form supported

// From integers (0-255 range for each channel)
const green = RGBA.fromInts(0, 255, 0, 255)   // r, g, b, a
const semiGreen = RGBA.fromInts(0, 255, 0, 128) // 50% transparent

// From normalized floats (0.0-1.0 range)
const blue = RGBA.fromValues(0.0, 0.0, 1.0, 1.0)  // r, g, b, a
const overlay = RGBA.fromValues(0.1, 0.1, 0.1, 0.7) // Dark semi-transparent

// Common use cases
const backgroundColor = RGBA.fromHex("#1a1a2e")
const textColor = RGBA.fromHex("#FFFFFF")
const borderColor = RGBA.fromInts(122, 162, 247, 255) // Tokyo Night blue
const shadowColor = RGBA.fromValues(0.0, 0.0, 0.0, 0.5) // 50% black
```

**When to use each method:**
- `fromHex()` - When working with design specs or CSS colors
- `fromInts()` - When you have 8-bit color values (0-255)
- `fromValues()` - When doing color math or interpolation (normalized 0.0-1.0)

### Using RGBA in React/Solid

```tsx
// React or Solid - RGBA works with color props
import { RGBA } from "@opentui/core"

const primaryColor = RGBA.fromHex("#7aa2f7")

function MyComponent() {
  return (
    <box backgroundColor={primaryColor} borderColor={primaryColor}>
      <text fg={RGBA.fromHex("#c0caf5")}>Styled with RGBA</text>
    </box>
  )
}
```

Most props that accept color strings (`"#FF0000"`, `"red"`) also accept `RGBA` objects directly.

## Text Wrapping

Text wraps based on parent container:

```tsx
<box width={40}>
  <text>
    This long text will wrap when it reaches the edge of the
    40-character wide parent container.
  </text>
</box>
```

## Dynamic Content

### React

```tsx
function Counter() {
  const [count, setCount] = useState(0)
  return <text>Count: {count}</text>
}
```

### Solid

```tsx
function Counter() {
  const [count, setCount] = createSignal(0)
  return <text>Count: {count()}</text>
}
```

### Core

```typescript
const text = new TextRenderable(renderer, {
  id: "counter",
  content: "Count: 0",
})

// Update later
text.setContent("Count: 1")
```

## Gotchas

### Text Modifiers Outside Text

```tsx
// WRONG - modifiers only work inside <text>
<box>
  <strong>Won't work</strong>
</box>

// CORRECT
<box>
  <text>
    <strong>This works</strong>
  </text>
</box>
```

### Empty Text

```tsx
// May cause layout issues
<text></text>

// Better - use space or conditional
<text>{content || " "}</text>
```

### Color Format

```tsx
// WRONG
<text fg="FF0000">Missing #</text>

// CORRECT
<text fg="#FF0000">With #</text>
```
