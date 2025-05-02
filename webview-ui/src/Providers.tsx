import type { ReactNode } from "react"

import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { FirebaseAuthProvider } from "./context/FirebaseAuthContext"
import { HeroUIProvider } from "@heroui/react"
import { PostHogProvider } from "posthog-js/react"
import { posthogConfig } from "@shared/services/config/posthog-config"
import posthog from "posthog-js"

posthog.init(posthogConfig.apiKey, {
	api_host: posthogConfig.host,
})

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ExtensionStateContextProvider>
			<PostHogProvider client={posthog}>
				<FirebaseAuthProvider>
					<HeroUIProvider>{children}</HeroUIProvider>
				</FirebaseAuthProvider>
			</PostHogProvider>
		</ExtensionStateContextProvider>
	)
}
