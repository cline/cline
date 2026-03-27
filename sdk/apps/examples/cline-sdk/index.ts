/**
 * index.ts
 *
 * Interactive onboarding app for the Cline SDK examples.
 *
 * This app guides you through:
 * 1) A quick tutorial of core SDK ideas
 * 2) Building a small project artifact with the SDK
 * 3) Optionally refining it in a second iteration
 *
 * Run: bun run index.ts
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process, { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { type AgentConfig, createSessionHost } from "@clinebot/core";

type ProviderOption = {
	label: string;
	providerId: "anthropic" | "openai" | "google" | "cline" | "openrouter";
	modelId: string;
	apiKey: string;
};

const PROJECT_STYLES = [
	{
		label: "Neon Landing Page",
		description:
			"A stylish single-page site with gradients, cards, and micro-interactions.",
		directive:
			"Create a responsive landing page with sections (hero, features, CTA) and polished visual styling.",
	},
	{
		label: "Mini Clicker Game",
		description:
			"A tiny browser game with score, upgrades, and playful feedback.",
		directive:
			"Create a simple clicker game with score tracking, at least two upgrades, and a reset button.",
	},
	{
		label: "Focus Dashboard",
		description:
			"A practical mini web app with tasks, timer, and progress visuals.",
		directive:
			"Create a lightweight productivity dashboard with a pomodoro timer, task list, and daily progress indicator.",
	},
] as const;

function slugify(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50);
}

function detectProviders(): ProviderOption[] {
	const providers: ProviderOption[] = [];

	if (process.env.ANTHROPIC_API_KEY) {
		providers.push({
			label: "Anthropic (Claude Sonnet)",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY,
		});
	}

	if (process.env.OPENAI_API_KEY) {
		providers.push({
			label: "OpenAI (GPT-5.3)",
			providerId: "openai",
			modelId: "gpt-5.3",
			apiKey: process.env.OPENAI_API_KEY,
		});
	}

	if (process.env.GEMINI_API_KEY) {
		providers.push({
			label: "Google (Gemini 3 Flash)",
			providerId: "google",
			modelId: "gemini-3-flash",
			apiKey: process.env.GEMINI_API_KEY,
		});
	}

	if (process.env.CLINE_API_KEY) {
		providers.push({
			label: "Cline",
			providerId: "cline",
			modelId: "anthropic/claude-haiku-4-6",
			apiKey: process.env.CLINE_API_KEY,
		});
	}

	if (process.env.OPENROUTER_API_KEY) {
		providers.push({
			label: "OpenRouter",
			providerId: "openrouter",
			modelId: "anthropic/claude-haiku-4-6",
			apiKey: process.env.OPENROUTER_API_KEY,
		});
	}
	return providers;
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function printDivider() {
	console.log(`\n${"-".repeat(72)}`);
}

async function askNumber(
	rl: ReturnType<typeof createInterface>,
	question: string,
	min: number,
	max: number,
): Promise<number> {
	while (true) {
		const raw = (await rl.question(question)).trim();
		const parsed = Number(raw);
		if (Number.isInteger(parsed) && parsed >= min && parsed <= max) {
			return parsed;
		}
		console.log(`Please enter a whole number between ${min} and ${max}.`);
	}
}

async function askYesNo(
	rl: ReturnType<typeof createInterface>,
	question: string,
): Promise<boolean> {
	const answer = (await rl.question(question)).trim().toLowerCase();
	return answer === "y" || answer === "yes";
}

async function main() {
	const providers = detectProviders();
	if (providers.length === 0) {
		console.error("No API key detected. Set one of:");
		console.error("  ANTHROPIC_API_KEY");
		console.error("  OPENAI_API_KEY");
		console.error("  GEMINI_API_KEY");
		console.error("  CLINE_API_KEY");
		console.error("  OPENROUTER_API_KEY");
		process.exit(1);
	}

	const rl = createInterface({ input, output });

	console.log("\n🚀 Welcome to the Cline SDK Interactive Builder");
	console.log("This walkthrough teaches key concepts, then builds a mini app.");

	printDivider();
	console.log("Choose a provider:");
	providers.forEach((provider, index) => {
		console.log(`  ${index + 1}) ${provider.label}`);
	});

	const providerChoice =
		providers.length === 1
			? 1
			: await askNumber(rl, "Provider number: ", 1, providers.length);
	const selectedProvider = providers[providerChoice - 1];

	printDivider();
	console.log("Pick what you want to build:");
	PROJECT_STYLES.forEach((option, index) => {
		console.log(`  ${index + 1}) ${option.label} — ${option.description}`);
	});
	const projectChoice = await askNumber(
		rl,
		"Project style number: ",
		1,
		PROJECT_STYLES.length,
	);
	const selectedStyle = PROJECT_STYLES[projectChoice - 1];

	if (!selectedProvider || !selectedStyle) {
		console.error("Invalid project style choice");
		process.exit(1);
	}

	const appNameInput = (
		await rl.question("Name your app (e.g. pixel-party): ")
	).trim();
	const appName = appNameInput || selectedStyle.label;

	const vibeInput = (
		await rl.question("Describe your vibe/theme in a few words (optional): ")
	).trim();
	const vibe = vibeInput || "clean, playful, and modern";

	printDivider();
	console.log("⏳ Starting session host...");

	const backendMode =
		process.env.CLINE_BACKEND_MODE === "local" ? "local" : "auto";

	const hooks: NonNullable<AgentConfig["hooks"]> = {
		onToolCallStart: async (ctx) => {
			console.log(`🛠️  Tool: ${ctx.call.name}`);
			return undefined;
		},
	};

	const sessionManager = await createSessionHost({
		backendMode,
		toolPolicies: {
			read_files: { enabled: true, autoApprove: true },
			search_codebase: { enabled: true, autoApprove: true },
			editor: { enabled: true, autoApprove: true },
			run_commands: { enabled: false, autoApprove: false },
		},
		requestToolApproval: async (request) => {
			if (
				request.toolName === "run_commands" ||
				request.toolName === "execute_command"
			) {
				return {
					approved: false,
					reason: "Command execution disabled in demo.",
				};
			}
			return { approved: true, reason: "Approved by onboarding flow." };
		},
	});

	const outputDir = path.join(
		process.cwd(),
		"generated",
		`${slugify(appName) || "sdk-project"}-${timestamp()}`,
	);
	await mkdir(outputDir, { recursive: true });

	try {
		console.log("\n📘 Step 1/2: Quick tutorial");
		const tutorial = await sessionManager.start({
			config: {
				providerId: selectedProvider.providerId,
				modelId: selectedProvider.modelId,
				apiKey: selectedProvider.apiKey,
				cwd: process.cwd(),
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				hooks,
				systemPrompt:
					"You are a fun but practical SDK mentor. Be concise and actionable.",
				maxIterations: 8,
			},
			userFiles: ["README.md", "QUICKSTART.md"],
			prompt: `Teach me the Cline SDK quickly using this exact structure:
1) 3 beginner capabilities
2) 3 intermediate capabilities
3) 2 advanced capabilities
4) one tiny code snippet showing createSessionHost + start
5) a one-sentence challenge for building a first app.

Keep it short and motivating.`,
			interactive: true,
		});

		printDivider();
		console.log("🧠 Tutorial result:\n");
		console.log(tutorial.result?.text ?? "(no text returned)");

		console.log("\n🎨 Step 2/2: Build your project artifact");
		const buildResult = await sessionManager.send({
			sessionId: tutorial.sessionId,
			prompt: `Now build my project.

Project name: ${appName}
Project style: ${selectedStyle.label}
Build directive: ${selectedStyle.directive}
Theme vibe: ${vibe}
Output directory (must stay inside this path): ${outputDir}

Rules:
- Create a visible browser result.
- Create at least: index.html and README.md.
- You may also create style.css and script.js if useful.
- Use modern but lightweight design.
- In README.md include exact viewing instructions for macOS using the generated path.
- Do not ask follow-up questions; make strong defaults and ship it.
- At the end of your response include:
  - short summary
  - created file list
  - one "next improvement" suggestion.
`,
		});

		printDivider();
		console.log("✅ Build result:\n");
		console.log(buildResult?.text ?? "(no text returned)");

		const wantsIteration = await askYesNo(
			rl,
			"\nWant one more improvement iteration? (y/N): ",
		);

		if (wantsIteration) {
			const improvementGoal = (
				await rl.question(
					"What should improve? (e.g. animations, mobile UX, game balance): ",
				)
			).trim();

			const iteration = await sessionManager.send({
				sessionId: tutorial.sessionId,
				prompt: `Improve the generated project in ${outputDir}.

Focus request: ${improvementGoal || "Improve UX and polish while staying simple."}

Rules:
- Keep the app lightweight.
- Preserve existing behavior unless needed for the improvement.
- Update README.md if run/view steps change.
- End with a short changelog.`,
			});

			printDivider();
			console.log("✨ Iteration result:\n");
			console.log(iteration?.text ?? "(no text returned)");
		}

		printDivider();
		console.log("🎉 Finished!");
		console.log(`Generated output: ${outputDir}`);
		console.log(
			`Open directly on macOS:\n  open "${path.join(outputDir, "index.html")}"`,
		);
		console.log(
			'Or serve it locally:\n  cd "' +
				outputDir +
				'" && python3 -m http.server 8080',
		);
	} finally {
		rl.close();
		await sessionManager.dispose();
	}
}

main().catch((error) => {
	console.error("\n❌ Interactive onboarding failed:");
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
