import React, { useEffect, useState } from "react"
import { Cloud, Hammer, Plus, SquarePen } from "lucide-react"
import type { CloudAgent } from "@roo-code/types"
import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"

const CloudAgents: React.FC = () => {
	const { t } = useTranslation()
	const { cloudIsAuthenticated, cloudUserInfo, cloudApiUrl } = useExtensionState()
	const [agents, setAgents] = useState<CloudAgent[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState(false)

	useEffect(() => {
		const getCloudAgents = () => {
			// Only fetch agents if user is authenticated
			if (!cloudIsAuthenticated) {
				setAgents([])
				setLoading(false)
				setError(false)
				return
			}

			setLoading(true)
			setError(false)
			vscode.postMessage({ type: "getCloudAgents" })
		}

		// Set up message listener for the response
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "cloudAgents") {
				if (message.error) {
					setError(true)
					setAgents([])
				} else {
					setAgents(message.agents || [])
				}

				setLoading(false)
			}
		}

		window.addEventListener("message", handleMessage)
		getCloudAgents()

		// Cleanup listener on unmount
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [cloudIsAuthenticated, cloudUserInfo?.organizationId]) // agents is excluded intentionally as it's set by the response

	if (!cloudIsAuthenticated || error) {
		return null
	}

	// Don't show loading state, just render nothing until data is ready
	if (loading) {
		return null
	}

	const handleAgentClick = (agentId: string) => {
		vscode.postMessage({ type: "openExternal", url: `${cloudApiUrl}/cloud-agents/${agentId}/run` })
	}

	const handleCreateClick = () => {
		vscode.postMessage({ type: "openExternal", url: `${cloudApiUrl}/cloud-agents/create` })
	}

	return (
		<div className="flex flex-col gap-3 mt-6 w-full">
			<div className="flex flex-wrap items-center justify-between mt-4 mb-1">
				<h2 className="font-semibold text-lg shrink-0 m-0">{t("chat:cloudAgents.title")}</h2>
				{agents.length > 0 && (
					<button
						onClick={handleCreateClick}
						className="text-base flex items-center gap-1 text-vscode-descriptionForeground hover:text-vscode-textLink-foreground transition-colors cursor-pointer"
						title={t("chat:cloudAgents.create")}>
						<Plus className="h-4 w-4" />
						{t("chat:cloudAgents.create")}
					</button>
				)}
			</div>

			{agents.length === 0 ? (
				<div className="flex items-center gap-3 px-4 rounded-xl bg-vscode-editor-background">
					<Cloud className="size-5 shrink-0" />
					<p className="text-base text-vscode-descriptionForeground">
						{t("chat:cloudAgents.description")}
						<button
							className="inline-flex ml-1 cursor-pointer text-vscode-textLink-foreground hover:underline"
							onClick={handleCreateClick}>
							{t("chat:cloudAgents.createFirst")}
						</button>
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-1">
					{agents.map((agent) => (
						<div
							key={agent.id}
							className="flex items-center relative group gap-2 px-4 py-3 rounded-xl bg-vscode-editor-background hover:bg-vscode-list-hoverBackground cursor-pointer transition-colors"
							onClick={() => handleAgentClick(agent.id)}
							aria-label={t("chat:cloudAgents.clickToRun", { name: agent.name })}>
							{agent.icon ? (
								<span
									className="text-xl size-5 bg-foreground"
									role="img"
									aria-label={agent.type}
									style={{
										mask: `url('${agent.icon}') no-repeat center`,
										maskSize: "contain",
									}}></span>
							) : (
								<Hammer className="size-5 text-vscode-descriptionForeground shrink-0" />
							)}
							<div className="flex-1 min-w-0">
								<div className="text-base font-medium text-vscode-foreground truncate">
									{agent.name}
								</div>
								<div className="text-sm font-light text-vscode-descriptionForeground">{agent.type}</div>
							</div>
							<SquarePen className="size-4 opacity-0 group-hover:opacity-100 transition-opacity" />
						</div>
					))}
				</div>
			)}
		</div>
	)
}

export default CloudAgents
