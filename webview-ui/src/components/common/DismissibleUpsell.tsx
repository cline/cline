import { memo, ReactNode, useEffect, useState, useRef } from "react"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { telemetryClient } from "@src/utils/TelemetryClient"
import { TelemetryEventName } from "@roo-code/types"

interface DismissibleUpsellProps {
	/** Required unique identifier for this upsell */
	upsellId: string
	/** Optional CSS class name for styling */
	className?: string
	/** Optional Icon component */
	icon?: ReactNode
	/** Content to display inside the upsell */
	children: ReactNode
	/** Visual variant of the upsell */
	variant?: "default" | "banner"
	/** Optional callback when upsell is dismissed */
	onDismiss?: () => void
	/** Optional callback when upsell is clicked */
	onClick?: () => void
	/** Whether clicking the upsell should also dismiss it (default: false) */
	dismissOnClick?: boolean
}

const DismissIcon = () => (
	<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.647 3.646.708.707L8 8.707z"
			fill="currentColor"
		/>
	</svg>
)

const DismissibleUpsell = memo(
	({
		upsellId,
		className,
		icon,
		children,
		variant = "default",
		onDismiss,
		onClick,
		dismissOnClick = false,
	}: DismissibleUpsellProps) => {
		const { t } = useAppTranslation()
		const [isVisible, setIsVisible] = useState(false)
		const isMountedRef = useRef(true)

		useEffect(() => {
			// Track mounted state
			isMountedRef.current = true

			// Request the current list of dismissed upsells from the extension
			vscode.postMessage({ type: "getDismissedUpsells" })

			// Listen for the response
			const handleMessage = (event: MessageEvent) => {
				// Only update state if component is still mounted
				if (!isMountedRef.current) return

				const message = event.data
				// Add null/undefined check for message
				if (message && message.type === "dismissedUpsells" && Array.isArray(message.list)) {
					// Check if this upsell has been dismissed
					if (!message.list.includes(upsellId)) {
						setIsVisible(true)
					}
				}
			}

			window.addEventListener("message", handleMessage)
			return () => {
				isMountedRef.current = false
				window.removeEventListener("message", handleMessage)
			}
		}, [upsellId])

		const handleDismiss = () => {
			// Track telemetry for dismissal
			telemetryClient.capture(TelemetryEventName.UPSELL_DISMISSED, {
				upsellId: upsellId,
			})

			// First notify the extension to persist the dismissal
			// This ensures the message is sent even if the component unmounts quickly
			vscode.postMessage({
				type: "dismissUpsell",
				upsellId: upsellId,
			})

			// Then hide the upsell
			setIsVisible(false)

			// Call the optional callback
			onDismiss?.()
		}

		// Don't render if not visible
		if (!isVisible) {
			return null
		}

		const variants = {
			banner: {
				container:
					"p-2 bg-vscode-badge-background/80 text-vscode-badge-foreground border-vscode-dropdown-border border",
				button: "text-vscode-badge-foreground",
			},
			default: {
				container: "bg-vscode-notifications-background text-vscode-notifications-foreground",
				button: "text-vscode-notifications-foreground",
			},
		}
		// Build container classes based on variant and presence of click handler
		const containerClasses = [
			"relative flex items-start justify-between gap-2",
			"text-sm",
			variants[variant].container,
			onClick && "cursor-pointer hover:opacity-90 transition-opacity duration-200",
			className,
		]
			.filter(Boolean)
			.join(" ")

		// Build button classes based on variant
		const buttonClasses = [
			"flex items-center justify-center",
			"rounded",
			"bg-transparent",
			"border-none",
			"cursor-pointer",
			"hover:opacity-50 transition-opacity duration-200",
			variants[variant].button,
			"focus:outline focus:outline-1 focus:outline-vscode-focusBorder focus:outline-offset-1",
		].join(" ")

		return (
			<div
				className={containerClasses}
				onClick={() => {
					// Track telemetry for click
					if (onClick) {
						telemetryClient.capture(TelemetryEventName.UPSELL_CLICKED, {
							upsellId: upsellId,
						})
					}

					// Call the onClick handler if provided
					onClick?.()
					// Also dismiss if dismissOnClick is true
					if (dismissOnClick) {
						handleDismiss()
					}
				}}>
				{icon && icon}
				<div>{children}</div>
				<button
					className={buttonClasses}
					onClick={(e) => {
						e.stopPropagation() // Prevent triggering the container's onClick
						handleDismiss()
					}}
					aria-label={t("common:dismiss")}
					title={t("common:dismissAndDontShowAgain")}>
					<DismissIcon />
				</button>
			</div>
		)
	},
)

DismissibleUpsell.displayName = "DismissibleUpsell"

export default DismissibleUpsell
