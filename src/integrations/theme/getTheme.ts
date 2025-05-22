import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { convertTheme } from "monaco-vscode-textmate-theme-converter/lib/cjs"

import { Package } from "../../schemas"

const defaultThemes: Record<string, string> = {
	"Default Dark Modern": "dark_modern",
	"Dark+": "dark_plus",
	"Default Dark+": "dark_plus",
	"Dark (Visual Studio)": "dark_vs",
	"Visual Studio Dark": "dark_vs",
	"Dark High Contrast": "hc_black",
	"Default High Contrast": "hc_black",
	"Light High Contrast": "hc_light",
	"Default High Contrast Light": "hc_light",
	"Default Light Modern": "light_modern",
	"Light+": "light_plus",
	"Default Light+": "light_plus",
	"Light (Visual Studio)": "light_vs",
	"Visual Studio Light": "light_vs",
}

function parseThemeString(themeString: string | undefined): any {
	themeString = themeString
		?.split("\n")
		.filter((line) => {
			return !line.trim().startsWith("//")
		})
		.join("\n")
	return JSON.parse(themeString ?? "{}")
}

export async function getTheme() {
	let currentTheme = undefined
	const colorTheme = vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") || "Default Dark Modern"

	try {
		for (let i = vscode.extensions.all.length - 1; i >= 0; i--) {
			if (currentTheme) {
				break
			}
			const extension = vscode.extensions.all[i]
			if (extension.packageJSON?.contributes?.themes?.length > 0) {
				for (const theme of extension.packageJSON.contributes.themes) {
					if (theme.label === colorTheme) {
						const themePath = path.join(extension.extensionPath, theme.path)
						currentTheme = await fs.readFile(themePath, "utf-8")
						break
					}
				}
			}
		}

		if (currentTheme === undefined && defaultThemes[colorTheme]) {
			const filename = `${defaultThemes[colorTheme]}.json`
			currentTheme = await fs.readFile(
				path.join(getExtensionUri().fsPath, "integrations", "theme", "default-themes", filename),
				"utf-8",
			)
		}

		// Strip comments from theme
		let parsed = parseThemeString(currentTheme)

		if (parsed.include) {
			const includeThemeString = await fs.readFile(
				path.join(getExtensionUri().fsPath, "integrations", "theme", "default-themes", parsed.include),
				"utf-8",
			)
			const includeTheme = parseThemeString(includeThemeString)
			parsed = mergeJson(parsed, includeTheme)
		}

		const converted = convertTheme(parsed)

		converted.base = (
			["vs", "hc-black"].includes(converted.base)
				? converted.base
				: colorTheme.includes("Light")
					? "vs"
					: "vs-dark"
		) as any

		return converted
	} catch (e) {
		console.log("Error loading color theme: ", e)
	}
	return undefined
}

type JsonObject = { [key: string]: any }
export function mergeJson(
	first: JsonObject,
	second: JsonObject,
	mergeBehavior?: "merge" | "overwrite",
	mergeKeys?: { [key: string]: (a: any, b: any) => boolean },
): any {
	const copyOfFirst = JSON.parse(JSON.stringify(first))

	try {
		for (const key in second) {
			const secondValue = second[key]

			if (!(key in copyOfFirst) || mergeBehavior === "overwrite") {
				// New value
				copyOfFirst[key] = secondValue
				continue
			}

			const firstValue = copyOfFirst[key]
			if (Array.isArray(secondValue) && Array.isArray(firstValue)) {
				// Array
				if (mergeKeys?.[key]) {
					// Merge keys are used to determine whether an item form the second object should override one from the first
					const keptFromFirst: any[] = []
					firstValue.forEach((item: any) => {
						if (!secondValue.some((item2: any) => mergeKeys[key](item, item2))) {
							keptFromFirst.push(item)
						}
					})
					copyOfFirst[key] = [...keptFromFirst, ...secondValue]
				} else {
					copyOfFirst[key] = [...firstValue, ...secondValue]
				}
			} else if (typeof secondValue === "object" && typeof firstValue === "object") {
				// Object
				copyOfFirst[key] = mergeJson(firstValue, secondValue, mergeBehavior)
			} else {
				// Other (boolean, number, string)
				copyOfFirst[key] = secondValue
			}
		}
		return copyOfFirst
	} catch (e) {
		console.error("Error merging JSON", e, copyOfFirst, second)
		return {
			...copyOfFirst,
			...second,
		}
	}
}

function getExtensionUri(): vscode.Uri {
	return vscode.extensions.getExtension(`${Package.publisher}.${Package.name}`)!.extensionUri
}
