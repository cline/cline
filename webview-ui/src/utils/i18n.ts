// See https://github.com/tc39/ecma402/issues/703
const languageMap: { [key: string]: string } = {
	en: "en-US",
	ja: "ja-JP-u-ca-japanese",
	"zh-cn": "zh-u-ca-chinese-nu-hanidec",
	"zh-CN": "zh-u-ca-chinese-nu-hanidec",
	"zh-tw": "zh-u-ca-chinese-nu-hanidec",
	"zh-TW": "zh-u-ca-chinese-nu-hanidec",
	de: "de-DE",
	es: "es-ES",
}

// Translate language code for common JS libraries
function translateLanguageCode(code: string): string {
	const lowerCaseCode = code.toLowerCase()
	return languageMap[lowerCaseCode] || code
}

export { translateLanguageCode }
