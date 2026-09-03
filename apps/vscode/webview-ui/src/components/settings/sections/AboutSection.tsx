import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import Section from "../Section"

interface AboutSectionProps {
	version: string
	extensionVariant?: "legacy" | "next"
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const VARIANT_LABEL_KEYS: Record<"legacy" | "next", string> = {
	legacy: "settings:about.variantLegacy",
	next: "settings:about.variantNext",
}

const AboutSection = ({ version, extensionVariant, renderSectionHeader }: AboutSectionProps) => {
	const { t } = useTranslation()
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">
						Cline v{version}
						{extensionVariant && (
							<span className="ml-2 text-sm font-normal text-description">
								({t(VARIANT_LABEL_KEYS[extensionVariant])})
							</span>
						)}
					</h2>
					<p>{t("settings:about.description")}</p>

					<h3 className="text-md font-semibold">{t("settings:about.communitySupport")}</h3>
					<p>
						<VSCodeLink href="https://x.com/cline">X</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://discord.gg/cline">Discord</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://www.reddit.com/r/cline/"> r/cline</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">{t("settings:about.development")}</h3>
					<p>
						<VSCodeLink href="https://github.com/cline/cline">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/issues"> {t("settings:about.issues")}</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop">
							{" "}
							{t("settings:about.featureRequests")}
						</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">{t("settings:about.resources")}</h3>
					<p>
						<VSCodeLink href="https://docs.cline.bot/">{t("settings:about.documentation")}</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://cline.bot/">https://cline.bot</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
