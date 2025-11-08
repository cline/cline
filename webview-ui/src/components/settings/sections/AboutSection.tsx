import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import Section from "../Section"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	const { t } = useTranslation("common")

	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">{t("settings.about.title", { version })}</h2>
					<p>{t("settings.about.description")}</p>

					<h3 className="text-md font-semibold">{t("settings.about.community_support")}</h3>
					<p>
						<VSCodeLink href="https://x.com/cline">{t("settings.about.x_link")}</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://discord.gg/cline">{t("settings.about.discord_link")}</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://www.reddit.com/r/cline/">{t("settings.about.reddit_link")}</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">{t("settings.about.development")}</h3>
					<p>
						<VSCodeLink href="https://github.com/cline/cline">{t("settings.about.github_link")}</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/issues">{t("settings.about.issues_link")}</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop">
							{t("settings.about.feature_requests_link")}
						</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">{t("settings.about.resources")}</h3>
					<p>
						<VSCodeLink href="https://docs.cline.bot/getting-started/for-new-coders">
							{t("settings.about.documentation_link")}
						</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://cline.bot/">{t("settings.about.website_link")}</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
