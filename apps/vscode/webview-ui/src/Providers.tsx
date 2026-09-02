import { HeroUIProvider } from "@heroui/react"
import { type ReactNode, useEffect } from "react"
import { I18nextProvider } from "react-i18next"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { ClineAuthProvider } from "./context/ClineAuthContext"
import { ExtensionStateContextProvider, useExtensionState } from "./context/ExtensionStateContext"
import { PlatformProvider } from "./context/PlatformContext"
import { i18n } from "./i18n"

/** Keeps the i18next language in sync with the locale resolved by the extension host. */
function I18nSync({ children }: { children: ReactNode }) {
	const { uiLocale } = useExtensionState()

	useEffect(() => {
		if (uiLocale && i18n.language !== uiLocale) {
			i18n.changeLanguage(uiLocale)
		}
	}, [uiLocale])

	return children
}

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<I18nextProvider i18n={i18n}>
					<I18nSync>
						<CustomPostHogProvider>
							<ClineAuthProvider>
								<HeroUIProvider>{children}</HeroUIProvider>
							</ClineAuthProvider>
						</CustomPostHogProvider>
					</I18nSync>
				</I18nextProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
