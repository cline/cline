import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Globe, Sparkles, Terminal, Wrench } from "lucide-react"
import { memo, useEffect, useState } from "react"

// AI-Hydro droplet logo SVG — the original brand icon
const AihydroLogo = () => (
	<svg className="drop-shadow-sm" fill="none" height="56" viewBox="0 0 100 100" width="56" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<linearGradient gradientUnits="userSpaceOnUse" id="dropletGrad" x1="50" x2="50" y1="10" y2="90">
				<stop offset="0%" stopColor="#00A3FF" />
				<stop offset="100%" stopColor="#00DDFF" />
			</linearGradient>
		</defs>
		<path d="M50 10 C50 10 25 35 25 55 C25 70 35 85 50 85 C65 85 75 70 75 55 C75 35 50 10 50 10 Z" fill="url(#dropletGrad)" />
		<ellipse cx="20" cy="52" fill="url(#dropletGrad)" rx="5" ry="7" />
		<ellipse cx="80" cy="52" fill="url(#dropletGrad)" rx="5" ry="7" />
		<ellipse cx="40" cy="48" fill="#1a1a2e" rx="6" ry="9" />
		<ellipse cx="60" cy="48" fill="#1a1a2e" rx="6" ry="9" />
		<path d="M 38 62 Q 50 68 62 62" fill="none" stroke="#1a1a2e" strokeLinecap="round" strokeWidth="3" />
		<circle cx="50" cy="14" fill="url(#dropletGrad)" r="4" />
	</svg>
)

import { BooleanRequest } from "@shared/proto/cline/common"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

const features = [
	{
		icon: Sparkles,
		label: "Agentic Coding",
		description: "Powered by Claude 4 Sonnet",
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
	const { apiConfiguration, mode } = useExtensionState()
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
							<div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-aihydro-ocean-blue to-aihydro-teal flex items-center justify-center shadow-lg shadow-aihydro-ocean-blue/20">
								{" "}
								<AihydroLogo />
							</div>
							<div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-aihydro-ocean-blue to-aihydro-teal opacity-20 blur-lg" />
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
							I can do all kinds of tasks thanks to breakthroughs in{" "}
							<VSCodeLink className="inline" href="https://www.anthropic.com/claude/sonnet">
								Claude 4 Sonnet's
							</VSCodeLink>{" "}
							agentic coding capabilities and access to tools that let me create & edit files, explore complex
							projects, use a browser, and execute terminal commands{" "}
							<i className="text-[var(--vscode-descriptionForeground)]">(with your permission, of course)</i>. I can
							even use MCP to create new tools and extend my own capabilities.
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
