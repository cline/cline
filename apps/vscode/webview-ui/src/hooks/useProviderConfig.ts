import { StringRequest } from "@shared/proto/cline/common"
import {
	type AwsProviderConfig,
	CommitModelSelectionRequest,
	type GcpProviderConfig,
	type ProviderConfigResponse,
	WriteProviderConfigPatch,
	WriteProviderConfigRequest,
} from "@shared/proto/cline/models"
import {
	type ProviderModelOverrides,
	toProtobufModelOverrides as toProtobufProviderModelOverrides,
} from "@shared/proto-conversions/models/modelOverrides"
import { isOpenaiReasoningEffort } from "@shared/storage/types"
import { useCallback, useEffect, useRef, useState } from "react"
import { DEFAULT_REASONING_EFFORT_OPTION, type ReasoningEffortSelection } from "@/components/settings/utils/reasoningEffort"
import type { ProviderId } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

export type ProviderConfigWritePatch = Partial<Omit<WriteProviderConfigPatch, "headers" | "aws" | "gcp">> & {
	headers?: Record<string, string>
	aws?: Partial<AwsProviderConfig>
	gcp?: Partial<GcpProviderConfig>
}

// The overrides domain type and its proto conversions are shared with the
// host; see the tri-state and normalization semantics documented there.
export {
	fromProtobufModelOverrides as fromProtobufProviderModelOverrides,
	toProtobufModelOverrides as toProtobufProviderModelOverrides,
} from "@shared/proto-conversions/models/modelOverrides"
export type { ProviderModelOverrides }

export interface ProviderModelSelection {
	providerId: ProviderId
	modelId: string
	/**
	 * Tri-state: `undefined` preserves the model's stored overrides, an
	 * explicitly empty object clears them, and a non-empty object replaces
	 * them wholesale.
	 */
	overrides?: ProviderModelOverrides
}

function toWriteProviderConfigPatch(patch: ProviderConfigWritePatch): WriteProviderConfigPatch {
	const headers = patch.headers ?? {}
	const shouldClearHeaders = patch.headers !== undefined && Object.keys(headers).length === 0

	return WriteProviderConfigPatch.create({
		...patch,
		headers,
		clearHeaders: shouldClearHeaders || undefined,
	})
}

/** The host echoes the requested id normalized (trimmed, lowercased). */
function isConfigFor(config: ProviderConfigResponse, providerId: ProviderId): boolean {
	return config.providerId.trim().toLowerCase() === providerId.trim().toLowerCase()
}

function touchesReasoning(patch: ProviderConfigWritePatch): boolean {
	return "reasoning" in patch || patch.clearReasoning === true
}

export function useProviderConfig(providerId: ProviderId) {
	const [storedConfig, setConfig] = useState<ProviderConfigResponse | undefined>(undefined)
	// Writes that change the saved reasoning setting, still waiting for the
	// host. A selector showing the pre-write value meanwhile would treat a
	// pick of that value as no change and never save it.
	const [pendingReasoningWrites, setPendingReasoningWrites] = useState(0)
	// A component that stays mounted across a provider switch keeps the
	// previous provider's response until the new read lands. Expose nothing
	// in between, so no field is edited against another provider's state.
	const config = storedConfig && isConfigFor(storedConfig, providerId) ? storedConfig : undefined

	// Reads and writes resolve asynchronously and can complete out of order
	// (e.g. a slow initial read landing after a user-triggered write). Only
	// the latest issued request may apply its response; anything older is
	// stale and would roll the UI state back.
	const requestSeqRef = useRef(0)
	const applyConfig = useCallback((seq: number, response: ProviderConfigResponse) => {
		if (seq !== requestSeqRef.current) {
			return
		}
		setConfig(response)
	}, [])

	const read = useCallback(async () => {
		const seq = ++requestSeqRef.current
		const response = await ModelsServiceClient.readProviderConfig(StringRequest.create({ value: providerId }))
		applyConfig(seq, response)
		return response
	}, [providerId, applyConfig])

	useEffect(() => {
		void read()
	}, [read])

	const write = useCallback(
		async (patch: ProviderConfigWritePatch) => {
			const seq = ++requestSeqRef.current
			const reasoningWrite = touchesReasoning(patch)
			if (reasoningWrite) {
				setPendingReasoningWrites((count) => count + 1)
			}
			try {
				const response = await ModelsServiceClient.writeProviderConfig(
					WriteProviderConfigRequest.create({
						providerId,
						patch: toWriteProviderConfigPatch(patch),
					}),
				)
				applyConfig(seq, response)
				return response
			} catch (error) {
				// A failed write may still have partially applied host-side, and
				// its failure means no response will ever apply for this seq —
				// without a re-read, older dropped responses could leave config
				// stale (or undefined) forever. Re-read to converge on the
				// backend's actual state, but only if this write is still the
				// latest request: when a newer request is already in flight, its
				// response (or its own failure recovery) supersedes this one,
				// and a recovery read issued now could race ahead of the newer
				// write host-side and pin a pre-write snapshot as the latest.
				if (seq === requestSeqRef.current) {
					void read().catch(() => {})
				}
				throw error
			} finally {
				if (reasoningWrite) {
					setPendingReasoningWrites((count) => count - 1)
				}
			}
		},
		[providerId, applyConfig, read],
	)

	const commitSelection = useCallback(
		async (mode: "plan" | "act", selection: ProviderModelSelection) => {
			if (selection.providerId !== providerId) {
				throw new Error(`selection providerId ${selection.providerId} does not match hook providerId ${providerId}`)
			}

			await ModelsServiceClient.commitModelSelection(
				CommitModelSelectionRequest.create({
					providerId,
					mode,
					modelId: selection.modelId,
					overrides:
						selection.overrides !== undefined ? toProtobufProviderModelOverrides(selection.overrides) : undefined,
				}),
			)
			await read()
		},
		[providerId, read],
	)

	/**
	 * The provider's saved reasoning effort as `ReasoningEffortSelector` shows
	 * it: `null` while it is unknown (the config is loading or a reasoning
	 * write is pending), otherwise the saved level or Default for nothing saved.
	 */
	const reasoningEffort: ReasoningEffortSelection | null =
		config === undefined || pendingReasoningWrites > 0
			? null
			: isOpenaiReasoningEffort(config.reasoningEffort)
				? config.reasoningEffort
				: DEFAULT_REASONING_EFFORT_OPTION

	return { config, reasoningEffort, write, commitSelection }
}
