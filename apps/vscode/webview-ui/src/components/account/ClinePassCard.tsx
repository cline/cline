import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import { Sparkles } from "lucide-react"
import { useClinePassPromo } from "@/hooks/useClinePassPromo"
import VSCodeButtonLink from "../common/VSCodeButtonLink"

/**
 * ClinePass section for the signed-in account view. Promotes the subscription
 * to users who aren't on the ClinePass provider, and links to subscription
 * management for those who are.
 */
export const ClinePassCard = () => {
	const { isClinePassEnabled, isUsingClinePass, subscribeUrl, manageSubscriptionUrl, switchToClinePassProvider } =
		useClinePassPromo()

	if (!isClinePassEnabled) {
		return null
	}

	return (
		<div className="flex flex-col gap-2" data-testid="cline-pass-card">
			<VSCodeDivider className="w-full mt-6 mb-3" />
			<div className="flex items-center gap-2">
				<Sparkles className="size-4 shrink-0 text-[var(--vscode-charts-yellow)]" />
				<span className="text-base font-semibold">ClinePass</span>
			</div>

			{isUsingClinePass ? (
				<>
					<p className="m-0 text-sm text-description">
						You're using the ClinePass provider. Manage your subscription and view usage from your dashboard.
					</p>
					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<div className="w-full min-[225px]:w-1/2">
							<VSCodeButtonLink appearance="secondary" className="w-full" href={manageSubscriptionUrl}>
								Manage Subscription
							</VSCodeButtonLink>
						</div>
					</div>
				</>
			) : (
				<>
					<p className="m-0 text-sm text-description">
						A monthly subscription for the latest open-weights models, at much lower cost than paying for direct API
						access.
					</p>
					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<div className="w-full min-[225px]:w-1/2">
							<VSCodeButtonLink appearance="primary" className="w-full" href={subscribeUrl}>
								Get ClinePass
							</VSCodeButtonLink>
						</div>
						<VSCodeButton
							appearance="secondary"
							className="w-full min-[225px]:w-1/2"
							onClick={() => void switchToClinePassProvider()}>
							Use ClinePass Provider
						</VSCodeButton>
					</div>
				</>
			)}
		</div>
	)
}

/**
 * Compact ClinePass callout for the signed-out account welcome view.
 */
export const ClinePassWelcomeCallout = () => {
	const { isClinePassEnabled } = useClinePassPromo()

	if (!isClinePassEnabled) {
		return null
	}

	return (
		<div
			className="w-full flex items-start gap-2 rounded-sm bg-[var(--vscode-textBlockQuote-background)] p-3 mb-2"
			data-testid="cline-pass-welcome-callout">
			<Sparkles className="size-4 shrink-0 mt-0.5 text-[var(--vscode-charts-yellow)]" />
			<p className="m-0 text-xs text-description">
				<span className="font-semibold text-foreground">ClinePass</span> — a low-cost monthly subscription for the latest
				open-weights models, much cheaper than direct API access. Sign up to subscribe from your dashboard.
			</p>
		</div>
	)
}
