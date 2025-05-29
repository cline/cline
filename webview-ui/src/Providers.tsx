import { type ReactNode } from "react"

import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { FirebaseAuthProvider } from "./context/FirebaseAuthContext"
import { HeroUIProvider } from "@heroui/react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ExtensionStateContextProvider>
			<CustomPostHogProvider>
				<FirebaseAuthProvider>
					<HeroUIProvider>{children}</HeroUIProvider>
				</FirebaseAuthProvider>
			</CustomPostHogProvider>
		</ExtensionStateContextProvider>
	)
}
