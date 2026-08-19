# Code & Diff Components

Components for displaying code with syntax highlighting and diffs in OpenTUI.

## Code Component

Display syntax-highlighted code blocks.

### Basic Usage

```tsx
// React
<code
  code={`function hello() {
  console.log("Hello, World!");
}`}
  language="typescript"
/>

// Solid
<code
  code={sourceCode}
  language="javascript"
/>

// Core
const codeBlock = new CodeRenderable(renderer, {
  id: "code",
  code: sourceCode,
  language: "typescript",
})
```

### Supported Languages

OpenTUI uses Tree-sitter for syntax highlighting. Common languages:
- `typescript`, `javascript`
- `python`
- `rust`
- `go`
- `json`
- `html`, `css`
- `markdown`
- `bash`, `shell`

### Styling

```tsx
<code
  code={sourceCode}
  language="typescript"
  backgroundColor="#1a1a2e"
  showLineNumbers
/>
```

### onHighlight Callback

Intercept and modify syntax highlights before rendering:

```tsx
// Core
const codeBlock = new CodeRenderable(renderer, {
  id: "code",
  code: sourceCode,
  language: "typescript",
  onHighlight: (highlights, context) => {
    // Add custom highlights
    highlights.push([10, 20, "custom.error", {}])
    return highlights
  },
})

// React/Solid
<code
  code={sourceCode}
  language="typescript"
  onHighlight={(highlights, context) => {
    // context: { content, filetype, syntaxStyle }
    // Modify and return highlights array
    return highlights.filter(h => h[2] !== "comment")
  }}
/>
```

**Callback signature:**
- `highlights: SimpleHighlight[]` - Array of `[start, end, scope, metadata]`
- `context: { content, filetype, syntaxStyle }` - Highlighting context
- Return modified highlights array or `undefined` to use original

Supports async callbacks for fetching additional highlight data.

### onChunks Callback

Post-process rendered text chunks after syntax highlighting. Runs after `onHighlight` and receives fully resolved chunks:

```tsx
// Core
const codeBlock = new CodeRenderable(renderer, {
  id: "code",
  code: sourceCode,
  language: "typescript",
  onChunks: (chunks, context) => {
    // Transform chunks (e.g., add link detection)
    return chunks
  },
})

// React/Solid
<code
  code={sourceCode}
  language="typescript"
  onChunks={(chunks, context) => {
    // context: { content, filetype, syntaxStyle, highlights }
    return chunks
  }}
/>
```

### Link Detection Utility

Auto-detect URLs in code and add clickable hyperlinks:

```typescript
import { detectLinks } from "@opentui/core"

<code
  code={sourceCode}
  language="typescript"
  onChunks={(chunks, context) => detectLinks(chunks, context)}
/>
```

`detectLinks` examines Tree-sitter highlights to find URL tokens and sets `chunk.link` on matching chunks. Supports async usage.

## TextTable Component

Render data tables with borders, word wrapping, and selection support.

### Basic Usage

```typescript
// Core
import { TextTableRenderable, type TextTableContent } from "@opentui/core"

const content: TextTableContent = [
  [[ { text: "Name" } ], [ { text: "Age" } ], [ { text: "Role" } ]],
  [[ { text: "Alice" } ], [ { text: "30" } ], [ { text: "Engineer" } ]],
  [[ { text: "Bob" } ], [ { text: "25" } ], [ { text: "Designer" } ]],
]

const table = new TextTableRenderable(renderer, {
  id: "table",
  content,
  wrapMode: "word",           // "none" | "char" | "word"
  columnWidthMode: "content", // "content" | "fill"
  cellPadding: 0,
  border: true,
  outerBorder: true,
  borderStyle: "single",      // single | double | rounded | bold
  selectable: true,           // Allow text selection
  columnFitter: "balanced",   // "proportional" | "balanced"
})
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `content` | `TextTableContent` | - | 2D array of cell content |
| `wrapMode` | `"none" \| "char" \| "word"` | `"none"` | Text wrapping in cells |
| `columnWidthMode` | `"content" \| "fill"` | `"content"` | Column sizing strategy |
| `cellPadding` | `number` | `0` | Padding inside cells |
| `border` | `boolean` | `true` | Show inner borders |
| `outerBorder` | `boolean` | `true` | Show outer borders |
| `borderStyle` | `string` | `"single"` | Border style |
| `borderColor` | `string \| RGBA` | - | Border color |
| `selectable` | `boolean` | `false` | Allow text selection |
| `columnFitter` | `"proportional" \| "balanced"` | `"proportional"` | Column width distribution |

### Cell Content Format

Each cell is an array of styled text chunks:

```typescript
type TextTableCellContent = { text: string; fg?: RGBA; bg?: RGBA }[]
type TextTableContent = TextTableCellContent[][]  // rows -> cells -> chunks
```

### Selection

```typescript
table.getSelectedText()  // Get selected text
table.hasSelection()     // Check if text is selected
```

Columnar selection is supported: dragging vertically within a single column selects only that column's content.

## Line Number Component

Code display with line numbers, highlighting, and diagnostics.

### Basic Usage

```tsx
// React
<line-number
  code={sourceCode}
  language="typescript"
/>

// Solid (note underscore)
<line_number
  code={sourceCode}
  language="typescript"
/>

// Core
const codeView = new LineNumberRenderable(renderer, {
  id: "code-view",
  code: sourceCode,
  language: "typescript",
})
```

### Line Number Options

```tsx
// React
<line-number
  code={sourceCode}
  language="typescript"
  startLine={1}              // Starting line number
  showLineNumbers={true}     // Display line numbers
/>

// Solid
<line_number
  code={sourceCode}
  language="typescript"
  startLine={1}
  showLineNumbers={true}
/>
```

### Line Highlighting

Highlight specific lines:

```tsx
// React
<line-number
  code={sourceCode}
  language="typescript"
  highlightedLines={[5, 10, 15]}  // Highlight these lines
/>

// Solid
<line_number
  code={sourceCode}
  language="typescript"
  highlightedLines={[5, 10, 15]}
/>
```

### Diagnostics

Show errors, warnings, and info on specific lines:

```tsx
// React
<line-number
  code={sourceCode}
  language="typescript"
  diagnostics={[
    { line: 3, severity: "error", message: "Unexpected token" },
    { line: 7, severity: "warning", message: "Unused variable" },
    { line: 12, severity: "info", message: "Consider using const" },
  ]}
/>

// Solid
<line_number
  code={sourceCode}
  language="typescript"
  diagnostics={[
    { line: 3, severity: "error", message: "Unexpected token" },
  ]}
/>
```

**Diagnostic severity levels:**
- `error` - Red indicator
- `warning` - Yellow indicator
- `info` - Blue indicator
- `hint` - Gray indicator

### Diff Highlighting

Show added/removed lines:

```tsx
<line-number
  code={sourceCode}
  language="typescript"
  addedLines={[5, 6, 7]}      // Green background
  removedLines={[10, 11]}     // Red background
/>
```

## Diff Component

Unified or split diff viewer with syntax highlighting.

### Basic Usage

```tsx
// React
<diff
  oldCode={originalCode}
  newCode={modifiedCode}
  language="typescript"
/>

// Solid
<diff
  oldCode={originalCode}
  newCode={modifiedCode}
  language="typescript"
/>

// Core
const diffView = new DiffRenderable(renderer, {
  id: "diff",
  oldCode: originalCode,
  newCode: modifiedCode,
  language: "typescript",
})
```

### Display Modes

```tsx
// Unified diff (default)
<diff
  oldCode={old}
  newCode={new}
  mode="unified"
/>

// Split/side-by-side diff
<diff
  oldCode={old}
  newCode={new}
  mode="split"
/>
```

### Synchronized Scrolling (Split View)

In split view, enable synchronized scrolling between left and right panes:

```tsx
// React/Solid
<diff
  oldCode={old}
  newCode={new}
  mode="split"
  syncScroll              // Scrolling one pane syncs the other
/>

// Core
const diffView = new DiffRenderable(renderer, {
  id: "diff",
  diff: unifiedDiff,
  view: "split",
  syncScroll: true,
})

// Toggle at runtime
diffView.syncScroll = true
diffView.syncScroll = false
```

### Options

```tsx
<diff
  oldCode={originalCode}
  newCode={modifiedCode}
  language="typescript"
  mode="unified"
  showLineNumbers
  context={3}                // Lines of context around changes
/>
```

### Styling

```tsx
<diff
  oldCode={old}
  newCode={new}
  addedLineColor="#2d4f2d"   // Background for added lines
  removedLineColor="#4f2d2d" // Background for removed lines
  unchangedLineColor="transparent"
/>
```

### Line Highlighting API (Core)

Programmatically highlight specific lines in a diff:

```typescript
// Set a single line's color
diffView.setLineColor(5, "#2d4f2d")
diffView.setLineColor(5, { gutter: "#333", content: "#2d4f2d" })

// Clear a single line's color
diffView.clearLineColor(5)

// Set multiple lines at once
diffView.setLineColors(new Map([
  [1, "#2d4f2d"],
  [2, "#4f2d2d"],
]))

// Highlight a range
diffView.highlightLines(10, 20, "#2d4f2d")
diffView.clearHighlightLines(10, 20)

// Clear all line colors
diffView.clearAllLineColors()
```

The `LineNumberRenderable` also supports programmatic highlighting:

```typescript
lineNumberView.highlightLines(5, 10, "#2d4f2d")
lineNumberView.clearHighlightLines(5, 10)
```
```

## Markdown Component

Render markdown content with syntax highlighting for code blocks.

### Basic Usage

```tsx
// React
<markdown
  content={markdownText}
  syntaxStyle={mySyntaxStyle}
/>

// Solid
<markdown
  content={markdownText}
  syntaxStyle={mySyntaxStyle}
/>

// Core
import { MarkdownRenderable } from "@opentui/core"

const md = new MarkdownRenderable(renderer, {
  id: "markdown",
  content: "# Hello\n\nThis is **markdown**.",
  syntaxStyle: mySyntaxStyle,
})
```

### Options

```tsx
<markdown
  content={markdownText}
  syntaxStyle={syntaxStyle}
  treeSitterClient={client}  // Optional: custom tree-sitter client
  conceal={true}             // Hide markdown syntax characters
  streaming={true}           // Enable streaming mode for incremental updates
  tableOptions={{            // Customize markdown table rendering
    widthMode: "full",       // "content" | "full"
    wrapMode: "word",        // "none" | "char" | "word"
    cellPadding: 0,
    borders: true,
    outerBorder: true,
    borderStyle: "single",
    borderColor: "#555",
    selectable: true,        // Tables are selectable by default
  }}
/>
```

### Custom Node Rendering

```tsx
// Core
const md = new MarkdownRenderable(renderer, {
  id: "markdown",
  content: "# Custom Heading",
  syntaxStyle,
  renderNode: (node, ctx, defaultRender) => {
    if (node.type === "heading") {
      // Return custom renderable for headings
      return new TextRenderable(ctx, {
        content: `>> ${node.content} <<`,
      })
    }
    return null // Use default rendering
  },
})
```

### Streaming Mode

For real-time content like LLM output:

```tsx
const [content, setContent] = useState("")

// Append text as it arrives
useEffect(() => {
  llmStream.on("token", (token) => {
    setContent(c => c + token)
  })
}, [])

<markdown
  content={content}
  syntaxStyle={syntaxStyle}
  streaming={true}  // Optimizes for incremental updates
/>
```

## Use Cases

### Code Editor

```tsx
function CodeEditor() {
  const [code, setCode] = useState(`function hello() {
  console.log("Hello!");
}`)

  return (
    <box flexDirection="column" height="100%">
      <box height={1}>
        <text>editor.ts</text>
      </box>
      <textarea
        value={code}
        onChange={setCode}
        language="typescript"
        showLineNumbers
        flexGrow={1}
        focused
      />
    </box>
  )
}
```

### Code Review

```tsx
function CodeReview({ oldCode, newCode }) {
  return (
    <box flexDirection="column" height="100%">
      <box height={1} backgroundColor="#333">
        <text>Changes in src/utils.ts</text>
      </box>
      <diff
        oldCode={oldCode}
        newCode={newCode}
        language="typescript"
        mode="split"
        showLineNumbers
      />
    </box>
  )
}
```

### Syntax-Highlighted Preview

```tsx
function MarkdownPreview({ content }) {
  // Extract code blocks from markdown
  const codeBlocks = extractCodeBlocks(content)

  return (
    <scrollbox height={20}>
      {codeBlocks.map((block, i) => (
        <box key={i} marginBottom={1}>
          <code
            code={block.code}
            language={block.language}
          />
        </box>
      ))}
    </scrollbox>
  )
}
```

### Error Display

```tsx
function ErrorView({ errors, code }) {
  const diagnostics = errors.map(err => ({
    line: err.line,
    severity: "error",
    message: err.message,
  }))

  return (
    <line-number
      code={code}
      language="typescript"
      diagnostics={diagnostics}
      highlightedLines={errors.map(e => e.line)}
    />
  )
}
```

## Gotchas

### Solid Uses Underscores

```tsx
// React
<line-number />

// Solid
<line_number />
```

### Language Required for Highlighting

```tsx
// No highlighting (plain text)
<code code={text} />

// With highlighting
<code code={text} language="typescript" />
```

### Large Files

For very large files, consider:
- Pagination or virtual scrolling
- Loading only visible portion
- Using `scrollbox` wrapper

```tsx
<scrollbox height={30}>
  <line-number
    code={largeFile}
    language="typescript"
  />
</scrollbox>
```

### Tree-sitter Loading

Syntax highlighting requires Tree-sitter grammars. If highlighting isn't working:

1. Check the language is supported
2. Verify grammars are installed
3. Check `OTUI_TREE_SITTER_WORKER_PATH` if using custom path
