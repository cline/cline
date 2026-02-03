import { Command } from "commander"
import { beforeEach, describe, expect, it } from "vitest"

/**
 * Tests for CLI command parsing and structure
 * These tests verify the commander.js command definitions without
 * actually running the commands (which would require full infrastructure)
 */

describe("CLI Commands", () => {
	let program: Command

	beforeEach(() => {
		// Create a fresh program instance for each test
		program = new Command()
		program.name("cline").description("Cline CLI - AI coding assistant").version("0.0.0")
		program.enablePositionalOptions()

		// Define commands matching index.ts
		program
			.command("task")
			.alias("t")
			.description("Run a new task")
			.argument("<prompt>", "The task prompt")
			.option("-a, --act", "Run in act mode")
			.option("-p, --plan", "Run in plan mode")
			.option("-y, --yolo", "Enable yolo mode")
			.option("-m, --model <model>", "Model to use")
			.option("-i, --images <paths...>", "Image file paths")
			.option("-v, --verbose", "Show verbose output")
			.option("-c, --cwd <path>", "Working directory")
			.option("--config <path>", "Configuration directory")
			.option("--thinking", "Enable extended thinking")
			.action(() => {})

		program
			.command("history")
			.alias("h")
			.description("List task history")
			.option("-n, --limit <number>", "Number of tasks to show", "10")
			.option("-p, --page <number>", "Page number", "1")
			.option("--config <path>", "Configuration directory")
			.action(() => {})

		program
			.command("config")
			.description("Show current configuration")
			.option("--config <path>", "Configuration directory")
			.action(() => {})

		program
			.command("auth")
			.description("Authenticate a provider")
			.option("-p, --provider <id>", "Provider ID")
			.option("-k, --apikey <key>", "API key")
			.option("-m, --modelid <id>", "Model ID")
			.option("-b, --baseurl <url>", "Base URL")
			.option("-v, --verbose", "Verbose output")
			.option("-c, --cwd <path>", "Working directory")
			.option("--config <path>", "Configuration directory")
			.action(() => {})

		// Default command for interactive mode
		program
			.argument("[prompt]", "Task prompt")
			.option("-i, --images <paths...>", "Image file paths")
			.option("-v, --verbose", "Verbose output")
			.option("-c, --cwd <path>", "Working directory")
			.option("--config <path>", "Configuration directory")
			.option("--thinking", "Enable extended thinking")
			.action(() => {})
	})

	describe("task command", () => {
		it("should parse task command with prompt", () => {
			const args = ["node", "cli", "task", "write hello world"]
			program.parse(args)
			// Command should be parsed without error
		})

		it("should parse task alias", () => {
			const args = ["node", "cli", "t", "write hello world"]
			program.parse(args)
		})

		it("should parse --act flag", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--act"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().act).toBe(true)
		})

		it("should parse --plan flag", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--plan"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().plan).toBe(true)
		})

		it("should parse --yolo flag", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--yolo"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().yolo).toBe(true)
		})

		it("should parse --model option", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--model", "claude-sonnet-4-20250514"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().model).toBe("claude-sonnet-4-20250514")
		})

		it("should parse --images option with multiple paths", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--images", "/path/to/img1.png", "/path/to/img2.jpg"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().images).toEqual(["/path/to/img1.png", "/path/to/img2.jpg"])
		})

		it("should parse --verbose flag", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--verbose"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().verbose).toBe(true)
		})

		it("should parse --cwd option", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--cwd", "/some/path"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().cwd).toBe("/some/path")
		})

		it("should parse --config option", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--config", "/custom/config"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().config).toBe("/custom/config")
		})

		it("should parse --thinking flag", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "--thinking"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().thinking).toBe(true)
		})

		it("should parse short flags", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const args = ["test prompt", "-a", "-v", "-m", "gpt-4"]
			taskCmd.parse(args, { from: "user" })
			expect(taskCmd.opts().act).toBe(true)
			expect(taskCmd.opts().verbose).toBe(true)
			expect(taskCmd.opts().model).toBe("gpt-4")
		})
	})

	describe("history command", () => {
		it("should have default limit of 10", () => {
			const historyCmd = program.commands.find((c) => c.name() === "history")!
			historyCmd.parse([], { from: "user" })
			expect(historyCmd.opts().limit).toBe("10")
		})

		it("should have default page of 1", () => {
			const historyCmd = program.commands.find((c) => c.name() === "history")!
			historyCmd.parse([], { from: "user" })
			expect(historyCmd.opts().page).toBe("1")
		})

		it("should parse --limit option", () => {
			const historyCmd = program.commands.find((c) => c.name() === "history")!
			const args = ["--limit", "20"]
			historyCmd.parse(args, { from: "user" })
			expect(historyCmd.opts().limit).toBe("20")
		})

		it("should parse --page option", () => {
			const historyCmd = program.commands.find((c) => c.name() === "history")!
			const args = ["--page", "3"]
			historyCmd.parse(args, { from: "user" })
			expect(historyCmd.opts().page).toBe("3")
		})

		it("should parse history alias", () => {
			const args = ["node", "cli", "h"]
			program.parse(args)
			// Alias should work
		})

		it("should parse short flags", () => {
			const historyCmd = program.commands.find((c) => c.name() === "history")!
			const args = ["-n", "5", "-p", "2"]
			historyCmd.parse(args, { from: "user" })
			expect(historyCmd.opts().limit).toBe("5")
			expect(historyCmd.opts().page).toBe("2")
		})
	})

	describe("config command", () => {
		it("should parse config command", () => {
			const args = ["node", "cli", "config"]
			program.parse(args)
		})

		it("should parse --config option", () => {
			const configCmd = program.commands.find((c) => c.name() === "config")!
			const args = ["--config", "/custom/path"]
			configCmd.parse(args, { from: "user" })
			expect(configCmd.opts().config).toBe("/custom/path")
		})
	})

	describe("auth command", () => {
		it("should parse auth command", () => {
			const args = ["node", "cli", "auth"]
			program.parse(args)
		})

		it("should parse --provider option", () => {
			const authCmd = program.commands.find((c) => c.name() === "auth")!
			const args = ["--provider", "openai"]
			authCmd.parse(args, { from: "user" })
			expect(authCmd.opts().provider).toBe("openai")
		})

		it("should parse --apikey option", () => {
			const authCmd = program.commands.find((c) => c.name() === "auth")!
			const args = ["--apikey", "sk-test-key"]
			authCmd.parse(args, { from: "user" })
			expect(authCmd.opts().apikey).toBe("sk-test-key")
		})

		it("should parse --modelid option", () => {
			const authCmd = program.commands.find((c) => c.name() === "auth")!
			const args = ["--modelid", "gpt-4"]
			authCmd.parse(args, { from: "user" })
			expect(authCmd.opts().modelid).toBe("gpt-4")
		})

		it("should parse --baseurl option", () => {
			const authCmd = program.commands.find((c) => c.name() === "auth")!
			const args = ["--baseurl", "https://api.example.com"]
			authCmd.parse(args, { from: "user" })
			expect(authCmd.opts().baseurl).toBe("https://api.example.com")
		})

		it("should parse short flags", () => {
			const authCmd = program.commands.find((c) => c.name() === "auth")!
			const args = ["-p", "anthropic", "-k", "key123", "-m", "claude-sonnet-4-20250514"]
			authCmd.parse(args, { from: "user" })
			expect(authCmd.opts().provider).toBe("anthropic")
			expect(authCmd.opts().apikey).toBe("key123")
			expect(authCmd.opts().modelid).toBe("claude-sonnet-4-20250514")
		})
	})

	describe("default command (interactive mode)", () => {
		it("should parse optional prompt argument", () => {
			const args = ["node", "cli", "do something"]
			program.parse(args)
		})

		it("should parse without prompt (interactive mode)", () => {
			const args = ["node", "cli"]
			program.parse(args)
		})

		it("should parse --images option", () => {
			program.parse(["node", "cli", "--images", "img.png"])
			expect(program.opts().images).toEqual(["img.png"])
		})

		it("should parse --verbose flag", () => {
			program.parse(["node", "cli", "--verbose"])
			expect(program.opts().verbose).toBe(true)
		})

		it("should parse --thinking flag", () => {
			program.parse(["node", "cli", "--thinking"])
			expect(program.opts().thinking).toBe(true)
		})
	})

	describe("command structure", () => {
		it("should have all expected commands", () => {
			const commandNames = program.commands.map((c) => c.name())
			expect(commandNames).toContain("task")
			expect(commandNames).toContain("history")
			expect(commandNames).toContain("config")
			expect(commandNames).toContain("auth")
		})

		it("should have correct aliases", () => {
			const taskCmd = program.commands.find((c) => c.name() === "task")!
			const historyCmd = program.commands.find((c) => c.name() === "history")!
			expect(taskCmd.aliases()).toContain("t")
			expect(historyCmd.aliases()).toContain("h")
		})

		it("should have descriptions for all commands", () => {
			for (const cmd of program.commands) {
				expect(cmd.description()).toBeTruthy()
			}
		})
	})
})

describe("getProviderModelIdKey", () => {
	// Test the provider model ID key mapping logic
	const providerKeyMap: Record<string, string> = {
		openrouter: "OpenRouterModelId",
		cline: "OpenRouterModelId",
		openai: "OpenAiModelId",
		ollama: "OllamaModelId",
		lmstudio: "LmStudioModelId",
		litellm: "LiteLlmModelId",
		requesty: "RequestyModelId",
		together: "TogetherModelId",
		fireworks: "FireworksModelId",
		sapaicore: "SapAiCoreModelId",
		groq: "GroqModelId",
		baseten: "BasetenModelId",
		huggingface: "HuggingFaceModelId",
	}

	function getProviderModelIdKey(provider: string, mode: "act" | "plan"): string | null {
		const prefix = mode === "act" ? "actMode" : "planMode"
		const keySuffix = providerKeyMap[provider]
		if (keySuffix) {
			return `${prefix}${keySuffix}`
		}
		return null
	}

	it("should return correct key for openrouter in act mode", () => {
		expect(getProviderModelIdKey("openrouter", "act")).toBe("actModeOpenRouterModelId")
	})

	it("should return correct key for openrouter in plan mode", () => {
		expect(getProviderModelIdKey("openrouter", "plan")).toBe("planModeOpenRouterModelId")
	})

	it("should return same key for cline as openrouter", () => {
		expect(getProviderModelIdKey("cline", "act")).toBe("actModeOpenRouterModelId")
	})

	it("should return correct key for openai", () => {
		expect(getProviderModelIdKey("openai", "act")).toBe("actModeOpenAiModelId")
	})

	it("should return correct key for ollama", () => {
		expect(getProviderModelIdKey("ollama", "act")).toBe("actModeOllamaModelId")
	})

	it("should return null for anthropic (uses generic key)", () => {
		expect(getProviderModelIdKey("anthropic", "act")).toBeNull()
	})

	it("should return null for gemini (uses generic key)", () => {
		expect(getProviderModelIdKey("gemini", "act")).toBeNull()
	})

	it("should return null for bedrock (uses generic key)", () => {
		expect(getProviderModelIdKey("bedrock", "act")).toBeNull()
	})

	it("should return null for unknown providers", () => {
		expect(getProviderModelIdKey("unknown-provider", "act")).toBeNull()
	})
})
