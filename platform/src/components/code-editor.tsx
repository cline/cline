"use client";

import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

function extensionFor(path: string | null) {
	const ext = path?.split(".").pop()?.toLowerCase() ?? "";
	switch (ext) {
		case "ts":
		case "tsx":
			return javascript({ typescript: true, jsx: ext === "tsx" });
		case "js":
		case "jsx":
		case "mjs":
		case "cjs":
			return javascript({ jsx: ext === "jsx" });
		case "py":
			return python();
		case "java":
			return java();
		case "c":
		case "h":
		case "cc":
		case "cpp":
		case "hpp":
			return cpp();
		case "go":
			return go();
		case "rs":
			return rust();
		case "php":
			return php();
		case "html":
		case "htm":
		case "vue":
			return html();
		case "css":
		case "scss":
			return css();
		case "json":
			return json();
		case "md":
		case "mdx":
			return markdown();
		default:
			return null;
	}
}

export function CodeEditor({
	path,
	value,
	onChange,
	readOnly,
	height = "520px",
}: {
	path: string | null;
	value: string;
	onChange?: (value: string) => void;
	readOnly?: boolean;
	height?: string;
}) {
	const extensions = useMemo(() => {
		const ext = extensionFor(path);
		return ext ? [ext] : [];
	}, [path]);

	return (
		<div className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#0a0d12]">
			<CodeMirror
				value={value}
				height={height}
				theme={oneDark}
				extensions={extensions}
				onChange={onChange}
				readOnly={readOnly}
				basicSetup={{
					lineNumbers: true,
					foldGutter: true,
					highlightActiveLine: !readOnly,
					highlightActiveLineGutter: !readOnly,
					autocompletion: false,
				}}
				className="text-[0.8rem]"
			/>
		</div>
	);
}
