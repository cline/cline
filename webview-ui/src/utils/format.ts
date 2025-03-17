import i18next from "i18next"

export function formatLargeNumber(num: number): string {
	if (num >= 1e9) {
		return (num / 1e9).toFixed(1) + i18next.t("common:number_format.billion_suffix")
	}
	if (num >= 1e6) {
		return (num / 1e6).toFixed(1) + i18next.t("common:number_format.million_suffix")
	}
	if (num >= 1e3) {
		return (num / 1e3).toFixed(1) + i18next.t("common:number_format.thousand_suffix")
	}
	return num.toString()
}

export const formatDate = (timestamp: number) => {
	const date = new Date(timestamp)
	const locale = i18next.language || "en"

	// Get date format style from translations or use default transformations
	const dateStr = date.toLocaleString(locale, {
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	})

	// Apply transformations based on locale or use default
	if (locale === "en") {
		return dateStr.replace(", ", " ").replace(" at", ",").toUpperCase()
	}

	return dateStr.toUpperCase()
}
