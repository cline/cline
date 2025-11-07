import { HeroUIProvider } from "@heroui/react"
import { type ReactNode } from "react"
import { I18nextProvider } from "react-i18next"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { ClineAuthProvider } from "./context/ClineAuthContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { PlatformProvider } from "./context/PlatformContext"
import i18n from "./i18n/i18n"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<CustomPostHogProvider>
					<ClineAuthProvider>
						<I18nextProvider i18n={i18n}>
							<HeroUIProvider>{children}</HeroUIProvider>
						</I18nextProvider>
					</ClineAuthProvider>
				</CustomPostHogProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
