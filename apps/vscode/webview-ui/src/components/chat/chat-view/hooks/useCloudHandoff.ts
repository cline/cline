import { PrepareCloudHandoffRequest } from "@shared/proto/cline/cloud"
import { StringRequest } from "@shared/proto/cline/common"
import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CloudServiceClient } from "@/services/grpc-client"
import type { ChatState, DraftSnapshot } from "../types/chatTypes"

export function useCloudHandoff(chatState: ChatState) {
	const { currentTaskItem, currentCloudTask, cloudSessionsEnabled, cloudHandoff } = useExtensionState()
	const drafts = useRef(new Map<string, { draft: DraftSnapshot; attemptId?: string; cleared?: boolean }>())
	const preparing = useRef(new Set<string>())
	const [failure, setFailure] = useState<{ sourceTaskId?: string; message: string }>()
	const sourceTaskId = currentTaskItem?.id

	useEffect(() => {
		setFailure(undefined)
	}, [sourceTaskId, cloudHandoff?.id])
	useEffect(() => {
		if (!sourceTaskId) return
		const submitted = drafts.current.get(sourceTaskId)
		if (!submitted) return
		if (!cloudHandoff) {
			if (submitted.attemptId) drafts.current.delete(sourceTaskId)
			return
		}
		if (cloudHandoff.sourceTaskId !== sourceTaskId) return
		if (cloudHandoff.phase === "preparing" || cloudHandoff.phase === "ready") submitted.attemptId ??= cloudHandoff.id
		if (submitted.attemptId !== cloudHandoff.id) return
		const sent = cloudHandoff.phase === "complete" && cloudHandoff.delivery === "sent"
		if (cloudHandoff.phase === "launching" || sent) {
			if (!submitted.cleared && chatState.getDraftSnapshot().revision === submitted.draft.revision) {
				submitted.cleared = true
				chatState.consumeDraftSnapshot(submitted.draft)
			}
			if (sent) drafts.current.delete(sourceTaskId)
		}
	}, [cloudHandoff, sourceTaskId, chatState.consumeDraftSnapshot, chatState.getDraftSnapshot])

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
			if (cloudHandoff) {
				setFailure({ sourceTaskId, message: "Review or dismiss the existing cloud handoff before starting another." })
				return
			}
			if (preparing.current.has(sourceTaskId)) return
			preparing.current.add(sourceTaskId)
			drafts.current.set(sourceTaskId, { draft })
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
				drafts.current.delete(sourceTaskId)
				setFailure({ sourceTaskId, message: err instanceof Error ? err.message : "Unable to prepare cloud handoff." })
			} finally {
				preparing.current.delete(sourceTaskId)
			}
		},
		[cloudSessionsEnabled, sourceTaskId, currentCloudTask, cloudHandoff],
	)
	const submitted = sourceTaskId ? drafts.current.get(sourceTaskId) : undefined
	const restoreDraft =
		submitted?.cleared &&
		cloudHandoff &&
		cloudHandoff.id === submitted.attemptId &&
		cloudHandoff.sourceTaskId === sourceTaskId &&
		(cloudHandoff.phase === "failed" || (cloudHandoff.phase === "complete" && cloudHandoff.delivery === "unconfirmed"))
			? async () => {
					const current = chatState.getDraftSnapshot()
					if (current.text || current.activeQuote !== null || current.images.length || current.files.length)
						throw new Error("Move or clear your current draft before restoring the cloud prompt.")
					chatState.setInputValue(submitted.draft.text)
					chatState.setActiveQuote(submitted.draft.activeQuote)
					chatState.setSelectedImages(submitted.draft.images)
					chatState.setSelectedFiles(submitted.draft.files)
					drafts.current.delete(cloudHandoff.sourceTaskId)
					if (cloudHandoff.phase === "failed")
						await CloudServiceClient.discardHandoff(StringRequest.create({ value: cloudHandoff.id }))
				}
			: undefined
	return { prepare, restoreDraft, error: failure?.sourceTaskId === sourceTaskId ? failure?.message : undefined }
}
