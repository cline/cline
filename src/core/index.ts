import { ClineApi } from "./ClineApi"
import { ClineProvider } from "./webview/ClineProvider"
import { ApiConfiguration } from "../shared/api"

export function createCline(
    provider: ClineProvider,
    apiConfiguration: ApiConfiguration,
    customInstructions?: string,
    alwaysAllowReadOnly?: boolean,
    task?: string,
    images?: string[],
    historyItem?: any
): ClineApi {
    return new ClineApi(
        provider,
        apiConfiguration,
        customInstructions,
        alwaysAllowReadOnly,
        task,
        images,
        historyItem
    )
}

export type { ClineApi }
export { ClineProvider }
