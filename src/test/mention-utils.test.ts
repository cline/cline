import { expect } from "chai"
import { describe, it } from "mocha"
import { EXT_PREFIX, resolveExtensionQueries } from "@/utils/mentions"

describe("utils/mentions", () => {
	describe("resolveExtensionQueries", () => {
		const VALID_EXTENSION_NAME = "VALID_EXTENSION_NAME"
		const VALID_COMMAND_NAME = "VALID_COMMAND_NAME"
		const VALID_QUERY_RESULT = "VALID_QUERY_RESULT"

		const qryCmd = (extname: string, cmdName: string): string => `${extname}.${cmdName}`
		const qryCmdWthPrefix = (extname: string, cmdName: string): string => `${EXT_PREFIX}${qryCmd(extname, cmdName)}`

		const VALID_QUERY = qryCmd(VALID_EXTENSION_NAME, VALID_COMMAND_NAME)

		const INVALID_EXTENSION_NAME = "INVALID_EXTENSION"
		const INVALID_COMMAND_NAME = "INVALID_COMMAND_NAME"

		const INVALID_EXT_NAME_ERROR = new Error("Invalid extension name")
		const INVALID_CMD_NAME_ERROR = new Error("Invalid command name")

		const resolve = (txtToResolve: string): Promise<string> => {
			if (txtToResolve === VALID_QUERY) {
				return Promise.resolve(VALID_QUERY_RESULT)
			}
			if (txtToResolve.includes(INVALID_EXTENSION_NAME)) {
				throw INVALID_EXT_NAME_ERROR
			}
			if (txtToResolve.includes(INVALID_COMMAND_NAME)) {
				throw INVALID_CMD_NAME_ERROR
			}
			// The mock resolver should not be called with unexpected queries.
			// Using expect.fail() ensures that any unhandled case loudly fails the test.
			expect.fail(`Mock resolver was called with an unexpected query: ${txtToResolve}`)
		}

		it("should return the original text if no placeholders are present", async () => {
			const input = "Some text without any placeholders."
			const result = await resolveExtensionQueries(input, resolve)
			expect(result).to.equal(input)
		})

		it("should resolve a single query placeholder", async () => {
			const input = `${EXT_PREFIX}${VALID_QUERY}`
			const result = await resolveExtensionQueries(input, resolve)
			expect(result).to.equal(VALID_QUERY_RESULT)
		})

		it("should resolve a single query placeholder within a larger text", async () => {
			const input = `Some text ${qryCmdWthPrefix(VALID_EXTENSION_NAME, VALID_COMMAND_NAME)} around it.`
			const result = await resolveExtensionQueries(input, resolve)
			expect(result).to.equal(`Some text ${VALID_QUERY_RESULT} around it.`)
		})

		it("should resolve multiple query placeholders within a larger text", async () => {
			const input = `Some text ${qryCmdWthPrefix(VALID_EXTENSION_NAME, VALID_COMMAND_NAME)} around it.
Another sentence ${qryCmdWthPrefix(VALID_EXTENSION_NAME, VALID_COMMAND_NAME)} with smth to resolve.
One last sentence with ${qryCmdWthPrefix(VALID_EXTENSION_NAME, VALID_COMMAND_NAME)} to resolve.`
			const result = await resolveExtensionQueries(input, resolve)

			const expectedResult = `Some text ${VALID_QUERY_RESULT} around it.
Another sentence ${VALID_QUERY_RESULT} with smth to resolve.
One last sentence with ${VALID_QUERY_RESULT} to resolve.`
			expect(result).to.equal(expectedResult)
		})

		describe("Error Handling", () => {
			const testCases = [
				{
					description: "should throw an error for an invalid extension name",
					input: `Some text with ${qryCmdWthPrefix(INVALID_EXTENSION_NAME, VALID_COMMAND_NAME)}`,
					expectedError: INVALID_EXT_NAME_ERROR,
				},
				{
					description: "should throw an error for an invalid command name",
					input: `Some text with ${qryCmdWthPrefix(VALID_EXTENSION_NAME, INVALID_COMMAND_NAME)}`,
					expectedError: INVALID_CMD_NAME_ERROR,
				},
			]

			for (const { description, input, expectedError } of testCases) {
				it(description, async () => {
					try {
						await resolveExtensionQueries(input, resolve)
						expect.fail("Expected resolveExtensionQueries to throw an error.")
					} catch (error) {
						expect(error).to.equal(expectedError)
					}
				})
			}
		})
	})
})
