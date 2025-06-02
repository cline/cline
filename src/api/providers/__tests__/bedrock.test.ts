import "should"
import { AwsBedrockHandler } from "../bedrock"
import { ApiHandlerOptions } from "@shared/api"

describe("AwsBedrockHandler", () => {
	describe("withTempEnv", () => {
		// Store original env vars for cleanup
		const originalEnv: Record<string, string | undefined> = {}

		beforeEach(() => {
			// Store original values before each test
			originalEnv.TEST_VAR = process.env.TEST_VAR
			originalEnv.ANOTHER_VAR = process.env.ANOTHER_VAR
			originalEnv.VAR1 = process.env.VAR1
			originalEnv.VAR2 = process.env.VAR2
			originalEnv.VAR3 = process.env.VAR3
			originalEnv.UNDEFINED_VAR = process.env.UNDEFINED_VAR
		})

		afterEach(() => {
			// Restore original values after each test
			Object.entries(originalEnv).forEach(([key, value]) => {
				if (value === undefined) {
					delete process.env[key]
				} else {
					process.env[key] = value
				}
			})
		})

		it("should restore original environment variables after operation", async () => {
			// Set initial environment
			process.env.TEST_VAR = "original"
			process.env.ANOTHER_VAR = "another"

			// Store original values
			const originalTestVar = process.env.TEST_VAR
			const originalAnotherVar = process.env.ANOTHER_VAR

			await AwsBedrockHandler["withTempEnv"](
				() => {
					process.env.TEST_VAR = "modified"
					delete process.env.ANOTHER_VAR
				},
				async () => {
					// Verify environment is modified
					process.env.TEST_VAR!.should.equal("modified")
					should.not.exist(process.env.ANOTHER_VAR)
					return "test"
				},
			)

			// Verify environment is restored
			process.env.TEST_VAR!.should.equal(originalTestVar)
			process.env.ANOTHER_VAR!.should.equal(originalAnotherVar)
		})

		it("should handle undefined environment variables", async () => {
			await AwsBedrockHandler["withTempEnv"](
				() => {
					delete process.env.UNDEFINED_VAR
				},
				async () => {
					should.not.exist(process.env.UNDEFINED_VAR)
					return "test"
				},
			)

			// Verify undefined variable is not present
			should.not.exist(process.env.UNDEFINED_VAR)
		})

		it("should handle errors and still restore environment", async () => {
			// Set initial environment
			process.env.TEST_VAR = "original"

			try {
				await AwsBedrockHandler["withTempEnv"](
					() => {
						process.env.TEST_VAR = "modified"
					},
					async () => {
						throw new Error("Test error")
					},
				)
				should.fail(null, null, "Expected error was not thrown", "throw")
			} catch (error) {
				;(error as Error).message.should.equal("Test error")
			}

			// Verify environment is restored even after error
			process.env.TEST_VAR!.should.equal("original")
		})

		it("should handle multiple environment variable changes", async () => {
			// Set initial environment
			process.env.VAR1 = "original1"
			process.env.VAR2 = "original2"
			process.env.VAR3 = "original3"

			// Store original values
			const originalVar1 = process.env.VAR1
			const originalVar2 = process.env.VAR2
			const originalVar3 = process.env.VAR3

			await AwsBedrockHandler["withTempEnv"](
				() => {
					process.env.VAR1 = "modified1"
					process.env.VAR2 = "modified2"
					delete process.env.VAR3
				},
				async () => {
					// Verify environment is modified
					process.env.VAR1!.should.equal("modified1")
					process.env.VAR2!.should.equal("modified2")
					should.not.exist(process.env.VAR3)
					return "test"
				},
			)

			// Verify environment is restored
			process.env.VAR1!.should.equal(originalVar1)
			process.env.VAR2!.should.equal(originalVar2)
			process.env.VAR3!.should.equal(originalVar3)
		})

		it("should work with AWS_PROFILE", async () => {
			process.env["AWS_PROFILE"] = "test-profile"

			const preAWSProfile = process.env["AWS_PROFILE"]

			await AwsBedrockHandler["withTempEnv"](
				() => {
					delete process.env["AWS_PROFILE"]
				},
				async () => {
					should.not.exist(process.env["AWS_PROFILE"])
					return "test"
				},
			)

			process.env["AWS_PROFILE"]!.should.equal(preAWSProfile)
		})
	})
})
