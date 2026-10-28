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

describe("GFM table and strike parity", () => {
	it("renders an aligned horizontal table with headers and inline formatting", () => {
		const { root, json } = render(
			<Markdown
				text={
					"| Name | Center | Amount |\n| :--- | :---: | ---: |\n| **alpha** | `code` | ~~old~~ |\n| beta | text | 42 |"
				}
			/>,
		);
		const table = root.find(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === "Table, 3 columns, 2 data rows",
		);
		expect(table.props.horizontal).toBe(true);
		expect(textContent(json)).toBe("NameCenterAmountalphacodeoldbetatext42");
		const headers = root.findAll(
			(node) =>
				node.type === "Text" && node.props.accessibilityRole === "header",
		);
		expect(headers).toHaveLength(3);
		expect(
			headers.map((node) => flattenStyle(node.props.style).textAlign),
		).toEqual(["left", "center", "right"]);
		expect(
			root
				.findAll(
					(node) =>
						node.type === "Text" &&
						flattenStyle(node.props.style).textDecorationLine ===
							"line-through",
				)
				.map((node) => node.props.children),
		).toEqual(["old"]);
	});
	it("keeps escaped pipes and code-span pipes inside cells without losing other content", () => {
		const { root, json } = render(
			<Markdown
				text={
					"Key | Value\n--- | ---\nleft\\|right | `a|b`\nempty |\n\nAfter table"
				}
			/>,
		);
		expect(textContent(json)).toBe("KeyValueleft|righta|bemptyAfter table");
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === "Table, 2 columns, 2 data rows",
			),
		).toHaveLength(1);
	});
	it("preserves fenced table/strike examples and prose pipes as literal text", () => {
		const source =
			"```md\n| Name | Value |\n| --- | --- |\n| ~~old~~ | a\\|b |\n```\n\nleft | right and ~~unfinished";
		const { root, json } = render(<Markdown text={source} />);
		expect(textContent(json)).toContain(
			"| Name | Value |\n| --- | --- |\n| ~~old~~ | a\\|b |",
		);
		expect(textContent(json)).toContain("left | right and ~~unfinished");
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					String(node.props.accessibilityLabel).startsWith("Table,"),
			),
		).toHaveLength(0);
	});
	it("leaves an unfinished delimiter literal and promotes it only when streaming completes", () => {
		const screen = render(<Markdown text={"| Name | Value |\n| -- | --- |"} />);
		expect(textContent(screen.renderer.toJSON())).toContain("| -- | --- |");
		expect(
			screen.root.findAll(
				(node) =>
					typeof node.type === "string" &&
					String(node.props.accessibilityLabel).startsWith("Table,"),
			),
		).toHaveLength(0);
		act(() =>
			screen.renderer.update(
				<Markdown
					text={"| Name | Value |\n| --- | --- |\n| alpha | partial"}
				/>,
			),
		);
		expect(textContent(screen.renderer.toJSON())).toBe("NameValuealphapartial");
	});
	it("does not drop overflow cells from malformed rows or turn mismatched delimiters into tables", () => {
		const { json } = render(
			<Markdown
				text={
					"A | B\n--- | ---\none | two | preserve_extra\n\nC | D\n--- | --- | ---\nthree | four"
				}
			/>,
		);
		expect(textContent(json)).toContain("one | two | preserve_extra");
		expect(textContent(json)).toContain("C | D --- | --- | --- three | four");
	});
	it("strikes completed text while keeping code, escaped markers and partial spans literal", () => {
		const { root, json } = render(
			<Markdown
				text={"~~removed words~~ `~~code~~` \\~~literal~~ ~~partial ~single~"}
			/>,
		);
		expect(textContent(json)).toBe(
			"removed words ~~code~~ \\~~literal~~ ~~partial ~single~",
		);
		expect(
			root
				.findAll(
					(node) =>
						node.type === "Text" &&
						flattenStyle(node.props.style).textDecorationLine ===
							"line-through",
				)
				.map((node) => node.props.children),
		).toEqual(["removed words"]);
	});
});

it("keeps unmatched streaming strike delimiters linear even in a very long paragraph", () => {
	const text = "~~a ".repeat(64_000);
	const started = performance.now();
	const screen = render(<Markdown text={text} />);
	const duration = performance.now() - started;
	expect(textContent(screen.json)).toBe(text.trim());
	expect(
		screen.root.findAll(
			(node) =>
				node.type === "Text" &&
				flattenStyle(node.props.style).textDecorationLine === "line-through",
		),
	).toHaveLength(0);
	// The old backtracking matcher takes several seconds for this input; leave
	// ample margin for slower CI while guarding that user-visible freeze.
	expect(duration).toBeLessThan(1500);
});

it("pairs completed strike delimiters without interpreting code or escaped markers", () => {
	const screen = render(
		<Markdown
			text={
				"~~first~~ then `~~code~~` and \\~~literal~~ then ~~second~~; ~~ leading~~; ~~trailing ~~"
			}
		/>,
	);
	expect(textContent(screen.json)).toBe(
		"first then ~~code~~ and \\~~literal~~ then second; ~~ leading~~; ~~trailing ~~",
	);
	expect(
		screen.root
			.findAll(
				(node) =>
					node.type === "Text" &&
					flattenStyle(node.props.style).textDecorationLine === "line-through",
			)
			.map((node) => node.props.children),
	).toEqual(["first", "second"]);
});
