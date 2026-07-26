/**
 * Unit tests for skills utility functions
 * Tests skill discovery, override resolution, toggle filtering, and content loading
 */

import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import { expect } from "chai"
import * as actualFsPromises from "fs/promises"
import * as path from "path"
import * as sinon from "sinon"

import * as actualSkillDirectories from "@/core/storage/skill-directories"
import { Logger } from "@/shared/services/Logger"
import * as actualFsUtils from "@/utils/fs"

// bun loads real ESM, so sinon cannot stub the `@utils/fs`,
// `@core/storage/skill-directories`, or the `fs/promises` namespace exports
// ("ES Modules cannot be stubbed"). Crucially, under bun `fs.promises` and the
// `fs/promises` module are NOT the same object, so stubbing `fs.promises.X`
// (which worked under mocha/ts-node) does not affect the SUT's
// `import * as fs from "fs/promises"` bindings. Inject module-level sinon stubs
// via bun's mock.module so the full sinon stub API (.withArgs/.resolves/etc.)
// keeps working through the exact specifiers the SUT imports.
const fileExistsAtPathStub = sinon.stub()
const isDirectoryStub_ = sinon.stub()
const getSkillsDirectoriesForScanStub = sinon.stub()
const readdirStub_ = sinon.stub()
const statStub_ = sinon.stub()
const readFileStub_ = sinon.stub()
const writeFileStub_ = sinon.stub()
const fsUtilsMock = () => ({
	...actualFsUtils,
	fileExistsAtPath: fileExistsAtPathStub,
	isDirectory: isDirectoryStub_,
})
const skillDirsMock = () => ({
	...actualSkillDirectories,
	getSkillsDirectoriesForScan: getSkillsDirectoriesForScanStub,
})
const fsPromisesMockNamespace = {
	...actualFsPromises,
	readdir: readdirStub_,
	stat: statStub_,
	readFile: readFileStub_,
	writeFile: writeFileStub_,
}
const fsPromisesMock = () => ({ ...fsPromisesMockNamespace, default: fsPromisesMockNamespace })
// The SUT imports via the `@utils/*` and `@core/*` tsconfig path aliases;
// register both the `@/`-prefixed and bare-alias forms to be safe.
mock.module("@utils/fs", fsUtilsMock)
mock.module("@/utils/fs", fsUtilsMock)
mock.module("@core/storage/skill-directories", skillDirsMock)
mock.module("@/core/storage/skill-directories", skillDirsMock)
mock.module("fs/promises", fsPromisesMock)
mock.module("node:fs/promises", fsPromisesMock)

import { parseYamlFrontmatter } from "../frontmatter"
import {
	discoverSkills,
	getAvailableSkills,
	getSkillContent,
	setSkillDisabledInFrontmatter,
	updateSkillMarkdownDisabledState,
} from "../skills"

describe("Skills Utility Functions", () => {
	let sandbox: sinon.SinonSandbox
	let fileExistsStub: sinon.SinonStub
	let isDirectoryStub: sinon.SinonStub
	let readdirStub: sinon.SinonStub
	let statStub: sinon.SinonStub
	let readFileStub: sinon.SinonStub

	// Use path.join for OS-independent paths
	const TEST_CWD = path.join("/test", "project")
	const GLOBAL_SKILLS_DIR = path.join("/home", "user", ".bedrock-coder", "skills")

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Stub Logger.warn to avoid noise in test output
		sandbox.stub(Logger, "warn")

		// Reset the module-level sinon stubs (injected via mock.module above) and
		// re-point the per-test handles at them.
		fileExistsAtPathStub.reset()
		isDirectoryStub_.reset()
		getSkillsDirectoriesForScanStub.reset()
		readdirStub_.reset()
		statStub_.reset()
		readFileStub_.reset()
		writeFileStub_.reset()
		fileExistsStub = fileExistsAtPathStub
		isDirectoryStub = isDirectoryStub_
		readdirStub = readdirStub_
		statStub = statStub_
		readFileStub = readFileStub_

		getSkillsDirectoriesForScanStub.returns([
			{ path: path.join(TEST_CWD, ".bedrock-coder", "skills"), source: "project" },
			{ path: path.join(TEST_CWD, ".bedrock-coder", "skills"), source: "project" },
			{ path: path.join(TEST_CWD, ".claude", "skills"), source: "project" },
			{ path: path.join(TEST_CWD, ".agents", "skills"), source: "project" },
			{ path: GLOBAL_SKILLS_DIR, source: "global" },
			{ path: path.join("/home", "user", ".agents", "skills"), source: "global" },
		])

		// Default: no directories exist
		fileExistsStub.resolves(false)
		isDirectoryStub.resolves(false)
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("discoverSkills", () => {
		it("should discover skills from global directory", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "my-skill")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["my-skill"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: my-skill
description: A test skill
---
Instructions here`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(1)
			expect(skills[0].name).to.equal("my-skill")
			expect(skills[0].description).to.equal("A test skill")
			expect(skills[0].source).to.equal("global")
		})

		// Regression test for https://github.com/FFFalexgo/AWS_Bedrock_Coder/issues/12151:
		// SKILL.md files saved with a UTF-8 BOM (e.g. by Windows Notepad's "UTF-8 with BOM"
		// encoding) were silently skipped because the frontmatter regex required "---" at the
		// very start of the file and never accounted for the leading \uFEFF byte sequence.
		it("should discover skills whose SKILL.md starts with a UTF-8 BOM", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "my-skill")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["my-skill"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`\uFEFF---
name: my-skill
description: A test skill
---
# my-skill
This is a test skill.`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(1)
			expect(skills[0].name).to.equal("my-skill")
			expect(skills[0].description).to.equal("A test skill")
			expect(skills[0].source).to.equal("global")
		})

		it("should discover skills from project .bedrock-coder/skills directory", async () => {
			const projectSkillsDir = path.join(TEST_CWD, ".bedrock-coder", "skills")
			const skillDir = path.join(projectSkillsDir, "explaining-code")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(projectSkillsDir).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(projectSkillsDir).resolves(true)
			readdirStub.withArgs(projectSkillsDir).resolves(["explaining-code"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: explaining-code
description: Explains code with diagrams and analogies
---
Use analogies and ASCII diagrams when explaining code.`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(1)
			expect(skills[0].name).to.equal("explaining-code")
			expect(skills[0].source).to.equal("project")
		})

		it("should discover skills from project .bedrock-coder/skills directory", async () => {
			const bedrockCoderSkillsDir = path.join(TEST_CWD, ".bedrock-coder", "skills")
			const skillDir = path.join(bedrockCoderSkillsDir, "debugging")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(bedrockCoderSkillsDir).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(bedrockCoderSkillsDir).resolves(true)
			readdirStub.withArgs(bedrockCoderSkillsDir).resolves(["debugging"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: debugging
description: Debug code systematically
---
Use systematic debugging approaches.`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(1)
			expect(skills[0].name).to.equal("debugging")
			expect(skills[0].source).to.equal("project")
		})

		it("should discover skills from project .claude/skills directory", async () => {
			const claudeSkillsDir = path.join(TEST_CWD, ".claude", "skills")
			const skillDir = path.join(claudeSkillsDir, "coding")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(claudeSkillsDir).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(claudeSkillsDir).resolves(true)
			readdirStub.withArgs(claudeSkillsDir).resolves(["coding"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: coding
description: Write clean code
---
Follow best practices.`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(1)
			expect(skills[0].name).to.equal("coding")
			expect(skills[0].source).to.equal("project")
		})

		it("should discover skills from project .agents/skills directory", async () => {
			const agentsSkillsDir = path.join(TEST_CWD, ".agents", "skills")
			const skillDir = path.join(agentsSkillsDir, "testing")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(agentsSkillsDir).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(agentsSkillsDir).resolves(true)
			readdirStub.withArgs(agentsSkillsDir).resolves(["testing"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: testing
description: Write comprehensive tests
---
Always write tests.`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(1)
			expect(skills[0].name).to.equal("testing")
			expect(skills[0].source).to.equal("project")
		})

		it("should handle empty skills directories gracefully", async () => {
			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves([])

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(0)
		})

		it("should skip non-directory entries in skills folder", async () => {
			const readmePath = path.join(GLOBAL_SKILLS_DIR, "README.md")
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "my-skill")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["README.md", "my-skill"])
			statStub.withArgs(readmePath).resolves({ isDirectory: () => false })
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: my-skill
description: A skill
---
Content`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(1)
			expect(skills[0].name).to.equal("my-skill")
		})

		it("should skip skill directories without SKILL.md", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "incomplete-skill")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["incomplete-skill"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			fileExistsStub.withArgs(skillMdPath).resolves(false)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(0)
		})
	})

	describe("getAvailableSkills - Override Resolution", () => {
		it("should override project skill with global skill of same name", async () => {
			const globalSkillDir = path.join(GLOBAL_SKILLS_DIR, "coding")
			const globalSkillMdPath = path.join(globalSkillDir, "SKILL.md")

			// Setup global skill (higher priority)
			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(globalSkillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["coding"])
			statStub.withArgs(globalSkillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(globalSkillMdPath, "utf-8").resolves(`---
name: coding
description: Global coding skill
---
Global instructions`)

			// Setup project skill with same name (lower priority)
			const projectSkillsDir = path.join(TEST_CWD, ".bedrock-coder", "skills")
			const projectSkillDir = path.join(projectSkillsDir, "coding")
			const projectSkillMdPath = path.join(projectSkillDir, "SKILL.md")

			fileExistsStub.withArgs(projectSkillsDir).resolves(true)
			fileExistsStub.withArgs(projectSkillMdPath).resolves(true)
			isDirectoryStub.withArgs(projectSkillsDir).resolves(true)
			readdirStub.withArgs(projectSkillsDir).resolves(["coding"])
			statStub.withArgs(projectSkillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(projectSkillMdPath, "utf-8").resolves(`---
name: coding
description: Project coding skill
---
Project instructions`)

			const allSkills = await discoverSkills(TEST_CWD)
			const skills = getAvailableSkills(allSkills)

			expect(skills).to.have.lengthOf(1)
			expect(skills[0].description).to.equal("Global coding skill")
			expect(skills[0].source).to.equal("global")
		})

		it("should keep both skills when names are different", async () => {
			const globalSkillDir = path.join(GLOBAL_SKILLS_DIR, "global-skill")
			const globalSkillMdPath = path.join(globalSkillDir, "SKILL.md")

			// Setup global skill
			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(globalSkillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["global-skill"])
			statStub.withArgs(globalSkillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(globalSkillMdPath, "utf-8").resolves(`---
name: global-skill
description: A global skill
---
Content`)

			// Setup project skill with different name
			const projectSkillsDir = path.join(TEST_CWD, ".bedrock-coder", "skills")
			const projectSkillDir = path.join(projectSkillsDir, "project-skill")
			const projectSkillMdPath = path.join(projectSkillDir, "SKILL.md")

			fileExistsStub.withArgs(projectSkillsDir).resolves(true)
			fileExistsStub.withArgs(projectSkillMdPath).resolves(true)
			isDirectoryStub.withArgs(projectSkillsDir).resolves(true)
			readdirStub.withArgs(projectSkillsDir).resolves(["project-skill"])
			statStub.withArgs(projectSkillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(projectSkillMdPath, "utf-8").resolves(`---
name: project-skill
description: A project skill
---
Content`)

			const allSkills = await discoverSkills(TEST_CWD)
			const skills = getAvailableSkills(allSkills)

			expect(skills).to.have.lengthOf(2)
			const names = skills.map((s) => s.name)
			expect(names).to.include("global-skill")
			expect(names).to.include("project-skill")
		})
	})

	describe("Metadata Validation", () => {
		it("should reject skill with missing name field", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "bad-skill")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["bad-skill"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
description: Missing name
---
Content`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(0)
			sinon.assert.calledWithMatch(Logger.warn as sinon.SinonStub, /missing required 'name' field/)
		})

		it("should reject skill with missing description field", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "bad-skill")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["bad-skill"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: bad-skill
---
Content`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(0)
			sinon.assert.calledWithMatch(Logger.warn as sinon.SinonStub, /missing required 'description' field/)
		})

		it("should reject skill when name doesn't match directory name", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "my-dir")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["my-dir"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: different-name
description: Mismatched name
---
Content`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(0)
			sinon.assert.calledWithMatch(Logger.warn as sinon.SinonStub, /doesn't match directory/)
		})

		it("should handle malformed YAML frontmatter gracefully", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "bad-yaml")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["bad-yaml"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: [invalid yaml
description: broken
---
Content`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(0)
		})

		it("should handle file without frontmatter", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "no-front")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["no-front"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`Just plain markdown content without frontmatter`)

			const skills = await discoverSkills(TEST_CWD)

			expect(skills).to.have.lengthOf(0)
		})
	})

	describe("getSkillContent", () => {
		it("should load full skill content with instructions", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "my-skill")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["my-skill"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: my-skill
description: Test skill
---
These are the detailed instructions.

## Step 1
Do this first.

## Step 2
Then do this.`)

			const allSkills = await discoverSkills(TEST_CWD)
			const availableSkills = getAvailableSkills(allSkills)
			const content = await getSkillContent("my-skill", availableSkills)

			expect(content).to.not.be.null
			expect(content!.name).to.equal("my-skill")
			expect(content!.instructions).to.include("These are the detailed instructions")
			expect(content!.instructions).to.include("Step 1")
			expect(content!.instructions).to.include("Step 2")
		})

		it("should return null for non-existent skill", async () => {
			const content = await getSkillContent("non-existent", [])

			expect(content).to.be.null
		})

		it("should trim whitespace from instructions", async () => {
			const skillDir = path.join(GLOBAL_SKILLS_DIR, "my-skill")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
			readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["my-skill"])
			statStub.withArgs(skillDir).resolves({ isDirectory: () => true })
			readFileStub.withArgs(skillMdPath, "utf-8").resolves(`---
name: my-skill
description: Test
---

   Instructions with whitespace   

`)

			const allSkills = await discoverSkills(TEST_CWD)
			const availableSkills = getAvailableSkills(allSkills)
			const content = await getSkillContent("my-skill", availableSkills)

			expect(content!.instructions).to.equal("Instructions with whitespace")
		})
	})
})

describe("updateSkillMarkdownDisabledState", () => {
	it("adds disabled: true when disabling a skill with existing frontmatter", () => {
		const input = ["---", "name: my-skill", "description: A skill", "---", "Body here"].join("\n")
		const output = updateSkillMarkdownDisabledState(input, false)
		expect(output).to.contain("disabled: true")
		expect(output).to.contain("name: my-skill")
		expect(output).to.contain("Body here")
	})

	it("removes disabled flag when enabling a previously-disabled skill", () => {
		const input = ["---", "name: my-skill", "description: A skill", "disabled: true", "---", "Body"].join("\n")
		const output = updateSkillMarkdownDisabledState(input, true)
		expect(output).to.not.contain("disabled")
		expect(output).to.contain("name: my-skill")
		expect(output).to.contain("Body")
	})

	it("also clears a stale enabled: false when enabling", () => {
		const input = ["---", "name: my-skill", "enabled: false", "---", "Body"].join("\n")
		const output = updateSkillMarkdownDisabledState(input, true)
		expect(output).to.not.contain("enabled: false")
	})

	it("drops the frontmatter block entirely when enabling leaves it empty", () => {
		const input = ["---", "disabled: true", "---", "Body only"].join("\n")
		const output = updateSkillMarkdownDisabledState(input, true)
		expect(output).to.equal("Body only")
	})

	it("returns content unchanged when enabling a doc with no frontmatter", () => {
		const input = "Just body, no frontmatter"
		expect(updateSkillMarkdownDisabledState(input, true)).to.equal(input)
	})

	it("is idempotent: disabling an already-disabled skill keeps disabled: true once", () => {
		const input = ["---", "name: s", "disabled: true", "---", "B"].join("\n")
		const output = updateSkillMarkdownDisabledState(input, false)
		expect(output.match(/disabled: true/g)).to.have.lengthOf(1)
	})

	// Frontmatter block whose YAML is genuinely invalid (asserted below). The
	// `---` markers are well-formed so parseYamlFrontmatter detects frontmatter
	// and then fails to parse it, exercising the parseError branch.
	const MALFORMED_FRONTMATTER = ["---", "name: s", "description: : : bad", "  - nope", "---", "Body"].join("\n")

	it("uses a fixture whose frontmatter YAML is actually invalid", () => {
		// Guards the two tests below from rotting into false positives: if this
		// fixture ever became valid YAML, updateSkillMarkdownDisabledState would
		// take a different (rewriting) path and the "untouched" assertions could
		// pass for the wrong reason.
		const parsed = parseYamlFrontmatter(MALFORMED_FRONTMATTER)
		expect(parsed.hadFrontmatter).to.be.true
		expect(parsed.parseError, "fixture frontmatter should be invalid YAML").to.be.a("string")
	})

	it("leaves malformed-frontmatter files untouched when disabling (no double header)", () => {
		// parseYamlFrontmatter fails open and returns the full original document
		// as the body. Disabling must not prepend a second `---` block and corrupt
		// the file.
		const output = updateSkillMarkdownDisabledState(MALFORMED_FRONTMATTER, false)
		expect(output).to.equal(MALFORMED_FRONTMATTER)
		// Exactly one frontmatter opener/closer pair, not two.
		expect(output.match(/^---$/gm)).to.have.lengthOf(2)
	})

	it("leaves malformed-frontmatter files untouched when enabling", () => {
		expect(updateSkillMarkdownDisabledState(MALFORMED_FRONTMATTER, true)).to.equal(MALFORMED_FRONTMATTER)
	})
})

describe("setSkillDisabledInFrontmatter", () => {
	let sandbox: sinon.SinonSandbox
	let readFileStub: sinon.SinonStub
	let writeFileStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		sandbox.stub(Logger, "warn")
		// Use the module-level fs/promises stubs (mock.module above) since under
		// bun fs.promises !== the `fs/promises` module the SUT imports.
		readFileStub_.reset()
		writeFileStub_.reset()
		readFileStub = readFileStub_
		writeFileStub = writeFileStub_
		writeFileStub.resolves()
	})

	afterEach(() => sandbox.restore())

	it("writes disabled: true to the SKILL.md when disabling a disk skill", async () => {
		const skillPath = path.join("/home", "user", ".bedrock-coder", "skills", "s", "SKILL.md")
		readFileStub.withArgs(skillPath, "utf-8").resolves(["---", "name: s", "description: d", "---", "Body"].join("\n"))

		const ok = await setSkillDisabledInFrontmatter(skillPath, false)

		expect(ok).to.be.true
		sinon.assert.calledOnce(writeFileStub)
		const written = writeFileStub.getCall(0).args[1] as string
		expect(written).to.contain("disabled: true")
	})
	it("skips the write when content is unchanged", async () => {
		const skillPath = path.join("/home", "user", ".bedrock-coder", "skills", "s", "SKILL.md")
		// Already disabled; disabling again yields identical content.
		readFileStub.withArgs(skillPath, "utf-8").resolves(["---", "name: s", "disabled: true", "---", "B"].join("\n"))

		const ok = await setSkillDisabledInFrontmatter(skillPath, false)

		expect(ok).to.be.true
		sinon.assert.notCalled(writeFileStub)
	})
})
