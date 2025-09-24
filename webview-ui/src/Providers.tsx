import { type ReactNode } from "react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { TooltipProvider } from "./components/ui/tooltip"
import { ClineAuthProvider } from "./context/ClineAuthContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { PlatformProvider } from "./context/PlatformContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<CustomPostHogProvider>
					<ClineAuthProvider>
						<TooltipProvider>{children}</TooltipProvider>
					</ClineAuthProvider>
				</CustomPostHogProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
