import { convertToMentionPath } from "../path-mentions"

describe("path-mentions", () => {
	describe("convertToMentionPath", () => {
		it("should convert an absolute path to a mention path when it starts with cwd", () => {
			// Windows-style paths
			expect(convertToMentionPath("C:\\Users\\user\\project\\file.txt", "C:\\Users\\user\\project")).toBe(
				"@/file.txt",
			)

			// Unix-style paths
			expect(convertToMentionPath("/Users/user/project/file.txt", "/Users/user/project")).toBe("@/file.txt")
		})

		it("should handle paths with trailing slashes in cwd", () => {
			expect(convertToMentionPath("/Users/user/project/file.txt", "/Users/user/project/")).toBe("@/file.txt")
		})

		it("should be case-insensitive when matching paths", () => {
			expect(convertToMentionPath("/Users/User/Project/file.txt", "/users/user/project")).toBe("@/file.txt")
		})

		it("should return the original path when cwd is not provided", () => {
			expect(convertToMentionPath("/Users/user/project/file.txt")).toBe("/Users/user/project/file.txt")
		})

		it("should return the original path when it does not start with cwd", () => {
			expect(convertToMentionPath("/Users/other/project/file.txt", "/Users/user/project")).toBe(
				"/Users/other/project/file.txt",
			)
		})

		it("should normalize backslashes to forward slashes", () => {
			expect(convertToMentionPath("C:\\Users\\user\\project\\subdir\\file.txt", "C:\\Users\\user\\project")).toBe(
				"@/subdir/file.txt",
			)
		})

		it("should handle nested paths correctly", () => {
			expect(convertToMentionPath("/Users/user/project/nested/deeply/file.txt", "/Users/user/project")).toBe(
				"@/nested/deeply/file.txt",
			)
		})

		it("should strip file:// protocol from paths if present", () => {
			// Without cwd
			expect(convertToMentionPath("file:///Users/user/project/file.txt")).toBe("/Users/user/project/file.txt")

			// With cwd - should strip protocol and then apply mention path logic
			expect(convertToMentionPath("file:///Users/user/project/file.txt", "/Users/user/project")).toBe(
				"@/file.txt",
			)

			// With Windows paths
			expect(convertToMentionPath("file://C:/Users/user/project/file.txt", "C:/Users/user/project")).toBe(
				"@/file.txt",
			)
		})
	})
})
