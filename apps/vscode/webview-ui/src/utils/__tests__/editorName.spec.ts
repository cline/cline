import { describe, expect, it } from "vitest"
import { editorName } from "../editorName"

describe("editorName", () => {
	it.each([
		["Visual Studio Code", "VS Code"],
		["Visual Studio Code - Insiders", "VS Code Insiders"],
		["Cursor", "Cursor"],
		["Windsurf", "Windsurf"],
		["IntelliJ IDEA Ultimate", "IntelliJ IDEA"],
		["PyCharm Professional", "PyCharm"],
		["PyCharm Community", "PyCharm"],
		["WebStorm", "WebStorm"],
		["Android Studio", "Android Studio"],
	])("names %s as %s", (hostName, expected) => {
		expect(editorName(hostName)).toBe(expected)
	})

	it.each([undefined, "", "  "])("falls back to a generic name for %j", (hostName) => {
		expect(editorName(hostName)).toBe("your IDE")
	})
})
