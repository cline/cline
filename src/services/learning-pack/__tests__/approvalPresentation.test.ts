import { strict as assert } from "node:assert"
import {
	createLearningPackApprovalPresentation,
	type LearningPackApprovalPrompt,
	requestLearningPackApproval,
} from "../approvalPresentation"
import type { LearningPackArchiveInspection } from "../inspectLearningPackArchive"
import { inspectLearningPackArchiveBytes } from "../inspectLearningPackArchive"
import { createLearningPackTestArchive, createValidLearningPackFiles } from "./learningPackTestFixture"

async function inspection(edition: "student" | "instructor"): Promise<LearningPackArchiveInspection> {
	const archive = createLearningPackTestArchive(createValidLearningPackFiles({ edition }).files)
	const result = await inspectLearningPackArchiveBytes(archive, { aiHydroVersion: "0.2.5" })
	assert.equal(result.status, "valid")
	return result.inspection!
}

describe("Learning Pack approval presentation", () => {
	it("requires the heightened instructor warning before an untrusted install decision", async () => {
		const presentation = createLearningPackApprovalPresentation(await inspection("instructor"), false)
		const prompts: LearningPackApprovalPrompt[] = []
		const answers = ["Continue", "Install Once"]
		const decision = await requestLearningPackApproval(presentation, async (prompt) => {
			prompts.push(prompt)
			return answers.shift()
		})
		assert.equal(decision, "install-once")
		assert.equal(prompts.length, 2)
		assert.match(prompts[0].message, /instructor materials may include inspectable solutions/i)
		assert.match(prompts[0].message, /not role-protected/)
		assert.deepEqual(prompts[0].items, ["Continue"])
		assert.match(prompts[0].detail, /terminal-equivalent, not sandboxed/)
	})

	it("cancels without showing installation choices when the instructor warning is declined", async () => {
		const presentation = createLearningPackApprovalPresentation(await inspection("instructor"), false)
		let calls = 0
		const decision = await requestLearningPackApproval(presentation, async () => {
			calls++
			return undefined
		})
		assert.equal(decision, "cancel")
		assert.equal(calls, 1)
	})

	it("maps student trust-once, persistent-trust, and trusted-publisher choices deterministically", async () => {
		const student = await inspection("student")
		const untrusted = createLearningPackApprovalPresentation(student, false)
		assert.equal(untrusted.instructorWarning, undefined)
		assert.equal(await requestLearningPackApproval(untrusted, async () => "Install Once"), "install-once")
		assert.equal(await requestLearningPackApproval(untrusted, async () => "Trust Publisher and Install"), "trust-publisher")
		const trusted = createLearningPackApprovalPresentation(student, true)
		assert.deepEqual(trusted.installPrompt.items, ["Install"])
		assert.equal(await requestLearningPackApproval(trusted, async () => "Install"), "install-once")
	})
})
