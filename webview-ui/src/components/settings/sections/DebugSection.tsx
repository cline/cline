import { createRollingLatencyStats, type LatencySample } from "@shared/LatencyObserver"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient, UiServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface DebugSectionProps {
	onResetState: (resetGlobalState?: boolean) => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const DebugSection = ({ onResetState, renderSectionHeader }: DebugSectionProps) => {
	const { setShowWelcome } = useExtensionState()
	const [payloadBytes, setPayloadBytes] = useState(0)
	const [samples, setSamples] = useState<LatencySample[]>([])
	const [isPinging, setIsPinging] = useState(false)
	const [pingError, setPingError] = useState<string | null>(null)

	const stats = useMemo(() => createRollingLatencyStats(samples), [samples])

	const runPing = async () => {
		setIsPinging(true)
		setPingError(null)
		const startedAt = performance.now()

		try {
			await UiServiceClient.pingLatencyProbe({ value: new Uint8Array(payloadBytes) })
			const endedAt = performance.now()
			setSamples((current) => [
				...current,
				{
					startedAt,
					endedAt,
					durationMs: endedAt - startedAt,
					payloadBytes,
				},
			])
		} catch (error) {
			setPingError(error instanceof Error ? error.message : String(error))
		} finally {
			setIsPinging(false)
		}
	}

	return (
		<div>
			{renderSectionHeader("debug")}
			<Section>
				<div className="flex flex-col gap-3">
					<h4 className="m-0 text-sm font-medium">Latency Observer</h4>
					<label className="flex flex-col gap-1 text-xs text-(--vscode-descriptionForeground)">
						<span>Ping payload bytes</span>
						<input
							aria-label="Ping payload bytes"
							className="bg-input text-foreground border border-input rounded px-2 py-1"
							min={0}
							onChange={(event) => setPayloadBytes(Math.max(0, Number(event.target.value) || 0))}
							type="number"
							value={payloadBytes}
						/>
					</label>
					<div className="flex gap-2">
						<Button disabled={isPinging} onClick={runPing} variant="secondary">
							{isPinging ? "Pinging..." : "Run Ping Probe"}
						</Button>
						<Button onClick={() => setSamples([])} variant="ghost">
							Reset Stats
						</Button>
					</div>
					<div className="grid grid-cols-2 gap-2 text-xs">
						<div>Samples: {stats.count}</div>
						<div>Last: {stats.lastMs?.toFixed(2) ?? "-"} ms</div>
						<div>Min: {stats.minMs?.toFixed(2) ?? "-"} ms</div>
						<div>Max: {stats.maxMs?.toFixed(2) ?? "-"} ms</div>
						<div>Avg: {stats.avgMs?.toFixed(2) ?? "-"} ms</div>
						<div>Payload: {payloadBytes} bytes</div>
					</div>
					{pingError && <p className="m-0 text-xs text-[var(--vscode-errorForeground)]">{pingError}</p>}
				</div>
			</Section>
			<Section>
				<Button onClick={() => onResetState()} variant="error">
					Reset Workspace State
				</Button>
				<Button onClick={() => onResetState(true)} variant="error">
					Reset Global State
				</Button>
				<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
					This will reset all global state and secret storage in the extension.
				</p>
			</Section>
			<Section>
				<Button
					onClick={async () =>
						await StateServiceClient.setWelcomeViewCompleted({ value: false })
							.catch(() => {})
							.finally(() => setShowWelcome(true))
					}
					variant="secondary">
					Reset Onboarding State
				</Button>
			</Section>
		</div>
	)
}

export default DebugSection
