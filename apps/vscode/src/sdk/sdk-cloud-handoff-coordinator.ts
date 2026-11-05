import { randomUUID } from "node:crypto"
import { type CoreSessionConfig, RuntimeOAuthTokenManager, summarizeConversation } from "@cline/core"
import {
	type CloudSessionController,
	CloudSessionError,
	type HandoffGitPlan,
	type PublishedHandoffInput,
	previewHandoffGit,
	publishCloudHandoff,
} from "@cline/core/cloud"
import { createMediaBudgetState, validateAndReserveImageMedia } from "@cline/shared"
import type { CloudHandoffView } from "@shared/cloud/cloud-handoff"
import { CLOUD_SESSION_MODE } from "@shared/cloud/cloud-sessions"
import { isClineManagedProvider } from "@shared/utils/cline"
import { Logger } from "@/shared/services/Logger"
import { getProviderSettingsManager } from "./provider-migration"

function handoffError(
	error: unknown,
	fallback: string,
): Pick<Extract<CloudHandoffView, { phase: "failed" }>, "message" | "recovery"> {
	if (error instanceof CloudSessionError) {
		return {
			message: error.detail,
			recovery: error.code === "github_not_connected" ? "connect_github" : undefined,
		}
	}
	return { message: error instanceof Error ? error.message.trim() || fallback : fallback }
}

export interface CapturedHandoffSource {
	messages: Parameters<typeof summarizeConversation>[0]["messages"]
	config: Parameters<typeof summarizeConversation>[0]["config"] & Pick<CoreSessionConfig, "thinking" | "reasoningEffort">
	plan: HandoffGitPlan
}

export interface PrepareCloudHandoffInput {
	sourceTaskId: string
	instruction: string
	images: string[]
	files: string[]
}

type HandoffCloud = Pick<
	CloudSessionController,
	"prepareHandoffRepository" | "listModels" | "create" | "send" | "subscribe" | "detach"
>

interface PreparedHandoff {
	cloud: HandoffCloud
	input: PublishedHandoffInput
}

interface UnsentContinuation {
	cloud: HandoffCloud
	modelId: string
	initialMessage: PreparedHandoff["input"]["initialMessage"]
}

type Attempt = { id: string; sourceTaskId: string; accountKey: string } & (
	| { phase: "preparing"; abort: AbortController }
	| { phase: "ready"; prepared: PreparedHandoff; preview: Extract<CloudHandoffView, { phase: "ready" }> }
	| { phase: "launching"; sessionId?: string }
	| ({ phase: "complete"; sessionId: string } & (
			| { delivery: "unsent"; unsent: UnsentContinuation }
			| { delivery: "sent" | "unconfirmed" }
	  ))
	| Omit<Extract<CloudHandoffView, { phase: "failed" }>, "id">
)

export class SdkCloudHandoffCoordinator {
	private readonly attempts = new Map<string, Attempt>()

	constructor(
		private readonly options: {
			capture(sourceTaskId: string, signal: AbortSignal): Promise<CapturedHandoffSource>
			getCloud(): HandoffCloud
			getAccount(): { key: string; accountId: string; organizationId: string | null; organizationName: string } | undefined
			assertEnabled(): void
			changed(): Promise<void>
		},
	) {}

	viewFor(taskId: string | undefined): CloudHandoffView | undefined {
		if (!taskId) return undefined
		const account = this.options.getAccount()
		const attempt = this.attempts.get(taskId)
		if (!attempt || attempt.accountKey !== account?.key) return undefined
		const { id, phase } = attempt
		const base = { id }
		switch (phase) {
			case "preparing":
				return { ...base, phase }
			case "ready":
				return attempt.preview
			case "launching":
				return { ...base, phase, sessionId: attempt.sessionId }
			case "complete":
				return { ...base, phase, sessionId: attempt.sessionId, delivery: attempt.delivery }
			case "failed":
				return { ...base, phase, message: attempt.message, recovery: attempt.recovery }
		}
	}

	async prepare(input: PrepareCloudHandoffInput): Promise<void> {
		this.options.assertEnabled()
		const account = this.options.getAccount()
		if (!account) throw new Error("Sign in to Cline before using /cloud.")
		if (this.attempts.has(input.sourceTaskId))
			throw new Error("Review or dismiss the existing cloud handoff before starting another.")
		if (input.files.length) throw new Error("Only image attachments can be sent with /cloud. Remove the files and try again.")
		if (input.images.length > 5) throw new Error("Attach up to 5 images.")
		const budget = createMediaBudgetState()
		for (const image of input.images) {
			const result = validateAndReserveImageMedia(undefined, image, {}, budget)
			if (!result.ok) throw new Error(result.message)
		}
		const base = { id: randomUUID(), sourceTaskId: input.sourceTaskId, accountKey: account.key }
		const attempt: Attempt = { ...base, phase: "preparing", abort: new AbortController() }
		this.attempts.set(input.sourceTaskId, attempt)
		try {
			await this.options.changed()
			const source = await this.options.capture(input.sourceTaskId, attempt.abort.signal)
			this.assertCurrent(attempt)
			const cloud = this.options.getCloud()
			const { organizationId } = await cloud.prepareHandoffRepository(source.plan.repoUrl)
			if ((organizationId ?? null) !== account.organizationId)
				throw new Error("The cloud organization changed. Run /cloud again.")
			const models = await cloud.listModels()
			const modelId = source.config.modelId
			if (!models.some((model) => model.id === modelId)) {
				throw new Error(
					`The selected model ${modelId} is not available in Cline Cloud. Select a supported model and try again.`,
				)
			}
			this.assertCurrent(attempt)
			const credentials = await new RuntimeOAuthTokenManager({
				providerSettingsManager: getProviderSettingsManager(),
			}).resolveProviderApiKey({ providerId: source.config.providerId })
			this.assertCurrent(attempt)
			if (isClineManagedProvider(source.config.providerId) && credentials && !credentials.accountId)
				throw new Error("Sign out of Cline and sign in again, then run /cloud.")
			if (
				isClineManagedProvider(source.config.providerId) &&
				(credentials
					? credentials.accountId !== account.accountId
					: source.config.apiKey?.trim().toLowerCase().startsWith("workos:"))
			)
				throw new Error("The cloud account does not match the signed-in account. Run /cloud again.")
			const summary = (
				await summarizeConversation({
					messages: source.messages,
					config: { ...source.config, ...(credentials && { apiKey: credentials.apiKey }) },
					signal: AbortSignal.any([attempt.abort.signal, AbortSignal.timeout(120_000)]),
				})
			).trim()
			this.assertCurrent(attempt)
			if (!summary) throw new Error("The conversation summary was empty. Run /cloud again.")
			const { files: _files, commits: _commits, sourceBranch: _sourceBranch, ...localGit } = source.plan
			const text = [
				summary,
				input.instruction
					? `Next instruction from the user:\n${input.instruction}`
					: "Continue the unfinished work described above. If no next action is clear, ask the user rather than inventing work.",
			].join("\n\n")
			this.attempts.set(input.sourceTaskId, {
				...base,
				phase: "ready",
				prepared: {
					cloud,
					input: {
						requestId: base.id,
						localGit,
						repoUrl: source.plan.repoUrl,
						branch: source.plan.branch,
						workspaceRelativePath: source.plan.workspaceRelativePath || undefined,
						organizationId: organizationId ?? null,
						modelId,
						mode: CLOUD_SESSION_MODE,
						thinking: source.config.thinking,
						reasoningEffort:
							source.config.reasoningEffort === "minimal" || source.config.reasoningEffort === "max"
								? undefined
								: source.config.reasoningEffort,
						initialMessage: { text, images: input.images },
					},
				},
				preview: {
					id: base.id,
					phase: "ready",
					git: previewHandoffGit(source.plan),
					modelId,
					organizationName: account.organizationName,
					instruction: input.instruction,
					imageCount: input.images.length,
				},
			})
		} catch (error) {
			if (this.attempts.get(input.sourceTaskId) === attempt) {
				this.attempts.set(input.sourceTaskId, {
					...base,
					phase: "failed",
					...handoffError(error, "Unable to prepare cloud handoff."),
				})
			}
		} finally {
			await this.options.changed()
		}
	}

	async confirm(id: string): Promise<void> {
		const attempt = [...this.attempts.values()].find((entry) => entry.id === id)
		if (!attempt) throw new Error("This preparation has expired. Run /cloud again.")
		if (attempt.phase !== "ready") return
		this.options.assertEnabled()
		this.assertCurrent(attempt)
		const { cloud, input } = attempt.prepared
		const base = { id: attempt.id, sourceTaskId: attempt.sourceTaskId, accountKey: attempt.accountKey }
		// Creation deduplicates in-flight calls only; completed attempts must not replay.
		const launching: Attempt & { phase: "launching" } = { ...base, phase: "launching" }
		this.attempts.set(attempt.sourceTaskId, launching)
		const unsubscribe = cloud.subscribe((event) => {
			if (
				event.type !== "snapshot" ||
				launching.sessionId === event.sessionId ||
				event.snapshot.record?.repoContext.branch !== input.branch ||
				event.snapshot.record?.repoContext.repoUrl !== input.repoUrl ||
				this.attempts.get(attempt.sourceTaskId) !== launching
			)
				return
			launching.sessionId = event.sessionId
			void this.options.changed()
		})
		try {
			await this.options.changed()
			this.assertCurrent(launching)
			const result = await publishCloudHandoff({
				controller: cloud,
				input,
				assertCurrent: () => this.assertCurrent(launching),
			})
			this.assertCurrent(launching)
			const send = result.initialSend
			const delivery =
				!send ||
				("dispatched" in send && send.dispatched) ||
				("recoveredAfterDisconnect" in send && send.recoveredAfterDisconnect)
					? "unconfirmed"
					: "dispatched" in send
						? "unsent"
						: "sent"
			this.attempts.set(attempt.sourceTaskId, {
				...base,
				phase: "complete",
				sessionId: result.sessionId,
				...(delivery === "unsent"
					? { delivery, unsent: { cloud, modelId: input.modelId, initialMessage: input.initialMessage } }
					: { delivery }),
			})
		} catch (error) {
			if (this.attempts.get(attempt.sourceTaskId) !== launching) return
			const failure = handoffError(error, "Cloud handoff failed.")
			this.attempts.set(
				attempt.sourceTaskId,
				launching.sessionId
					? {
							...base,
							phase: "complete",
							sessionId: launching.sessionId,
							delivery: "unconfirmed",
						}
					: {
							...base,
							phase: "failed",
							...failure,
							message: `${failure.message} The snapshot may have been published or a cloud task created. Check Cline Cloud before starting another handoff.`,
						},
			)
		} finally {
			unsubscribe()
			const completed = this.attempts.get(attempt.sourceTaskId)
			if (completed?.id === attempt.id) await this.detachCompleted(cloud, completed)
			await this.options.changed()
		}
	}

	async retryMessage(id: string): Promise<void> {
		const attempt = [...this.attempts.values()].find((entry) => entry.id === id)
		if (!attempt) throw new Error("This handoff has expired.")
		if (attempt.phase !== "complete" || attempt.delivery !== "unsent") return
		this.options.assertEnabled()
		this.assertCurrent(attempt)
		const { cloud, modelId, initialMessage } = attempt.unsent
		const base = { id, sourceTaskId: attempt.sourceTaskId, accountKey: attempt.accountKey, sessionId: attempt.sessionId }
		const launching: Attempt & { phase: "launching" } = { ...base, phase: "launching" }
		this.attempts.set(attempt.sourceTaskId, launching)
		let settled: Attempt = attempt
		try {
			await this.options.changed()
			this.assertCurrent(launching)
			let delivery: "sent" | "unconfirmed" = "unconfirmed"
			let dispatched = false
			try {
				const result = await cloud.send(attempt.sessionId, initialMessage.text, "queue", modelId, initialMessage.images, {
					beforeDispatch: () => {
						dispatched = true
					},
				})
				delivery = result.recoveredAfterDisconnect ? "unconfirmed" : "sent"
			} catch (error) {
				if (
					!dispatched ||
					(error instanceof Error &&
						error.name === "HubCommandError" &&
						"code" in error &&
						error.code === "hub_draining")
				)
					throw error
				// Other send errors do not prove the message stayed unsent.
			}
			settled = { ...base, phase: "complete", delivery }
		} finally {
			if (this.attempts.get(attempt.sourceTaskId) === launching) {
				this.attempts.set(attempt.sourceTaskId, settled)
				await this.detachCompleted(cloud, settled)
				await this.options.changed()
			}
		}
	}

	private async detachCompleted(cloud: HandoffCloud, attempt: Attempt): Promise<void> {
		if (attempt.phase !== "complete" || attempt.delivery === "unsent") return
		try {
			await cloud.detach(attempt.sessionId)
		} catch (error) {
			Logger.error("[SdkCloudHandoffCoordinator] Failed to detach completed handoff", error)
		}
	}

	async discard(id: string): Promise<void> {
		const attempt = [...this.attempts.values()].find((entry) => entry.id === id)
		if (!attempt || attempt.phase === "launching" || (attempt.phase === "complete" && attempt.delivery === "unsent")) return
		if (attempt.phase === "preparing") attempt.abort.abort()
		this.attempts.delete(attempt.sourceTaskId)
		await this.options.changed()
	}

	reset(): void {
		for (const attempt of this.attempts.values()) if (attempt.phase === "preparing") attempt.abort.abort()
		this.attempts.clear()
	}

	private assertCurrent(attempt: Attempt): void {
		const account = this.options.getAccount()
		if (this.attempts.get(attempt.sourceTaskId) !== attempt || account?.key !== attempt.accountKey) {
			throw new Error("The cloud account or preparation changed. Run /cloud again.")
		}
	}
}
