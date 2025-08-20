import Section from "../Section"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="text-center text-[var(--vscode-descriptionForeground)] text-xs leading-[1.2] px-0 py-0 pr-2 pb-[15px] mt-auto">
					<p className="break-words">
						<span className="text-sm">If you have any questions or feedback, feel free to open an issue at </span>
						<VSCodeLink href="https://github.com/cline/cline" className="inline">
							https://github.com/cline/cline
						</VSCodeLink>
					</p>
					<div className="flex flex-col my-4 text-sm">
						<span>Want to leave a review?</span>
						<div>
							<VSCodeLink
								href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev&ssr=false#review-details"
								className="inline">
								VSCode Marketplace
							</VSCodeLink>
							<span className="">•</span>
							<VSCodeLink href="https://open-vsx.org/extension/saoudrizwan/claude-dev/reviews" className="inline">
								Open VSX Registry
							</VSCodeLink>
						</div>
					</div>
					<p className="italic mt-[10px] mb-0 p-0">v{version}</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
