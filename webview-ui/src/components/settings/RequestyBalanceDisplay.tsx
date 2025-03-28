import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { useRequestyKeyInfo } from "@/components/ui/hooks/useRequestyKeyInfo"

export const RequestyBalanceDisplay = ({ apiKey }: { apiKey: string }) => {
	const { data: keyInfo } = useRequestyKeyInfo(apiKey)

	if (!keyInfo) {
		return null
	}

	// Parse the balance to a number and format it to 2 decimal places.
	const balance = parseFloat(keyInfo.org_balance)
	const formattedBalance = balance.toFixed(2)

	return (
		<VSCodeLink href="https://app.requesty.ai/settings" className="text-vscode-foreground hover:underline">
			${formattedBalance}
		</VSCodeLink>
	)
}
