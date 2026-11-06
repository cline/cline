import { z } from "zod";

export const LANGUAGES = [
	{ id: "typescript", label: "TypeScript", ext: "ts" },
	{ id: "javascript", label: "JavaScript", ext: "js" },
	{ id: "python", label: "Python", ext: "py" },
	{ id: "java", label: "Java", ext: "java" },
	{ id: "c", label: "C", ext: "c" },
	{ id: "cpp", label: "C++", ext: "cpp" },
	{ id: "go", label: "Go", ext: "go" },
	{ id: "rust", label: "Rust", ext: "rs" },
	{ id: "php", label: "PHP", ext: "php" },
	{ id: "ruby", label: "Ruby", ext: "rb" },
	{ id: "html", label: "HTML / CSS", ext: "html" },
] as const;

export const TEMPLATES = [
	{
		id: "blank",
		label: "Blank workspace",
		language: "typescript",
		description: "An empty sandbox with a README.",
	},
	{
		id: "node-api",
		label: "Node API",
		language: "typescript",
		description: "A minimal TypeScript HTTP API.",
	},
	{
		id: "static-site",
		label: "Static site",
		language: "html",
		description: "HTML, CSS and JavaScript.",
	},
	{
		id: "python",
		label: "Python",
		language: "python",
		description: "A Python script with a test.",
	},
	{ id: "go", label: "Go", language: "go", description: "A Go module with a test." },
	{ id: "rust", label: "Rust", language: "rust", description: "A Cargo binary with a test." },
	{ id: "java", label: "Java", language: "java", description: "A single-file Java program." },
	{ id: "cpp", label: "C++", language: "cpp", description: "A C++ program with a Makefile." },
	{ id: "php", label: "PHP", language: "php", description: "A PHP script with a test." },
	{ id: "ruby", label: "Ruby", language: "ruby", description: "A Ruby script with a test." },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]["id"];
export type LanguageId = (typeof LANGUAGES)[number]["id"];

const languageIds = LANGUAGES.map((l) => l.id) as [LanguageId, ...LanguageId[]];
const templateIds = TEMPLATES.map((t) => t.id) as [TemplateId, ...TemplateId[]];

const modelId = z
	.string()
	.trim()
	.min(3)
	.max(200)
	.regex(/^[a-zA-Z0-9._:/-]+$/, "Invalid model id");

export const createProjectSchema = z.object({
	name: z.string().trim().min(1, "Give the project a name").max(80),
	description: z.string().trim().max(2000).default(""),
	language: z.enum(languageIds).default("typescript"),
	template: z.enum(templateIds).default("blank"),
	modelId: modelId.nullish(),
	repoUrl: z
		.string()
		.trim()
		.max(500)
		.refine(
			(value) => value === "" || /^https:\/\/[^\s]+$/i.test(value),
			"Repository URL must be an https URL",
		)
		.nullish(),
	approvalMode: z.enum(["auto", "writes", "read_only"]).default("auto"),
});

export const updateProjectSchema = z.object({
	name: z.string().trim().min(1).max(80).optional(),
	description: z.string().trim().max(2000).optional(),
	defaultModel: modelId.nullish(),
	approvalMode: z.enum(["auto", "writes", "read_only"]).optional(),
	status: z.enum(["active", "archived"]).optional(),
});

export const createTaskSchema = z.object({
	projectId: z.string().uuid(),
	prompt: z.string().trim().min(1, "Describe what to build or fix").max(20_000),
	modelId,
	conversationId: z.string().uuid().nullish(),
	title: z.string().trim().min(1).max(200).optional(),
});

export const updateSettingsSchema = z.object({
	defaultModel: modelId.nullish(),
	theme: z.enum(["dark", "graphite", "system"]).optional(),
	monthlyTokenLimit: z.number().int().positive().max(100_000_000).nullish(),
	monthlyTaskLimit: z.number().int().positive().max(100_000).nullish(),
	maxConcurrentTasks: z.number().int().min(1).max(10).optional(),
	terminalTimeoutSeconds: z.number().int().min(5).max(300).optional(),
});

export const updateProfileSchema = z.object({
	displayName: z.string().trim().max(80).nullish(),
	avatarUrl: z.string().trim().url().max(500).nullish(),
	defaultModel: modelId.nullish(),
	theme: z.enum(["dark", "graphite", "system"]).optional(),
});

export const writeFileSchema = z.object({
	path: z.string().min(1).max(500),
	content: z.string().max(500_000),
});

export const executeCommandSchema = z.object({
	command: z.string().min(1).max(8000),
	cwd: z.string().max(500).optional(),
	timeoutSeconds: z.number().int().min(1).max(300).optional(),
	stream: z.boolean().optional(),
});

export const approvalDecisionSchema = z.object({
	decision: z.enum(["approve", "reject"]),
	note: z.string().trim().max(1000).optional(),
});

export const providerKeySchema = z.object({
	key: z
		.string()
		.trim()
		.min(20, "That key looks too short")
		.max(300)
		.refine((value) => value.startsWith("sk-or-"), "Enter a valid OpenRouter API key"),
});

export const cancelTaskSchema = z.object({
	reason: z.string().trim().max(500).optional(),
});

export const cloneRepoSchema = z.object({
	repoUrl: z.string().url().max(500),
	branch: z.string().trim().max(120).optional(),
});
