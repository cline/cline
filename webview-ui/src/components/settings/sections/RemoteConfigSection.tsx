import { EmptyRequest } from "@shared/proto/index.cline"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface RemoteConfigSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

function BaseRemoteConfigSection({ renderSectionHeader, children }: React.PropsWithChildren<RemoteConfigSectionProps>) {
	return (
		<div>
			{renderSectionHeader("remote-config")}
			<Section>{children}</Section>
		</div>
	)
}

const AUTOMATIC_DELAY_MS = 30000

function RefreshButton() {
	const [isLoading, setIsLoading] = useState(false)
	const [retryIn, setRetryIn] = useState<number | null>(null)
	const intervalRef = useRef<NodeJS.Timeout>()

	useEffect(() => {
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current)
			}
		}
	}, [])

	const onRefresh = () => {
		setIsLoading(true)
		StateServiceClient.refreshRemoteConfig(EmptyRequest.create()).finally(() => {
			setIsLoading(false)
			setRetryIn(AUTOMATIC_DELAY_MS / 30000)

			intervalRef.current = setInterval(() => {
				setRetryIn((old) => {
					if (old && old > 0) return old - 1

					intervalRef.current && clearInterval(intervalRef.current)
					return null
				})
			}, 1000)
		})
	}

	return (
		<VSCodeButton
			className={`w-full rounded-xs ${isLoading ? "animate-pulse" : ""}`}
			disabled={isLoading || (retryIn !== null && retryIn > 0)}
			onClick={() => onRefresh()}>
			Refresh {retryIn && retryIn > 0 && <>(Retry in: {retryIn} seconds)</>}
		</VSCodeButton>
	)
}

export function RemoteConfigSection({ renderSectionHeader }: RemoteConfigSectionProps) {
	const { remoteConfigSettings } = useExtensionState()

	if (!remoteConfigSettings) {
		return (
			<BaseRemoteConfigSection renderSectionHeader={renderSectionHeader}>
				<div className="flex flex-col justify-center gap-4">
					<h3>
						You haven't configured remote config yet. Do so through our{" "}
						<VSCodeLink href="https://app.cline.bot/dashboard/organization?tab=settings">dashboard</VSCodeLink>.
					</h3>

					<RefreshButton />
				</div>
			</BaseRemoteConfigSection>
		)
	}

	return null
}
