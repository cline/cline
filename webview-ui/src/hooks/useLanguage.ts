import { useEffect } from "react"
import { useTranslation } from "react-i18next"

export const useLanguage = () => {
	const { i18n } = useTranslation()

	useEffect(() => {
		// Get VS Code locale or default to Korean for testing
		const vscodeLocale = (window as any).vscodeLocale || "ko"
		const language = vscodeLocale.startsWith("ko") ? "ko" : "en"
		console.log("Setting language to:", language, "from vscodeLocale:", vscodeLocale)
		i18n.changeLanguage(language)
	}, [i18n])

	return { i18n }
}
