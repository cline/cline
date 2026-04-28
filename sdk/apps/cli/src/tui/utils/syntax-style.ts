import { RGBA, SyntaxStyle } from "@opentui/core";

let _instance: SyntaxStyle | null = null;

export function getSyntaxStyle(): SyntaxStyle {
	if (_instance) return _instance;
	_instance = SyntaxStyle.fromStyles({
		keyword: { fg: RGBA.fromHex("#c678dd"), bold: true },
		"keyword.control": { fg: RGBA.fromHex("#c678dd"), bold: true },
		"keyword.operator": { fg: RGBA.fromHex("#56b6c2") },
		type: { fg: RGBA.fromHex("#e5c07b") },
		"type.builtin": { fg: RGBA.fromHex("#e5c07b") },
		function: { fg: RGBA.fromHex("#61afef") },
		"function.method": { fg: RGBA.fromHex("#61afef") },
		variable: { fg: RGBA.fromHex("#e06c75") },
		"variable.parameter": { fg: RGBA.fromHex("#e06c75") },
		"variable.builtin": { fg: RGBA.fromHex("#e5c07b") },
		string: { fg: RGBA.fromHex("#98c379") },
		"string.special": { fg: RGBA.fromHex("#98c379") },
		number: { fg: RGBA.fromHex("#d19a66") },
		comment: { fg: RGBA.fromHex("#5c6370"), italic: true },
		operator: { fg: RGBA.fromHex("#56b6c2") },
		punctuation: { fg: RGBA.fromHex("#abb2bf") },
		property: { fg: RGBA.fromHex("#e06c75") },
		constant: { fg: RGBA.fromHex("#d19a66") },
		tag: { fg: RGBA.fromHex("#e06c75") },
		attribute: { fg: RGBA.fromHex("#d19a66") },
		escape: { fg: RGBA.fromHex("#56b6c2") },
	});
	return _instance;
}
