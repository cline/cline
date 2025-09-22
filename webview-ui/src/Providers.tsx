import { HeroUIProvider } from "@heroui/react"
import { type ReactNode } from "react"
import { ClineAuthProvider } from "./context/ClineAuthContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { PlatformProvider } from "./context/PlatformContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<ClineAuthProvider>
					<HeroUIProvider>{children}</HeroUIProvider>
				</ClineAuthProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
