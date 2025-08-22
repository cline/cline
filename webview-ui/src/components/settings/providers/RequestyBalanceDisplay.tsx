import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { useRequestyKeyInfo } from "@/components/ui/hooks/useRequestyKeyInfo"
import { toRequestyServiceUrl } from "@roo/utils/requesty"

type RequestyBalanceDisplayProps = {
	apiKey: string
	baseUrl?: string
}

export const RequestyBalanceDisplay = ({ baseUrl, apiKey }: RequestyBalanceDisplayProps) => {
	const { data: keyInfo } = useRequestyKeyInfo(baseUrl, apiKey)

	if (!keyInfo) {
		return null
	}

	// Parse the balance to a number and format it to 2 decimal places.
	const balance = parseFloat(keyInfo.org_balance)
	const formattedBalance = balance.toFixed(2)

	const resolvedBaseUrl = toRequestyServiceUrl(baseUrl, "app")
	const settingsUrl = new URL("settings", resolvedBaseUrl)

	return (
		<VSCodeLink href={settingsUrl.toString()} className="text-vscode-foreground hover:underline">
			${formattedBalance}
		</VSCodeLink>
	)
}
