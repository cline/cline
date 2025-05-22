import { memo, type ReactNode, useMemo, useRef } from "react" // Added useRef

// Removed import for ExtensionStateProviderWrapper
import { FirebaseAuthProvider } from "./context/FirebaseAuthContext"
import { HeroUIProvider } from "@heroui/react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { logger } from "./utils/logger"

export const Providers = memo(function Providers({ children }: { children: ReactNode }) {
	const renderCountRef = useRef(0)
	renderCountRef.current += 1
	logger.debug(
		`[Providers.tsx] Providers inner function Render #${renderCountRef.current}. Children changed: ${children !== (useRef(children).current = children)}`,
	)

	const memoizedPostHogChildren = useMemo(
		() => (
			<FirebaseAuthProvider>
				<HeroUIProvider>{children}</HeroUIProvider>
			</FirebaseAuthProvider>
		),
		[children],
	)

	return <CustomPostHogProvider>{memoizedPostHogChildren}</CustomPostHogProvider>
})
