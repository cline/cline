import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import * as extractTextModule from "@integrations/misc/extract-text"
import * as terminalModule from "@integrations/terminal/get-latest-output"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import * as gitModule from "@utils/git"
import { expect } from "chai"
import * as fs from "fs"
import * as isBinaryFileModule from "isbinaryfile"
import * as path from "path"
import * as sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { parseMentions } from "."

describe("parseMentions", () => {
	let sandbox: sinon.SinonSandbox
	let urlContentFetcherStub: sinon.SinonStubbedInstance<UrlContentFetcher>
	let fileContextTrackerStub: sinon.SinonStubbedInstance<FileContextTracker>
	let fsStatStub: sinon.SinonStub
	let fsReaddirStub: sinon.SinonStub
	let extractTextStub: sinon.SinonStub
	let isBinaryFileStub: sinon.SinonStub
	let getLatestTerminalOutputStub: sinon.SinonStub
	let getWorkingStateStub: sinon.SinonStub
	let getCommitInfoStub: sinon.SinonStub
	let showMessageStub: sinon.SinonStub

	const cwd = "/test/project"

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		setVscodeHostProviderMock()
		// Create stubs for dependencies
		urlContentFetcherStub = {
			launchBrowser: sandbox.stub().resolves(),
			closeBrowser: sandbox.stub().resolves(),
			urlToMarkdown: sandbox.stub().resolves("# Example Website\n\nContent here"),
		} as any

		fileContextTrackerStub = {
			trackFileContext: sandbox.stub().resolves(),
		} as any

		// Stub file system operations using fs.promises
		fsStatStub = sandbox.stub(fs.promises, "stat")
		fsReaddirStub = sandbox.stub(fs.promises, "readdir")

		// Stub other modules
		extractTextStub = sandbox.stub(extractTextModule, "extractTextFromFile")
		isBinaryFileStub = sandbox.stub(isBinaryFileModule, "isBinaryFile")
		getLatestTerminalOutputStub = sandbox.stub(terminalModule, "getLatestTerminalOutput")
		getWorkingStateStub = sandbox.stub(gitModule, "getWorkingState")
		getCommitInfoStub = sandbox.stub(gitModule, "getCommitInfo")
		showMessageStub = sandbox.stub(HostProvider.window, "showMessage")
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("File mentions", () => {
		it("should handle simple file mention", async () => {
			const text = "Check @/src/index.ts for details"

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(false)
			extractTextStub.resolves("console.log('Hello World');")

			const result = await parseMentions(text, cwd, urlContentFetcherStub, fileContextTrackerStub)

			const expectedOutput = `Check 'src/index.ts' (see below for file content) for details

<file_content path="src/index.ts">
console.log('Hello World');
</file_content>`

			expect(result).to.equal(expectedOutput)
			expect(fileContextTrackerStub.trackFileContext.calledWith("src/index.ts", "file_mentioned")).to.be.true
		})

		it("should handle quoted file paths with spaces", async () => {
			const text = 'Open @"/path with spaces/file.txt"'

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(false)
			extractTextStub.resolves("console.log('Hello World');")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Open 'path with spaces/file.txt' (see below for file content)

<file_content path="path with spaces/file.txt">
console.log('Hello World');
</file_content>`

			expect(result).to.equal(expectedOutput)
		})

		it("should handle binary files", async () => {
			const text = "Check @/image.png"

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(true)

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Check 'image.png' (see below for file content)

<file_content path="image.png">
(Binary file, unable to display content)
</file_content>`

			expect(result).to.equal(expectedOutput)
		})

		it("should handle file read errors", async () => {
			const text = "Check @/missing.txt"

			fsStatStub.rejects(new Error("ENOENT: no such file or directory"))

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Check 'missing.txt' (see below for file content)

<file_content path="missing.txt">
Error fetching content: Failed to access path "missing.txt": ENOENT: no such file or directory
</file_content>`

			expect(result).to.equal(expectedOutput)
		})
	})

	describe("Folder mentions", () => {
		it("should handle folder mention", async () => {
			const text = "Look in @/src/ folder"

			fsStatStub.resolves({ isFile: () => false, isDirectory: () => true })
			fsReaddirStub.resolves([
				{ name: "index.ts", isFile: () => true, isDirectory: () => false },
				{ name: "utils", isFile: () => false, isDirectory: () => true },
				{ name: "README.md", isFile: () => true, isDirectory: () => false },
			])

			// Set up file content stubs
			isBinaryFileStub.resolves(false)
			extractTextStub.withArgs(path.resolve(cwd, "src/index.ts")).resolves("export const main = () => {};")
			extractTextStub.withArgs(path.resolve(cwd, "src/README.md")).resolves("# Source Code")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Look in 'src/' (see below for folder content) folder

<folder_content path="src/">
├── index.ts
├── utils/
└── README.md

<file_content path="src/index.ts">
export const main = () => {};
</file_content>

<file_content path="src/README.md">
# Source Code
</file_content>
</folder_content>`

			expect(result).to.equal(expectedOutput)
		})
	})

	describe("URL mentions", () => {
		it("should handle URL mention", async () => {
			const text = "Visit @https://example.com for info"

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Visit 'https://example.com' (see below for site content) for info

<url_content url="https://example.com">
# Example Website

Content here
</url_content>`

			expect(result).to.equal(expectedOutput)
			expect(urlContentFetcherStub.launchBrowser.called).to.be.true
			expect(urlContentFetcherStub.urlToMarkdown.calledWith("https://example.com")).to.be.true
			expect(urlContentFetcherStub.closeBrowser.called).to.be.true
		})

		it("should handle browser launch errors", async () => {
			const text = "Visit @https://example.com"

			urlContentFetcherStub.launchBrowser.rejects(new Error("Browser launch failed"))

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Visit 'https://example.com' (see below for site content)

<url_content url="https://example.com">
Error fetching content: Browser launch failed
</url_content>`

			expect(result).to.equal(expectedOutput)
			expect(showMessageStub.called).to.be.true
		})

		it("should handle URL fetch errors", async () => {
			const text = "Visit @https://example.com"

			urlContentFetcherStub.urlToMarkdown.rejects(new Error("Network error"))

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Visit 'https://example.com' (see below for site content)

<url_content url="https://example.com">
Error fetching content: Network error
</url_content>`

			expect(result).to.equal(expectedOutput)
			expect(showMessageStub.called).to.be.true
		})
	})

	describe("Special mentions", () => {
		it("should handle @terminal mention", async () => {
			const text = "See @terminal output"

			getLatestTerminalOutputStub.resolves("$ npm test\nAll tests passed!")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `See Terminal Output (see below for output) output

<terminal_output>
$ npm test
All tests passed!
</terminal_output>`

			expect(result).to.equal(expectedOutput)
		})

		it("should handle @git-changes mention", async () => {
			const text = "Review @git-changes"

			getWorkingStateStub.resolves("M  src/index.ts\nA  src/new-file.ts")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Review Working directory changes (see below for details)

<git_working_state>
M  src/index.ts
A  src/new-file.ts
</git_working_state>`

			expect(result).to.equal(expectedOutput)
		})

		it("should handle git commit hash mention", async () => {
			const text = "See commit @abcdef1234567890"

			getCommitInfoStub.resolves("commit abcdef1234567890\nAuthor: Test\nDate: 2024-01-01\n\nInitial commit")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `See commit Git commit 'abcdef1234567890' (see below for commit info)

<git_commit hash="abcdef1234567890">
commit abcdef1234567890
Author: Test
Date: 2024-01-01

Initial commit
</git_commit>`

			expect(result).to.equal(expectedOutput)
		})
	})

	describe("Multiple mentions", () => {
		it("should handle multiple mentions in order", async () => {
			const text = "Check @/file1.txt and @/file2.txt"

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(false)
			extractTextStub.withArgs(path.resolve(cwd, "file1.txt")).resolves("Content 1")
			extractTextStub.withArgs(path.resolve(cwd, "file2.txt")).resolves("Content 2")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Check 'file1.txt' (see below for file content) and 'file2.txt' (see below for file content)

<file_content path="file1.txt">
Content 1
</file_content>

<file_content path="file2.txt">
Content 2
</file_content>`

			expect(result).to.equal(expectedOutput)
		})

		it("should handle duplicate mentions only once", async () => {
			const text = "Check @/file.txt and again @/file.txt"

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(false)
			extractTextStub.resolves("Content")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Check 'file.txt' (see below for file content) and again 'file.txt' (see below for file content)

<file_content path="file.txt">
Content
</file_content>`

			expect(result).to.equal(expectedOutput)
		})

		it("should handle mixed mention types", async () => {
			const text = "Check @/file.txt, and @https://example.com"

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(false)
			extractTextStub.resolves("File content")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Check 'file.txt' (see below for file content), and 'https://example.com' (see below for site content)

<file_content path="file.txt">
File content
</file_content>

<url_content url="https://example.com">
# Example Website

Content here
</url_content>`

			expect(result).to.equal(expectedOutput)
		})
	})

	describe("Error handling", () => {
		it("should handle errors for each mention type gracefully", async () => {
			const text = "@/error.txt @terminal @git-changes @abc1234567"

			fsStatStub.rejects(new Error("File error"))
			getLatestTerminalOutputStub.rejects(new Error("Terminal error"))
			getWorkingStateStub.rejects(new Error("Git state error"))
			getCommitInfoStub.rejects(new Error("Commit error"))

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `'error.txt' (see below for file content) Terminal Output (see below for output) Working directory changes (see below for details) Git commit 'abc1234567' (see below for commit info)

<file_content path="error.txt">
Error fetching content: Failed to access path "error.txt": File error
</file_content>

<terminal_output>
Error fetching terminal output: Terminal error
</terminal_output>

<git_working_state>
Error fetching working state: Git state error
</git_working_state>

<git_commit hash="abc1234567">
Error fetching commit info: Commit error
</git_commit>`

			expect(result).to.equal(expectedOutput)
		})
	})

	describe("Edge cases", () => {
		it("should handle text with no mentions", async () => {
			const text = "This is plain text without any mentions"

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			expect(result).to.equal(text)
		})

		it("should handle empty text", async () => {
			const result = await parseMentions("", cwd, urlContentFetcherStub)

			expect(result).to.equal("")
		})

		it("should handle mentions with trailing punctuation", async () => {
			const text = "Check @/file.txt!"

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(false)
			extractTextStub.resolves("Content")

			const result = await parseMentions(text, cwd, urlContentFetcherStub)

			const expectedOutput = `Check 'file.txt' (see below for file content)!

<file_content path="file.txt">
Content
</file_content>`

			expect(result).to.equal(expectedOutput)
		})
	})

	describe("Multiroot workspace mentions", () => {
		let workspaceManagerStub: any

		beforeEach(() => {
			// Create a mock multiroot workspace manager
			workspaceManagerStub = {
				getRoots: sandbox.stub().returns([
					{ name: "frontend", path: "/test/frontend" },
					{ name: "backend", path: "/test/backend" },
				]),
				getRootByName: sandbox.stub().callsFake((name: string) => {
					const roots = [
						{ name: "frontend", path: "/test/frontend" },
						{ name: "backend", path: "/test/backend" },
					]
					return roots.find((r) => r.name === name)
				}),
			}
		})

		it("should handle workspace-prefixed file mention", async () => {
			const text = "Check @frontend:/src/index.ts"

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(false)
			extractTextStub.resolves("console.log('Frontend');")

			const result = await parseMentions(text, cwd, urlContentFetcherStub, fileContextTrackerStub, workspaceManagerStub)

			const expectedOutput = `Check 'frontend:src/index.ts' (see below for file content)

<file_content path="src/index.ts" workspace="frontend">
console.log('Frontend');
</file_content>`

			expect(result).to.equal(expectedOutput)
			expect(fileContextTrackerStub.trackFileContext.calledWith("src/index.ts", "file_mentioned")).to.be.true
		})

		it("should handle file in multiple workspaces without hint", async () => {
			const text = "Check @/config.json"

			fsStatStub.resolves({ isFile: () => true, isDirectory: () => false })
			isBinaryFileStub.resolves(false)
			extractTextStub.withArgs(path.resolve("/test/frontend", "config.json")).resolves('{"env": "dev"}')
			extractTextStub.withArgs(path.resolve("/test/backend", "config.json")).resolves('{"env": "prod"}')

			const result = await parseMentions(text, cwd, urlContentFetcherStub, fileContextTrackerStub, workspaceManagerStub)

			// Should include both files with workspace annotations
			expect(result).to.include('workspace="frontend"')
			expect(result).to.include('workspace="backend"')
			expect(result).to.include('{"env": "dev"}')
			expect(result).to.include('{"env": "prod"}')
		})
	})
})
