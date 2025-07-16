import type { Meta, StoryObj } from "@storybook/react-vite"
import McpResponseDisplay from "./McpResponseDisplay"
import { StorybookProvider } from "@/components/common/StorybookDecorator"

const meta: Meta<typeof McpResponseDisplay> = {
	title: "Component/McpResponseDisplay",
	component: McpResponseDisplay,
	parameters: {
		layout: "padded",
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
	decorators: [
		(Story) => {
			const mockState = {
				mcpResponsesCollapsed: false, // Default to expanded for better demo
				mcpRichDisplayEnabled: true, // Default to rich display enabled
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	argTypes: {
		responseText: {
			control: "text",
			description: "The response text to display",
		},
	},
}

export default meta
type Story = StoryObj<typeof McpResponseDisplay>

// Basic text response
export const BasicText: Story = {
	args: {
		responseText: `Here's a simple text response from an MCP server.

This response contains multiple paragraphs and demonstrates the basic text rendering capabilities of the component.

The text is displayed in a monospace font with proper line breaks and formatting.`,
	},
	parameters: {
		docs: {
			description: {
				story: "A basic text response without any URLs or rich content.",
			},
		},
	},
}

// Response with URLs (will show as plain text in Storybook)
export const WithUrls: Story = {
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

This demonstrates how the component handles a mix of text, links, and images.`,
	},
	parameters: {
		docs: {
			description: {
				story: "A comprehensive response mixing text, links, and images to showcase the component structure.",
			},
		},
	},
}

// Collapsed by default
export const CollapsedByDefault: Story = {
	args: {
		responseText: `This response starts in a collapsed state.

Click the header to expand and see the full content.

https://example.com/hidden-until-expanded
https://via.placeholder.com/400x300/ffc107/000000?text=Hidden+Image`,
	},
	decorators: [
		(Story) => {
			const mockState = {
				mcpResponsesCollapsed: true, // Start collapsed
				mcpRichDisplayEnabled: true,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Response that starts in a collapsed state, useful for long responses or when screen space is limited.",
			},
		},
	},
}

// Plain text mode
export const PlainTextMode: Story = {
	args: {
		responseText: `This response is displayed in plain text mode.

Even though it contains URLs like:
- https://example.com/link
- https://via.placeholder.com/400x300/17a2b8/ffffff?text=Image

They won't be processed for rich display when in plain text mode.`,
	},
	decorators: [
		(Story) => {
			const mockState = {
				mcpResponsesCollapsed: false,
				mcpRichDisplayEnabled: false, // Disable rich display
			}
			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Response displayed in plain text mode where URLs are not processed for rich content.",
			},
		},
	},
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

// Very long response
export const LongResponse: Story = {
	args: {
		responseText: `This is a very long response that demonstrates how the component handles extensive content.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Here are some resources:
- Documentation: https://docs.example.com/getting-started
- API reference: https://docs.example.com/api-reference
- Tutorials: https://docs.example.com/tutorials
- Examples: https://docs.example.com/examples

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
				story: "Tests the component with longer content to demonstrate layout and performance.",
			},
		},
	},
}
