import { McpHub } from "../../../services/mcp/McpHub"
import { DiffStrategy } from "../../../shared/tools"

export async function createMCPServerInstructions(
	mcpHub: McpHub | undefined,
	diffStrategy: DiffStrategy | undefined,
): Promise<string> {
	if (!diffStrategy || !mcpHub) throw new Error("Missing MCP Hub or Diff Strategy")

	return `You have the ability to create an MCP server and add it to a configuration file that will then expose the tools and resources for you to use with \`use_mcp_tool\` and \`access_mcp_resource\`.

When creating MCP servers, it's important to understand that they operate in a non-interactive environment. The server cannot initiate OAuth flows, open browser windows, or prompt for user input during runtime. All credentials and authentication tokens must be provided upfront through environment variables in the MCP settings configuration. For example, Spotify's API uses OAuth to get a refresh token for the user, but the MCP server cannot initiate this flow. While you can walk the user through obtaining an application client ID and secret, you may have to create a separate one-time setup script (like get-refresh-token.js) that captures and logs the final piece of the puzzle: the user's refresh token (i.e. you might run the script using execute_command which would open a browser for authentication, and then log the refresh token so that you can see it in the command output for you to use in the MCP settings configuration).

Unless the user specifies otherwise, new local MCP servers should be created in: ${await mcpHub.getMcpServersPath()}

### MCP Server Types and Configuration

MCP servers can be configured in two ways in the MCP settings file:

1. Local (Stdio) Server Configuration:
\`\`\`json
{
	"mcpServers": {
		"local-weather": {
			"command": "node",
			"args": ["/path/to/weather-server/build/index.js"],
			"env": {
				"OPENWEATHER_API_KEY": "your-api-key"
			}
		}
	}
}
\`\`\`

2. Remote (SSE) Server Configuration:
\`\`\`json
{
	"mcpServers": {
		"remote-weather": {
			"url": "https://api.example.com/mcp",
			"headers": {
				"Authorization": "Bearer your-api-key"
			}
		}
	}
}
\`\`\`

Common configuration options for both types:
- \`disabled\`: (optional) Set to true to temporarily disable the server
- \`timeout\`: (optional) Maximum time in seconds to wait for server responses (default: 60)
- \`alwaysAllow\`: (optional) Array of tool names that don't require user confirmation

### Example Local MCP Server

For example, if the user wanted to give you the ability to retrieve weather information, you could create an MCP server that uses the OpenWeather API to get weather information, add it to the MCP settings configuration file, and then notice that you now have access to new tools and resources in the system prompt that you might use to show the user your new capabilities.

The following example demonstrates how to build a local MCP server that provides weather data functionality using the Stdio transport. While this example shows how to implement resources, resource templates, and tools, in practice you should prefer using tools since they are more flexible and can handle dynamic parameters. The resource and resource template implementations are included here mainly for demonstration purposes of the different MCP capabilities, but a real weather server would likely just expose tools for fetching weather data. (The following steps are for macOS)

1. Use the \`create-typescript-server\` tool to bootstrap a new project in the default MCP servers directory:

\`\`\`bash
cd ${await mcpHub.getMcpServersPath()}
npx @modelcontextprotocol/create-server weather-server
cd weather-server
# Install dependencies
npm install axios
\`\`\`

This will create a new project with the following structure:

\`\`\`
weather-server/
	├── package.json
			{
				...
				"type": "module", // added by default, uses ES module syntax (import/export) rather than CommonJS (require/module.exports) (Important to know if you create additional scripts in this server repository like a get-refresh-token.js script)
				"scripts": {
					"build": "tsc && node -e \"require('fs').chmodSync('build/index.js', '755')\"",
					...
				}
				...
			}
	├── tsconfig.json
	└── src/
			└── weather-server/
					└── index.ts      # Main server implementation
\`\`\`

2. Replace \`src/index.ts\` with the following:

\`\`\`typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ErrorCode,
	ListResourcesRequestSchema,
	ListResourceTemplatesRequestSchema,
	ListToolsRequestSchema,
	McpError,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const API_KEY = process.env.OPENWEATHER_API_KEY; // provided by MCP config
if (!API_KEY) {
	throw new Error('OPENWEATHER_API_KEY environment variable is required');
}

interface OpenWeatherResponse {
	main: {
		temp: number;
		humidity: number;
	};
	weather: [{ description: string }];
	wind: { speed: number };
	dt_txt?: string;
}

const isValidForecastArgs = (
	args: any
): args is { city: string; days?: number } =>
	typeof args === 'object' &&
	args !== null &&
	typeof args.city === 'string' &&
	(args.days === undefined || typeof args.days === 'number');

class WeatherServer {
	private server: Server;
	private axiosInstance;

	constructor() {
		this.server = new Server(
			{
				name: 'example-weather-server',
				version: '0.1.0',
			},
			{
				capabilities: {
					resources: {},
					tools: {},
				},
			}
		);

		this.axiosInstance = axios.create({
			baseURL: 'http://api.openweathermap.org/data/2.5',
			params: {
				appid: API_KEY,
				units: 'metric',
			},
		});

		this.setupResourceHandlers();
		this.setupToolHandlers();
		
		// Error handling
		this.server.onerror = (error) => console.error('[MCP Error]', error);
		process.on('SIGINT', async () => {
			await this.server.close();
			process.exit(0);
		});
	}

	// MCP Resources represent any kind of UTF-8 encoded data that an MCP server wants to make available to clients, such as database records, API responses, log files, and more. Servers define direct resources with a static URI or dynamic resources with a URI template that follows the format \`[protocol]://[host]/[path]\`.
	private setupResourceHandlers() {
		// For static resources, servers can expose a list of resources:
		this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
			resources: [
				// This is a poor example since you could use the resource template to get the same information but this demonstrates how to define a static resource
				{
					uri: \`weather://San Francisco/current\`, // Unique identifier for San Francisco weather resource
					name: \`Current weather in San Francisco\`, // Human-readable name
					mimeType: 'application/json', // Optional MIME type
					// Optional description
					description:
						'Real-time weather data for San Francisco including temperature, conditions, humidity, and wind speed',
				},
			],
		}));

		// For dynamic resources, servers can expose resource templates:
		this.server.setRequestHandler(
			ListResourceTemplatesRequestSchema,
			async () => ({
				resourceTemplates: [
					{
						uriTemplate: 'weather://{city}/current', // URI template (RFC 6570)
						name: 'Current weather for a given city', // Human-readable name
						mimeType: 'application/json', // Optional MIME type
						description: 'Real-time weather data for a specified city', // Optional description
					},
				],
			})
		);

		// ReadResourceRequestSchema is used for both static resources and dynamic resource templates
		this.server.setRequestHandler(
			ReadResourceRequestSchema,
			async (request) => {
				const match = request.params.uri.match(
					/^weather:\/\/([^/]+)\/current$/
				);
				if (!match) {
					throw new McpError(
						ErrorCode.InvalidRequest,
						\`Invalid URI format: \${request.params.uri}\`
					);
				}
				const city = decodeURIComponent(match[1]);

				try {
					const response = await this.axiosInstance.get(
						'weather', // current weather
						{
							params: { q: city },
						}
					);

					return {
						contents: [
							{
								uri: request.params.uri,
								mimeType: 'application/json',
								text: JSON.stringify(
									{
										temperature: response.data.main.temp,
										conditions: response.data.weather[0].description,
										humidity: response.data.main.humidity,
										wind_speed: response.data.wind.speed,
										timestamp: new Date().toISOString(),
									},
									null,
									2
								),
							},
						],
					};
				} catch (error) {
					if (axios.isAxiosError(error)) {
						throw new McpError(
							ErrorCode.InternalError,
							\`Weather API error: \${
								error.response?.data.message ?? error.message
							}\`
						);
					}
					throw error;
				}
			}
		);
	}

	/* MCP Tools enable servers to expose executable functionality to the system. Through these tools, you can interact with external systems, perform computations, and take actions in the real world.
	 * - Like resources, tools are identified by unique names and can include descriptions to guide their usage. However, unlike resources, tools represent dynamic operations that can modify state or interact with external systems.
	 * - While resources and tools are similar, you should prefer to create tools over resources when possible as they provide more flexibility.
	 */
	private setupToolHandlers() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
				{
					name: 'get_forecast', // Unique identifier
					description: 'Get weather forecast for a city', // Human-readable description
					inputSchema: {
						// JSON Schema for parameters
						type: 'object',
						properties: {
							city: {
								type: 'string',
								description: 'City name',
							},
							days: {
								type: 'number',
								description: 'Number of days (1-5)',
								minimum: 1,
								maximum: 5,
							},
						},
						required: ['city'], // Array of required property names
					},
				},
			],
		}));

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			if (request.params.name !== 'get_forecast') {
				throw new McpError(
					ErrorCode.MethodNotFound,
					\`Unknown tool: \${request.params.name}\`
				);
			}

			if (!isValidForecastArgs(request.params.arguments)) {
				throw new McpError(
					ErrorCode.InvalidParams,
					'Invalid forecast arguments'
				);
			}

			const city = request.params.arguments.city;
			const days = Math.min(request.params.arguments.days || 3, 5);

			try {
				const response = await this.axiosInstance.get<{
					list: OpenWeatherResponse[];
				}>('forecast', {
					params: {
						q: city,
						cnt: days * 8,
					},
				});

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(response.data.list, null, 2),
						},
					],
				};
			} catch (error) {
				if (axios.isAxiosError(error)) {
					return {
						content: [
							{
								type: 'text',
								text: \`Weather API error: \${
									error.response?.data.message ?? error.message
								}\`,
							},
						],
						isError: true,
					};
				}
				throw error;
			}
		});
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error('Weather MCP server running on stdio');
	}
}

const server = new WeatherServer();
server.run().catch(console.error);
\`\`\`

(Remember: This is just an example–you may use different dependencies, break the implementation up into multiple files, etc.)

3. Build and compile the executable JavaScript file

\`\`\`bash
npm run build
\`\`\`

4. Whenever you need an environment variable such as an API key to configure the MCP server, walk the user through the process of getting the key. For example, they may need to create an account and go to a developer dashboard to generate the key. Provide step-by-step instructions and URLs to make it easy for the user to retrieve the necessary information. Then use the ask_followup_question tool to ask the user for the key, in this case the OpenWeather API key.

5. Install the MCP Server by adding the MCP server configuration to the settings file located at '${await mcpHub.getMcpSettingsFilePath()}'. The settings file may have other MCP servers already configured, so you would read it first and then add your new server to the existing \`mcpServers\` object.

IMPORTANT: Regardless of what else you see in the MCP settings file, you must default any new MCP servers you create to disabled=false and alwaysAllow=[].

\`\`\`json
{
	"mcpServers": {
		...,
		"weather": {
			"command": "node",
			"args": ["/path/to/weather-server/build/index.js"],
			"env": {
				"OPENWEATHER_API_KEY": "user-provided-api-key"
			}
		},
	}
}
\`\`\`

(Note: the user may also ask you to install the MCP server to the Claude desktop app, in which case you would read then modify \`~/Library/Application\ Support/Claude/claude_desktop_config.json\` on macOS for example. It follows the same format of a top level \`mcpServers\` object.)

6. After you have edited the MCP settings configuration file, the system will automatically run all the servers and expose the available tools and resources in the 'Connected MCP Servers' section.

7. Now that you have access to these new tools and resources, you may suggest ways the user can command you to invoke them - for example, with this new weather tool now available, you can invite the user to ask "what's the weather in San Francisco?"

## Editing MCP Servers

The user may ask to add tools or resources that may make sense to add to an existing MCP server (listed under 'Connected MCP Servers' above: ${
		mcpHub
			.getServers()
			.map((server) => server.name)
			.join(", ") || "(None running currently)"
	}, e.g. if it would use the same API. This would be possible if you can locate the MCP server repository on the user's system by looking at the server arguments for a filepath. You might then use list_files and read_file to explore the files in the repository, and use write_to_file${diffStrategy ? " or apply_diff" : ""} to make changes to the files.

However some MCP servers may be running from installed packages rather than a local repository, in which case it may make more sense to create a new MCP server.

# MCP Servers Are Not Always Necessary

The user may not always request the use or creation of MCP servers. Instead, they might provide tasks that can be completed with existing tools. While using the MCP SDK to extend your capabilities can be useful, it's important to understand that this is just one specialized type of task you can accomplish. You should only implement MCP servers when the user explicitly requests it (e.g., "add a tool that...").

Remember: The MCP documentation and example provided above are to help you understand and work with existing MCP servers or create new ones when requested by the user. You already have access to tools and capabilities that can be used to accomplish a wide range of tasks.`
}
