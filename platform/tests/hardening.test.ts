import { beforeEach, describe, expect, it } from "vitest";
import { sanitizeLogMessage } from "@/lib/api";
import {
	constantTimeEqual,
	decryptSecret,
	encryptSecret,
	hashToolInput,
	lastFour,
	stableStringify,
} from "@/lib/crypto";
import { clampToPlanLimit, formatLimit, limitsForPlan } from "@/lib/plans";
import { normalizeSandboxError } from "@/lib/sandbox/errors";
import { assertSafeCommand, checkCommand, ForbiddenCommandError } from "@/lib/sandbox/guard";
import { SandboxError, SandboxNotConfiguredError } from "@/lib/sandbox/types";
import {
	approvalDecisionSchema,
	createProjectSchema,
	createTaskSchema,
	executeCommandSchema,
	providerKeySchema,
	updateSettingsSchema,
	writeFileSchema,
} from "@/lib/validation";

const USER_ID = "a0fa01a1-817b-44ef-b296-e60e1c8446e9";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("input validation", () => {
	it("accepts a well-formed project and rejects unsafe repository URLs", () => {
		const ok = createProjectSchema.parse({
			name: "My project",
			description: "demo",
			language: "typescript",
			template: "blank",
			repoUrl: "https://github.com/example/repo.git",
			approvalMode: "writes",
		});
		expect(ok.name).toBe("My project");
		expect(ok.repoUrl).toBe("https://github.com/example/repo.git");

		for (const repoUrl of [
			"git@github.com:example/repo.git",
			"javascript:alert(1)",
			"http://example.com/repo",
			"https://example.com/repo\nrm -rf /",
		]) {
			expect(() => createProjectSchema.parse({ name: "x", repoUrl })).toThrow();
		}
	});

	it("bounds names, prompts and models", () => {
		expect(() => createProjectSchema.parse({ name: "" })).toThrow();
		expect(() => createProjectSchema.parse({ name: "a".repeat(81) })).toThrow();

		expect(() =>
			createTaskSchema.parse({ projectId: "not-a-uuid", prompt: "do it", modelId: "a/b" }),
		).toThrow();
		expect(() =>
			createTaskSchema.parse({ projectId: PROJECT_ID, prompt: "   ", modelId: "a/b" }),
		).toThrow();
		expect(() =>
			createTaskSchema.parse({
				projectId: PROJECT_ID,
				prompt: "x".repeat(20_001),
				modelId: "a/b",
			}),
		).toThrow();
		expect(() =>
			createTaskSchema.parse({ projectId: PROJECT_ID, prompt: "fix", modelId: "bad model" }),
		).toThrow();
		expect(
			createTaskSchema.parse({
				projectId: PROJECT_ID,
				prompt: "fix the tests",
				modelId: "anthropic/claude-sonnet-4.6",
			}).prompt,
		).toBe("fix the tests");
	});

	it("enforces file and terminal limits", () => {
		expect(() => writeFileSchema.parse({ path: "a.ts", content: "x".repeat(500_001) })).toThrow();
		expect(() => executeCommandSchema.parse({ command: "" })).toThrow();
		expect(() => executeCommandSchema.parse({ command: "ls", timeoutSeconds: 301 })).toThrow();
		expect(executeCommandSchema.parse({ command: "npm test" }).command).toBe("npm test");
	});

	it("requires an OpenRouter-shaped provider key", () => {
		expect(() => providerKeySchema.parse({ key: "sk-live-123" })).toThrow();
		expect(() => providerKeySchema.parse({ key: "sk-or-" })).toThrow();
		expect(providerKeySchema.parse({ key: `sk-or-v1-${"a".repeat(40)}` }).key).toContain(
			"sk-or-v1-",
		);
	});

	it("rejects impossible approval decisions and settings", () => {
		expect(() => approvalDecisionSchema.parse({ decision: "maybe" })).toThrow();
		expect(() => updateSettingsSchema.parse({ maxConcurrentTasks: 0 })).toThrow();
		expect(() => updateSettingsSchema.parse({ terminalTimeoutSeconds: 1000 })).toThrow();
		expect(updateSettingsSchema.parse({ maxConcurrentTasks: 3 }).maxConcurrentTasks).toBe(3);
	});
});

describe("plan limits", () => {
	it("falls back to free for unknown plans", () => {
		expect(limitsForPlan("enterprise").tasksPerMonth).toBe(limitsForPlan("free").tasksPerMonth);
		expect(limitsForPlan("pro").concurrentTasks).toBeGreaterThan(
			limitsForPlan("free").concurrentTasks,
		);
	});

	it("clamps requested values to the plan ceiling", () => {
		expect(clampToPlanLimit(undefined, 30, 24)).toBe(24);
		expect(clampToPlanLimit(0, 30, 24)).toBe(1);
		expect(clampToPlanLimit(999, 30, 24)).toBe(30);
		expect(clampToPlanLimit(12.9, 30, 24)).toBe(12);
	});

	it("formats limits for display", () => {
		expect(formatLimit(2_000_000)).toBe("2M");
		expect(formatLimit(50_000)).toBe("50k");
		expect(formatLimit(5)).toBe("5");
	});
});

describe("secret handling", () => {
	beforeEach(() => {
		process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
	});

	it("encrypts and decrypts a provider key without storing it in plaintext", () => {
		const plaintext = "sk-or-v1-abcdef0123456789";
		const encrypted = encryptSecret(plaintext);
		expect(JSON.stringify(encrypted)).not.toContain(plaintext);
		expect(decryptSecret(encrypted)).toBe(plaintext);
		expect(lastFour(plaintext)).toBe("6789");
	});

	it("uses a fresh IV per encryption and rejects tampering", () => {
		const first = encryptSecret("sk-or-v1-aaaaaaaa");
		const second = encryptSecret("sk-or-v1-aaaaaaaa");
		expect(first.iv).not.toBe(second.iv);

		const tampered = { ...first, ciphertext: Buffer.from("bad").toString("base64") };
		expect(() => decryptSecret(tampered)).toThrow();
	});

	it("compares secrets in constant time and hashes tool input deterministically", () => {
		expect(constantTimeEqual("abc", "abc")).toBe(true);
		expect(constantTimeEqual("abc", "abd")).toBe(false);
		expect(constantTimeEqual("abc", "abcd")).toBe(false);

		const a = hashToolInput({ b: 1, a: { y: 2, x: 3 } });
		const b = hashToolInput({ a: { x: 3, y: 2 }, b: 1 });
		expect(a).toBe(b);
		expect(stableStringify({ z: undefined, a: 1 })).toBe('{"a":1}');
	});
});

describe("log and error redaction", () => {
	it("redacts provider keys, Daytona keys, JWTs and bearer tokens", () => {
		const message = [
			"key sk-or-v1-abcdefghijklmnop",
			"daytona dtn_abcdef123456",
			"jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
			"header Authorization: Bearer abc.def",
		].join(" ");
		const clean = sanitizeLogMessage(message);
		expect(clean).toContain("sk-or-v1-[redacted]");
		expect(clean).toContain("dtn_[redacted]");
		expect(clean).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
		expect(clean).not.toContain("abc.def");
	});

	it("truncates very long messages", () => {
		expect(sanitizeLogMessage("x".repeat(5000)).length).toBe(2000);
	});

	it("maps sandbox failures to safe API errors without leaking internals", () => {
		const notConfigured = normalizeSandboxError(new SandboxNotConfiguredError());
		expect(notConfigured).toMatchObject({ status: 503, code: "sandbox_not_configured" });

		const providerFailure = normalizeSandboxError(
			new SandboxError("Sandbox unavailable", "https://app.daytona.io/api/secret"),
		);
		expect(providerFailure).toMatchObject({ status: 502, code: "sandbox_error" });
	});
});

describe("agent command guard", () => {
	it("still allows common build and test commands", () => {
		for (const command of [
			"npm ci",
			"npm run build",
			"pnpm test -- --watch=false",
			"pytest -q tests/",
			"go test ./...",
			"cargo clippy",
			"git diff --stat",
		]) {
			expect(checkCommand(command), command).toEqual({ ok: true });
		}
	});

	it("throws a typed error for blocked commands", () => {
		expect(() => assertSafeCommand("sudo rm -rf /")).toThrow(ForbiddenCommandError);
		expect(() => assertSafeCommand("cat /etc/shadow")).toThrow(/off limits/i);
	});
});
