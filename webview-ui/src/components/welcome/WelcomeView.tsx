import { BooleanRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Globe, Sparkles, Terminal, Wrench } from "lucide-react"
import { memo, useEffect, useState } from "react"
import AiHydroLogoVariable from "@/assets/AiHydroLogoVariable"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

const features = [
	{
		icon: Sparkles,
		label: "Agentic Coding",
		description: "Plan, edit, and iterate across projects",
		color: "#6BB6FF",
	},
	{
		icon: Terminal,
		label: "Terminal Commands",
		description: "Execute with your approval",
		color: "#50C878",
	},
	{
		icon: Globe,
		label: "Browser Access",
		description: "Research & navigate the web",
		color: "#48D1CC",
	},
	{
		icon: Wrench,
		label: "MCP Tools",
		description: "Create & extend capabilities",
		color: "#20E3E3",
	},
]

const WelcomeView = memo(() => {
	const { apiConfiguration, environment, mode } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to update API configuration or complete welcome view:", error)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration))
	}, [apiConfiguration, mode])

	return (
		<div className="fixed inset-0 p-0 flex flex-col bg-[var(--vscode-editor-background)]">
			{/* Animated background gradient */}
			<div className="absolute inset-0 opacity-30">
				<div className="absolute inset-0 bg-gradient-to-br from-aihydro-ocean-dark/40 via-transparent to-aihydro-teal/20 animate-gradient-shift welcome-gradient-bg" />
			</div>

			<div className="relative h-full px-6 overflow-auto custom-scrollbar">
				<div className="max-w-xl mx-auto py-12 flex flex-col items-center">
					{/* Hero Logo */}
					<div className="animate-float mb-6">
						<div className="relative">
							<AiHydroLogoVariable className="size-20 drop-shadow-sm" environment={environment} />
							<div className="absolute -inset-4 rounded-full bg-gradient-to-br from-aihydro-ocean-blue/15 to-aihydro-teal/15 blur-2xl -z-10" />
						</div>
					</div>

					{/* Title */}
					<h1 className="text-2xl font-semibold text-[var(--vscode-foreground)] mb-2 text-center animate-fade-in-up">
						Hi, I'm{" "}
						<span className="bg-gradient-to-r from-aihydro-ocean-light to-aihydro-teal-light bg-clip-text text-transparent">
							AI-Hydro
						</span>
					</h1>
					<p className="text-sm text-[var(--vscode-descriptionForeground)] text-center mb-8 max-w-md animate-fade-in-up stagger-1">
						Your intelligent assistant for hydrology research, coding, and scientific workflows.
					</p>

					{/* Feature Pills */}
					<div className="flex flex-wrap justify-center gap-2 mb-8 animate-fade-in-up stagger-2">
						{features.map((feature) => (
							<div
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--vscode-badge-background)]/50 border border-[var(--vscode-panel-border)]/50 text-xs text-[var(--vscode-foreground)] transition-all duration-200 hover:border-aihydro-ocean-blue/40 hover:bg-aihydro-ocean-blue/10"
								key={feature.label}>
								<feature.icon className="welcome-feature-icon" size={13} style={{ color: feature.color }} />
								<span className="font-medium">{feature.label}</span>
							</div>
						))}
					</div>

					{/* Description Card */}
					<div className="w-full rounded-xl border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]/80 backdrop-blur-sm p-5 mb-8 animate-fade-in-up stagger-3">
						<p className="text-sm text-[var(--vscode-foreground)] leading-relaxed text-center">
							AI-Hydro helps you move from hydrology questions to working artifacts: exploring projects, editing
							files, running analyses, using the browser, and executing terminal commands{" "}
							<i className="text-[var(--vscode-descriptionForeground)]">(only when you approve)</i>. With{" "}
							<VSCodeLink className="inline" href="https://modelcontextprotocol.io/">
								MCP
							</VSCodeLink>
							, it can connect to specialized tools for watershed modeling, data workflows, and reproducible
							research.
						</p>
					</div>

					{/* Setup Section */}
					<div className="w-full animate-fade-in-up stagger-4">
						<div className="flex items-center gap-2 mb-4">
							<div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--vscode-panel-border)] to-transparent" />
							<span className="text-xs font-medium text-[var(--vscode-descriptionForeground)] uppercase tracking-wider">
								Configure a model provider to get started
							</span>
							<div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--vscode-panel-border)] to-transparent" />
						</div>

						<div className="rounded-xl border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]/60 p-5">
							<ApiOptions currentMode={mode} showModelOptions={false} />
						</div>

						<div className="flex justify-center mt-6">
							<VSCodeButton
								className="animate-glow-pulse welcome-lets-go-btn"
								disabled={disableLetsGoButton}
								onClick={handleSubmit}>
								Let's go!
							</VSCodeButton>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
