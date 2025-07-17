import type { Meta, StoryObj } from "@storybook/react-vite"
import McpResponseDisplay from "./McpResponseDisplay"
import { StorybookProvider, VSCodeWebview } from "@/components/common/StorybookDecorator"
import { ExtensionState } from "@shared/ExtensionMessage"

const meta: Meta<typeof McpResponseDisplay> = {
	title: "Component/mcpDisplayMode",
	component: McpResponseDisplay,
	parameters: {
		docs: {
			description: {
				component: `
The McpResponseDisplay component renders MCP (Model Context Protocol) server responses with rich content support.

**Features:**
- **Rich Display Mode**: Automatically detects and renders images and link previews
- **Plain Text Mode**: Fallback mode for simple text display
- **Collapsible**: Can be expanded/collapsed with header controls
- **Toggle Switch**: Users can switch between rich and plain display modes
- **URL Processing**: Extracts and processes URLs from response text
- **Error Handling**: Graceful error handling with fallbacks
- **Loading States**: Shows progress indicators during content processing

**Use Cases:**
- Displaying MCP server responses in chat interfaces
- Showing rich content like images and link previews
- Providing user control over content display modes

**Note**: In Storybook, rich content features may be limited due to mocking constraints. 
The component will demonstrate the basic text display and UI structure.
        `,
			},
		},
	},
	decorators: [VSCodeWebview],
	argTypes: {
		responseText: {
			control: "text",
			description: "The response text to display",
		},
	},
}

const defaultSettings = {
	mcpDisplayMode: "plain",
	mcpResponsesCollapsed: false,
} satisfies Partial<ExtensionState>

export default meta

type Story = StoryObj<typeof McpResponseDisplay>

// Basic text response
export const Default: Story = {
	args: {
		responseText: `Here's a simple text response from an MCP server.

This response contains multiple paragraphs and demonstrates the basic text rendering capabilities of the component.

The text is displayed in a monospace font with proper line breaks and formatting.`,
	},
	parameters: {
		docs: {
			description: {
				story: "A basic text response without any URLs or rich content in plain mode.",
			},
		},
	},
}

// Response with URLs (will show as plain text in Storybook)
export const LinksPreview: Story = {
	args: {
		responseText: `Here's a response that contains URLs:

Documentation: https://example.com/docs
API reference: https://api.example.com/reference
Sample image: https://via.placeholder.com/600x400/0066cc/ffffff?text=Sample+Image

In the actual application, these URLs would be processed for rich display when rich mode is enabled.`,
	},
	parameters: {
		docs: {
			description: {
				story: "Response containing URLs. In the real application, these would be processed for rich display.",
			},
		},
	},
	decorators: [
		(Story) => {
			const mockState = {
				...defaultSettings,
				mcpDisplayMode: "rich",
			} satisfies Partial<ExtensionState>

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
}

// Mixed content response
export const MixedContent: Story = {
	args: {
		responseText: `Here's a comprehensive response with mixed content:

## Documentation Links
- Main docs: https://example.com/docs
- API guide: https://api.example.com/guide

## Sample Images
Here's a screenshot: https://via.placeholder.com/500x300/28a745/ffffff?text=Screenshot
And a diagram: https://via.placeholder.com/400x400/6f42c1/ffffff?text=Diagram

## Additional Resources
- Tutorial: https://tutorial.example.com
- Examples: https://examples.example.com

This demonstrates how the component handles a mix of text, links, and images.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

More content here to demonstrate scrolling and layout behavior with longer text content that might wrap across multiple lines and require proper text handling.

Sample images:
- https://via.placeholder.com/300x200/007bff/ffffff?text=Logo
- https://via.placeholder.com/400x300/28a745/ffffff?text=Feature+1
- https://via.placeholder.com/400x300/dc3545/ffffff?text=Feature+2

This tests the component's ability to handle longer content efficiently while maintaining good performance and user experience.`,
	},
	parameters: {
		docs: {
			description: {
				story: "A comprehensive response mixing text, links, and images to showcase the component structure.",
			},
		},
	},
	decorators: [
		(Story) => {
			const mockState = {
				...defaultSettings,
				mcpDisplayMode: "rich",
			} satisfies Partial<ExtensionState>

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
}

// Code-like response
export const CodeResponse: Story = {
	args: {
		responseText: `Here's some code with embedded URLs:

\`\`\`javascript
// API endpoint
const apiUrl = "https://api.example.com/v1/data";

// Image URL
const imageUrl = "https://via.placeholder.com/200x200/6c757d/ffffff?text=API+Response";

fetch(apiUrl)
  .then(response => response.json())
  .then(data => console.log(data));
\`\`\`

Documentation: https://docs.example.com/api`,
	},
	parameters: {
		docs: {
			description: {
				story: "Response containing code blocks with embedded URLs.",
			},
		},
	},
}

// Empty response
export const EmptyResponse: Story = {
	args: {
		responseText: "",
	},
	parameters: {
		docs: {
			description: {
				story: "Handles empty response text gracefully.",
			},
		},
	},
}
