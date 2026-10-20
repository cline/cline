import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState } from "react";

export function CloudConfirmContent(
	props: ChoiceContext<boolean> & { title: string; detail: string },
) {
	useDialogKeyboard((key) => {
		if (key.name === "y") {
			key.preventDefault();
			props.resolve(true);
		}
		if (key.name === "n" || key.name === "escape") {
			key.preventDefault();
			props.dismiss();
		}
	}, props.dialogId);
	return (
		<box flexDirection="column" padding={1} gap={1}>
			<text>{props.title}</text>
			<text fg="gray">{props.detail}</text>
			<text>Y to confirm · N/Esc to cancel</text>
		</box>
	);
}

export function CloudTextContent(
	props: ChoiceContext<string> & {
		title: string;
		detail?: string;
		initial?: string;
	},
) {
	const [text, setText] = useState(props.initial ?? "");
	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			key.preventDefault();
			props.dismiss();
		}
		if ((key.name === "return" || key.name === "enter") && text.trim()) {
			key.preventDefault();
			props.resolve(text);
		}
	}, props.dialogId);
	return (
		<box flexDirection="column" padding={1} gap={1}>
			<text>{props.title}</text>
			{props.detail && <text fg="gray">{props.detail}</text>}
			<input
				focused
				value={text}
				onInput={setText}
				placeholder="Enter text..."
			/>
			<text fg="gray">Enter to continue · Esc to cancel</text>
		</box>
	);
}

export function CloudChoiceContent(
	props: ChoiceContext<string> & {
		title: string;
		items: Array<{ id: string; label: string }>;
		initial?: string;
		detail?: string;
	},
) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(
		Math.max(
			0,
			props.items.findIndex((item) => item.id === props.initial),
		),
	);
	const items = props.items.filter((item) =>
		item.label.toLowerCase().includes(query.toLowerCase()),
	);
	const index = Math.min(selected, Math.max(0, items.length - 1));
	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			key.preventDefault();
			props.dismiss();
		}
		if (key.name === "up") {
			key.preventDefault();
			setSelected(Math.max(0, index - 1));
		}
		if (key.name === "down") {
			key.preventDefault();
			setSelected(Math.min(items.length - 1, index + 1));
		}
		if (key.name === "return" || key.name === "enter") {
			key.preventDefault();
			if (items[index]) props.resolve(items[index].id);
		}
	}, props.dialogId);
	const start = Math.max(0, index - 5);
	return (
		<box flexDirection="column" padding={1} gap={1}>
			<text>{props.title}</text>
			{props.detail && <text fg="gray">{props.detail}</text>}
			<input
				focused
				value={query}
				onInput={(value) => {
					setQuery(value);
					setSelected(0);
				}}
				placeholder="Filter..."
			/>
			{items.slice(start, start + 12).map((item, offset) => (
				<text key={item.id} fg={start + offset === index ? "cyan" : undefined}>
					{start + offset === index ? "> " : "  "}
					{item.label}
				</text>
			))}
			{items.length === 0 && <text>No matching choices.</text>}
			<text fg="gray">↑↓ choose · Enter select · Esc cancel</text>
		</box>
	);
}
