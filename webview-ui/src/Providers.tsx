import { HeroUIProvider } from "@heroui/react"
import { type ReactNode } from "react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { ClineAuthProvider } from "./context/ClineAuthContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ExtensionStateContextProvider>
			<CustomPostHogProvider>
				<ClineAuthProvider>
					<HeroUIProvider>{children}</HeroUIProvider>
				</ClineAuthProvider>
			</CustomPostHogProvider>
		</ExtensionStateContextProvider>
	)
}
