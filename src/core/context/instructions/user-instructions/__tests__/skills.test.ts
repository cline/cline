/**
 * Unit tests for skills utility functions
 * Tests skill discovery, override resolution, toggle filtering, and content loading
 */

import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as path from "path"
import * as sinon from "sinon"

import * as disk from "@/core/storage/disk"
import { Logger } from "@/shared/services/Logger"
import * as fsUtils from "@/utils/fs"
import { discoverSkills, getAvailableSkills, getSkillContent } from "../skills"

describe("Skills Utility Functions", () => {
	let sandbox: sinon.SinonSandbox
	let fileExistsStub: sinon.SinonStub
	let isDirectoryStub: sinon.SinonStub
	let readdirStub: sinon.SinonStub
	let statStub: sinon.SinonStub
	let readFileStub: sinon.SinonStub
	let ensureSkillsDirStub: sinon.SinonStub

	// Use path.join for OS-independent paths
	const TEST_CWD = path.join("/test", "project")
	const GLOBAL_SKILLS_DIR = path.join("/home", "user", ".cline", "skills")

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Stub Logger.warn to avoid noise in test output
		sandbox.stub(Logger, "warn")

		// Stub filesystem utilities
		fileExistsStub = sandbox.stub(fsUtils, "fileExistsAtPath")
		isDirectoryStub = sandbox.stub(fsUtils, "isDirectory")
		readdirStub = sandbox.stub(fs.promises, "readdir")
		statStub = sandbox.stub(fs.promises, "stat")
		readFileStub = sandbox.stub(fs.promises, "readFile")
		ensureSkillsDirStub = sandbox.stub(disk, "ensureSkillsDirectoryExists")

		// Default: global skills dir
		ensureSkillsDirStub.resolves(GLOBAL_SKILLS_DIR)

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

		it("should discover skills from project .clinerules/skills directory", async () => {
			const projectSkillsDir = path.join(TEST_CWD, ".clinerules", "skills")
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

		it("should discover skills from project .cline/skills directory", async () => {
			const clineSkillsDir = path.join(TEST_CWD, ".cline", "skills")
			const skillDir = path.join(clineSkillsDir, "debugging")
			const skillMdPath = path.join(skillDir, "SKILL.md")

			fileExistsStub.withArgs(clineSkillsDir).resolves(true)
			fileExistsStub.withArgs(skillMdPath).resolves(true)
			isDirectoryStub.withArgs(clineSkillsDir).resolves(true)
			readdirStub.withArgs(clineSkillsDir).resolves(["debugging"])
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
			const projectSkillsDir = path.join(TEST_CWD, ".clinerules", "skills")
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
			const projectSkillsDir = path.join(TEST_CWD, ".clinerules", "skills")
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
