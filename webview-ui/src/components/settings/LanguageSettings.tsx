import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Globe } from "lucide-react"

import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

const LANGUAGES: Record<string, string> = {
	ca: "Català",
	de: "Deutsch",
	en: "English",
	es: "Español",
	fr: "Français",
	hi: "हिन्दी",
	it: "Italiano",
	ja: "日本語",
	ko: "한국어",
	pl: "Polski",
	"pt-BR": "Português",
	tr: "Türkçe",
	vi: "Tiếng Việt",
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文",
}

type LanguageSettingsProps = HTMLAttributes<HTMLDivElement> & {
	language: string
	setCachedStateField: SetCachedStateField<"language">
}

export const LanguageSettings = ({ language, setCachedStateField, className, ...props }: LanguageSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Globe className="w-4" />
					<div>{t("settings:sections.language")}</div>
				</div>
			</SectionHeader>

			<Section>
				<Select value={language} onValueChange={(value) => setCachedStateField("language", value)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{Object.entries(LANGUAGES).map(([code, name]) => (
								<SelectItem key={code} value={code}>
									{name}
									<span className="text-muted-foreground">({code})</span>
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Section>
		</div>
	)
}
