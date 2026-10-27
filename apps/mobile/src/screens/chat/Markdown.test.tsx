import { Linking } from "react-native";
import { act, type ReactTestRendererJSON } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { flattenStyle } from "../../ui/__testing__/rn-host";
import { Markdown } from "./Markdown";

/** Read host text once, preserving exactly the characters shown to the user. */
function textContent(node: ReactTestRendererJSON | string | null): string {
	if (node === null) return "";
	if (typeof node === "string") return node;
	return (node.children ?? []).map(textContent).join("");
}

describe("assistant Markdown", () => {
	it.each([
		"MOBILE_E2E_FOLLOWUP_OK",
		"MOBILE_E2E_READ_ONLY_OK",
		"snake_case_identifier and double__underscore__identifier",
		"v1_2_3 and résumé_été_fin and 中文_测试_结果",
		"trailing_name_ and _leading_name",
	])("preserves literal underscores in %s", (text) => {
		const screen = render(<Markdown text={text} />);
		expect(textContent(screen.json)).toBe(text);
		expect(
			screen.root.findAll(
				(node) =>
					node.type === "Text" &&
					flattenStyle(node.props.style).fontStyle === "italic",
			),
		).toHaveLength(0);
	});

	it("still renders underscore emphasis and strong text at word boundaries", () => {
		const screen = render(
			<Markdown text="(_italic_) and __bold__ plus _snake_case_!" />,
		);
		expect(textContent(screen.json)).toBe("(italic) and bold plus snake_case!");
		const styled = screen.root.findAll((node) => node.type === "Text");
		expect(
			styled
				.filter((node) => flattenStyle(node.props.style).fontStyle === "italic")
				.map((node) => node.props.children),
		).toEqual(["italic", "snake_case"]);
		expect(
			styled.some(
				(node) =>
					node.props.children === "bold" &&
					flattenStyle(node.props.style).fontWeight === "600",
			),
		).toBe(true);
	});

	it("retains asterisk emphasis inside words and literal code contents", () => {
		const screen = render(
			<Markdown text="a*b*c and a**bold**c with `MOBILE_E2E_OK`" />,
		);
		expect(textContent(screen.json)).toBe("abc and aboldc with MOBILE_E2E_OK");
		expect(
			screen.root.findAll(
				(node) =>
					node.type === "Text" &&
					node.props.children === "b" &&
					flattenStyle(node.props.style).fontStyle === "italic",
			),
		).toHaveLength(1);
	});

	it("keeps links with underscore labels and URLs intact and opens the URL", async () => {
		vi.mocked(Linking.openURL).mockClear();
		const screen = render(
			<Markdown text="[read_the_docs](https://example.com/snake_case_path)" />,
		);
		expect(textContent(screen.json)).toBe("read_the_docs");
		const link = screen.root.find(
			(node) => node.type === "Text" && node.props.accessibilityRole === "link",
		);
		await act(async () => link.props.onPress());
		expect(Linking.openURL).toHaveBeenCalledExactlyOnceWith(
			"https://example.com/snake_case_path",
		);
	});
});
