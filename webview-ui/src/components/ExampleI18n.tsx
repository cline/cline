import { useTranslation } from "react-i18next"
import { useLanguage } from "../hooks/useLanguage"

export const ExampleComponent = () => {
	const { t } = useTranslation()
	useLanguage()

	return (
		<div>
			<h1>{t("welcome")}</h1>
			<button>{t("newTask")}</button>
			<button>{t("settings")}</button>
		</div>
	)
}
