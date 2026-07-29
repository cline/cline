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
import { useCallback, useEffect, useState } from "react"
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

export function useProviderConfig(providerId: ProviderId) {
	const [config, setConfig] = useState<ProviderConfigResponse | undefined>(undefined)

	const read = useCallback(async () => {
		const response = await ModelsServiceClient.readProviderConfig(StringRequest.create({ value: providerId }))
		setConfig(response)
		return response
	}, [providerId])

	useEffect(() => {
		void read()
	}, [read])

	const write = useCallback(
		async (patch: ProviderConfigWritePatch) => {
			const response = await ModelsServiceClient.writeProviderConfig(
				WriteProviderConfigRequest.create({
					providerId,
					patch: toWriteProviderConfigPatch(patch),
				}),
			)
			setConfig(response)
			return response
		},
		[providerId],
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

	return { config, write, commitSelection }
}
