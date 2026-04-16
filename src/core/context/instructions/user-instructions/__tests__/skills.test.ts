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
import { discoverSkills, getAvailableSkills, getSkillContent, parseRemoteSkillEntries } from "../skills"

describe("Skills Utility Functions", () => {
	let sandbox: sinon.SinonSandbox
	let fileExistsStub: sinon.SinonStub
	let isDirectoryStub: sinon.SinonStub
	let readdirStub: sinon.SinonStub
	let statStub: sinon.SinonStub
	let readFileStub: sinon.SinonStub

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
		sandbox.stub(disk, "getSkillsDirectoriesForScan").returns([
			{ path: path.join(TEST_CWD, ".clinerules", "skills"), source: "project" },
			{ path: path.join(TEST_CWD, ".cline", "skills"), source: "project" },
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

	describe("Remote Skills", () => {
		// entry.name must match frontmatter name (enforced by parseRemoteSkillEntries)
		const makeEntry = (name: string, desc: string, body = "Instructions", alwaysEnabled = false) => ({
			name,
			alwaysEnabled,
			contents: `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`,
		})

		describe("parseRemoteSkillEntries", () => {
			it("should return validated entries when entry.name matches frontmatter.name", () => {
				const entries = [
					{ name: "Deploy", alwaysEnabled: true, contents: `---\nname: Deploy\ndescription: CI/CD\n---\nBody` },
				]
				const result = parseRemoteSkillEntries(entries)
				expect(result).to.have.lengthOf(1)
				expect(result[0].name).to.equal("Deploy")
				expect(result[0].description).to.equal("CI/CD")
				expect(result[0].alwaysEnabled).to.equal(true)
			})

			it("should warn but still include entries where entry.name drifts from frontmatter.name", () => {
				const entries = [
					{
						name: "entry-key",
						alwaysEnabled: false,
						contents: `---\nname: Different Name\ndescription: Desc\n---\nBody`,
					},
				]
				const result = parseRemoteSkillEntries(entries)
				expect(result).to.have.lengthOf(1)
				expect(result[0].name).to.equal("Different Name")
				sinon.assert.calledWithMatch(Logger.warn as sinon.SinonStub, /does not match frontmatter\.name/)
			})

			it("should skip entries with missing frontmatter name", () => {
				const entries = [{ name: "bad", alwaysEnabled: false, contents: `---\ndescription: No name\n---\nContent` }]
				const result = parseRemoteSkillEntries(entries)
				expect(result).to.have.lengthOf(0)
			})

			it("should skip entries with missing frontmatter description", () => {
				const entries = [{ name: "No Desc", alwaysEnabled: false, contents: `---\nname: No Desc\n---\nContent` }]
				const result = parseRemoteSkillEntries(entries)
				expect(result).to.have.lengthOf(0)
			})

			it("should handle empty array", () => {
				expect(parseRemoteSkillEntries([])).to.have.lengthOf(0)
			})

			it("should include all entries with valid frontmatter even with drift", () => {
				const entries = [
					{ name: "Good", alwaysEnabled: false, contents: `---\nname: Good\ndescription: Valid\n---\nBody` },
					{ name: "drift", alwaysEnabled: false, contents: `---\nname: Different\ndescription: Drifted\n---\nBody` },
					{
						name: "Also Good",
						alwaysEnabled: true,
						contents: `---\nname: Also Good\ndescription: Valid too\n---\nBody`,
					},
				]
				const result = parseRemoteSkillEntries(entries)
				expect(result).to.have.lengthOf(3)
				expect(result[0].name).to.equal("Good")
				expect(result[1].name).to.equal("Different")
				expect(result[2].name).to.equal("Also Good")
			})
		})

		describe("discoverSkills - remote skill discovery", () => {
			it("should include remote skills from remote config", async () => {
				const entries = [makeEntry("Deploy Pipeline", "Handles CI/CD deployment", "Deploy instructions")]
				const skills = await discoverSkills(TEST_CWD, entries)

				const remoteSkill = skills.find((s) => s.name === "Deploy Pipeline")
				expect(remoteSkill).to.not.be.undefined
				expect(remoteSkill!.path).to.equal("remote:Deploy Pipeline")
				expect(remoteSkill!.source).to.equal("global")
				expect(remoteSkill!.description).to.equal("Handles CI/CD deployment")
			})

			it("should use frontmatter.name as identity even when entry.name drifts", async () => {
				const entries = [
					{ name: "entry-key", alwaysEnabled: false, contents: `---\nname: Actual Name\ndescription: Desc\n---\nBody` },
				]
				const skills = await discoverSkills(TEST_CWD, entries)
				const remoteSkill = skills.find((s) => s.path?.startsWith("remote:"))
				expect(remoteSkill).to.not.be.undefined
				expect(remoteSkill!.name).to.equal("Actual Name")
				expect(remoteSkill!.path).to.equal("remote:Actual Name")
			})

			it("should skip remote skills with missing frontmatter name", async () => {
				const entries = [{ name: "bad", alwaysEnabled: false, contents: `---\ndescription: No name\n---\nContent` }]
				const skills = await discoverSkills(TEST_CWD, entries)
				expect(skills.find((s) => s.path?.startsWith("remote:"))).to.be.undefined
			})

			it("should skip remote skills with missing frontmatter description", async () => {
				const entries = [{ name: "No Desc", alwaysEnabled: false, contents: `---\nname: No Desc\n---\nContent` }]
				const skills = await discoverSkills(TEST_CWD, entries)
				expect(skills.find((s) => s.path?.startsWith("remote:"))).to.be.undefined
			})

			it("should handle empty and undefined entries gracefully", async () => {
				for (const val of [[], undefined]) {
					const skills = await discoverSkills(TEST_CWD, val)
					expect(skills.filter((s) => s.path?.startsWith("remote:"))).to.have.lengthOf(0)
				}
			})
		})

		describe("Override resolution (remote > disk-global > project)", () => {
			it("remote overrides disk-global skill of same name", async () => {
				const entries = [makeEntry("coding", "Remote coding")]
				const diskGlobalDir = path.join(GLOBAL_SKILLS_DIR, "coding")
				const diskGlobalMd = path.join(diskGlobalDir, "SKILL.md")
				fileExistsStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
				fileExistsStub.withArgs(diskGlobalMd).resolves(true)
				isDirectoryStub.withArgs(GLOBAL_SKILLS_DIR).resolves(true)
				readdirStub.withArgs(GLOBAL_SKILLS_DIR).resolves(["coding"])
				statStub.withArgs(diskGlobalDir).resolves({ isDirectory: () => true })
				readFileStub
					.withArgs(diskGlobalMd, "utf-8")
					.resolves(`---\nname: coding\ndescription: Disk global coding\n---\nDisk`)

				const available = getAvailableSkills(await discoverSkills(TEST_CWD, entries))
				expect(available).to.have.lengthOf(1)
				expect(available[0].description).to.equal("Remote coding")
				expect(available[0].path).to.equal("remote:coding")
			})

			it("remote overrides project skill of same name", async () => {
				const entries = [makeEntry("coding", "Remote coding")]
				const projDir = path.join(TEST_CWD, ".clinerules", "skills")
				const projSkillDir = path.join(projDir, "coding")
				const projMd = path.join(projSkillDir, "SKILL.md")
				fileExistsStub.withArgs(projDir).resolves(true)
				fileExistsStub.withArgs(projMd).resolves(true)
				isDirectoryStub.withArgs(projDir).resolves(true)
				readdirStub.withArgs(projDir).resolves(["coding"])
				statStub.withArgs(projSkillDir).resolves({ isDirectory: () => true })
				readFileStub.withArgs(projMd, "utf-8").resolves(`---\nname: coding\ndescription: Project coding\n---\nProject`)

				const available = getAvailableSkills(await discoverSkills(TEST_CWD, entries))
				expect(available).to.have.lengthOf(1)
				expect(available[0].description).to.equal("Remote coding")
				expect(available[0].path).to.equal("remote:coding")
			})
		})

		describe("getSkillContent - remote skill content loading", () => {
			it("should load content from provided entries for remote skills", async () => {
				const entries = [makeEntry("Deploy Pipeline", "Deployment skill", "These are the deployment instructions.")]
				const skill = {
					name: "Deploy Pipeline",
					description: "Deployment skill",
					path: "remote:Deploy Pipeline",
					source: "global" as const,
				}
				const content = await getSkillContent("Deploy Pipeline", [skill], entries)

				expect(content).to.not.be.null
				expect(content!.name).to.equal("Deploy Pipeline")
				expect(content!.instructions).to.equal("These are the deployment instructions.")
			})

			it("should trim whitespace from remote skill instructions", async () => {
				const entries = [makeEntry("Trim Skill", "Test", "\n   Instructions with whitespace   \n\n")]
				const skill = { name: "Trim Skill", description: "Test", path: "remote:Trim Skill", source: "global" as const }
				const content = await getSkillContent("Trim Skill", [skill], entries)
				expect(content!.instructions).to.equal("Instructions with whitespace")
			})

			it("should return null if remote skill entry not found in entries", async () => {
				const skill = { name: "Gone", description: "Removed", path: "remote:Gone", source: "global" as const }
				const content = await getSkillContent("Gone", [skill], [])
				expect(content).to.be.null
			})

			it("should not attempt disk read for remote skills", async () => {
				const entries = [makeEntry("Remote Only", "Test", "Remote content")]
				const skill = { name: "Remote Only", description: "Test", path: "remote:Remote Only", source: "global" as const }
				await getSkillContent("Remote Only", [skill], entries)
				sinon.assert.notCalled(readFileStub)
			})
		})
	})
})
