import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useRef } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface PortkeyProviderProps {
    showModelOptions: boolean
    isPopup?: boolean
    currentMode: Mode
}

const PORTKEY_DEFAULT_BASE_URL = "https://api.portkey.ai/v1"

export const PortkeyProvider = ({ showModelOptions, isPopup, currentMode }: PortkeyProviderProps) => {
    const { apiConfiguration } = useExtensionState()
    const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

    const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current)
            }
        }
    }, [])

    const debouncedRefreshModels = useCallback((baseUrl?: string, apiKey?: string) => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current)
        }

        if (baseUrl && apiKey) {
            debounceTimerRef.current = setTimeout(() => {
                ModelsServiceClient.refreshOpenAiModels(
                    OpenAiModelsRequest.create({
                        baseUrl,
                        apiKey,
                    }),
                ).catch((error) => {
                    console.error("Failed to refresh Portkey models:", error)
                })
            }, 500)
        }
    }, [])

    return (
        <div>
            <DebouncedTextField
                initialValue={apiConfiguration?.openAiBaseUrl || PORTKEY_DEFAULT_BASE_URL}
                onChange={(value) => {
                    handleFieldChange("openAiBaseUrl", value)
                    debouncedRefreshModels(value || PORTKEY_DEFAULT_BASE_URL, apiConfiguration?.openAiApiKey)
                }}
                placeholder={`Default: ${PORTKEY_DEFAULT_BASE_URL}`}
                style={{ width: "100%", marginBottom: 10 }}
                type="url">
                <span style={{ fontWeight: 500 }}>Gateway URL (optional)</span>
            </DebouncedTextField>

            <ApiKeyField
                initialValue={apiConfiguration?.openAiApiKey || ""}
                onChange={(value) => {
                    handleFieldChange("openAiApiKey", value)
                    debouncedRefreshModels(apiConfiguration?.openAiBaseUrl || PORTKEY_DEFAULT_BASE_URL, value)
                }}
                providerName="Portkey"
            />

            <DebouncedTextField
                initialValue={selectedModelId || ""}
                onChange={(value) =>
                    handleModeFieldChange({ plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" }, value, currentMode)
                }
                placeholder={"Enter Model ID..."}
                style={{ width: "100%", marginBottom: 10 }}>
                <span style={{ fontWeight: 500 }}>Model ID</span>
            </DebouncedTextField>

            {showModelOptions && (
                <ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
            )}
        </div>
    )
}


