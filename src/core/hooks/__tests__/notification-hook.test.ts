import { afterEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import * as HookExecutor from "../hook-executor"
import {
	buildNotificationData,
	emitNotificationHook,
	emitTaskCompleteNotification,
	emitUserAttentionNotification,
	NOTIFICATION_MESSAGE_MAX_LENGTH,
} from "../notification-hook"

describe("notification-hook", () => {
	afterEach(() => {
		sinon.restore()
	})

	const context = {
		messageStateHandler: {} as any,
		taskId: "task-123",
		hooksEnabled: true,
		model: { provider: "anthropic", slug: "claude" },
	}

	it("emits user-attention notifications with normalized payload", async () => {
		const executeHookStub = sinon.stub(HookExecutor, "executeHook").resolves({ wasCancelled: false })

		await emitUserAttentionNotification(context, {
			source: "approval_request",
			message: "Need approval",
		})

		sinon.assert.calledOnce(executeHookStub)
		const notification = (
			executeHookStub.firstCall.args[0].hookInput as { notification: ReturnType<typeof buildNotificationData> }
		).notification
		notification.event.should.equal("user_attention")
		notification.source.should.equal("approval_request")
		notification.sourceType.should.equal("ask")
		notification.sourceId.should.equal("approval_request")
		notification.waitingForUserInput.should.equal(true)
		notification.requiresUserAction.should.equal(true)
		notification.severity.should.equal("info")
	})

	it("emits task-complete notifications with normalized payload", async () => {
		const executeHookStub = sinon.stub(HookExecutor, "executeHook").resolves({ wasCancelled: false })

		await emitTaskCompleteNotification(context, { message: "All done" })

		const notification = (
			executeHookStub.firstCall.args[0].hookInput as { notification: ReturnType<typeof buildNotificationData> }
		).notification
		notification.event.should.equal("task_complete")
		notification.source.should.equal("attempt_completion")
		notification.sourceType.should.equal("tool")
		notification.sourceId.should.equal("attempt_completion")
		notification.waitingForUserInput.should.equal(false)
		notification.requiresUserAction.should.equal(false)
	})

	it("centralizes truncation and exposes truncation metadata", () => {
		const notification = buildNotificationData({
			event: "user_attention",
			source: "ask",
			sourceType: "ask",
			sourceId: "followup",
			message: "x".repeat(NOTIFICATION_MESSAGE_MAX_LENGTH + 25),
			waitingForUserInput: true,
			requiresUserAction: true,
		})

		notification.messageTruncated.should.equal(true)
		notification.message.length.should.equal(NOTIFICATION_MESSAGE_MAX_LENGTH + "\n...[truncated]".length)
		notification.message.should.match(/\.\.\.\[truncated\]$/)
	})

	it("preserves backward-compatible fields while adding additive fields", () => {
		const notification = buildNotificationData({
			event: "user_attention",
			source: "ask",
			sourceType: "ask",
			sourceId: "approval",
			message: "hello",
			waitingForUserInput: true,
			requiresUserAction: true,
		})

		notification.event.should.equal("user_attention")
		notification.source.should.equal("ask")
		notification.message.should.equal("hello")
		notification.waitingForUserInput.should.equal(true)
		notification.eventVersion.should.equal("1")
		notification.eventId.should.not.equal("")
		notification.messageTruncated.should.equal(false)
		notification.sourceType.should.equal("ask")
		notification.sourceId.should.equal("approval")
		notification.requiresUserAction.should.equal(true)
		notification.severity.should.equal("info")
	})

	it("ignores unsupported notification outputs and logs warnings", async () => {
		const executeHookStub = sinon.stub(HookExecutor, "executeHook").resolves({
			cancel: true,
			contextModification: "ignored",
			wasCancelled: false,
		})
		const warnStub = sinon.stub(Logger, "warn")

		await emitNotificationHook(
			context,
			buildNotificationData({
				event: "task_complete",
				source: "attempt_completion",
				sourceType: "tool",
				sourceId: "attempt_completion",
				message: "done",
				waitingForUserInput: false,
				requiresUserAction: false,
			}),
		)

		sinon.assert.calledOnce(executeHookStub)
		sinon.assert.calledTwice(warnStub)
	})

	it("fails open when hook execution throws", async () => {
		sinon.stub(HookExecutor, "executeHook").rejects(new Error("boom"))
		const errorStub = sinon.stub(Logger, "error")

		await emitTaskCompleteNotification(context, { message: "done" })

		sinon.assert.calledOnce(errorStub)
	})

	it("does nothing when hooks are disabled", async () => {
		const executeHookStub = sinon.stub(HookExecutor, "executeHook").resolves({ wasCancelled: false })

		await emitTaskCompleteNotification({ ...context, hooksEnabled: false }, { message: "done" })

		sinon.assert.notCalled(executeHookStub)
	})
})
