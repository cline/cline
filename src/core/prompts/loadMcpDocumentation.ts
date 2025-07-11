import { McpHub } from "@services/mcp/McpHub"

export async function loadMcpDocumentation(mcpHub: McpHub) {
	return `## 创建 MCP 服务器

在创建 MCP 服务器时，必须理解它们运行在非交互式环境中。服务器不能在运行时启动 OAuth 流程、打开浏览器窗口或提示用户输入。所有凭证和认证令牌必须通过 MCP 设置配置中的环境变量预先提供。例如，Spotify 的 API 使用 OAuth 来获取用户的刷新令牌，但 MCP 服务器无法启动该流程。虽然你可以引导用户获取应用客户端 ID 和密钥，但你可能需要创建一个一次性设置脚本（如 get-refresh-token.js），该脚本用于捕获并记录拼图的最后一块：用户的刷新令牌（即你可以使用 execute_command 运行该脚本，脚本会打开浏览器进行认证，然后日志中记录刷新令牌，供你在 MCP 设置配置中使用）。

除非用户另有说明，新 MCP 服务器应创建在：${await mcpHub.getMcpServersPath()}

### 示例 MCP 服务器

例如，如果用户希望你具备检索天气信息的能力，你可以创建一个使用 OpenWeather API 获取天气信息的 MCP 服务器，将其添加到 MCP 设置配置文件中，从而注意到在系统提示中你现在可以使用新的工具和资源来展示给用户你新增的能力。

以下示例展示了如何构建一个提供天气数据功能的 MCP 服务器。虽然该示例展示了如何实现资源、资源模板和工具，但在实际应用中，你应优先使用工具，因为它们更灵活且能处理动态参数。资源及资源模板的实现此处主要用于演示 MCP 各种功能，而一个真正的天气服务器可能只会暴露用于获取天气数据的工具。（以下步骤适用于 macOS）

1. 使用 \`create-typescript-server\` 工具在默认的 MCP 服务器目录下引导创建一个新项目：

\`\`\`bash
cd ${await mcpHub.getMcpServersPath()}
npx @modelcontextprotocol/create-server weather-server
cd weather-server
# 安装依赖
npm install axios
\`\`\`

这将创建一个具有以下结构的新项目：

\`\`\`
weather-server/
  ├── package.json
      {
        ...
        "type": "module", // 默认添加，使用 ES 模块语法 (import/export) 而非 CommonJS (require/module.exports)（如果你在该服务器仓库创建额外脚本如 get-refresh-token.js，此信息很重要）
        "scripts": {
          "build": "tsc && node -e \"require('fs').chmodSync('build/index.js', '755')\"",
          ...
        }
        ...
      }
  ├── tsconfig.json
  └── src/
      └── weather-server/
          └── index.ts      # 服务器主要实现入口
\`\`\`

2. 将 \`src/index.ts\` 替换为以下内容：

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

const API_KEY = process.env.OPENWEATHER_API_KEY; // 由 MCP 配置提供
if (!API_KEY) {
  throw new Error('需要提供 OPENWEATHER_API_KEY 环境变量');
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
    
    // 错误处理
    this.server.onerror = (error) => console.error('[MCP 错误]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // MCP 资源代表 MCP 服务器想要提供给客户端的任意 UTF-8 编码数据，如数据库记录、API 响应、日志文件等。服务器可定义具有静态 URI 的直接资源，或遵循 \`[protocol]://[host]/[path]\` 格式的动态资源模板。
  private setupResourceHandlers() {
    // 对于静态资源，服务器可以暴露一个资源列表：
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        // 虽然这不是一个理想的例子（你可以使用资源模板获取相同信息），但此处展示了如何定义一个静态资源
        {
          uri: \`weather://San Francisco/current\`, // 旧金山天气资源的唯一标识符
          name: \`旧金山当前天气\`, // 人性化的名称
          mimeType: 'application/json', // 可选 MIME 类型
          // 可选描述
          description:
            '旧金山的实时天气数据，包括温度、天气状况、湿度和风速',
        },
      ],
    }));

    // 对于动态资源，服务器可以暴露资源模板：
    this.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async () => ({
        resourceTemplates: [
          {
            uriTemplate: 'weather://{city}/current', // URI 模板 (RFC 6570)
            name: '指定城市的当前天气', // 人性化名称
            mimeType: 'application/json', // 可选 MIME 类型
            description: '指定城市的实时天气数据', // 可选描述
          },
        ],
      })
    );

    // ReadResourceRequestSchema 用于静态资源和动态资源模板
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const match = request.params.uri.match(
          /^weather:\/\/([^/]+)\/current$/
        );
        if (!match) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            \`无效的 URI 格式: \${request.params.uri}\`
          );
        }
        const city = decodeURIComponent(match[1]);

        try {
          const response = await this.axiosInstance.get(
            'weather', // 当前天气
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
              \`天气 API 错误: \${
                error.response?.data.message ?? error.message
              }\`
            );
          }
          throw error;
        }
      }
    );
  }

  /* MCP 工具允许服务器向系统暴露可执行功能。通过这些工具，你可以与外部系统交互、执行运算并在现实中采取行动。
   * - 与资源类似，工具具有唯一的名称，并可包含指导说明。然而，与资源不同的是，工具代表动态操作，能够修改状态或与外部系统交互。
   * - 尽管资源和工具有相似之处，但在可能的情况下，你应优先创建工具，因为它们提供更高的灵活性。
   */
  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_forecast', // 唯一标识符
          description: '获取指定城市的天气预报', // 人性化描述
          inputSchema: {
            // 参数的 JSON Schema
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: '城市名称',
              },
              days: {
                type: 'number',
                description: '天数 (1-5)',
                minimum: 1,
                maximum: 5,
              },
            },
            required: ['city'], // 必需属性数组
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'get_forecast') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          \`未知的工具: \${request.params.name}\`
        );
      }

      if (!isValidForecastArgs(request.params.arguments)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          '无效的天气预报参数'
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
                text: \`天气 API 错误: \${
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
    console.error('天气 MCP 服务器已通过 stdio 运行');
  }
}

const server = new WeatherServer();
server.run().catch(console.error);
\`\`\`

（注意：这仅是一个示例——你可以使用不同的依赖项，将实现分拆到多个文件中等。）

3. 构建并编译可执行的 JavaScript 文件

\`\`\`bash
npm run build
\`\`\`

4. 当需要通过环境变量（如 API 密钥）来配置 MCP 服务器时，引导用户完成获取密钥的流程。例如，用户可能需要创建账户并访问开发者仪表盘以生成密钥。提供逐步说明和相关链接，方便用户获取必要的信息。然后使用 ask_followup_question 工具询问用户提供此处的 OpenWeather API 密钥。

5. 通过将 MCP 服务器配置添加到位于 '${await mcpHub.getMcpSettingsFilePath()}' 的设置文件中来安装 MCP 服务器。该设置文件中可能已有其他 MCP 服务器配置，因此你需要先读取该文件，再向现有的 \`mcpServers\` 对象中添加新服务器。

重要提示：无论 MCP 设置文件中还有何内容，你创建的新 MCP 服务器其默认值必须设置为 disabled=false 且 autoApprove=[]。

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
    }
  }
}
\`\`\`

（注：用户也可能要求你将 MCP 服务器安装到 Claude 桌面应用，此时你需要读取并修改 macOS 下 \`~/Library/Application Support/Claude/claude_desktop_config.json\` 文件，其格式与顶级 \`mcpServers\` 对象相同。）

6. 在你编辑 MCP 设置配置文件后，系统会自动运行所有服务器，并在“Connected MCP Servers”部分中暴露可用的工具和资源。（注意：如果在测试新安装的 MCP 服务器时遇到“未连接”的错误，一个常见原因是 MCP 设置配置中的构建路径不正确。由于编译后的 JavaScript 文件通常输出到 “dist/” 或 “build/” 目录中，请检查 MCP 设置中的构建路径是否与实际编译输出相符。例如，如果你假定目录为 “build”，请检查 tsconfig.json 是否实际使用 “dist”。）

7. 既然你已经可以使用这些新的工具和资源，你可以建议用户如何命令你调用它们——例如，当这个新的天气工具可用时，你可以邀请用户询问“旧金山天气如何？”。
`
}
