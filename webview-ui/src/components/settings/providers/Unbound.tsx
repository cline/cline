import { useCallback, useState, useRef } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useQueryClient } from "@tanstack/react-query"

import { type ProviderSettings, type OrganizationAllowList, unboundDefaultModelId } from "@roo-code/types"

import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type UnboundProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Unbound = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
}: UnboundProps) => {
	const { t } = useAppTranslation()
	const [didRefetch, setDidRefetch] = useState<boolean>()
	const [isInvalidKey, setIsInvalidKey] = useState<boolean>(false)
	const queryClient = useQueryClient()

	// Add refs to store timer IDs
	const didRefetchTimerRef = useRef<NodeJS.Timeout>()
	const invalidKeyTimerRef = useRef<NodeJS.Timeout>()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const saveConfiguration = useCallback(async () => {
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: "default",
			apiConfiguration: apiConfiguration,
		})

		const waitForStateUpdate = new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				window.removeEventListener("message", messageHandler)
				reject(new Error("Timeout waiting for state update"))
			}, 10000) // 10 second timeout

			const messageHandler = (event: MessageEvent) => {
				const message = event.data
				if (message.type === "state") {
					clearTimeout(timeoutId)
					window.removeEventListener("message", messageHandler)
					resolve()
				}
			}
			window.addEventListener("message", messageHandler)
		})

		try {
			await waitForStateUpdate
		} catch (error) {
			console.error("Failed to save configuration:", error)
		}
	}, [apiConfiguration])

	const requestModels = useCallback(async () => {
		vscode.postMessage({ type: "flushRouterModels", text: "unbound" })

		const modelsPromise = new Promise<void>((resolve) => {
			const messageHandler = (event: MessageEvent) => {
				const message = event.data
				if (message.type === "routerModels") {
					window.removeEventListener("message", messageHandler)
					resolve()
				}
			}
			window.addEventListener("message", messageHandler)
		})

		vscode.postMessage({ type: "requestRouterModels" })

		await modelsPromise

		await queryClient.invalidateQueries({ queryKey: ["routerModels"] })

		// After refreshing models, check if current model is in the updated list
		// If not, select the first available model
		const updatedModels = queryClient.getQueryData<{ unbound: RouterModels }>(["routerModels"])?.unbound
		if (updatedModels && Object.keys(updatedModels).length > 0) {
			const currentModelId = apiConfiguration?.unboundModelId
			const modelExists = currentModelId && Object.prototype.hasOwnProperty.call(updatedModels, currentModelId)

			if (!currentModelId || !modelExists) {
				const firstAvailableModelId = Object.keys(updatedModels)[0]
				setApiConfigurationField("unboundModelId", firstAvailableModelId)
			}
		}

		if (!updatedModels || Object.keys(updatedModels).includes("error")) {
			return false
		} else {
			return true
		}
	}, [queryClient, apiConfiguration, setApiConfigurationField])

	const handleRefresh = useCallback(async () => {
		await saveConfiguration()
		const requestModelsResult = await requestModels()

		if (requestModelsResult) {
			setDidRefetch(true)
			didRefetchTimerRef.current = setTimeout(() => setDidRefetch(false), 3000)
		} else {
			setIsInvalidKey(true)
			invalidKeyTimerRef.current = setTimeout(() => setIsInvalidKey(false), 3000)
		}
	}, [saveConfiguration, requestModels])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.unboundApiKey || ""}
				type="password"
				onInput={handleInputChange("unboundApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.unboundApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.unboundApiKey && (
				<VSCodeButtonLink href="https://gateway.getunbound.ai" appearance="secondary">
					{t("settings:providers.getUnboundApiKey")}
				</VSCodeButtonLink>
			)}
			<div className="flex justify-end">
				<Button variant="outline" onClick={handleRefresh} className="w-1/2 max-w-xs">
					<div className="flex items-center gap-2 justify-center">
						<span className="codicon codicon-refresh" />
						{t("settings:providers.refreshModels.label")}
					</div>
				</Button>
			</div>
			{didRefetch && (
				<div className="flex items-center text-vscode-charts-green">
					{t("settings:providers.unboundRefreshModelsSuccess")}
				</div>
			)}
			{isInvalidKey && (
				<div className="flex items-center text-vscode-errorForeground">
					{t("settings:providers.unboundInvalidApiKey")}
				</div>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				defaultModelId={unboundDefaultModelId}
				models={routerModels?.unbound ?? {}}
				modelIdKey="unboundModelId"
				serviceName="Unbound"
				serviceUrl="https://api.getunbound.ai/models"
				setApiConfigurationField={setApiConfigurationField}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}
