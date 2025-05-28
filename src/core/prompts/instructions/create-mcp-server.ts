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
npm install axios zod @modelcontextprotocol/sdk
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
			└── index.ts      # Main server implementation
\`\`\`

2. Replace \`src/index.ts\` with the following:

\`\`\`typescript
#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from 'axios';

const API_KEY = process.env.OPENWEATHER_API_KEY; // provided by MCP config
if (!API_KEY) {
  throw new Error('OPENWEATHER_API_KEY environment variable is required');
}

// Define types for OpenWeather API responses
interface WeatherData {
  main: {
    temp: number;
    humidity: number;
  };
  weather: Array<{
    description: string;
  }>;
  wind: {
    speed: number;
  };
}

interface ForecastData {
  list: Array<WeatherData & {
    dt_txt: string;
  }>;
}

// Create an MCP server
const server = new McpServer({
  name: "weather-server",
  version: "0.1.0"
});

// Create axios instance for OpenWeather API
const weatherApi = axios.create({
  baseURL: 'http://api.openweathermap.org/data/2.5',
  params: {
    appid: API_KEY,
    units: 'metric',
  },
});

// Add a tool for getting weather forecasts
server.tool(
  "get_forecast",
  {
    city: z.string().describe("City name"),
    days: z.number().min(1).max(5).optional().describe("Number of days (1-5)"),
  },
  async ({ city, days = 3 }) => {
    try {
      const response = await weatherApi.get<ForecastData>('forecast', {
        params: {
          q: city,
          cnt: Math.min(days, 5) * 8,
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data.list, null, 2),
          },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          content: [
            {
              type: "text",
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
  }
);

// Add a resource for current weather in San Francisco
server.resource(
  "sf_weather",
  { uri: "weather://San Francisco/current", list: true },
  async (uri) => {
    try {
      const response = weatherApi.get<WeatherData>('weather', {
        params: { q: "San Francisco" },
      });

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
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
        throw new Error(\`Weather API error: \${
          error.response?.data.message ?? error.message
        }\`);
      }
      throw error;
    }
  }
);

// Add a dynamic resource template for current weather by city
server.resource(
  "current_weather",
  new ResourceTemplate("weather://{city}/current", { list: true }),
  async (uri, { city }) => {
    try {
      const response = await weatherApi.get('weather', {
        params: { q: city },
      });

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
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
        throw new Error(\`Weather API error: \${
          error.response?.data.message ?? error.message
        }\`);
      }
      throw error;
    }
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Weather MCP server running on stdio');
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

The user may ask to add tools or resources that may make sense to add to an existing MCP server (listed under 'Connected MCP Servers' above: ${(() => {
		if (!mcpHub) return "(None running currently)"
		const servers = mcpHub
			.getServers()
			.map((server) => server.name)
			.join(", ")
		return servers || "(None running currently)"
	})()}, e.g. if it would use the same API. This would be possible if you can locate the MCP server repository on the user's system by looking at the server arguments for a filepath. You might then use list_files and read_file to explore the files in the repository, and use write_to_file${diffStrategy ? " or apply_diff" : ""} to make changes to the files.

However some MCP servers may be running from installed packages rather than a local repository, in which case it may make more sense to create a new MCP server.

# MCP Servers Are Not Always Necessary

The user may not always request the use or creation of MCP servers. Instead, they might provide tasks that can be completed with existing tools. While using the MCP SDK to extend your capabilities can be useful, it's important to understand that this is just one specialized type of task you can accomplish. You should only implement MCP servers when the user explicitly requests it (e.g., "add a tool that...").

Remember: The MCP documentation and example provided above are to help you understand and work with existing MCP servers or create new ones when requested by the user. You already have access to tools and capabilities that can be used to accomplish a wide range of tasks.`
}
