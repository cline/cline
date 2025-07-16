import { type ReactNode } from "react"

import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { ClineAuthProvider } from "./context/ClineAuthContext"
import { HeroUIProvider } from "@heroui/react"
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
