import type { BannerAction, BannerCardData } from "@shared/cline/banner"
import React from "react"
import Markdown from "react-markdown"

interface WhatsNewItemsProps {
	welcomeBanners?: BannerCardData[]
	onBannerAction?: (action: BannerAction) => void
	onClose: () => void
	inlineCodeStyle: React.CSSProperties
}

export const WhatsNewItems: React.FC<WhatsNewItemsProps> = ({ welcomeBanners, onBannerAction, onClose, inlineCodeStyle }) => {
	const hasWelcomeBanners = welcomeBanners && welcomeBanners.length > 0

	return (
		<ul className="text-sm pl-3 list-disc" style={{ color: "var(--vscode-descriptionForeground)" }}>
			{hasWelcomeBanners &&
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
				))}
		</ul>
	)
}

export default WhatsNewItems
