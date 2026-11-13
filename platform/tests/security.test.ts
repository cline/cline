import { beforeAll, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import { sanitizeLogMessage } from "@/lib/api";
import { decryptSecret, encryptSecret, hashToolInput, stableStringify } from "@/lib/crypto";
import { clampToPlanLimit, limitsForPlan } from "@/lib/plans";
import { createTaskSchema, providerKeySchema, writeFileSchema } from "@/lib/validation";

beforeAll(() => {
	process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("secret encryption", () => {
	it("round-trips a provider key", () => {
		const encrypted = encryptSecret("sk-or-v1-test-key");
		expect(encrypted.ciphertext).not.toContain("sk-or-v1");
		expect(decryptSecret(encrypted)).toBe("sk-or-v1-test-key");
	});

	it("uses a fresh IV per encryption", () => {
		const a = encryptSecret("same-secret");
		const b = encryptSecret("same-secret");
		expect(a.iv).not.toBe(b.iv);
		expect(a.ciphertext).not.toBe(b.ciphertext);
	});

	it("rejects tampered ciphertext", () => {
		const encrypted = encryptSecret("sk-or-v1-test-key");
		const tampered = {
			...encrypted,
			ciphertext: Buffer.from("tampered").toString("base64"),
		};
		expect(() => decryptSecret(tampered)).toThrow();
	});

	it("hashes tool inputs deterministically regardless of key order", () => {
		expect(hashToolInput({ a: 1, b: 2 })).toBe(hashToolInput({ b: 2, a: 1 }));
		expect(hashToolInput({ a: 1 })).not.toBe(hashToolInput({ a: 2 }));
		expect(stableStringify({ b: [1, 2], a: "x" })).toBe('{"a":"x","b":[1,2]}');
	});
});

describe("log sanitization", () => {
	it("redacts provider keys, Daytona keys and JWTs", () => {
		const message =
			"key sk-or-v1-abcdef leaked dtn_123abc token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
		const cleaned = sanitizeLogMessage(message);
		expect(cleaned).not.toContain("sk-or-v1-abcdef");
		expect(cleaned).not.toContain("dtn_123abc");
		expect(cleaned).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
	});

	it("caps very long messages", () => {
		expect(sanitizeLogMessage("a".repeat(10_000)).length).toBeLessThanOrEqual(2000);
	});
});

describe("request validation", () => {
	it("accepts a normal task and trims its prompt", () => {
		const parsed = createTaskSchema.parse({
			projectId: "00000000-0000-4000-8000-000000000000",
			prompt: "  fix the failing test  ",
			modelId: "anthropic/claude-sonnet-4",
		});
		expect(parsed.prompt).toBe("fix the failing test");
	});

	it("rejects oversized prompts and malformed ids", () => {
		expect(
			createTaskSchema.safeParse({
				projectId: "not-a-uuid",
				prompt: "hello",
				modelId: "anthropic/claude-sonnet-4",
			}).success,
		).toBe(false);
		expect(
			createTaskSchema.safeParse({
				projectId: "00000000-0000-4000-8000-000000000000",
				prompt: "x".repeat(20_001),
				modelId: "anthropic/claude-sonnet-4",
			}).success,
		).toBe(false);
		expect(
			createTaskSchema.safeParse({
				projectId: "00000000-0000-4000-8000-000000000000",
				prompt: "hello",
				modelId: "bad model with spaces",
			}).success,
		).toBe(false);
	});

	it("enforces the OpenRouter key shape", () => {
		expect(providerKeySchema.safeParse({ key: "sk-or-v1-abcdefghijklmnop" }).success).toBe(true);
		expect(providerKeySchema.safeParse({ key: "sk-live-abc" }).success).toBe(false);
	});

	it("limits editor writes", () => {
		expect(writeFileSchema.safeParse({ path: "a.ts", content: "x".repeat(500_001) }).success).toBe(
			false,
		);
	});
});

describe("plans", () => {
	it("clamps requested values to the plan ceiling", () => {
		expect(clampToPlanLimit(500, 40, 24)).toBe(40);
		expect(clampToPlanLimit(undefined, 40, 24)).toBe(24);
		expect(clampToPlanLimit(0, 40, 24)).toBe(1);
		expect(limitsForPlan("pro").concurrentTasks).toBe(4);
		expect(limitsForPlan("unknown").tasksPerMonth).toBe(100);
	});
});

describe("agent system prompt", () => {
	const base = {
		projectName: "demo",
		language: "typescript",
		template: "blank",
		rootPath: "workspace",
		modelId: "anthropic/claude-sonnet-4",
	};

	it("treats repository content as untrusted data", () => {
		const prompt = buildSystemPrompt({ ...base, approvalMode: "auto" });
		expect(prompt).toContain("UNTRUSTED DATA");
		expect(prompt).toContain("finish_task");
		expect(prompt).toContain("never claim a test passed");
	});

	it("explains approval and read-only modes", () => {
		expect(buildSystemPrompt({ ...base, approvalMode: "writes" })).toContain(
			"require explicit user approval",
		);
		expect(buildSystemPrompt({ ...base, approvalMode: "read_only" })).toContain("read-only mode");
	});

	it("does not include server secrets", () => {
		process.env.OPENROUTER_API_KEY = "sk-or-v1-should-not-appear";
		const prompt = buildSystemPrompt({ ...base, approvalMode: "auto" });
		expect(prompt).not.toContain("sk-or-v1-should-not-appear");
		delete process.env.OPENROUTER_API_KEY;
	});
});
