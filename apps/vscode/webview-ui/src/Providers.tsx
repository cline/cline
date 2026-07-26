import { HeroUIProvider } from "@heroui/react"
import { type ReactNode } from "react"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { PlatformProvider } from "./context/PlatformContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<HeroUIProvider>{children}</HeroUIProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
