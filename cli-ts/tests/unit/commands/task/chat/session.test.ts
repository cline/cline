/**
 * Tests for session management
 */

import { expect } from "chai"
import { createSession } from "../../../../../src/commands/task/chat/session.js"

describe("session", () => {
	describe("createSession", () => {
		it("should create session with null taskId", () => {
			const session = createSession()
			expect(session.taskId).to.be.null
		})

		it("should create session with isRunning true", () => {
			const session = createSession()
			expect(session.isRunning).to.be.true
		})

		it("should create session with awaitingApproval false", () => {
			const session = createSession()
			expect(session.awaitingApproval).to.be.false
		})

		it("should create session with awaitingInput false", () => {
			const session = createSession()
			expect(session.awaitingInput).to.be.false
		})

		it("should create session with null adapter", () => {
			const session = createSession()
			expect(session.adapter).to.be.null
		})

		it("should create independent session instances", () => {
			const session1 = createSession()
			const session2 = createSession()

			session1.taskId = "task-1"
			session1.isRunning = false

			expect(session2.taskId).to.be.null
			expect(session2.isRunning).to.be.true
		})
	})
})
