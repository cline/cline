import { describe, expect, it } from "vitest"
import { FailureClassifier } from "../classifier"

describe("FailureClassifier", () => {
	const classifier = new FailureClassifier()

	describe("Provider Bug Detection", () => {
		it("detects Gemini signature issue", () => {
			const logs = `
				Error: Function call is missing a thought_signature in functionCall parts.
				This is required for tools to work correctly with Gemini 3 Pro...
			`
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("gemini_signature")
			expect(failures[0].category).toBe("provider_bug")
			expect(failures[0].issue_url).toBe("https://github.com/cline/cline/issues/7974")
		})

		it("detects Claude tool format issue", () => {
			const logs = `Cline tried to use write_to_file without value for required parameter 'content'`
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("claude_tool_format")
			expect(failures[0].category).toBe("provider_bug")
			expect(failures[0].issue_url).toBe("https://github.com/cline/cline/issues/7998")
		})
	})

	describe("Transient Failure Detection", () => {
		it("detects rate limiting", () => {
			const logs = "Error: 429 Too Many Requests - Rate limit exceeded"
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("rate_limit")
			expect(failures[0].category).toBe("transient")
		})

		it("detects network timeout", () => {
			const logs = "Error: ETIMEDOUT - Connection timed out"
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("network_timeout")
			expect(failures[0].category).toBe("transient")
		})

		it("detects service unavailable", () => {
			const logs = "503 Service Unavailable - Model is currently overloaded"
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("model_overloaded")
			expect(failures[0].category).toBe("transient")
		})
	})

	describe("Infrastructure Failure Detection", () => {
		it("detects harness errors", () => {
			const logs = "verifier script failed with exit code 1"
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("harness_error")
			expect(failures[0].category).toBe("harness")
		})

		it("detects environment failures", () => {
			const logs = "Error: docker container exit code 137"
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("environment_failure")
			expect(failures[0].category).toBe("environment")
		})
	})

	describe("Policy and Auth Failures", () => {
		it("detects safety refusals", () => {
			const logs = "Request blocked: Content policy violation"
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("safety_refusal")
			expect(failures[0].category).toBe("policy")
		})

		it("detects auth errors", () => {
			const logs = "401 Unauthorized: Invalid API key"
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("auth_error")
			expect(failures[0].category).toBe("auth")
		})
	})

	describe("Excerpt Extraction", () => {
		it("extracts context around the matched pattern", () => {
			const logs = `
				This is some context before the error.
				Error: 429 Too Many Requests - Rate limit exceeded
				This is some context after the error.
			`
			const failures = classifier.classify(logs)

			expect(failures[0].excerpt).toContain("Rate limit exceeded")
			expect(failures[0].excerpt.length).toBeLessThan(500)
		})
	})

	describe("Helper Methods", () => {
		it("hasProviderBug returns true for provider bugs", () => {
			const logs = "Error: missing thoughtSignature in function call"
			expect(classifier.hasProviderBug(logs)).toBe(true)
		})

		it("hasProviderBug returns false for non-provider bugs", () => {
			const logs = "Error: 429 Too Many Requests"
			expect(classifier.hasProviderBug(logs)).toBe(false)
		})

		it("hasTransientFailure returns true for transient errors", () => {
			const logs = "Error: ETIMEDOUT"
			expect(classifier.hasTransientFailure(logs)).toBe(true)
		})

		it("hasTransientFailure returns false for non-transient errors", () => {
			const logs = "Error: missing thoughtSignature"
			expect(classifier.hasTransientFailure(logs)).toBe(false)
		})

		it("getPatternsByCategory returns correct patterns", () => {
			const providerBugs = classifier.getPatternsByCategory("provider_bug")
			expect(providerBugs).toContain("gemini_signature")
			expect(providerBugs).toContain("claude_tool_format")

			const transient = classifier.getPatternsByCategory("transient")
			expect(transient).toContain("rate_limit")
			expect(transient).toContain("network_timeout")
			expect(transient).toContain("model_overloaded")
		})
	})

	describe("Multiple Pattern Matching", () => {
		it("detects multiple failures in same log", () => {
			const logs = `
				Error: 429 Too Many Requests
				Later: Error: ETIMEDOUT
			`
			const failures = classifier.classify(logs)

			expect(failures.length).toBe(2)
			expect(failures.map((f) => f.name)).toContain("rate_limit")
			expect(failures.map((f) => f.name)).toContain("network_timeout")
		})
	})

	describe("Case Insensitivity", () => {
		it("matches patterns case-insensitively", () => {
			const logs = "error: RATE LIMIT exceeded"
			const failures = classifier.classify(logs)

			expect(failures.length).toBeGreaterThan(0)
			expect(failures[0].name).toBe("rate_limit")
		})
	})

	describe("No Match", () => {
		it("returns empty array when no patterns match", () => {
			const logs = "Everything completed successfully"
			const failures = classifier.classify(logs)

			expect(failures).toEqual([])
		})
	})
})
