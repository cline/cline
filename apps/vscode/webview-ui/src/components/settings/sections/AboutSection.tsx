import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { FileServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface AboutSectionProps {
	version: string
	extensionVariant?: "legacy" | "next"
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const VARIANT_LABELS: Record<"legacy" | "next", string> = {
	legacy: "Legacy",
	next: "Next",
}

const AboutSection = ({ version, extensionVariant, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="rounded-xl bg-[#151618] border border-white/[0.08] p-5 flex flex-col gap-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2.5">
							<span className="text-[15px] font-semibold text-[#f2f4f7]">Cline Studio</span>
							<span className="font-geist-mono text-[11px] px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.07] text-[#b0b6bf]">
								v{version}
								{extensionVariant ? ` · ${VARIANT_LABELS[extensionVariant]}` : ""}
							</span>
						</div>
					</div>
					<p className="text-[13px] text-[#9aa0a8] leading-relaxed m-0">
						Autonomous coding agent workspace capable of reading and editing files, running shell commands, and
						collaborating step-by-step directly inside your local project.
					</p>
				</div>

				<div className="rounded-xl bg-[#151618] border border-white/[0.08] px-4 divide-y divide-white/[0.06] text-[13px]">
					<div className="py-3 flex items-center justify-between gap-4">
						<span className="text-[#858b94]">Source & Issues</span>
						<div className="flex items-center gap-3">
							<VSCodeLink href="https://github.com/cline/cline">GitHub</VSCodeLink>
							<VSCodeLink href="https://github.com/cline/cline/issues">Issues</VSCodeLink>
						</div>
					</div>
					<div className="py-3 flex items-center justify-between gap-4">
						<span className="text-[#858b94]">Documentation</span>
						<div className="flex items-center gap-3">
							<VSCodeLink href="https://docs.cline.bot/">Docs</VSCodeLink>
							<VSCodeLink href="https://cline.bot/">Website</VSCodeLink>
						</div>
					</div>
					{PLATFORM_CONFIG.supportsThirdPartyNotices && (
						<div className="py-3 flex items-center justify-between gap-4">
							<span className="text-[#858b94]">Licenses</span>
							<VSCodeLink
								href="#"
								onClick={(e) => {
									e.preventDefault()
									FileServiceClient.openThirdPartyNotices(EmptyRequest.create()).catch(console.error)
								}}>
								Third-Party Notices
							</VSCodeLink>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
