import { describe, it } from "mocha"
import "should"
import { shouldIgnorePath } from "./cline-ignore"

describe("shouldIgnorePath", () => {
	it("exact match pattern", () => {
		const ignoreContent = "test.txt"
		shouldIgnorePath("test.txt", ignoreContent).should.be.true()
		shouldIgnorePath("other.txt", ignoreContent).should.be.false()
	})

	it("wildcard pattern", () => {
		const ignoreContent = "*.txt"
		shouldIgnorePath("test.txt", ignoreContent).should.be.true()
		shouldIgnorePath("test.js", ignoreContent).should.be.false()
	})

	it("directory pattern", () => {
		const ignoreContent = "node_modules/"
		shouldIgnorePath("node_modules/package.json", ignoreContent).should.be.true()
		shouldIgnorePath("src/node_modules.ts", ignoreContent).should.be.false()
	})

	it("comments and empty lines", () => {
		const ignoreContent = `
      # This is a comment
      test.txt

      # This is also ignored
      *.js
    `
		shouldIgnorePath("test.txt", ignoreContent).should.be.true()
		shouldIgnorePath("app.js", ignoreContent).should.be.true()
	})

	it("negation pattern", () => {
		const ignoreContent = `
      *.txt
      !important.txt
      docs/
      !docs/README.txt
    `
		// Matches *.txt but excluded by !important.txt
		shouldIgnorePath("test.txt", ignoreContent).should.be.true()
		shouldIgnorePath("important.txt", ignoreContent).should.be.false()

		// Matches docs/ but excluded by !docs/README.txt
		shouldIgnorePath("docs/test.txt", ignoreContent).should.be.true()
		shouldIgnorePath("docs/README.txt", ignoreContent).should.be.false()
	})

	it("complex negation pattern combinations", () => {
		const ignoreContent = `
      # Ignore all .log files
      *.log
      # But not debug.log
      !debug.log
      # However, ignore debug.log in tmp/
      tmp/debug.log
    `
		shouldIgnorePath("error.log", ignoreContent).should.be.true()
		shouldIgnorePath("debug.log", ignoreContent).should.be.false()
		shouldIgnorePath("tmp/debug.log", ignoreContent).should.be.true()
	})

	it("negation pattern with reversed order", () => {
		const ignoreContent = `
			!.env.example
			.env*
		`
		// .env.example should be ignored because .env* comes after !.env.example
		shouldIgnorePath(".env.example", ignoreContent).should.be.true()
		shouldIgnorePath(".env.local", ignoreContent).should.be.true()
	})
})
