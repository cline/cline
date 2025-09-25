import { useCallback, useState, useEffect } from "react"
import knuthShuffle from "knuth-shuffle-seeded"
import { Trans } from "react-i18next"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import posthog from "posthog-js"

import type { ProviderSettings } from "@roo-code/types"
import { TelemetryEventName } from "@roo-code/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { validateApiConfiguration } from "@src/utils/validate"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { getRequestyAuthUrl, getOpenRouterAuthUrl } from "@src/oauth/urls"
import { telemetryClient } from "@src/utils/TelemetryClient"

import ApiOptions from "../settings/ApiOptions"
import { Tab, TabContent } from "../common/Tab"

import RooHero from "./RooHero"

const WelcomeView = () => {
	const { apiConfiguration, currentApiConfigName, setApiConfiguration, uriScheme, machineId } = useExtensionState()
	const { t } = useAppTranslation()
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
	const [showRooProvider, setShowRooProvider] = useState(false)

	// Check PostHog feature flag for Roo provider
	useEffect(() => {
		posthog.onFeatureFlags(function () {
			setShowRooProvider(posthog?.getFeatureFlag("roo-provider-featured") === "test")
		})
	}, [])

	// Memoize the setApiConfigurationField function to pass to ApiOptions
	const setApiConfigurationFieldForApiOptions = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => {
			setApiConfiguration({ [field]: value })
		},
		[setApiConfiguration], // setApiConfiguration from context is stable
	)

	const handleSubmit = useCallback(() => {
		const error = apiConfiguration ? validateApiConfiguration(apiConfiguration) : undefined

		if (error) {
			setErrorMessage(error)
			return
		}

		setErrorMessage(undefined)
		vscode.postMessage({ type: "upsertApiConfiguration", text: currentApiConfigName, apiConfiguration })
	}, [apiConfiguration, currentApiConfigName])

	// Using a lazy initializer so it reads once at mount
	const [imagesBaseUri] = useState(() => {
		const w = window as any
		return w.IMAGES_BASE_URI || ""
	})

	return (
		<Tab>
			<TabContent className="flex flex-col gap-4 p-6">
				<RooHero />
				<h2 className="mt-0 mb-4 text-xl text-center">{t("welcome:greeting")}</h2>

				<div className="text-base text-vscode-foreground py-2 px-2 mb-4">
					<p className="mb-3 leading-relaxed">
						<Trans i18nKey="welcome:introduction" />
					</p>
					<p className="mb-0 leading-relaxed">
						<Trans i18nKey="welcome:chooseProvider" />
					</p>
				</div>

				<div className="mb-4">
					<p className="text-sm font-medium mt-4 mb-3">{t("welcome:startRouter")}</p>

					<div>
						{/* Define the providers */}
						{(() => {
							// Provider card configuration
							const baseProviders = [
								{
									slug: "requesty",
									name: "Requesty",
									description: t("welcome:routers.requesty.description"),
									incentive: t("welcome:routers.requesty.incentive"),
									authUrl: getRequestyAuthUrl(uriScheme),
								},
								{
									slug: "openrouter",
									name: "OpenRouter",
									description: t("welcome:routers.openrouter.description"),
									authUrl: getOpenRouterAuthUrl(uriScheme),
								},
							]

							// Conditionally add Roo provider based on feature flag
							const providers = showRooProvider
								? [
										...baseProviders,
										{
											slug: "roo",
											name: "Roo Code Cloud",
											description: t("welcome:routers.roo.description"),
											incentive: t("welcome:routers.roo.incentive"),
											authUrl: "#", // Placeholder since onClick handler will prevent default
										},
									]
								: baseProviders

							// Shuffle providers based on machine ID (will be consistent for the same machine)
							const orderedProviders = [...providers]
							knuthShuffle(orderedProviders, (machineId as any) || Date.now())

							// Render the provider cards
							return orderedProviders.map((provider, index) => (
								<a
									key={index}
									href={provider.authUrl}
									className="relative flex-1 border border-vscode-panel-border hover:bg-secondary rounded-md py-3 px-4 mb-2 flex flex-row gap-3 cursor-pointer transition-all no-underline text-inherit"
									target="_blank"
									rel="noopener noreferrer"
									onClick={(e) => {
										// Track telemetry for featured provider click
										telemetryClient.capture(TelemetryEventName.FEATURED_PROVIDER_CLICKED, {
											provider: provider.slug,
										})

										// Special handling for Roo provider
										if (provider.slug === "roo") {
											e.preventDefault()

											// Set the Roo provider configuration
											const rooConfig: ProviderSettings = {
												apiProvider: "roo",
											}

											// Save the Roo provider configuration
											vscode.postMessage({
												type: "upsertApiConfiguration",
												text: currentApiConfigName,
												apiConfiguration: rooConfig,
											})

											// Then trigger cloud sign-in
											vscode.postMessage({ type: "rooCloudSignIn" })
										}
										// For other providers, let the default link behavior work
									}}>
									{provider.incentive && (
										<div className="absolute top-0 right-0 text-[10px] text-vscode-badge-foreground bg-vscode-badge-background px-2 py-0.5 rounded-bl rounded-tr-md">
											{provider.incentive}
										</div>
									)}
									<div className="w-8 h-8 flex-shrink-0">
										<img
											src={`${imagesBaseUri}/${provider.slug}.png`}
											alt={provider.name}
											className="w-full h-full object-contain"
										/>
									</div>
									<div>
										<div className="text-sm font-medium text-vscode-foreground">
											{provider.name}
										</div>
										<div className="text-xs text-vscode-descriptionForeground">
											{provider.description}
										</div>
									</div>
								</a>
							))
						})()}
					</div>

					<p className="text-sm font-medium mt-6 mb-3">{t("welcome:startCustom")}</p>
					<ApiOptions
						fromWelcomeView
						apiConfiguration={apiConfiguration || {}}
						uriScheme={uriScheme}
						setApiConfigurationField={setApiConfigurationFieldForApiOptions}
						errorMessage={errorMessage}
						setErrorMessage={setErrorMessage}
					/>
				</div>
			</TabContent>
			<div className="sticky bottom-0 bg-vscode-sideBar-background p-4 border-t border-vscode-panel-border">
				<div className="flex flex-col gap-2">
					<div className="flex justify-end">
						<VSCodeLink
							href="#"
							onClick={(e) => {
								e.preventDefault()
								vscode.postMessage({ type: "importSettings" })
							}}
							className="text-sm">
							{t("welcome:importSettings")}
						</VSCodeLink>
					</div>
					<VSCodeButton onClick={handleSubmit} appearance="primary">
						{t("welcome:start")}
					</VSCodeButton>
					{errorMessage && <div className="text-vscode-errorForeground">{errorMessage}</div>}
				</div>
			</div>
		</Tab>
	)
}

export default WelcomeView
