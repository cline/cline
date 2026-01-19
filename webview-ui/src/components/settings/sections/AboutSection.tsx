import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { PLATFORM_CONFIG, PlatformType } from "../../../config/platform.config"
import { FileServiceClient } from "../../../services/grpc-client"
import { Button } from "../../ui/button"
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
					<h2 className="text-lg font-semibold">Cline v{version}</h2>
					<p>
						An AI assistant that can use your CLI and Editor. Cline can handle complex software development tasks
						step-by-step with tools that let him create & edit files, explore large projects, use the browser, and
						execute terminal commands (after you grant permission).
					</p>

					<h3 className="text-md font-semibold">Community & Support</h3>
					<p>
						<VSCodeLink href="https://x.com/cline">X</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://discord.gg/cline">Discord</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://www.reddit.com/r/cline/"> r/cline</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Development</h3>
					<p>
						<VSCodeLink href="https://github.com/cline/cline">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/issues"> Issues</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop">
							{" "}
							Feature Requests
						</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Resources</h3>
					<p>
						<VSCodeLink href="https://docs.cline.bot/">Documentation</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://cline.bot/">https://cline.bot</VSCodeLink>
					</p>

					{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
						<>
							<h3 className="text-md font-semibold">Logs</h3>
							<p className="text-sm text-(--vscode-descriptionForeground)">
								Cline writes detailed logs to help diagnose issues. Each session creates a separate log file. If
								you encounter an error, these logs can be shared with the Cline team for troubleshooting.
							</p>
							<p className="text-xs text-(--vscode-descriptionForeground)">Old logs are automatically removed.</p>

							<div className="flex flex-col gap-2 max-w-md">
								<Button
									className="w-full whitespace-normal min-h-[32px]"
									onClick={() => FileServiceClient.openLogFile({})}
									variant="secondary">
									Current Log
								</Button>
								<p className="text-xs text-(--vscode-descriptionForeground) -mt-1 ml-1">
									View the log file for this session
								</p>

								<Button
									className="w-full whitespace-normal min-h-[32px]"
									onClick={() => FileServiceClient.openLogsFolder({})}
									variant="secondary">
									All Logs
								</Button>
								<p className="text-xs text-(--vscode-descriptionForeground) -mt-1 ml-1">
									Browse all session logs in your file manager
								</p>
							</div>
						</>
					)}
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
