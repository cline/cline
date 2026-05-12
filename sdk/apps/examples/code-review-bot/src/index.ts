import { execSync } from "node:child_process";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";

const ReviewCommentSchema = z.object({
	file: z.string().describe("File path"),
	line: z.number().describe("Line number (approximate is fine)"),
	severity: z.enum(["critical", "warning", "suggestion"]),
	comment: z.string().describe("The review comment"),
});

const reviews: z.infer<typeof ReviewCommentSchema>[] = [];

const agent = new Agent({
	providerId: "cline",
	modelId: "anthropic/claude-sonnet-4-6",
	apiKey: process.env.CLINE_API_KEY,
	systemPrompt: `You are a senior code reviewer. Analyze the git diff provided and leave review comments using the add_review_comment tool. Focus on:
- Bugs and logic errors (critical)
- Security issues (critical)
- Performance problems (warning)
- Style and readability improvements (suggestion)

When you are done reviewing, call submit_review with a brief summary.`,
	maxIterations: 5,
	tools: [
		createTool({
			name: "get_file_context",
			description: "Read the full contents of a file to understand context around a diff hunk.",
			inputSchema: z.object({
				path: z.string().describe("File path relative to the repo root"),
			}),
			async execute(input) {
				try {
					const content = execSync(`cat "${input.path}"`, { encoding: "utf-8", maxBuffer: 1024 * 1024 });
					return content;
				} catch {
					return `Error: could not read file ${input.path}`;
				}
			},
		}),
		createTool({
			name: "add_review_comment",
			description: "Add a review comment on a specific file and line.",
			inputSchema: ReviewCommentSchema,
			async execute(input) {
				reviews.push(input);
				return `Comment added (${reviews.length} total)`;
			},
		}),
		createTool({
			name: "submit_review",
			description: "Submit the completed review with a summary.",
			inputSchema: z.object({
				summary: z.string().describe("Brief overall assessment of the changes"),
				approve: z.boolean().describe("Whether the changes look good to merge"),
			}),
			lifecycle: { completesRun: true },
			async execute(input) {
				return JSON.stringify({ summary: input.summary, approve: input.approve, commentCount: reviews.length });
			},
		}),
	],
});

agent.subscribe((event) => {
	switch (event.type) {
		case "assistant-text-delta":
			process.stdout.write(event.text);
			break;
		case "tool-started":
			if (event.toolCall.toolName === "add_review_comment") {
				const input = event.toolCall.input as z.infer<typeof ReviewCommentSchema>;
				const icon = input.severity === "critical" ? "X" : input.severity === "warning" ? "!" : "~";
				console.log(`  [${icon}] ${input.file}:${input.line} - ${input.comment}`);
			}
			break;
	}
});

// Get the diff to review
const ref = process.argv[2] || "HEAD~1";
let diff: string;
try {
	diff = execSync(`git diff ${ref}`, { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 });
} catch {
	console.error(`Failed to get diff for ref: ${ref}`);
	console.error("Usage: bun dev [git-ref]");
	console.error("  e.g. bun dev HEAD~3");
	console.error("  e.g. bun dev main");
	process.exit(1);
}

if (!diff.trim()) {
	console.log("No diff found. Nothing to review.");
	process.exit(0);
}

console.log(`Reviewing diff against ${ref} (${diff.split("\n").length} lines)...\n`);

const result = await agent.run(`Review this git diff:\n\n\`\`\`diff\n${diff}\n\`\`\``);

console.log("\n\n--- Review Complete ---\n");

if (reviews.length === 0) {
	console.log("No comments. Looks clean!");
} else {
	const critical = reviews.filter((r) => r.severity === "critical");
	const warnings = reviews.filter((r) => r.severity === "warning");
	const suggestions = reviews.filter((r) => r.severity === "suggestion");

	if (critical.length > 0) {
		console.log(`Critical: ${critical.length}`);
		for (const r of critical) {
			console.log(`  ${r.file}:${r.line} - ${r.comment}`);
		}
	}
	if (warnings.length > 0) {
		console.log(`Warnings: ${warnings.length}`);
		for (const r of warnings) {
			console.log(`  ${r.file}:${r.line} - ${r.comment}`);
		}
	}
	if (suggestions.length > 0) {
		console.log(`Suggestions: ${suggestions.length}`);
		for (const r of suggestions) {
			console.log(`  ${r.file}:${r.line} - ${r.comment}`);
		}
	}
}

console.log(`\nStatus: ${result.status} | Iterations: ${result.iterations} | Tokens: ${result.usage.outputTokens} output`);
