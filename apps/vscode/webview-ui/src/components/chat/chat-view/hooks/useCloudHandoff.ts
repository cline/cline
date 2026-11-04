import { PrepareCloudHandoffRequest } from "@shared/proto/cline/cloud"
import { StringRequest } from "@shared/proto/cline/common"
import { useCallback, useEffect, useRef, useState } from "react"
import { z } from "zod"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CloudServiceClient } from "@/services/grpc-client"
import type { ChatState, DraftSnapshot } from "../types/chatTypes"

const savedDraftSchema = z.object({
	draft: z.object({
		revision: z.number().int().nonnegative(),
		text: z.string(),
		activeQuote: z.string().nullable(),
		images: z.array(z.string()),
		files: z.array(z.string()),
	}),
	attemptId: z.string().optional(),
})
type SavedHandoffDraft = z.infer<typeof savedDraftSchema> & { cleared?: boolean }
const nativeStateSchema = z.record(z.string(), z.unknown())
const savedDraftsSchema = z.record(z.string(), savedDraftSchema)
const MAX_SAVED_DRAFTS = 5
const MAX_SAVED_DRAFT_BYTES = 16 * 1024 * 1024

function nativeState() {
	const result = nativeStateSchema.safeParse(PLATFORM_CONFIG.getState())
	return result.success ? result.data : {}
}

function draftCapacityError(drafts: Map<string, SavedHandoffDraft>): string | undefined {
	if (drafts.size > MAX_SAVED_DRAFTS)
		return "Saved cloud prompt recovery is full. Your current draft was kept. Restore or discard saved prompts to continue."
	if (new TextEncoder().encode(JSON.stringify(Object.fromEntries(drafts))).length > MAX_SAVED_DRAFT_BYTES)
		return "There is too much saved cloud prompt data. Your current draft was kept. Reduce this prompt or discard saved prompts."
}

function readSavedDrafts() {
	const result = savedDraftsSchema.safeParse(nativeState().cloudHandoffDrafts)
	const drafts = new Map<string, SavedHandoffDraft>()
	if (!result.success) return drafts
	for (const [taskId, saved] of Object.entries(result.data)) {
		// A replacement view has a new composer; its revisions cannot acknowledge this saved submission.
		drafts.set(taskId, { ...saved, cleared: true })
	}
	return draftCapacityError(drafts) ? new Map<string, SavedHandoffDraft>() : drafts
}

function saveDraftChanges(current: Map<string, SavedHandoffDraft>, next: Map<string, SavedHandoffDraft>) {
	const previous = [...current].filter(([, saved]) => saved.cleared)
	const saved = [...next].filter(([, draft]) => draft.cleared)
	if (previous.length === saved.length && saved.every(([taskId, draft]) => current.get(taskId) === draft)) return
	const capacityError = draftCapacityError(new Map(saved))
	if (capacityError) throw new Error(capacityError)
	PLATFORM_CONFIG.setState({
		...nativeState(),
		cloudHandoffDrafts: Object.fromEntries(saved.map(([taskId, { draft, attemptId }]) => [taskId, { draft, attemptId }])),
	})
}

export function useCloudHandoff(chatState: ChatState) {
	const { currentTaskItem, currentCloudTask, cloudSessionsEnabled, cloudHandoff } = useExtensionState()
	const [drafts, setDraftState] = useState(readSavedDrafts)
	const draftsRef = useRef(drafts)
	const setDrafts = useCallback((update: (current: Map<string, SavedHandoffDraft>) => Map<string, SavedHandoffDraft>) => {
		const current = draftsRef.current
		const next = update(current)
		if (next === current) return
		saveDraftChanges(current, next)
		draftsRef.current = next
		setDraftState(next)
	}, [])
	const preparing = useRef(new Set<string>())
	const [failure, setFailure] = useState<{ sourceTaskId?: string; message: string; capacity?: true }>()
	const sourceTaskId = currentTaskItem?.id

	const removeDraft = useCallback(
		(taskId: string, expected: SavedHandoffDraft) => {
			setDrafts((current) => {
				if (current.get(taskId) !== expected) return current
				const next = new Map(current)
				next.delete(taskId)
				return next
			})
		},
		[setDrafts],
	)

	useEffect(() => {
		setFailure(undefined)
	}, [sourceTaskId, cloudHandoff?.id])
	useEffect(() => {
		if (!sourceTaskId) return
		const submitted = drafts.get(sourceTaskId)
		if (!submitted) return
		if (!cloudHandoff) {
			if (submitted.attemptId && !submitted.cleared) removeDraft(sourceTaskId, submitted)
			return
		}
		if ((cloudHandoff.phase === "preparing" || cloudHandoff.phase === "ready") && !submitted.attemptId) {
			setDrafts((current) => new Map(current).set(sourceTaskId, { ...submitted, attemptId: cloudHandoff.id }))
			return
		}
		if (submitted.attemptId !== cloudHandoff.id) return
		const sent = cloudHandoff.phase === "complete" && cloudHandoff.delivery === "sent"
		if (cloudHandoff.phase === "launching" || sent) {
			try {
				if (!submitted.cleared) {
					if (!sent) setDrafts((current) => new Map(current).set(sourceTaskId, { ...submitted, cleared: true }))
					chatState.consumeDraftSnapshot(submitted.draft)
				}
				if (sent) {
					removeDraft(sourceTaskId, submitted)
					setFailure(undefined)
				}
			} catch {
				setFailure({
					sourceTaskId,
					message: sent
						? "Could not update saved cloud prompt recovery."
						: "Could not save the cloud prompt for recovery. Your current draft was kept.",
				})
			}
		}
	}, [cloudHandoff, sourceTaskId, drafts, removeDraft, setDrafts, chatState.consumeDraftSnapshot])

	const prepare = useCallback(
		async (instruction: string, draft: DraftSnapshot) => {
			setFailure(undefined)
			if (!cloudSessionsEnabled) {
				setFailure({ sourceTaskId, message: "Enable Cloud sessions in Settings to use /cloud." })
				return
			}
			if (!sourceTaskId || currentCloudTask) {
				setFailure({ sourceTaskId, message: "Start a local conversation before using /cloud." })
				return
			}
			if (cloudHandoff || drafts.get(sourceTaskId)?.cleared) {
				setFailure({
					sourceTaskId,
					message:
						"Review or dismiss the existing cloud handoff, or restore or discard its saved draft before starting another.",
				})
				return
			}
			if (preparing.current.has(sourceTaskId)) {
				setFailure({
					sourceTaskId,
					message: "The previous cloud preparation is still pending. Wait for it to finish, then run /cloud again.",
				})
				return
			}
			const submitted = { draft }
			const next = new Map(draftsRef.current).set(sourceTaskId, submitted)
			const capacityError = draftCapacityError(next)
			if (capacityError) {
				setFailure({ sourceTaskId, message: capacityError, capacity: draftsRef.current.size ? true : undefined })
				return
			}
			try {
				setDrafts(() => next)
			} catch (err) {
				setFailure({ sourceTaskId, message: err instanceof Error ? err.message : "Unable to save the cloud prompt." })
				return
			}
			preparing.current.add(sourceTaskId)
			try {
				await CloudServiceClient.prepareHandoff(
					PrepareCloudHandoffRequest.create({
						sourceTaskId,
						instruction,
						images: draft.images,
						files: draft.files,
					}),
				)
			} catch (err) {
				removeDraft(sourceTaskId, submitted)
				setFailure({ sourceTaskId, message: err instanceof Error ? err.message : "Unable to prepare cloud handoff." })
			} finally {
				preparing.current.delete(sourceTaskId)
			}
		},
		[cloudSessionsEnabled, sourceTaskId, currentCloudTask, cloudHandoff, drafts, removeDraft, setDrafts],
	)
	const submitted = sourceTaskId ? drafts.get(sourceTaskId) : undefined
	const recoverable =
		submitted?.cleared &&
		(!cloudHandoff ||
			(cloudHandoff.id === submitted.attemptId &&
				(cloudHandoff.phase === "failed" ||
					(cloudHandoff.phase === "complete" && cloudHandoff.delivery === "unconfirmed"))))
	const restoreDraft =
		recoverable && sourceTaskId
			? async () => {
					const current = chatState.getDraftSnapshot()
					if (current.text || current.activeQuote !== null || current.images.length || current.files.length)
						throw new Error("Move or clear your current draft before restoring the cloud prompt.")
					chatState.setInputValue(submitted.draft.text)
					chatState.setActiveQuote(submitted.draft.activeQuote)
					chatState.setSelectedImages(submitted.draft.images)
					chatState.setSelectedFiles(submitted.draft.files)
					removeDraft(sourceTaskId, submitted)
					setFailure(undefined)
					if (cloudHandoff?.phase === "failed")
						await CloudServiceClient.discardHandoff(StringRequest.create({ value: cloudHandoff.id }))
				}
			: undefined
	const discardDraft =
		recoverable && sourceTaskId
			? async () => {
					setFailure(undefined)
					if (cloudHandoff) await CloudServiceClient.discardHandoff(StringRequest.create({ value: cloudHandoff.id }))
					removeDraft(sourceTaskId, submitted)
				}
			: undefined
	const discardAllDrafts =
		failure?.capacity && failure.sourceTaskId === sourceTaskId
			? async () => {
					setDrafts(() => new Map())
					setFailure(undefined)
				}
			: undefined
	return {
		prepare,
		restoreDraft,
		discardDraft: discardDraft ?? discardAllDrafts,
		error: failure?.sourceTaskId === sourceTaskId ? failure?.message : undefined,
	}
}
