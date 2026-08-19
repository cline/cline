import type { Meta, StoryObj } from "@storybook/react-vite"
import MarkdownBlock from "./MarkdownBlock"

const meta: Meta<typeof MarkdownBlock> = {
	title: "Views/Components/MarkdownBlock",
	component: MarkdownBlock,
	parameters: {
		layout: "centered",
		docs: {
			description: {
				component: `
The MarkdownBlock component renders markdown content with advanced features for code display, syntax highlighting, and interactive elements.

**Key Features:**
- **Syntax Highlighting**: Automatic code highlighting using rehype-highlight
- **File Path Detection**: Detects file paths in inline code and makes them clickable
- **Act Mode Highlighting**: Special styling for "Act Mode" mentions with keyboard shortcuts
- **URL Auto-linking**: Converts plain URLs in text to clickable links
- **Mermaid Diagrams**: Supports mermaid diagram rendering in code blocks
- **Copy Buttons**: Automatic copy buttons for code blocks
- **Filename Protection**: Prevents filenames like __init__.py from being rendered as bold

**Use Cases:**
- Rendering AI assistant responses with code snippets
- Displaying formatted documentation
- Interactive file navigation within markdown
- Technical content with syntax highlighting

**Props:**
- \`markdown\`: The markdown string to render
- \`compact\`: Removes paragraph margins for compact display
- \`showCursor\`: Shows a blinking cursor after content (for streaming effect)

**Try It Out:**
Use the controls below to test different markdown content and see how various features work.
				`,
			},
		},
	},
	argTypes: {
		markdown: {
			control: "text",
			description: "The markdown content to render",
			table: {
				type: { summary: "string" },
			},
		},
		compact: {
			control: "boolean",
			description: "Enables compact mode with reduced spacing",
			table: {
				type: { summary: "boolean" },
				defaultValue: { summary: "false" },
			},
		},
		showCursor: {
			control: "boolean",
			description: "Shows a blinking cursor after the content",
			table: {
				type: { summary: "boolean" },
				defaultValue: { summary: "false" },
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="w-full max-w-3xl p-6 bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
				<Story />
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof MarkdownBlock>

export const Default: Story = {
	args: {
		markdown: `Here's a TypeScript example with syntax highlighting:

\`\`\`typescript
interface User {
  id: string
  name: string
  email: string
}

async function fetchUser(id: string): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`)
  return response.json()
}
\`\`\`

The code above demonstrates a simple API fetch function.`,
		compact: false,
		showCursor: false,
	},
	parameters: {
		docs: {
			description: {
				story: "Basic markdown rendering with text, inline code for file paths, and lists.",
			},
		},
	},
}

export const WithActMode: Story = {
	args: {
		markdown: `I've analyzed your request. To proceed with implementation, please switch to Act Mode using the keyboard shortcut.

Once you're ready, I can execute the necessary file changes and command operations.`,
		compact: false,
		showCursor: false,
	},
	parameters: {
		docs: {
			description: {
				story: 'Demonstrates the special "Act Mode" highlighting feature with clickable toggle and keyboard shortcut display.',
			},
		},
	},
}

export const WithLinks: Story = {
	args: {
		markdown: `Check out these resources:

- Official documentation: https://github.com/cline/cline
- API reference: https://api.cline.bot/docs
- Support forum: https://community.cline.bot

You can also visit our website at https://cline.bot for more information.`,
		compact: false,
		showCursor: false,
	},
	parameters: {
		docs: {
			description: {
				story: "Shows automatic URL detection and conversion to clickable links. Plain URLs in text are converted to links automatically.",
			},
		},
	},
}

export const WithMermaidDiagram: Story = {
	args: {
		markdown: `Here's a diagram showing the component architecture:

\`\`\`mermaid
graph TD
    A[User Request] --> B{Extension}
    B --> C[Controller]
    C --> D[Task]
    D --> E[API Provider]
    E --> F[AI Model]
    F --> G[Response]
    G --> D
    D --> H[Tool Execution]
    H --> I[File System]
    H --> J[Terminal]
    H --> K[Browser]
\`\`\`

This flow shows how requests are processed through the system.`,
		compact: false,
		showCursor: false,
	},
	parameters: {
		docs: {
			description: {
				story: "Demonstrates Mermaid diagram rendering. The diagram is automatically detected and rendered as an interactive SVG.",
			},
		},
	},
}

export const WithDiffSyntax: Story = {
	args: {
		markdown: `Here are the changes I made to config.ts:

\`\`\`diff
export const config = {
-  apiUrl: 'http://localhost:3000',
+  apiUrl: process.env.API_URL || 'http://localhost:3000',
   timeout: 5000,
-  retries: 3,
+  retries: 5,
}
\`\`\``,
		compact: false,
		showCursor: false,
	},
	parameters: {
		docs: {
			description: {
				story: "Shows diff-style syntax highlighting with additions (+) and deletions (-) color-coded.",
			},
		},
	},
}

export const CompactMode: Story = {
	args: {
		markdown: `Compact mode removes extra spacing between paragraphs.

This is useful for inline messages or notifications.

All formatting still works: **bold**, *italic*, and [links](https://example.com).`,
		compact: true,
		showCursor: false,
	},
	parameters: {
		docs: {
			description: {
				story: "Demonstrates compact mode with reduced vertical spacing. Useful for tight layouts or inline messages.",
			},
		},
	},
}

export const WithCursor: Story = {
	args: {
		markdown: `I'm analyzing your codebase`,
		compact: false,
		showCursor: true,
	},
	parameters: {
		docs: {
			description: {
				story: "Shows the blinking cursor effect, typically used during streaming responses to indicate ongoing generation.",
			},
		},
	},
}

export const FilenameProtection: Story = {
	args: {
		markdown:
			"I need to update these Python files:\n\n\n- `__init__.py` - Package initializer\n- `__main__.py` - Entry point\n- `__version__.py` - Version info\n\nThe `__init__.py` file should not render with bold text.",
		compact: false,
		showCursor: false,
	},
	parameters: {
		docs: {
			description: {
				story: "Demonstrates filename protection. Filenames like __init__.py are protected from being parsed as markdown bold (**text**).",
			},
		},
	},
}

export const Interactive: Story = {
	args: {
		markdown: `# Try Different Markdown!

Edit the markdown content in the controls panel to test:

## Features to Try:
- **Bold text** and *italic text*
- 'inline code' and file paths like \`src/App.tsx\`
- Links: https://example.com
- Mentions of switching to Act Mode

## Code Blocks:
\`\`\`javascript
console.log("Hello, World!")
\`\`\`

## Lists:
1. First item
2. Second item
3. Third item

---

Toggle the controls to test compact mode and showCursor!`,
		compact: false,
		showCursor: false,
	},
	parameters: {
		docs: {
			description: {
				story: `Interactive playground for testing MarkdownBlock. Use the controls panel to:

- **Edit markdown**: Type or paste any markdown content
- **Toggle compact mode**: See how spacing changes
- **Toggle cursor**: Add a blinking cursor effect
- **Test features**: Try file paths, code blocks, links, Act Mode mentions, diagrams, etc.

This is perfect for experimenting with different markdown patterns and seeing how they render in real-time.`,
			},
		},
	},
}
