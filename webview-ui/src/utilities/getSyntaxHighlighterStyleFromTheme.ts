import * as defaultThemes from "react-syntax-highlighter/dist/esm/styles/prism"
import * as generatedThemes from "./vscode-themes"

/*
VSCode extension webviews have a notoriously difficult time syntax highlighting with styles from the user's theme. We don’t have access to css variables like --vscode-function-color that map to all the token styles react-syntax-highlighter expects. Fortunately, react-syntax-highlighter comes with many built-in themes that we can map to popular VSCode themes. We can also use the few editor css variables exposed to use like --vscode-editor-background (see CodeBlock.tsx), which 99% of the time results in syntax highlighting identical to how the user's editor looks. This approach avoids the overhead of using VSCode's Monaco editor and the monaco-vscode-textmate-theme-converter as some other extensions do, and allows us to take advantage of all the benefits of react-syntax-highlighter.
For themes that don't have a 1:1 match with react-syntax-highlighter built-in themes, we can use Claude to generate style objects based on the results from the "Developer: Generate Color Theme From Current Settings" command.

https://github.com/microsoft/vscode/issues/56356
*/

// See https://github.com/react-syntax-highlighter/react-syntax-highlighter/blob/master/AVAILABLE_STYLES_PRISM.MD for available styles react-syntax-highlighter provides
const defaultSyntaxHighlighterThemes: { [key: string]: string } = {
	// Vscode built-in
	"Default Dark Modern": "vscDarkPlus",
	"Dark+": "vscDarkPlus",
	"Default Dark+": "vscDarkPlus",
	"Dark (Visual Studio)": "vscDarkPlus",
	"Visual Studio Dark": "vscDarkPlus",
	"Dark High Contrast": "vscDarkPlus",
	"Default High Contrast": "vscDarkPlus",
	"Light High Contrast": "vs",
	"Default High Contrast Light": "vs", // FIXME: some text renders white
	"Default Light Modern": "vs",
	"Light+": "vs",
	"Default Light+": "vs",
	"Light (Visual Studio)": "vs",
	"Visual Studio Light": "vs",

	// Third party
	Anysphere: "nightOwl",
	Abyss: "materialOceanic",
	"Kimbie Dark": "cb",
	Monokai: "darcula",
	"Monokai Dimmed": "darcula",
	"Solarized Dark": "solarizedDarkAtom",
	"Solarized Light": "solarizedlight",
	"Quiet Light": "solarizedlight",
	"Tomorrow Night Blue": "lucario",
	Dracula: "dracula",
	"Dracula Theme": "dracula",
	"Dracula Theme Soft": "dracula",
	"Night Owl": "nightOwl",
	"Material Theme": "materialDark",
	"Material Theme Lighter": "materialLight",
	"Material Theme Lighter High Contrast": "materialLight",
	"One Dark Pro": "oneDark",
	"One Dark Pro Darker": "oneDark",
	"One Dark Pro Flat": "oneDark",
	"One Dark Pro Mix": "oneDark",
	"One Light": "oneLight",
	"Winter is Coming": "nord",
	"Atom One Dark": "oneDark",
	"SynthWave '84": "synthwave84",
}

// Themes that don't have an already provided 1:1 syntax highlighter style
// These style objects are built with Claude using the results from "Developer: Generate Color Theme From Current Settings" command
const generatedSyntaxHighlighterThemes: { [key: string]: string } = {
	"Github Dark": "githubDark",
	"GitHub Dark Colorblind (Beta)": "githubDark",
	"GitHub Dark Colorblind": "githubDark",
	"GitHub Dark Default": "githubDark",
	"GitHub Dark Dimmed": "githubDark",
	"GitHub Dark High Contrast": "githubDark",

	"Github Light": "githubLight",
	"GitHub Light Colorblind (Beta)": "githubLight",
	"GitHub Light Colorblind": "githubLight",
	"GitHub Light Default": "githubLight",
	"GitHub Light High Contrast": "githubLight",
}

export type SyntaxHighlighterStyle = { [key: string]: React.CSSProperties }

export function getSyntaxHighlighterStyleFromTheme(themeName: string): SyntaxHighlighterStyle | undefined {
	const defaultSyntaxHighlighterTheme = Object.entries(defaultSyntaxHighlighterThemes).find(([key]) =>
		key.toLowerCase().startsWith(themeName.toLowerCase())
	)?.[1]
	if (defaultSyntaxHighlighterTheme && defaultSyntaxHighlighterTheme in defaultThemes) {
		return defaultThemes[defaultSyntaxHighlighterTheme as keyof typeof defaultThemes]
	} else {
		const generatedSyntaxHighlighterTheme = Object.entries(generatedSyntaxHighlighterThemes).find(([key]) =>
			key.toLowerCase().startsWith(themeName.toLowerCase())
		)?.[1]
		if (generatedSyntaxHighlighterTheme && generatedSyntaxHighlighterTheme in generatedThemes) {
			return generatedThemes[generatedSyntaxHighlighterTheme as keyof typeof generatedThemes]
		}
	}
}
