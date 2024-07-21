const theme: { [key: string]: React.CSSProperties } = {
	'code[class*="language-"]': {
		background: "hsl(220, 13%, 18%)",
		color: "hsl(220, 14%, 71%)",
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
		background: "hsl(220, 13%, 18%)",
		color: "hsl(220, 14%, 71%)",
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
		background: "hsl(220, 13%, 28%)",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"] *::-moz-selection': {
		background: "hsl(220, 13%, 28%)",
		color: "inherit",
		textShadow: "none",
	},
	'pre[class*="language-"] *::-moz-selection': {
		background: "hsl(220, 13%, 28%)",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"]::selection': {
		background: "hsl(220, 13%, 28%)",
		color: "inherit",
		textShadow: "none",
	},
	'code[class*="language-"] *::selection': {
		background: "hsl(220, 13%, 28%)",
		color: "inherit",
		textShadow: "none",
	},
	'pre[class*="language-"] *::selection': {
		background: "hsl(220, 13%, 28%)",
		color: "inherit",
		textShadow: "none",
	},
	':not(pre) > code[class*="language-"]': {
		padding: "0.2em 0.3em",
		borderRadius: "0.3em",
		whiteSpace: "normal",
	},
	comment: {
		color: "hsl(220, 10%, 40%)",
		fontStyle: "italic",
	},
	prolog: {
		color: "hsl(220, 10%, 40%)",
	},
	cdata: {
		color: "hsl(220, 10%, 40%)",
	},
	doctype: {
		color: "hsl(220, 14%, 71%)",
	},
	punctuation: {
		color: "hsl(220, 14%, 71%)",
	},
	entity: {
		color: "hsl(220, 14%, 71%)",
		cursor: "help",
	},
	"attr-name": {
		color: "hsl(29, 54%, 61%)",
	},
	"class-name": {
		color: "hsl(29, 54%, 61%)",
	},
	boolean: {
		color: "hsl(29, 54%, 61%)",
	},
	constant: {
		color: "hsl(29, 54%, 61%)",
	},
	number: {
		color: "hsl(29, 54%, 61%)",
	},
	atrule: {
		color: "hsl(29, 54%, 61%)",
	},
	keyword: {
		color: "hsl(286, 60%, 67%)",
	},
	property: {
		color: "hsl(355, 65%, 65%)",
	},
	tag: {
		color: "hsl(355, 65%, 65%)",
	},
	symbol: {
		color: "hsl(355, 65%, 65%)",
	},
	deleted: {
		color: "hsl(355, 65%, 65%)",
	},
	important: {
		color: "hsl(355, 65%, 65%)",
	},
	selector: {
		color: "hsl(95, 38%, 62%)",
	},
	string: {
		color: "hsl(95, 38%, 62%)",
	},
	char: {
		color: "hsl(95, 38%, 62%)",
	},
	builtin: {
		color: "hsl(95, 38%, 62%)",
	},
	inserted: {
		color: "hsl(95, 38%, 62%)",
	},
	regex: {
		color: "hsl(95, 38%, 62%)",
	},
	"attr-value": {
		color: "hsl(95, 38%, 62%)",
	},
	"attr-value > .token.punctuation": {
		color: "hsl(95, 38%, 62%)",
	},
	variable: {
		color: "hsl(207, 82%, 66%)",
	},
	operator: {
		color: "hsl(207, 82%, 66%)",
	},
	function: {
		color: "hsl(207, 82%, 66%)",
	},
	url: {
		color: "hsl(187, 47%, 55%)",
	},
	"attr-value > .token.punctuation.attr-equals": {
		color: "hsl(220, 14%, 71%)",
	},
	"special-attr > .token.attr-value > .token.value.css": {
		color: "hsl(220, 14%, 71%)",
	},
	".language-css .token.selector": {
		color: "hsl(355, 65%, 65%)",
	},
	".language-css .token.property": {
		color: "hsl(220, 14%, 71%)",
	},
	".language-css .token.function": {
		color: "hsl(187, 47%, 55%)",
	},
	".language-css .token.url > .token.function": {
		color: "hsl(187, 47%, 55%)",
	},
	".language-css .token.url > .token.string.url": {
		color: "hsl(95, 38%, 62%)",
	},
	".language-css .token.important": {
		color: "hsl(286, 60%, 67%)",
	},
	".language-css .token.atrule .token.rule": {
		color: "hsl(286, 60%, 67%)",
	},
	".language-javascript .token.operator": {
		color: "hsl(286, 60%, 67%)",
	},
	".language-javascript .token.template-string > .token.interpolation > .token.interpolation-punctuation.punctuation":
		{
			color: "hsl(5, 48%, 51%)",
		},
	".language-json .token.operator": {
		color: "hsl(220, 14%, 71%)",
	},
	".language-json .token.null.keyword": {
		color: "hsl(29, 54%, 61%)",
	},
	".language-markdown .token.url": {
		color: "hsl(220, 14%, 71%)",
	},
	".language-markdown .token.url > .token.operator": {
		color: "hsl(220, 14%, 71%)",
	},
	".language-markdown .token.url-reference.url > .token.string": {
		color: "hsl(220, 14%, 71%)",
	},
	".language-markdown .token.url > .token.content": {
		color: "hsl(207, 82%, 66%)",
	},
	".language-markdown .token.url > .token.url": {
		color: "hsl(187, 47%, 55%)",
	},
	".language-markdown .token.url-reference.url": {
		color: "hsl(187, 47%, 55%)",
	},
	".language-markdown .token.blockquote.punctuation": {
		color: "hsl(220, 10%, 40%)",
		fontStyle: "italic",
	},
	".language-markdown .token.hr.punctuation": {
		color: "hsl(220, 10%, 40%)",
		fontStyle: "italic",
	},
	".language-markdown .token.code-snippet": {
		color: "hsl(95, 38%, 62%)",
	},
	".language-markdown .token.bold .token.content": {
		color: "hsl(29, 54%, 61%)",
	},
	".language-markdown .token.italic .token.content": {
		color: "hsl(286, 60%, 67%)",
	},
	".language-markdown .token.strike .token.content": {
		color: "hsl(355, 65%, 65%)",
	},
	".language-markdown .token.strike .token.punctuation": {
		color: "hsl(355, 65%, 65%)",
	},
	".language-markdown .token.list.punctuation": {
		color: "hsl(355, 65%, 65%)",
	},
	".language-markdown .token.title.important > .token.punctuation": {
		color: "hsl(355, 65%, 65%)",
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
		color: "hsla(220, 14%, 71%, 0.15)",
		textShadow: "none",
	},
	"token.cr:before": {
		color: "hsla(220, 14%, 71%, 0.15)",
		textShadow: "none",
	},
	"token.lf:before": {
		color: "hsla(220, 14%, 71%, 0.15)",
		textShadow: "none",
	},
	"token.space:before": {
		color: "hsla(220, 14%, 71%, 0.15)",
		textShadow: "none",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item": {
		marginRight: "0.4em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button": {
		background: "hsl(220, 13%, 26%)",
		color: "hsl(220, 9%, 55%)",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a": {
		background: "hsl(220, 13%, 26%)",
		color: "hsl(220, 9%, 55%)",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span": {
		background: "hsl(220, 13%, 26%)",
		color: "hsl(220, 9%, 55%)",
		padding: "0.1em 0.4em",
		borderRadius: "0.3em",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:hover": {
		background: "hsl(220, 13%, 28%)",
		color: "hsl(220, 14%, 71%)",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:focus": {
		background: "hsl(220, 13%, 28%)",
		color: "hsl(220, 14%, 71%)",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:hover": {
		background: "hsl(220, 13%, 28%)",
		color: "hsl(220, 14%, 71%)",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:focus": {
		background: "hsl(220, 13%, 28%)",
		color: "hsl(220, 14%, 71%)",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:hover": {
		background: "hsl(220, 13%, 28%)",
		color: "hsl(220, 14%, 71%)",
	},
	"div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:focus": {
		background: "hsl(220, 13%, 28%)",
		color: "hsl(220, 14%, 71%)",
	},
	".line-highlight.line-highlight": {
		background: "hsla(220, 100%, 80%, 0.04)",
	},
	".line-highlight.line-highlight:before": {
		background: "hsl(220, 13%, 26%)",
		color: "hsl(220, 14%, 71%)",
		padding: "0.1em 0.6em",
		borderRadius: "0.3em",
		boxShadow: "0 2px 0 0 rgba(0, 0, 0, 0.2)",
	},
	".line-highlight.line-highlight[data-end]:after": {
		background: "hsl(220, 13%, 26%)",
		color: "hsl(220, 14%, 71%)",
		padding: "0.1em 0.6em",
		borderRadius: "0.3em",
		boxShadow: "0 2px 0 0 rgba(0, 0, 0, 0.2)",
	},
	"pre[id].linkable-line-numbers.linkable-line-numbers span.line-numbers-rows > span:hover:before": {
		backgroundColor: "hsla(220, 100%, 80%, 0.04)",
	},
	".line-numbers.line-numbers .line-numbers-rows": {
		borderRightColor: "hsla(220, 14%, 71%, 0.15)",
	},
	".command-line .command-line-prompt": {
		borderRightColor: "hsla(220, 14%, 71%, 0.15)",
	},
	".line-numbers .line-numbers-rows > span:before": {
		color: "hsl(220, 14%, 45%)",
	},
	".command-line .command-line-prompt > span:before": {
		color: "hsl(220, 14%, 45%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-1": {
		color: "hsl(355, 65%, 65%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-5": {
		color: "hsl(355, 65%, 65%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-9": {
		color: "hsl(355, 65%, 65%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-2": {
		color: "hsl(95, 38%, 62%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-6": {
		color: "hsl(95, 38%, 62%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-10": {
		color: "hsl(95, 38%, 62%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-3": {
		color: "hsl(207, 82%, 66%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-7": {
		color: "hsl(207, 82%, 66%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-11": {
		color: "hsl(207, 82%, 66%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-4": {
		color: "hsl(286, 60%, 67%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-8": {
		color: "hsl(286, 60%, 67%)",
	},
	".rainbow-braces .token.token.punctuation.brace-level-12": {
		color: "hsl(286, 60%, 67%)",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)": {
		backgroundColor: "hsla(353, 100%, 66%, 0.15)",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)": {
		backgroundColor: "hsla(353, 100%, 66%, 0.15)",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)::-moz-selection": {
		backgroundColor: "hsla(353, 95%, 66%, 0.25)",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix) *::-moz-selection": {
		backgroundColor: "hsla(353, 95%, 66%, 0.25)",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)::-moz-selection": {
		backgroundColor: "hsla(353, 95%, 66%, 0.25)",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix) *::-moz-selection": {
		backgroundColor: "hsla(353, 95%, 66%, 0.25)",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix)::selection": {
		backgroundColor: "hsla(353, 95%, 66%, 0.25)",
	},
	"pre.diff-highlight > code .token.token.deleted:not(.prefix) *::selection": {
		backgroundColor: "hsla(353, 95%, 66%, 0.25)",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix)::selection": {
		backgroundColor: "hsla(353, 95%, 66%, 0.25)",
	},
	"pre > code.diff-highlight .token.token.deleted:not(.prefix) *::selection": {
		backgroundColor: "hsla(353, 95%, 66%, 0.25)",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)": {
		backgroundColor: "hsla(137, 100%, 55%, 0.15)",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)": {
		backgroundColor: "hsla(137, 100%, 55%, 0.15)",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)::-moz-selection": {
		backgroundColor: "hsla(135, 73%, 55%, 0.25)",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix) *::-moz-selection": {
		backgroundColor: "hsla(135, 73%, 55%, 0.25)",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)::-moz-selection": {
		backgroundColor: "hsla(135, 73%, 55%, 0.25)",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix) *::-moz-selection": {
		backgroundColor: "hsla(135, 73%, 55%, 0.25)",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix)::selection": {
		backgroundColor: "hsla(135, 73%, 55%, 0.25)",
	},
	"pre.diff-highlight > code .token.token.inserted:not(.prefix) *::selection": {
		backgroundColor: "hsla(135, 73%, 55%, 0.25)",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix)::selection": {
		backgroundColor: "hsla(135, 73%, 55%, 0.25)",
	},
	"pre > code.diff-highlight .token.token.inserted:not(.prefix) *::selection": {
		backgroundColor: "hsla(135, 73%, 55%, 0.25)",
	},
	".prism-previewer.prism-previewer:before": {
		borderColor: "hsl(224, 13%, 17%)",
	},
	".prism-previewer-gradient.prism-previewer-gradient div": {
		borderColor: "hsl(224, 13%, 17%)",
		borderRadius: "0.3em",
	},
	".prism-previewer-color.prism-previewer-color:before": {
		borderRadius: "0.3em",
	},
	".prism-previewer-easing.prism-previewer-easing:before": {
		borderRadius: "0.3em",
	},
	".prism-previewer.prism-previewer:after": {
		borderTopColor: "hsl(224, 13%, 17%)",
	},
	".prism-previewer-flipped.prism-previewer-flipped.after": {
		borderBottomColor: "hsl(224, 13%, 17%)",
	},
	".prism-previewer-angle.prism-previewer-angle:before": {
		background: "hsl(219, 13%, 22%)",
	},
	".prism-previewer-time.prism-previewer-time:before": {
		background: "hsl(219, 13%, 22%)",
	},
	".prism-previewer-easing.prism-previewer-easing": {
		background: "hsl(219, 13%, 22%)",
	},
	".prism-previewer-angle.prism-previewer-angle circle": {
		stroke: "hsl(220, 14%, 71%)",
		strokeOpacity: "1",
	},
	".prism-previewer-time.prism-previewer-time circle": {
		stroke: "hsl(220, 14%, 71%)",
		strokeOpacity: "1",
	},
	".prism-previewer-easing.prism-previewer-easing circle": {
		stroke: "hsl(220, 14%, 71%)",
		fill: "transparent",
	},
	".prism-previewer-easing.prism-previewer-easing path": {
		stroke: "hsl(220, 14%, 71%)",
	},
	".prism-previewer-easing.prism-previewer-easing line": {
		stroke: "hsl(220, 14%, 71%)",
	},
}
export default theme
