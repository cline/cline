/**
 * Tests for input-checker functions
 */

import { expect } from "chai"
import { checkForPendingInput } from "../../../../../src/commands/task/chat/input-checker.js"

describe("input-checker", () => {
	describe("checkForPendingInput", () => {
		it("should return no pending input for empty messages", () => {
			const result = checkForPendingInput([])
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.false
		})

		it("should return no pending input for partial messages", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "command",
					partial: true,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.false
		})

		it("should return awaitingApproval for command ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "command" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.true
			expect(result.awaitingInput).to.be.false
		})

		it("should return awaitingApproval for tool ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "tool" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.true
			expect(result.awaitingInput).to.be.false
		})

		it("should return awaitingApproval for browser_action_launch ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "browser_action_launch" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.true
			expect(result.awaitingInput).to.be.false
		})

		it("should return awaitingApproval for use_mcp_server ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "use_mcp_server" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.true
			expect(result.awaitingInput).to.be.false
		})

		it("should return awaitingApproval for api_req_failed ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "api_req_failed" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.true
			expect(result.awaitingInput).to.be.false
		})

		it("should return awaitingInput for followup ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "followup" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.true
		})

		it("should return awaitingInput for plan_mode_respond ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "plan_mode_respond" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.true
		})

		it("should return awaitingInput for act_mode_respond ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "act_mode_respond" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.true
		})

		it("should return awaitingInput for completion_result ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "completion_result" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.true
		})

		it("should return awaitingInput for resume_task ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "resume_task" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.true
		})

		it("should return awaitingInput for resume_completed_task ask", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "ask" as const,
					ask: "resume_completed_task" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.true
		})

		it("should return no pending input for say type messages", () => {
			const messages = [
				{
					ts: Date.now(),
					type: "say" as const,
					say: "text" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.false
		})

		it("should only check the last message", () => {
			const messages = [
				{
					ts: Date.now() - 1000,
					type: "ask" as const,
					ask: "command" as const,
				},
				{
					ts: Date.now(),
					type: "say" as const,
					say: "text" as const,
				},
			]
			const result = checkForPendingInput(messages)
			expect(result.awaitingApproval).to.be.false
			expect(result.awaitingInput).to.be.false
		})
	})
})
