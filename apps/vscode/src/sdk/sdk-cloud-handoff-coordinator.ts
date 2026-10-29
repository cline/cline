import { randomUUID } from "node:crypto"
import { type CoreSessionConfig, RuntimeOAuthTokenManager, summarizeConversation } from "@cline/core"
import { type CloudHubScope, type HandoffGitPlan, type HubCloudSessionClient, previewHandoffGit } from "@cline/core/cloud"
import { createMediaBudgetState, validateAndReserveImageMedia } from "@cline/shared"
import type { CloudHandoffView } from "@shared/cloud/cloud-handoff"
import { z } from "zod"
import { getProviderSettingsManager } from "./provider-migration"

const cloudErrorDetail = z.object({ message: z.string().trim().min(1), code: z.string().optional() })

function handoffError(
	error: unknown,
	fallback: string,
): Pick<Extract<CloudHandoffView, { phase: "failed" }>, "message" | "recovery"> {
	const message = error instanceof Error ? error.message.trim() : ""
	const prefix = "CLOUD_SESSION_ERROR:"
	if (message.startsWith(prefix)) {
		try {
			const parsed = cloudErrorDetail.safeParse(JSON.parse(message.slice(prefix.length)))
			if (parsed.success) {
				if (parsed.data.code === "github_not_connected")
					return { message: parsed.data.message, recovery: "connect_github" }
				return { message: parsed.data.message }
			}
		} catch {}
	}
	return { message: message || fallback }
}

export interface CapturedHandoffSource {
	messages: Parameters<typeof summarizeConversation>[0]["messages"]
	config: Parameters<typeof summarizeConversation>[0]["config"] & Pick<CoreSessionConfig, "thinking" | "reasoningEffort">
	plan: HandoffGitPlan
	mode: "plan" | "act"
}

export interface PrepareCloudHandoffInput {
	sourceTaskId: string
	instruction: string
	images: string[]
	files: string[]
}

type HandoffCloud = Pick<
	HubCloudSessionClient,
	"connect" | "scope" | "prepareHandoffRepository" | "listModels" | "create" | "send" | "subscribe"
>

interface PreparedHandoff {
	cloud: HandoffCloud
	scope: CloudHubScope
	input: Parameters<HubCloudSessionClient["create"]>[0] & {
		initialMessage: NonNullable<Parameters<HubCloudSessionClient["create"]>[0]["initialMessage"]>
	}
}

interface UnsentContinuation {
	cloud: HandoffCloud
	scope: CloudHubScope
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
	| Omit<Extract<CloudHandoffView, { phase: "failed" }>, "id" | "sourceTaskId">
)

export class SdkCloudHandoffCoordinator {
	private readonly attempts = new Map<string, Attempt>()

	constructor(
		private readonly options: {
			capture(sourceTaskId: string, signal: AbortSignal): Promise<CapturedHandoffSource>
			getCloud(cwd: string): HandoffCloud
			getAccount(): { key: string; accountId: string; organizationId: string | null; organizationName: string } | undefined
			assertEnabled(): void
			changed(): Promise<void>
			summarize?: typeof summarizeConversation
		},
	) {}

	viewFor(sourceTaskId: string | undefined): CloudHandoffView | undefined {
		const attempt = sourceTaskId ? this.attempts.get(sourceTaskId) : undefined
		if (!attempt || attempt.accountKey !== this.options.getAccount()?.key) return undefined
		const { id, phase } = attempt
		const base = { id, sourceTaskId: attempt.sourceTaskId }
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
		const draft = structuredClone(input)
		const base = { id: randomUUID(), sourceTaskId: input.sourceTaskId, accountKey: account.key }
		const attempt: Attempt = { ...base, phase: "preparing", abort: new AbortController() }
		this.attempts.set(input.sourceTaskId, attempt)
		try {
			await this.options.changed()
			const source = await this.options.capture(input.sourceTaskId, attempt.abort.signal)
			this.assertCurrent(attempt)
			const cloud = this.options.getCloud(source.plan.root)
			await cloud.connect()
			const observedScope = cloud.scope
			if (!observedScope) throw new Error("Cloud account is unavailable.")
			const scope = { ...observedScope, expectedAccountId: account.accountId }
			const { organizationId } = await cloud.prepareHandoffRepository(source.plan.repoUrl, scope)
			if ((organizationId ?? null) !== account.organizationId)
				throw new Error("The cloud organization changed. Run /cloud again.")
			const models = await cloud.listModels(scope)
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
			if (
				(source.config.providerId === "cline" || source.config.providerId === "cline-pass") &&
				(credentials
					? credentials.accountId !== account.accountId
					: source.config.apiKey?.trim().toLowerCase().startsWith("workos:"))
			)
				throw new Error("The cloud account does not match the signed-in account. Run /cloud again.")
			const summary = (
				await (this.options.summarize ?? summarizeConversation)({
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
				draft.instruction
					? `Next instruction from the user:\n${draft.instruction}`
					: "Continue the unfinished work described above. If no next action is clear, ask the user rather than inventing work.",
			].join("\n\n")
			this.attempts.set(input.sourceTaskId, {
				...base,
				phase: "ready",
				prepared: {
					cloud,
					scope,
					input: {
						requestId: base.id,
						localGit,
						repoUrl: source.plan.repoUrl,
						branch: source.plan.branch,
						workspaceRelativePath: source.plan.workspaceRelativePath || undefined,
						organizationId: organizationId ?? null,
						modelId,
						mode: source.mode,
						thinking: source.config.thinking,
						reasoningEffort:
							source.config.reasoningEffort === "minimal" || source.config.reasoningEffort === "max"
								? undefined
								: source.config.reasoningEffort,
						initialMessage: { text, images: draft.images },
					},
				},
				preview: {
					id: base.id,
					sourceTaskId: input.sourceTaskId,
					phase: "ready",
					git: previewHandoffGit(source.plan),
					modelId,
					organizationName: account.organizationName,
					instruction: draft.instruction,
					imageCount: draft.images.length,
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
		const { cloud, scope, input } = attempt.prepared
		const base = { id: attempt.id, sourceTaskId: attempt.sourceTaskId, accountKey: attempt.accountKey }
		// Hub create deduplicates in-flight calls only; completed attempts must not replay.
		const launching: Attempt & { phase: "launching" } = { ...base, phase: "launching" }
		this.attempts.set(attempt.sourceTaskId, launching)
		const unsubscribe = cloud.subscribe((event) => {
			if (
				event.type !== "snapshot" ||
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
			const result = await cloud.create(input, scope)
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
					? { delivery, unsent: { cloud, scope, modelId: input.modelId, initialMessage: input.initialMessage } }
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
			await this.options.changed()
		}
	}

	async retryMessage(id: string): Promise<void> {
		const attempt = [...this.attempts.values()].find((entry) => entry.id === id)
		if (!attempt) throw new Error("This handoff has expired.")
		if (attempt.phase !== "complete" || attempt.delivery !== "unsent") return
		this.options.assertEnabled()
		this.assertCurrent(attempt)
		const { cloud, scope, modelId, initialMessage } = attempt.unsent
		if (cloud.scope?.serviceId !== scope.serviceId || cloud.scope.scopeGeneration !== scope.scopeGeneration)
			throw new Error("The cloud account changed. Check the cloud task before resending.")
		const base = { id, sourceTaskId: attempt.sourceTaskId, accountKey: attempt.accountKey, sessionId: attempt.sessionId }
		const launching: Attempt & { phase: "launching" } = { ...base, phase: "launching" }
		this.attempts.set(attempt.sourceTaskId, launching)
		let settled: Attempt = attempt
		try {
			await this.options.changed()
			this.assertCurrent(launching)
			if (cloud.scope?.serviceId !== scope.serviceId || cloud.scope.scopeGeneration !== scope.scopeGeneration)
				throw new Error("Cloud account changed")
			let delivery: "sent" | "unconfirmed" = "unconfirmed"
			try {
				const result = await cloud.send(attempt.sessionId, initialMessage.text, "queue", modelId, initialMessage.images)
				delivery = result.recoveredAfterDisconnect ? "unconfirmed" : "sent"
			} catch (error) {
				if (
					error instanceof Error &&
					error.name === "HubCommandError" &&
					"code" in error &&
					error.code === "hub_draining"
				)
					throw error
				// Other send errors do not prove the message stayed unsent.
			}
			settled = { ...base, phase: "complete", delivery }
		} finally {
			if (this.attempts.get(attempt.sourceTaskId) === launching) {
				this.attempts.set(attempt.sourceTaskId, settled)
				await this.options.changed()
			}
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
		if (this.attempts.get(attempt.sourceTaskId) !== attempt || this.options.getAccount()?.key !== attempt.accountKey) {
			throw new Error("The cloud account or preparation changed. Run /cloud again.")
		}
	}
}
