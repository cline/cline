import { type ReactNode } from "react"

import { HeroUIProvider } from "@heroui/react"
import { ClineAuthProvider } from "./context/ClineAuthContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { CustomPostHogProvider } from "./CustomPostHogProvider"

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
