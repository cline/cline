import type { ReactNode } from "react"

import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { FirebaseAuthProvider } from "./context/FirebaseAuthContext"
import { HeroUIProvider } from "@heroui/react"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ExtensionStateContextProvider>
			<FirebaseAuthProvider>
				<HeroUIProvider>{children}</HeroUIProvider>
			</FirebaseAuthProvider>
		</ExtensionStateContextProvider>
	)
}
