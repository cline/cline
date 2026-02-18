import type { BannerAction, BannerCardData } from "@shared/cline/banner"
import React from "react"
import Markdown from "react-markdown"

interface WhatsNewItemsProps {
	welcomeBanners?: BannerCardData[]
	onBannerAction?: (action: BannerAction) => void
	onClose: () => void
	inlineCodeStyle: React.CSSProperties
	onNavigateToModelPicker: (initialModelTab: "recommended" | "free", modelId?: string) => void
}

export const WhatsNewItems: React.FC<WhatsNewItemsProps> = ({
	welcomeBanners,
	onBannerAction,
	onClose,
	inlineCodeStyle,
	onNavigateToModelPicker,
}) => {
	const hasWelcomeBanners = welcomeBanners && welcomeBanners.length > 0

	return (
		<ul className="text-sm pl-3 list-disc" style={{ color: "var(--vscode-descriptionForeground)" }}>
			{hasWelcomeBanners ? (
				welcomeBanners.map((banner) => (
					<li className="mb-2" key={banner.id}>
						{banner.title && <strong>{banner.title}</strong>}{" "}
						{banner.description && (
							<Markdown
								components={{
									a: ({ href, children }) => (
										<a
											href={href}
											rel="noopener noreferrer"
											style={{ color: "var(--vscode-textLink-foreground)" }}
											target="_blank">
											{children}
										</a>
									),
									code: ({ children }) => <code style={inlineCodeStyle}>{children}</code>,
									p: ({ children }) => <p style={{ display: "inline", margin: 0 }}>{children}</p>,
								}}>
								{banner.description}
							</Markdown>
						)}
						{banner.actions && banner.actions.length > 0 && onBannerAction && (
							<span className="inline-flex gap-2 ml-2 align-middle">
								{banner.actions.map((action, idx) => (
									<a
										href="#"
										key={idx}
										onClick={(event) => {
											event.preventDefault()
											onBannerAction(action)
											onClose()
										}}
										style={{
											color: "var(--vscode-textLink-foreground)",
											cursor: "pointer",
										}}>
										{action.title}
									</a>
								))}
							</span>
						)}
					</li>
				))
			) : (
				<>
					{/* Hardcoded fallback items shown when remote welcome banners feature flag is off */}
					<li className="mb-2">
						<strong>Claude Sonnet 4.6 is here!</strong> Anthropic's latest model with advanced reasoning and coding
						performance. Free for 24 hours for Cline users.{" "}
						<span
							onClick={() => onNavigateToModelPicker("free", "anthropic/claude-sonnet-4.6")}
							style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
							Try now
						</span>
					</li>
					<li className="mb-2">
						<strong>GLM 5 is now available with free promo!</strong> the latest open-source SOTA model for advanced
						reasoning, coding, and agentic tasks.{" "}
						<span
							onClick={() => onNavigateToModelPicker("free", "z-ai/glm-5")}
							style={{ color: "var(--vscode-textLink-foreground)", cursor: "pointer" }}>
							Try now
						</span>
					</li>
					<li className="mb-2">
						<strong>Cline CLI 2.0:</strong> Major upgrade bringing interactive and autonomous agentic coding to your
						terminal. Install with <code style={inlineCodeStyle}>npm install -g cline</code>
						<a
							href="https://cline.bot/cli"
							rel="noopener noreferrer"
							style={{ color: "var(--vscode-textLink-foreground)" }}
							target="_blank">
							{" "}
							Learn more
						</a>
					</li>
					<li className="mb-2">
						<strong> Subagents experimental feature</strong> available in VSCode and the CLI.{" "}
						<a
							href="https://docs.cline.bot/features/subagents"
							rel="noopener noreferrer"
							style={{ color: "var(--vscode-textLink-foreground)" }}
							target="_blank">
							Learn more
						</a>
					</li>
				</>
			)}
		</ul>
	)
}

export default WhatsNewItems
