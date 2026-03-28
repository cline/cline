/**
 * 05-custom-tools.ts
 *
 * Learn how to create and use custom tools with the Cline SDK.
 *
 * This example shows how to:
 * - Define custom tool schemas
 * - Implement tool executors
 * - Pass custom tools to agents
 * - Handle tool errors gracefully
 * - Create tools that call external APIs
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 05-custom-tools.ts
 */

import { ClineCore, type Tool } from "@clinebot/core";

// Example 1: Simple calculator tool
const calculatorTool: Tool = {
	name: "calculator",
	description:
		"Perform basic arithmetic operations (add, subtract, multiply, divide)",
	inputSchema: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: ["add", "subtract", "multiply", "divide"],
				description: "The arithmetic operation to perform",
			},
			a: {
				type: "number",
				description: "First number",
			},
			b: {
				type: "number",
				description: "Second number",
			},
		},
		required: ["operation", "a", "b"],
	},
	execute: async (input: unknown) => {
		const args = input as {
			operation: string;
			a: number;
			b: number;
		};
		try {
			let result: number;

			switch (args.operation) {
				case "add":
					result = args.a + args.b;
					break;
				case "subtract":
					result = args.a - args.b;
					break;
				case "multiply":
					result = args.a * args.b;
					break;
				case "divide":
					if (args.b === 0) {
						return {
							success: false,
							output: "Error: Division by zero is not allowed",
						};
					}
					result = args.a / args.b;
					break;
				default:
					return {
						success: false,
						output: `Unknown operation: ${args.operation}`,
					};
			}

			return {
				success: true,
				output: `Result: ${result}`,
			};
		} catch (error) {
			return {
				success: false,
				output: `Error: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};

// Example 2: Weather tool (simulated API)
const weatherTool: Tool = {
	name: "get_weather",
	description: "Get current weather information for a city",
	inputSchema: {
		type: "object",
		properties: {
			city: {
				type: "string",
				description: "Name of the city",
			},
			units: {
				type: "string",
				enum: ["celsius", "fahrenheit"],
				description: "Temperature units",
			},
		},
		required: ["city"],
	},
	execute: async (input: unknown) => {
		const args = input as {
			city: string;
			units?: string;
		};
		// Simulate API call with mock data
		const mockWeather: Record<string, { temp: number; condition: string }> = {
			"san francisco": { temp: 18, condition: "Foggy" },
			"new york": { temp: 22, condition: "Sunny" },
			london: { temp: 15, condition: "Rainy" },
			tokyo: { temp: 25, condition: "Partly Cloudy" },
		};

		const cityKey = args.city.toLowerCase();
		const weather = mockWeather[cityKey];

		if (!weather) {
			return {
				success: false,
				output: `Weather data not available for ${args.city}. Available cities: ${Object.keys(mockWeather).join(", ")}`,
			};
		}

		const units = args.units || "celsius";
		let temp = weather.temp;

		if (units === "fahrenheit") {
			temp = (temp * 9) / 5 + 32;
		}

		return {
			success: true,
			output: `Weather in ${args.city}:
Temperature: ${Math.round(temp)}°${units === "fahrenheit" ? "F" : "C"}
Condition: ${weather.condition}`,
		};
	},
};

// Example 3: Database query tool (simulated)
const databaseTool: Tool = {
	name: "query_database",
	description: "Query a mock user database",
	inputSchema: {
		type: "object",
		properties: {
			query_type: {
				type: "string",
				enum: ["get_user", "list_users", "count_users"],
				description: "Type of query to execute",
			},
			user_id: {
				type: "number",
				description: "User ID (required for get_user)",
			},
		},
		required: ["query_type"],
	},
	execute: async (input: unknown) => {
		const args = input as {
			query_type: string;
			user_id?: number;
		};
		// Mock database
		const mockUsers = [
			{
				id: 1,
				name: "Alice Johnson",
				email: "alice@example.com",
				role: "admin",
			},
			{ id: 2, name: "Bob Smith", email: "bob@example.com", role: "user" },
			{
				id: 3,
				name: "Carol Williams",
				email: "carol@example.com",
				role: "user",
			},
		];

		try {
			switch (args.query_type) {
				case "get_user": {
					if (args.user_id === undefined) {
						return {
							success: false,
							output: "Error: user_id is required for get_user query",
						};
					}
					const user = mockUsers.find((u) => u.id === args.user_id);
					if (!user) {
						return {
							success: false,
							output: `User with ID ${args.user_id} not found`,
						};
					}
					return {
						success: true,
						output: JSON.stringify(user, null, 2),
					};
				}

				case "list_users": {
					return {
						success: true,
						output: JSON.stringify(mockUsers, null, 2),
					};
				}

				case "count_users": {
					return {
						success: true,
						output: `Total users: ${mockUsers.length}`,
					};
				}

				default:
					return {
						success: false,
						output: `Unknown query type: ${args.query_type}`,
					};
			}
		} catch (error) {
			return {
				success: false,
				output: `Database error: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};

// Example 4: File metadata tool
const fileMetadataTool: Tool = {
	name: "get_file_metadata",
	description: "Get metadata about a file (size, modified date, etc.)",
	inputSchema: {
		type: "object",
		properties: {
			filepath: {
				type: "string",
				description: "Path to the file",
			},
		},
		required: ["filepath"],
	},
	execute: async (input: unknown) => {
		const args = input as { filepath: string };
		try {
			const fs = await import("node:fs/promises");
			const path = await import("node:path");

			const stats = await fs.stat(args.filepath);

			return {
				success: true,
				output: `File: ${path.basename(args.filepath)}
Size: ${stats.size} bytes
Modified: ${stats.mtime.toISOString()}
Is Directory: ${stats.isDirectory()}
Is File: ${stats.isFile()}`,
			};
		} catch (error) {
			return {
				success: false,
				output: `Error reading file metadata: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	},
};

async function demoCalculatorTool() {
	console.log("\n=== Calculator Tool ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			// Add custom tool via extraTools
			extraTools: [calculatorTool],

			systemPrompt:
				"You are a helpful assistant with access to a calculator tool. Use it to help with math problems.",
		},
		prompt: "What is 12345 multiplied by 6789?",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoWeatherTool() {
	console.log("\n=== Weather Tool ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			extraTools: [weatherTool],
			systemPrompt:
				"You are a helpful weather assistant. Use the weather tool to provide current conditions.",
		},
		prompt: "What's the weather like in Tokyo? Please show it in Fahrenheit.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoDatabaseTool() {
	console.log("\n=== Database Query Tool ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			extraTools: [databaseTool],
			systemPrompt:
				"You are a helpful assistant with access to a user database. Help users query the database.",
		},
		prompt: "Show me all users in the database and tell me who the admin is.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoMultipleTools() {
	console.log("\n=== Multiple Custom Tools ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			// Pass multiple custom tools
			extraTools: [calculatorTool, weatherTool, databaseTool, fileMetadataTool],

			systemPrompt:
				"You are a versatile assistant with access to calculator, weather, database, and file tools. Use them as needed.",
		},
		prompt:
			"How many users are in the database? Then check the weather in London and get metadata for package.json",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	await demoCalculatorTool();
	await demoWeatherTool();
	await demoDatabaseTool();
	await demoMultipleTools();

	console.log("\n✅ All custom tool demos completed!");
}

main().catch(console.error);
