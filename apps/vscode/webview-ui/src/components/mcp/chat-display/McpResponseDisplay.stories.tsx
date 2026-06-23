import type { Meta, StoryObj } from "@storybook/react-vite"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import McpResponseDisplay from "./McpResponseDisplay"

const meta: Meta<typeof McpResponseDisplay> = {
	title: "Views/Components/McpResponseDisplay",
	component: McpResponseDisplay,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component:
					"Renders MCP server responses with rich content support including images, links, and collapsible display modes.",
			},
		},
	},
	decorators: [createStorybookDecorator()],
	argTypes: {
		responseText: { control: "text", description: "The response text to display" },
	},
}

export default meta
type Story = StoryObj<typeof McpResponseDisplay>

export const BasicText: Story = {
	args: {
		responseText:
			"Here's a simple text response from an MCP server.\n\nThis demonstrates basic text rendering with proper line breaks and formatting.",
	},
}

export const WithUrls: Story = {
	args: {
		responseText:
			"Response with URLs:\n\nDocs: https://example.com/docs\nAPI: https://api.example.com/reference\nImage: https://via.placeholder.com/600x400?text=Sample",
	},
}

export const MixedContent: Story = {
	args: {
		responseText:
			"Mixed content response:\n\n## Links\n- Docs: https://example.com/docs\n- API: https://api.example.com/guide\n\n## Images\nScreenshot: https://via.placeholder.com/500x300?text=Screenshot\nDiagram: https://via.placeholder.com/400x400?text=Diagram",
	},
}

export const CollapsedByDefault: Story = {
	args: {
		responseText:
			"Collapsed response.\n\nClick header to expand.\n\nhttps://example.com/hidden\nhttps://via.placeholder.com/400x300?text=Hidden",
	},
	decorators: [createStorybookDecorator({ mcpResponsesCollapsed: true })],
}

export const PlainTextMode: Story = {
	args: {
		responseText:
			"Plain text mode response.\n\nURLs shown as text:\n- https://example.com/link\n- https://via.placeholder.com/400x300?text=Image",
	},
}

export const CodeResponse: Story = {
	args: {
		responseText:
			'Code with URLs:\n\n```javascript\nconst apiUrl = "https://api.example.com/v1/data";\nconst imageUrl = "https://via.placeholder.com/200x200?text=API";\n\nfetch(apiUrl)\n  .then(response => response.json())\n  .then(data => console.log(data));\n```\n\nDocs: https://docs.example.com/api',
	},
}

export const EmptyResponse: Story = {
	args: { responseText: "" },
}

export const LongResponse: Story = {
	args: {
		responseText:
			"Long response content.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\nResources:\n- Docs: https://docs.example.com/getting-started\n- API: https://docs.example.com/api-reference\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.\n\nImages:\n- https://via.placeholder.com/300x200?text=Logo\n- https://via.placeholder.com/400x300?text=Feature1\n- https://via.placeholder.com/400x300?text=Feature2",
	},
}
