import { extractPatternsFromCommand } from "../command-parser"

describe("extractPatternsFromCommand", () => {
	it("should extract simple command pattern", () => {
		const patterns = extractPatternsFromCommand("ls")
		expect(patterns).toEqual(["ls"])
	})

	it("should extract command with subcommand", () => {
		const patterns = extractPatternsFromCommand("git push origin main")
		expect(patterns).toEqual(["git", "git push", "git push origin"])
	})

	it("should stop at flags", () => {
		const patterns = extractPatternsFromCommand("git commit -m 'test'")
		expect(patterns).toEqual(["git", "git commit"])
	})

	it("should stop at paths", () => {
		const patterns = extractPatternsFromCommand("cd /usr/local/bin")
		expect(patterns).toEqual(["cd"])
	})

	it("should handle pipes", () => {
		const patterns = extractPatternsFromCommand("ls -la | grep test")
		expect(patterns).toEqual(["grep", "grep test", "ls"])
	})

	it("should handle && operator", () => {
		const patterns = extractPatternsFromCommand("npm install && git push origin main")
		expect(patterns).toEqual(["git", "git push", "git push origin", "npm", "npm install"])
	})

	it("should handle || operator", () => {
		const patterns = extractPatternsFromCommand("npm test || npm run test:ci")
		expect(patterns).toEqual(["npm", "npm run", "npm test"])
	})

	it("should handle semicolon separator", () => {
		const patterns = extractPatternsFromCommand("cd src; npm install")
		expect(patterns).toEqual(["cd", "cd src", "npm", "npm install"])
	})

	it("should skip numeric commands", () => {
		const patterns = extractPatternsFromCommand("0 total")
		expect(patterns).toEqual([])
	})

	it("should handle empty command", () => {
		const patterns = extractPatternsFromCommand("")
		expect(patterns).toEqual([])
	})

	it("should handle null/undefined", () => {
		expect(extractPatternsFromCommand(null as any)).toEqual([])
		expect(extractPatternsFromCommand(undefined as any)).toEqual([])
	})

	it("should handle scripts", () => {
		const patterns = extractPatternsFromCommand("./script.sh --verbose")
		expect(patterns).toEqual(["./script.sh"])
	})

	it("should handle paths with dots", () => {
		const patterns = extractPatternsFromCommand("git add .")
		expect(patterns).toEqual(["git", "git add"])
	})

	it("should handle paths with tilde", () => {
		const patterns = extractPatternsFromCommand("cd ~/projects")
		expect(patterns).toEqual(["cd"])
	})

	it("should handle colons in arguments", () => {
		const patterns = extractPatternsFromCommand("docker run image:tag")
		expect(patterns).toEqual(["docker", "docker run"])
	})

	it("should return sorted patterns", () => {
		const patterns = extractPatternsFromCommand("npm run build && git push")
		expect(patterns).toEqual(["git", "git push", "npm", "npm run", "npm run build"])
	})

	it("should handle complex command with multiple operators", () => {
		const patterns = extractPatternsFromCommand("npm install && npm test | grep success || echo 'failed'")
		expect(patterns).toContain("npm")
		expect(patterns).toContain("npm install")
		expect(patterns).toContain("npm test")
		expect(patterns).toContain("grep")
		expect(patterns).toContain("echo")
	})

	it("should handle malformed commands gracefully", () => {
		const patterns = extractPatternsFromCommand("echo 'unclosed quote")
		expect(patterns).toContain("echo")
	})

	it("should not treat package managers specially", () => {
		const patterns = extractPatternsFromCommand("npm run build")
		expect(patterns).toEqual(["npm", "npm run", "npm run build"])
		// Now includes "npm run build" with 3-level extraction
	})

	it("should extract at most 3 levels", () => {
		const patterns = extractPatternsFromCommand("git push origin main --force")
		expect(patterns).toEqual(["git", "git push", "git push origin"])
		// Should NOT include deeper levels beyond 3
	})

	it("should handle multi-level commands like gh pr", () => {
		const patterns = extractPatternsFromCommand("gh pr checkout 123")
		expect(patterns).toEqual(["gh", "gh pr", "gh pr checkout"])
	})

	it("should extract 3 levels for git remote add", () => {
		const patterns = extractPatternsFromCommand("git remote add origin https://github.com/user/repo.git")
		expect(patterns).toEqual(["git", "git remote", "git remote add"])
	})

	it("should extract 3 levels for npm run build", () => {
		const patterns = extractPatternsFromCommand("npm run build --production")
		expect(patterns).toEqual(["npm", "npm run", "npm run build"])
	})

	it("should stop at file extensions even at third level", () => {
		const patterns = extractPatternsFromCommand("node scripts test.js")
		expect(patterns).toEqual(["node", "node scripts"])
		// Should NOT include "node scripts test.js" because of .js
	})

	it("should stop at flags at any level", () => {
		const patterns = extractPatternsFromCommand("docker run -it ubuntu")
		expect(patterns).toEqual(["docker", "docker run"])
		// Stops at -it flag
	})
})
