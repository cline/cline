import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import McpConfigurationView from "./McpConfigurationView"
import { StorybookProvider, VSCodeWebview } from "../../common/StorybookDecorator"
import { ExtensionState } from "@shared/ExtensionMessage"
import { McpMarketplaceCatalog, McpViewTab } from "@shared/mcp"
import { useExtensionState } from "@/context/ExtensionStateContext"

const mcpMarketplaceCatalog: McpMarketplaceCatalog = {
	items: [
		{
			mcpId: "example-server",
			githubUrl: "https://github.com/example/mcp-server",
			name: "Example Server",
			author: "Example Author",
			description: "An example MCP server for demonstration",
			codiconIcon: "database",
			logoUrl: "https://example.com/logo.png",
			category: "Data",
			tags: ["example", "demo"],
			requiresApiKey: false,
			isRecommended: true,
			githubStars: 100,
			downloadCount: 500,
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2024-01-15T00:00:00Z",
			lastGithubSync: "2024-01-15T00:00:00Z",
		},
	],
}

const mcpservers = [
	{
		name: "example-server",
		config: "npx -y example-server",
		status: "connected" as const,
		tools: [{ name: "example_tool", description: "Example tool" }],
		resources: [],
		resourceTemplates: [],
	},
	{
		name: "filesystem",
		config: "npx -y @modelcontextprotocol/server-filesystem /path/to/files",
		status: "connected" as const,
		tools: [
			{
				name: "read_file",
				description: "Read contents of a file",
				inputSchema: {},
			},
			{
				name: "write_file",
				description: "Write contents to a file",
				inputSchema: {},
			},
		],
		resources: [],
		resourceTemplates: [],
	},
	{
		name: "database",
		config: "npx -y @modelcontextprotocol/server-sqlite /path/to/database.db",
		status: "disconnected" as const,
		error: "Connection failed",
		tools: [],
		resources: [],
		resourceTemplates: [],
	},
]

const createStoryDecorator =
	(
		state: Partial<ExtensionState> = { mcpMarketplaceEnabled: true },
		servers: McpMarketplaceCatalog = mcpMarketplaceCatalog,
		mcpServers = mcpservers,
	) =>
	(Story: React.ComponentType) => {
		const StoryWithCatalog = () => {
			const { setMcpMarketplaceCatalog, setMcpServers } = useExtensionState()

			React.useEffect(() => {
				setMcpMarketplaceCatalog(servers)
				setMcpServers(mcpServers)
				// Don't call setMcpTab or navigateToMcp here as they interfere with the component's initialTab prop
			}, [])

			return <Story />
		}

		return (
			<StorybookProvider
				mockState={{
					mcpMarketplaceEnabled: true,
					...state,
				}}>
				<StoryWithCatalog />
			</StorybookProvider>
		)
	}

const meta: Meta<typeof McpConfigurationView> = {
	title: "Component/McpConfigurationView",
	component: McpConfigurationView,
	decorators: [VSCodeWebview],
	argTypes: {
		initialTab: {
			control: "select",
			options: ["marketplace", "addRemote", "installed"],
			defaultValue: "marketplace",
		},
	},
	parameters: {
		layout: "fullscreen",
	},
}

const mcpDecorator = (Story: React.ComponentType) => {
	return (
		<StorybookProvider>
			<Story />
		</StorybookProvider>
	)
}

export default meta
type Story = StoryObj<typeof McpConfigurationView>

const defaultArgs = {
	initialTab: "marketplace" as McpViewTab,
}

export const Default: Story = {
	args: defaultArgs,
	decorators: [mcpDecorator],
}

export const MarketplaceEnabled: Story = {
	args: defaultArgs,
	decorators: [createStoryDecorator({ mcpMarketplaceEnabled: true }, mcpMarketplaceCatalog)],
}

export const MarketplaceDisabled: Story = {
	args: defaultArgs,
	decorators: [createStoryDecorator({ mcpMarketplaceEnabled: false })],
}

export const DisconnectedServers: Story = {
	args: {
		...defaultArgs,
		initialTab: "installed" as McpViewTab,
	},
	decorators: [
		(Story) => {
			const mockState = {
				mcpMarketplaceEnabled: true,
			} satisfies Partial<ExtensionState>

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
}
