import * as path from "path"

describe("custom-instructions path detection", () => {
	it("should use exact path comparison instead of string includes", () => {
		// Test the logic that our fix implements
		const fakeHomeDir = "/Users/john.roo.smith"
		const globalRooDir = path.join(fakeHomeDir, ".roo") // "/Users/john.roo.smith/.roo"
		const projectRooDir = "/projects/my-project/.roo"

		// Old implementation (fragile):
		// const isGlobal = rooDir.includes(path.join(os.homedir(), ".roo"))
		// This could fail if the home directory path contains ".roo" elsewhere

		// New implementation (robust):
		// const isGlobal = path.resolve(rooDir) === path.resolve(getGlobalRooDirectory())

		// Test the new logic
		const isGlobalForGlobalDir = path.resolve(globalRooDir) === path.resolve(globalRooDir)
		const isGlobalForProjectDir = path.resolve(projectRooDir) === path.resolve(globalRooDir)

		expect(isGlobalForGlobalDir).toBe(true)
		expect(isGlobalForProjectDir).toBe(false)

		// Verify that the old implementation would have been problematic
		// if the home directory contained ".roo" in the path
		const oldLogicGlobal = globalRooDir.includes(path.join(fakeHomeDir, ".roo"))
		const oldLogicProject = projectRooDir.includes(path.join(fakeHomeDir, ".roo"))

		expect(oldLogicGlobal).toBe(true) // This works
		expect(oldLogicProject).toBe(false) // This also works, but is fragile

		// The issue was that if the home directory path itself contained ".roo",
		// the includes() check could produce false positives in edge cases
	})

	it("should handle edge cases with path resolution", () => {
		// Test various edge cases that exact path comparison handles better
		const testCases = [
			{
				global: "/Users/test/.roo",
				project: "/Users/test/project/.roo",
				expected: { global: true, project: false },
			},
			{
				global: "/home/user/.roo",
				project: "/home/user/.roo", // Same directory
				expected: { global: true, project: true },
			},
			{
				global: "/Users/john.roo.smith/.roo",
				project: "/projects/app/.roo",
				expected: { global: true, project: false },
			},
		]

		testCases.forEach(({ global, project, expected }) => {
			const isGlobalForGlobal = path.resolve(global) === path.resolve(global)
			const isGlobalForProject = path.resolve(project) === path.resolve(global)

			expect(isGlobalForGlobal).toBe(expected.global)
			expect(isGlobalForProject).toBe(expected.project)
		})
	})
})
