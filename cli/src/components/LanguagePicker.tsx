/**
 * Language picker component for user preference
 */

import React, { useMemo } from "react"
import { SearchableList, SearchableListItem } from "./SearchableList"

// Available languages - English names only to avoid Unicode rendering issues
const LANGUAGES = [
	"English",
	"Arabic",
	"Czech",
	"French",
	"German",
	"Hindi",
	"Hungarian",
	"Italian",
	"Japanese",
	"Korean",
	"Polish",
	"Portuguese (Brazil)",
	"Portuguese (Portugal)",
	"Russian",
	"Simplified Chinese",
	"Spanish",
	"Traditional Chinese",
	"Turkish",
]

interface LanguagePickerProps {
	onSelect: (language: string) => void
	isActive?: boolean
}

export const LanguagePicker: React.FC<LanguagePickerProps> = ({ onSelect, isActive = true }) => {
	const items: SearchableListItem[] = useMemo(
		() =>
			LANGUAGES.map((lang) => ({
				id: lang,
				label: lang,
			})),
		[],
	)

	return <SearchableList isActive={isActive} items={items} onSelect={(item) => onSelect(item.id)} />
}
