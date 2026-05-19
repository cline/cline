import { execFileSync } from "node:child_process";
import {
	type AgentEvent,
	type AgentTool,
	ClineCore,
	createTool,
	type ToolPolicy,
} from "@cline/sdk";
import { z } from "zod";

const SecurityFindingSchema = z.object({
	file: z.string().describe("File path"),
	line: z.number().describe("Line number (approximate is fine)"),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	category: z
		.enum([
			"authentication",
			"authorization",
			"injection",
			"secrets",
			"cryptography",
			"data_exposure",
			"ssrf",
			"xss",
			"deserialization",
			"path_traversal",
			"dependency",
			"logging_monitoring",
			"configuration",
			"other",
		])
		.describe("Security weakness category"),
	cwe: z
		.string()
		.optional()
		.describe("Relevant CWE identifier, such as CWE-89, if known"),
	owasp: z.string().optional().describe("Relevant OWASP category, if known"),
	title: z.string().describe("Short finding title"),
	description: z.string().describe("What is vulnerable and why it matters"),
	exploitScenario: z
		.string()
		.describe("A realistic abuse case or exploit path"),
	remediation: z.string().describe("Concrete recommended fix or mitigation"),
	confidence: z.enum(["high", "medium", "low"]),
});

const SecurityReviewResultSchema = z.object({
	summary: z.string().describe("Brief overall security assessment"),
	overallRisk: z.enum(["critical", "high", "medium", "low", "none"]),
	blockMerge: z
		.boolean()
		.describe("Whether the changes should be blocked from merging"),
});

const findings: z.infer<typeof SecurityFindingSchema>[] = [];
let reviewResult: z.infer<typeof SecurityReviewResultSchema> | undefined;

const repoRoot = (() => {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], {
			encoding: "utf-8",
		}).trim();
	} catch {
		console.error("Error: must be run from within a git repository.");
		process.exit(1);
	}
})();

const systemPrompt = `You are a senior application security engineer performing a focused security review of a git diff.

Your goal is to identify exploitable or defense-in-depth security issues introduced or modified by the diff. The repository root is ${repoRoot}. Use the read_files tool with absolute paths, or search_codebase, when you need surrounding code to determine whether a finding is real.

Focus on:
- Authentication and authorization bypasses
- Injection flaws, including SQL/NoSQL/command/template/LDAP injection
- Cross-site scripting and unsafe HTML/script rendering
- Server-side request forgery and unsafe URL fetching
- Path traversal and unsafe file operations
- Hardcoded secrets, tokens, private keys, and credential leakage
- Cryptographic misuse, weak randomness, insecure hashing, or missing integrity checks
- Sensitive data exposure in logs, errors, telemetry, APIs, or client bundles
- Unsafe deserialization or dynamic code execution
- Insecure dependency, environment, CORS, cookie, header, or cloud configuration changes
- Missing validation, rate limits, audit logging, or security checks around sensitive operations

Only report actionable findings that are supported by the diff or file context. Do not report generic best practices unless they materially reduce a realistic risk. Prefer fewer high-quality findings over many speculative ones.

Severity guidance:
- critical: likely remote code execution, auth bypass, mass data exposure, secret compromise, or trivially exploitable injection on sensitive data paths
- high: practical privilege escalation, significant data exposure, SSRF with meaningful impact, or exploitable stored XSS
- medium: plausible vulnerability requiring constraints, limited data exposure, missing authorization on lower-risk operations, or reflected XSS with user interaction
- low: hardening issue with limited exploitability
- info: noteworthy observation with minimal direct risk

For each real issue, call add_security_finding with clear evidence, exploit scenario, remediation, confidence, and CWE/OWASP metadata when applicable.

When you are done reviewing, call submit_security_review with a brief summary, an overall risk rating, and whether the changes should be blocked from merging.`;

const addSecurityFindingTool = createTool({
	name: "add_security_finding",
	description:
		"Add an actionable security finding on a specific file and line.",
	inputSchema: SecurityFindingSchema,
	async execute(input) {
		findings.push(input);
		return {
			success: true,
			message: `Security finding added (${findings.length} total)`,
			findingCount: findings.length,
		};
	},
});

const submitSecurityReviewTool = createTool({
	name: "submit_security_review",
	description: "Submit the completed security review with a risk summary.",
	inputSchema: SecurityReviewResultSchema,
	lifecycle: { completesRun: true },
	async execute(input) {
		reviewResult = input;
		return {
			success: true,
			summary: input.summary,
			overallRisk: input.overallRisk,
			blockMerge: input.blockMerge,
			findingCount: findings.length,
		};
	},
});

const securityReviewTools: AgentTool[] = [
	addSecurityFindingTool as AgentTool,
	submitSecurityReviewTool as AgentTool,
];

const securityReviewToolPolicies = {
	"*": { autoApprove: true },
	read_files: { autoApprove: true },
	search_codebase: { autoApprove: true },
	add_security_finding: { autoApprove: true },
	submit_security_review: { autoApprove: true },
	run_commands: { enabled: false },
	fetch_web_content: { enabled: false },
	editor: { enabled: false },
	apply_patch: { enabled: false },
	skills: { enabled: false },
	ask_question: { enabled: false },
} satisfies Record<string, ToolPolicy>;

let reasoningOpen = false;

function usage() {
	console.error("Usage: bun dev [git-ref] [--prompt <instructions>]");
	console.error("  e.g. bun dev HEAD~3");
	console.error("  e.g. bun dev main");
	console.error(
		'  e.g. bun dev main --prompt "Focus on authorization bypasses and SSRF"',
	);
	console.error(
		'  e.g. bun dev main "Prioritize auth, secrets, and unsafe file access"',
	);
}

function parseArgs(args: string[]): { ref: string; extraPrompt?: string } {
	let ref = "HEAD~1";
	let hasRef = false;
	const promptParts: string[] = [];
	const positionalPromptParts: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			usage();
			process.exit(0);
		}

		if (arg === "--prompt" || arg === "-p") {
			const value = args[i + 1];
			if (!value) {
				console.error(`Missing value for ${arg}`);
				usage();
				process.exit(1);
			}
			promptParts.push(value);
			i++;
			continue;
		}

		if (arg.startsWith("--prompt=")) {
			const value = arg.slice("--prompt=".length);
			if (!value) {
				console.error("Missing value for --prompt");
				usage();
				process.exit(1);
			}
			promptParts.push(value);
			continue;
		}

		if (arg.startsWith("-")) {
			console.error(`Unknown option: ${arg}`);
			usage();
			process.exit(1);
		}

		if (!hasRef) {
			ref = arg;
			hasRef = true;
			continue;
		}

		positionalPromptParts.push(arg);
	}

	if (positionalPromptParts.length > 0) {
		promptParts.push(positionalPromptParts.join(" "));
	}

	return {
		ref,
		extraPrompt: promptParts.length > 0 ? promptParts.join("\n\n") : undefined,
	};
}

function closeReasoning() {
	if (reasoningOpen) {
		process.stdout.write("\n");
		reasoningOpen = false;
	}
}

function renderToolStart(
	event: Extract<AgentEvent, { type: "content_start" }>,
) {
	const toolName = event.toolName ?? "unknown_tool";
	if (toolName === "add_security_finding") {
		const parsed = SecurityFindingSchema.safeParse(event.input);
		if (!parsed.success) {
			console.log(`\n[tool] ${toolName}`);
			return;
		}
		const input = parsed.data;
		const icon =
			input.severity === "critical"
				? "X"
				: input.severity === "high"
					? "!"
					: input.severity === "medium"
						? "~"
						: "i";
		console.log(
			`\n  [${icon}] ${input.severity.toUpperCase()} ${input.file}:${input.line} - ${input.title}`,
		);
		return;
	}

	console.log(`\n[tool] ${toolName}`);
}

function renderAgentEvent(event: AgentEvent) {
	switch (event.type) {
		case "content_start":
			if (event.contentType === "text" && event.text) {
				closeReasoning();
				process.stdout.write(event.text);
				return;
			}
			if (event.contentType === "reasoning") {
				if (event.redacted === true && !event.reasoning) {
					console.log("\n[thinking redacted]");
					return;
				}
				if (event.reasoning) {
					if (!reasoningOpen) {
						process.stdout.write("\n[thinking]\n");
						reasoningOpen = true;
					}
					process.stdout.write(event.reasoning);
				}
				return;
			}
			if (event.contentType === "tool") {
				closeReasoning();
				renderToolStart(event);
				return;
			}
			break;
		case "content_end":
			if (event.contentType === "reasoning") {
				closeReasoning();
				return;
			}
			if (event.contentType === "tool" && event.error) {
				closeReasoning();
				console.log(
					`\n[tool failed] ${event.toolName ?? "unknown_tool"}: ${event.error}`,
				);
			}
			break;
	}
}

// Get the diff to review
const { ref, extraPrompt } = parseArgs(process.argv.slice(2));
if (ref.startsWith("-")) {
	console.error(`Invalid ref: ${ref}`);
	process.exit(1);
}

let diff: string;
try {
	diff = execFileSync("git", ["diff", ref], {
		encoding: "utf-8",
		maxBuffer: 5 * 1024 * 1024,
	});
} catch {
	console.error(`Failed to get diff for ref: ${ref}`);
	usage();
	process.exit(1);
}

if (!diff.trim()) {
	console.log("No diff found. Nothing to security review.");
	process.exit(0);
}

console.log(
	`Security reviewing diff against ${ref} (${diff.split("\n").length} lines)...\n`,
);
if (extraPrompt) {
	console.log(`Additional review instructions: ${extraPrompt}\n`);
}

const cline = await ClineCore.create({
	clientName: "security-review-bot",
	backendMode: "local",
});

const unsubscribe = cline.subscribe((event) => {
	switch (event.type) {
		case "agent_event":
			renderAgentEvent(event.payload.event);
			break;
	}
});

try {
	const prompt = `Security review this git diff.${
		extraPrompt ? `\n\nAdditional review instructions:\n${extraPrompt}` : ""
	}\n\n\`\`\`diff\n${diff}\n\`\`\``;

	const result = await cline.start({
		source: "cli",
		interactive: false,
		prompt,
		config: {
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: process.env.CLINE_API_KEY,
			cwd: repoRoot,
			workspaceRoot: repoRoot,
			mode: "act",
			systemPrompt,
			maxIterations: 25,
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			disableMcpSettingsTools: true,
			toolPolicies: securityReviewToolPolicies,
		},
		localRuntime: {
			extraTools: securityReviewTools,
		},
	});

	console.log("\n\n--- Security Review Complete ---\n");

	if (reviewResult) {
		console.log(`Summary: ${reviewResult.summary}`);
		console.log(`Overall risk: ${reviewResult.overallRisk}`);
		console.log(`Block merge: ${reviewResult.blockMerge ? "yes" : "no"}\n`);
	}

	if (findings.length === 0) {
		console.log("No actionable security findings identified.");
	} else {
		const severityOrder = [
			"critical",
			"high",
			"medium",
			"low",
			"info",
		] as const;

		for (const severity of severityOrder) {
			const group = findings.filter((finding) => finding.severity === severity);
			if (group.length === 0) {
				continue;
			}

			console.log(`${severity.toUpperCase()}: ${group.length}`);
			for (const finding of group) {
				const metadata = [finding.cwe, finding.owasp]
					.filter(Boolean)
					.join(" | ");
				console.log(
					`  ${finding.file}:${finding.line} - ${finding.title}${metadata ? ` (${metadata})` : ""}`,
				);
				console.log(`    Category: ${finding.category}`);
				console.log(`    Confidence: ${finding.confidence}`);
				console.log(`    Risk: ${finding.description}`);
				console.log(`    Exploit: ${finding.exploitScenario}`);
				console.log(`    Fix: ${finding.remediation}`);
			}
		}
	}

	const usage = result.result?.usage;
	console.log(
		`\nSession: ${result.sessionId} | Status: ${result.result?.finishReason ?? "unknown"} | Iterations: ${result.result?.iterations ?? 0} | Tokens: ${usage?.outputTokens ?? 0} output`,
	);
} finally {
	unsubscribe();
	await cline.dispose();
}
