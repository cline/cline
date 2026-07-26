import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">Bedrock Coder v{version}</h2>
					<p>
						A local-first coding agent for VS Code powered exclusively by Amazon Bedrock. It can inspect and edit
						files, explore projects, use the browser, and run terminal commands with your approval.
					</p>

					<h3 className="text-md font-semibold">Development</h3>
					<p>
						<VSCodeLink href="https://github.com/FFFalexgo/AWS_Bedrock_Coder">GitHub</VSCodeLink>
						{" · "}
						<VSCodeLink href="https://github.com/FFFalexgo/AWS_Bedrock_Coder/issues">Issues</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Resources</h3>
					<p>
						<VSCodeLink href="https://github.com/FFFalexgo/AWS_Bedrock_Coder#readme">Documentation</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
