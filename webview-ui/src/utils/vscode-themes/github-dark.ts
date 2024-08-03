const theme: { [key: string]: React.CSSProperties } = {
	'code[class*="language-"]': {
		color: "#e1e4e8",
		background: "#24292e",
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
		color: "#e1e4e8",
		background: "#24292e",
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
		background: "#3392ff44",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"] *::-moz-selection': {
		background: "#3392ff44",
		color: "inherit",
		textShadow: "none",
	},
	'pre[class*="language-"] *::-moz-selection': {
		background: "#3392ff44",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"]::selection': {
		background: "#3392ff44",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"] *::selection': {
		background: "#3392ff44",
		color: "inherit",
		textShadow: "none",
	},
	'pre[class*="language-"] *::selection': {
		background: "#3392ff44",
		color: "inherit",
		textShadow: "none",
	},
	':not(pre) > code[class*="language-"]': {
		background: "#24292e",
		padding: "0.1em",
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
		color: "#e1e4e8",
	},
	punctuation: {
		color: "#e1e4e8",
	},
	entity: {
		color: "#e1e4e8",
		cursor: "help",
	},
	"attr-name": {
		color: "#79B8FF",
	},
	"class-name": {
		color: "#B392F0",
	},
	boolean: {
		color: "#79B8FF",
	},
	constant: {
		color: "#79B8FF",
	},
	number: {
		color: "#79B8FF",
	},
	atrule: {
		color: "#79B8FF",
	},
	keyword: {
		color: "#F97583",
	},
	property: {
		color: "#79B8FF",
	},
	tag: {
		color: "#85E89D",
	},
	symbol: {
		color: "#79B8FF",
	},
	deleted: {
		color: "#FDAEB7",
		background: "#86181D",
	},
	important: {
		color: "#F97583",
	},
	selector: {
		color: "#85E89D",
	},
	string: {
		color: "#9ECBFF",
	},
	char: {
		color: "#9ECBFF",
	},
	builtin: {
		color: "#79B8FF",
	},
	inserted: {
		color: "#85E89D",
		background: "#144620",
	},
	regex: {
		color: "#DBEDFF",
	},
	"attr-value": {
		color: "#9ECBFF",
	},
	"attr-value > .token.punctuation": {
		color: "#9ECBFF",
	},
	variable: {
		color: "#FFAB70",
	},
	operator: {
		color: "#F97583",
	},
	function: {
		color: "#B392F0",
	},
	url: {
		color: "#79B8FF",
	},
	"attr-value > .token.punctuation.attr-equals": {
		color: "#e1e4e8",
	},
	"special-attr > .token.attr-value > .token.value.css": {
		color: "#e1e4e8",
	},
	".language-css .token.selector": {
		color: "#85E89D",
	},
	".language-css .token.property": {
		color: "#79B8FF",
	},
	".language-css .token.function": {
		color: "#79B8FF",
	},
	".language-css .token.url > .token.function": {
		color: "#79B8FF",
	},
	".language-css .token.url > .token.string.url": {
		color: "#9ECBFF",
	},
	".language-css .token.important": {
		color: "#F97583",
	},
	".language-css .token.atrule .token.rule": {
		color: "#F97583",
	},
	".language-javascript .token.operator": {
		color: "#F97583",
	},
	".language-javascript .token.template-string > .token.interpolation > .token.interpolation-punctuation.punctuation":
		{
			color: "#FDAEB7",
		},
	".language-json .token.operator": {
		color: "#e1e4e8",
	},
	".language-json .token.null.keyword": {
		color: "#79B8FF",
	},
	".language-markdown .token.url": {
		color: "#e1e4e8",
	},
	".language-markdown .token.url > .token.operator": {
		color: "#e1e4e8",
	},
	".language-markdown .token.url-reference.url > .token.string": {
		color: "#e1e4e8",
	},
	".language-markdown .token.url > .token.content": {
		color: "#79B8FF",
	},
	".language-markdown .token.url > .token.url": {
		color: "#79B8FF",
	},
	".language-markdown .token.url-reference.url": {
		color: "#79B8FF",
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
		color: "#9ECBFF",
	},
	".language-markdown .token.bold .token.content": {
		color: "#79B8FF",
	},
	".language-markdown .token.italic .token.content": {
		color: "#B392F0",
	},
	".language-markdown .token.strike .token.content": {
		color: "#FDAEB7",
	},
	".language-markdown .token.strike .token.punctuation": {
		color: "#FDAEB7",
	},
	".language-markdown .token.list.punctuation": {
		color: "#FDAEB7",
	},
	".language-markdown .token.title.important > .token.punctuation": {
		color: "#FDAEB7",
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
		color: "#6A737D",
	},
	"token.cr:before": {
		color: "#6A737D",
	},
	"token.lf:before": {
		color: "#6A737D",
	},
	"token.space:before": {
		color: "#6A737D",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item": {
		marginRight: "0.4em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button": {
		background: "#2f363d",
		color: "#959da5",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a": {
		background: "#2f363d",
		color: "#959da5",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span": {
		background: "#2f363d",
		color: "#959da5",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:hover": {
		background: "#444d56",
		color: "#e1e4e8",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:focus": {
		background: "#444d56",
		color: "#e1e4e8",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:hover": {
		background: "#444d56",
		color: "#e1e4e8",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:focus": {
		background: "#444d56",
		color: "#e1e4e8",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:hover": {
		background: "#444d56",
		color: "#e1e4e8",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:focus": {
		background: "#444d56",
		color: "#e1e4e8",
	},
	".line-highlight.line-highlight": {
		background: "#2b3036",
	},
	".line-highlight.line-highlight:before": {
		background: "#2f363d",
		color: "#e1e4e8",
		padding: "0.1em 0.6em",
		borderRadius: "0.3em",
		boxShadow: "0 2px 0 0 rgba(0, 0, 0, 0.2)",
	},
	".line-highlight.line-highlight[data-end]:after": {
		background: "#2f363d",
		color: "#e1e4e8",
		padding: "0.1em 0.6em",
		borderRadius: "0.3em",
		boxShadow: "0 2px 0 0 rgba(0, 0, 0, 0.2)",
	},
	"pre[id].linkable-line-numbers.linkable-line-numbers span.line-numbers-rows > span:hover:before": {
		backgroundColor: "#2b3036",
	},
	".line-numbers.line-numbers .line-numbers-rows": {
		borderRightColor: "#444d56",
	},
	".command-line .command-line-prompt": {
		borderRightColor: "#444d56",
	},
	".line-numbers .line-numbers-rows > span:before": {
		color: "#444d56",
	},
	".command-line .command-line-prompt > span:before": {
		color: "#444d56",
	},
	".rainbow-braces .token.token.punctuation.brace-level-1": {
		color: "#FDAEB7",
	},
	".rainbow-braces .token.token.punctuation.brace-level-5": {
		color: "#FDAEB7",
	},
	".rainbow-braces .token.token.punctuation.brace-level-9": {
		color: "#FDAEB7",
	},
	".rainbow-braces .token.token.punctuation.brace-level-2": {
		color: "#9ECBFF",
	},
	".rainbow-braces .token.token.punctuation.brace-level-6": {
		color: "#9ECBFF",
	},
	".rainbow-braces .token.token.punctuation.brace-level-10": {
		color: "#9ECBFF",
	},
	".rainbow-braces .token.token.punctuation.brace-level-3": {
		color: "#79B8FF",
	},
	".rainbow-braces .token.token.punctuation.brace-level-7": {
		color: "#79B8FF",
	},
	".rainbow-braces .token.token.punctuation.brace-level-11": {
		color: "#79B8FF",
	},
	".rainbow-braces .token.token.punctuation.brace-level-4": {
		color: "#B392F0",
	},
	".rainbow-braces .token.token.punctuation.brace-level-8": {
		color: "#B392F0",
	},
	".rainbow-braces .token.token.punctuation.brace-level-12": {
		color: "#B392F0",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)": {
		backgroundColor: "#86181D",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)": {
		backgroundColor: "#86181D",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)::-moz-selection": {
		backgroundColor: "#86181D",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix) *::-moz-selection": {
		backgroundColor: "#86181D",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)::-moz-selection": {
		backgroundColor: "#86181D",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix) *::-moz-selection": {
		backgroundColor: "#86181D",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)::selection": {
		backgroundColor: "#86181D",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix) *::selection": {
		backgroundColor: "#86181D",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)::selection": {
		backgroundColor: "#86181D",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix) *::selection": {
		backgroundColor: "#86181D",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)": {
		backgroundColor: "#144620",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)": {
		backgroundColor: "#144620",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)::-moz-selection": {
		backgroundColor: "#144620",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix) *::-moz-selection": {
		backgroundColor: "#144620",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)::-moz-selection": {
		backgroundColor: "#144620",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix) *::-moz-selection": {
		backgroundColor: "#144620",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)::selection": {
		backgroundColor: "#144620",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix) *::selection": {
		backgroundColor: "#144620",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)::selection": {
		backgroundColor: "#144620",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix) *::selection": {
		backgroundColor: "#144620",
	},
	".prism-previewer.prism-previewer:before": {
		borderColor: "#1b1f23",
	},
	".prism-previewer-gradient.prism-previewer-gradient div": {
		borderColor: "#1b1f23",
		borderRadius: "0.3em",
	},
	".prism-previewer-color.prism-previewer-color:before": {
		borderRadius: "0.3em",
	},
	".prism-previewer-easing.prism-previewer-easing:before": {
		borderRadius: "0.3em",
	},
	".prism-previewer.prism-previewer:after": {
		borderTopColor: "#1b1f23",
	},
	".prism-previewer-flipped.prism-previewer-flipped.after": {
		borderBottomColor: "#1b1f23",
	},
	".prism-previewer-angle.prism-previewer-angle:before": {
		background: "#1f2428",
	},
	".prism-previewer-time.prism-previewer-time:before": {
		background: "#1f2428",
	},
	".prism-previewer-easing.prism-previewer-easing": {
		background: "#1f2428",
	},
	".prism-previewer-angle.prism-previewer-angle circle": {
		stroke: "#e1e4e8",
		strokeOpacity: "1",
	},
	".prism-previewer-time.prism-previewer-time circle": {
		stroke: "#e1e4e8",
		strokeOpacity: "1",
	},
	".prism-previewer-easing.prism-previewer-easing circle": {
		stroke: "#e1e4e8",
		fill: "transparent",
	},
	".prism-previewer-easing.prism-previewer-easing path": {
		stroke: "#e1e4e8",
	},
	".prism-previewer-easing.prism-previewer-easing line": {
		stroke: "#e1e4e8",
	},
}

export default theme
