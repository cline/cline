import { PrepareCloudHandoffRequest } from "@shared/proto/cline/cloud"
import { StringRequest } from "@shared/proto/cline/common"
import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CloudServiceClient } from "@/services/grpc-client"
import type { ChatState, DraftSnapshot } from "../types/chatTypes"

type SavedHandoffDraft = {
	draft: DraftSnapshot
	attemptId?: string
	cleared?: boolean
}

export function useCloudHandoff(chatState: ChatState) {
	const { currentTaskItem, currentCloudTask, cloudSessionsEnabled, cloudHandoff } = useExtensionState()
	const [drafts, setDraftState] = useState(() => new Map<string, SavedHandoffDraft>())
	const draftsRef = useRef(drafts)
	const setDrafts = useCallback((update: (current: Map<string, SavedHandoffDraft>) => Map<string, SavedHandoffDraft>) => {
		const current = draftsRef.current
		const next = update(current)
		if (next === current) return
		draftsRef.current = next
		setDraftState(next)
	}, [])
	const preparing = useRef(new Set<string>())
	const [failure, setFailure] = useState<{ sourceTaskId?: string; message: string }>()
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
			if (!submitted.cleared) {
				if (!sent) setDrafts((current) => new Map(current).set(sourceTaskId, { ...submitted, cleared: true }))
				chatState.consumeDraftSnapshot(submitted.draft)
			}
			if (sent) {
				removeDraft(sourceTaskId, submitted)
				setFailure(undefined)
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
			setDrafts((current) => new Map(current).set(sourceTaskId, submitted))
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
	return {
		prepare,
		restoreDraft,
		discardDraft,
		error: failure?.sourceTaskId === sourceTaskId ? failure?.message : undefined,
	}
}
