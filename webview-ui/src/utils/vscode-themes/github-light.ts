const theme: { [key: string]: React.CSSProperties } = {
	'code[class*="language-"]': {
		background: "#ffffff",
		color: "#24292e",
		textShadow: "0 1px rgba(0, 0, 0, 0.3)",
		fontFamily: '"Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
		direction: "ltr",
		textAlign: "left",
		whiteSpace: "pre",
		wordSpacing: "normal",
		wordBreak: "normal",
		lineHeight: "1.5",
		MozTabSize: "2",
		OTabSize: "2",
		tabSize: "2",
		WebkitHyphens: "none",
		MozHyphens: "none",
		msHyphens: "none",
		hyphens: "none",
	},
	'pre[class*="language-"]': {
		background: "#ffffff",
		color: "#24292e",
		textShadow: "0 1px rgba(0, 0, 0, 0.3)",
		fontFamily: '"Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
		direction: "ltr",
		textAlign: "left",
		whiteSpace: "pre",
		wordSpacing: "normal",
		wordBreak: "normal",
		lineHeight: "1.5",
		MozTabSize: "2",
		OTabSize: "2",
		tabSize: "2",
		WebkitHyphens: "none",
		MozHyphens: "none",
		msHyphens: "none",
		hyphens: "none",
		padding: "1em",
		margin: "0.5em 0",
		overflow: "auto",
		borderRadius: "0.3em",
	},
	'code[class*="language-"]::-moz-selection': {
		background: "#0366d625",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"] *::-moz-selection': {
		background: "#0366d625",
		color: "inherit",
		textShadow: "none",
	},
	'pre[class*="language-"] *::-moz-selection': {
		background: "#0366d625",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"]::selection': {
		background: "#0366d625",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"] *::selection': {
		background: "#0366d625",
		color: "inherit",
		textShadow: "none",
	},
	'pre[class*="language-"] *::selection': {
		background: "#0366d625",
		color: "inherit",
		textShadow: "none",
	},
	':not(pre) > code[class*="language-"]': {
		padding: "0.2em 0.3em",
		borderRadius: "0.3em",
		whiteSpace: "normal",
	},
	comment: {
		color: "#6A737D",
		fontStyle: "italic",
	},
	prolog: {
		color: "#6A737D",
	},
	cdata: {
		color: "#6A737D",
	},
	doctype: {
		color: "#24292e",
	},
	punctuation: {
		color: "#24292e",
	},
	entity: {
		color: "#24292e",
		cursor: "help",
	},
	"attr-name": {
		color: "#6F42C1",
	},
	"class-name": {
		color: "#6F42C1",
	},
	boolean: {
		color: "#005CC5",
	},
	constant: {
		color: "#005CC5",
	},
	number: {
		color: "#005CC5",
	},
	atrule: {
		color: "#005CC5",
	},
	keyword: {
		color: "#D73A49",
	},
	property: {
		color: "#005CC5",
	},
	tag: {
		color: "#22863A",
	},
	symbol: {
		color: "#005CC5",
	},
	deleted: {
		color: "#B31D28",
		background: "#FFEEF0",
	},
	important: {
		color: "#D73A49",
	},
	selector: {
		color: "#22863A",
	},
	string: {
		color: "#032F62",
	},
	char: {
		color: "#032F62",
	},
	builtin: {
		color: "#005CC5",
	},
	inserted: {
		color: "#22863A",
		background: "#F0FFF4",
	},
	regex: {
		color: "#032F62",
	},
	"attr-value": {
		color: "#032F62",
	},
	"attr-value > .token.punctuation": {
		color: "#032F62",
	},
	variable: {
		color: "#E36209",
	},
	operator: {
		color: "#D73A49",
	},
	function: {
		color: "#6F42C1",
	},
	url: {
		color: "#005CC5",
	},
	"attr-value > .token.punctuation.attr-equals": {
		color: "#24292e",
	},
	"special-attr > .token.attr-value > .token.value.css": {
		color: "#24292e",
	},
	".language-css .token.selector": {
		color: "#22863A",
	},
	".language-css .token.property": {
		color: "#005CC5",
	},
	".language-css .token.function": {
		color: "#005CC5",
	},
	".language-css .token.url > .token.function": {
		color: "#005CC5",
	},
	".language-css .token.url > .token.string.url": {
		color: "#032F62",
	},
	".language-css .token.important": {
		color: "#D73A49",
	},
	".language-css .token.atrule .token.rule": {
		color: "#D73A49",
	},
	".language-javascript .token.operator": {
		color: "#D73A49",
	},
	".language-javascript .token.template-string > .token.interpolation > .token.interpolation-punctuation.punctuation":
		{
			color: "#B31D28",
		},
	".language-json .token.operator": {
		color: "#24292e",
	},
	".language-json .token.null.keyword": {
		color: "#005CC5",
	},
	".language-markdown .token.url": {
		color: "#24292e",
	},
	".language-markdown .token.url > .token.operator": {
		color: "#24292e",
	},
	".language-markdown .token.url-reference.url > .token.string": {
		color: "#24292e",
	},
	".language-markdown .token.url > .token.content": {
		color: "#005CC5",
	},
	".language-markdown .token.url > .token.url": {
		color: "#005CC5",
	},
	".language-markdown .token.url-reference.url": {
		color: "#005CC5",
	},
	".language-markdown .token.blockquote.punctuation": {
		color: "#6A737D",
		fontStyle: "italic",
	},
	".language-markdown .token.hr.punctuation": {
		color: "#6A737D",
		fontStyle: "italic",
	},
	".language-markdown .token.code-snippet": {
		color: "#032F62",
	},
	".language-markdown .token.bold .token.content": {
		color: "#005CC5",
	},
	".language-markdown .token.italic .token.content": {
		color: "#6F42C1",
	},
	".language-markdown .token.strike .token.content": {
		color: "#B31D28",
	},
	".language-markdown .token.strike .token.punctuation": {
		color: "#B31D28",
	},
	".language-markdown .token.list.punctuation": {
		color: "#B31D28",
	},
	".language-markdown .token.title.important > .token.punctuation": {
		color: "#B31D28",
	},
	bold: {
		fontWeight: "bold",
	},
	italic: {
		fontStyle: "italic",
	},
	namespace: {
		opacity: "0.8",
	},
	"token.tab:not(:empty):before": {
		color: "#24292e33",
		textShadow: "none",
	},
	"token.cr:before": {
		color: "#24292e33",
		textShadow: "none",
	},
	"token.lf:before": {
		color: "#24292e33",
		textShadow: "none",
	},
	"token.space:before": {
		color: "#24292e33",
		textShadow: "none",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item": {
		marginRight: "0.4em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button": {
		background: "#f6f8fa",
		color: "#24292e",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a": {
		background: "#f6f8fa",
		color: "#24292e",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span": {
		background: "#f6f8fa",
		color: "#24292e",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:hover": {
		background: "#e1e4e8",
		color: "#2f363d",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:focus": {
		background: "#e1e4e8",
		color: "#2f363d",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:hover": {
		background: "#e1e4e8",
		color: "#2f363d",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:focus": {
		background: "#e1e4e8",
		color: "#2f363d",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:hover": {
		background: "#e1e4e8",
		color: "#2f363d",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:focus": {
		background: "#e1e4e8",
		color: "#2f363d",
	},
	".line-highlight.line-highlight": {
		background: "#f6f8fa",
	},
	".line-highlight.line-highlight:before": {
		background: "#f6f8fa",
		color: "#24292e",
		padding: "0.1em 0.6em",
		borderRadius: "0.3em",
		boxShadow: "0 2px 0 0 rgba(0, 0, 0, 0.2)",
	},
	".line-highlight.line-highlight[data-end]:after": {
		background: "#f6f8fa",
		color: "#24292e",
		padding: "0.1em 0.6em",
		borderRadius: "0.3em",
		boxShadow: "0 2px 0 0 rgba(0, 0, 0, 0.2)",
	},
	"pre[id].linkable-line-numbers.linkable-line-numbers span.line-numbers-rows > span:hover:before": {
		backgroundColor: "#f6f8fa",
	},
	".line-numbers.line-numbers .line-numbers-rows": {
		borderRightColor: "#e1e4e8",
	},
	".command-line .command-line-prompt": {
		borderRightColor: "#e1e4e8",
	},
	".line-numbers .line-numbers-rows > span:before": {
		color: "#1b1f234d",
	},
	".command-line .command-line-prompt > span:before": {
		color: "#1b1f234d",
	},
	".rainbow-braces .token.token.punctuation.brace-level-1": {
		color: "#B31D28",
	},
	".rainbow-braces .token.token.punctuation.brace-level-5": {
		color: "#B31D28",
	},
	".rainbow-braces .token.token.punctuation.brace-level-9": {
		color: "#B31D28",
	},
	".rainbow-braces .token.token.punctuation.brace-level-2": {
		color: "#22863A",
	},
	".rainbow-braces .token.token.punctuation.brace-level-6": {
		color: "#22863A",
	},
	".rainbow-braces .token.token.punctuation.brace-level-10": {
		color: "#22863A",
	},
	".rainbow-braces .token.token.punctuation.brace-level-3": {
		color: "#005CC5",
	},
	".rainbow-braces .token.token.punctuation.brace-level-7": {
		color: "#005CC5",
	},
	".rainbow-braces .token.token.punctuation.brace-level-11": {
		color: "#005CC5",
	},
	".rainbow-braces .token.token.punctuation.brace-level-4": {
		color: "#6F42C1",
	},
	".rainbow-braces .token.token.punctuation.brace-level-8": {
		color: "#6F42C1",
	},
	".rainbow-braces .token.token.punctuation.brace-level-12": {
		color: "#6F42C1",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)": {
		backgroundColor: "#FFEEF0",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)": {
		backgroundColor: "#FFEEF0",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)::-moz-selection": {
		backgroundColor: "#FFEEF0",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix) *::-moz-selection": {
		backgroundColor: "#FFEEF0",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)::-moz-selection": {
		backgroundColor: "#FFEEF0",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix) *::-moz-selection": {
		backgroundColor: "#FFEEF0",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)::selection": {
		backgroundColor: "#FFEEF0",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix) *::selection": {
		backgroundColor: "#FFEEF0",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)::selection": {
		backgroundColor: "#FFEEF0",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix) *::selection": {
		backgroundColor: "#FFEEF0",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)": {
		backgroundColor: "#F0FFF4",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)": {
		backgroundColor: "#F0FFF4",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)::-moz-selection": {
		backgroundColor: "#F0FFF4",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix) *::-moz-selection": {
		backgroundColor: "#F0FFF4",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)::-moz-selection": {
		backgroundColor: "#F0FFF4",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix) *::-moz-selection": {
		backgroundColor: "#F0FFF4",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)::selection": {
		backgroundColor: "#F0FFF4",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix) *::selection": {
		backgroundColor: "#F0FFF4",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)::selection": {
		backgroundColor: "#F0FFF4",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix) *::selection": {
		backgroundColor: "#F0FFF4",
	},
	".prism-previewer.prism-previewer:before": {
		borderColor: "#ffffff",
	},
	".prism-previewer-gradient.prism-previewer-gradient div": {
		borderColor: "#ffffff",
		borderRadius: "0.3em",
	},
	".prism-previewer-color.prism-previewer-color:before": {
		borderRadius: "0.3em",
	},
	".prism-previewer-easing.prism-previewer-easing:before": {
		borderRadius: "0.3em",
	},
	".prism-previewer.prism-previewer:after": {
		borderTopColor: "#ffffff",
	},
	".prism-previewer-flipped.prism-previewer-flipped.after": {
		borderBottomColor: "#ffffff",
	},
	".prism-previewer-angle.prism-previewer-angle:before": {
		background: "#f6f8fa",
	},
	".prism-previewer-time.prism-previewer-time:before": {
		background: "#f6f8fa",
	},
	".prism-previewer-easing.prism-previewer-easing": {
		background: "#f6f8fa",
	},
	".prism-previewer-angle.prism-previewer-angle circle": {
		stroke: "#24292e",
		strokeOpacity: "1",
	},
	".prism-previewer-time.prism-previewer-time circle": {
		stroke: "#24292e",
		strokeOpacity: "1",
	},
	".prism-previewer-easing.prism-previewer-easing circle": {
		stroke: "#24292e",
		fill: "transparent",
	},
	".prism-previewer-easing.prism-previewer-easing path": {
		stroke: "#24292e",
	},
	".prism-previewer-easing.prism-previewer-easing line": {
		stroke: "#24292e",
	},
}

export default theme
