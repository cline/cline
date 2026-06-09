import { StringRequest } from "@shared/proto/cline/common"
import {
	CommitModelSelectionRequest,
	type ProviderConfigResponse,
	WriteProviderConfigPatch,
	WriteProviderConfigRequest,
} from "@shared/proto/cline/models"
import { toProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { useCallback, useEffect, useState } from "react"
import type { ProviderId } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import type { ModelInfo } from "../../../src/shared/api"

export type ProviderConfigWritePatch = Partial<Omit<WriteProviderConfigPatch, "headers">> & {
	headers?: Record<string, string>
}

export interface ProviderModelSelection {
	providerId: ProviderId
	modelId: string
	modelInfo: ModelInfo
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
					modelInfo: toProtobufModelInfo(selection.modelInfo),
				}),
			)
			await read()
		},
		[providerId, read],
	)

	return { config, write, commitSelection }
}
