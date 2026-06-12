import { HeroUIProvider } from "@heroui/react"
import { type ReactNode } from "react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { AiHydroAuthProvider } from "./context/AiHydroAuthContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { HtmlPreviewContextProvider } from "./context/HtmlPreviewContext"
import { LedgerContextProvider } from "./context/LedgerContext"
import { MapContextProvider } from "./context/MapContext"
import { PlatformProvider } from "./context/PlatformContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<MapContextProvider>
					<LedgerContextProvider>
						<HtmlPreviewContextProvider>
							<CustomPostHogProvider>
								<AiHydroAuthProvider>
									<HeroUIProvider>{children}</HeroUIProvider>
								</AiHydroAuthProvider>
							</CustomPostHogProvider>
						</HtmlPreviewContextProvider>
					</LedgerContextProvider>
				</MapContextProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
