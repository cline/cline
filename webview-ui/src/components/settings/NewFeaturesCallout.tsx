import { Sparkles, X } from "lucide-react"
import { useState } from "react"

interface NewFeature {
	id: string
	label: string
	description: string
}

interface NewFeaturesCalloutProps {
	features: NewFeature[]
	onDismiss?: () => void
}

export const NewFeaturesCallout = ({ features, onDismiss }: NewFeaturesCalloutProps) => {
	const [dismissed, setDismissed] = useState(false)

	if (dismissed || features.length === 0) return null

	const handleDismiss = () => {
		setDismissed(true)
		onDismiss?.()
	}

	return (
		<div
			className="relative mb-6 rounded-md p-4"
			style={{
				border: "1px solid color-mix(in srgb, var(--vscode-button-background) 30%, transparent)",
				backgroundColor: "color-mix(in srgb, var(--vscode-button-background) 10%, transparent)",
			}}>
			<button
				aria-label="Dismiss"
				className="absolute top-2 right-2 p-1 rounded hover:bg-white/10 transition-colors"
				onClick={handleDismiss}
				style={{ color: "var(--vscode-descriptionForeground)" }}>
				<X className="w-4 h-4" />
			</button>

			<div className="flex items-start gap-3">
				<div className="flex-shrink-0 mt-0.5">
					<Sparkles className="w-5 h-5" style={{ color: "var(--vscode-button-background)" }} />
				</div>

				<div className="flex-1">
					<h3 className="text-sm font-semibold mb-2" style={{ color: "var(--vscode-foreground)" }}>
						New Features Available
					</h3>

					<ul className="space-y-2">
						{features.map((feature) => (
							<li className="text-xs" key={feature.id}>
								<span className="font-medium" style={{ color: "var(--vscode-foreground)" }}>
									{feature.label}
								</span>
								<span style={{ color: "var(--vscode-descriptionForeground)" }}> — {feature.description}</span>
							</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	)
}

export type { NewFeature }
