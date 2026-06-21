import { StringRequest } from "@shared/proto/cline/common"
import {
	type AwsProviderConfig,
	CommitModelSelectionRequest,
	type GcpProviderConfig,
	type ProviderConfigResponse,
	WriteProviderConfigPatch,
	WriteProviderConfigRequest,
} from "@shared/proto/cline/models"
import { toProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { useCallback, useEffect, useState } from "react"
import type { ProviderId } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import type { ModelInfo } from "../../../src/shared/api"

const pendingWritesByProvider = new Map<ProviderId, Promise<ProviderConfigResponse>>()
const writeSequenceByProvider = new Map<ProviderId, number>()

export type ProviderConfigWritePatch = Partial<Omit<WriteProviderConfigPatch, "headers" | "aws" | "gcp">> & {
	headers?: Record<string, string>
	aws?: Partial<AwsProviderConfig>
	gcp?: Partial<GcpProviderConfig>
	settingsJson?: string
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
		await pendingWritesByProvider.get(providerId)?.catch(() => undefined)
		const response = await ModelsServiceClient.readProviderConfig(StringRequest.create({ value: providerId }))
		setConfig(response)
		return response
	}, [providerId])

	useEffect(() => {
		void read()
	}, [read])

	const write = useCallback(
		async (patch: ProviderConfigWritePatch) => {
			const previousWrite = pendingWritesByProvider.get(providerId)?.catch(() => undefined)
			const sequence = (writeSequenceByProvider.get(providerId) ?? 0) + 1
			writeSequenceByProvider.set(providerId, sequence)
			const writePromise = (previousWrite ?? Promise.resolve()).then(() =>
				ModelsServiceClient.writeProviderConfig(
					WriteProviderConfigRequest.create({
						providerId,
						patch: toWriteProviderConfigPatch(patch),
					}),
				),
			)
			const trackedWritePromise = writePromise.finally(() => {
				if (pendingWritesByProvider.get(providerId) === trackedWritePromise) {
					pendingWritesByProvider.delete(providerId)
				}
			})
			pendingWritesByProvider.set(providerId, trackedWritePromise)
			const response = await writePromise
			if (writeSequenceByProvider.get(providerId) === sequence) {
				setConfig(response)
			}
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
