import { AgentSessionRow } from "../components/agent-session-row.js";

<AgentSessionRow disabled label="Native" onSelect={() => undefined} />;
<AgentSessionRow
	label="Link"
	renderControl={({ className, children }) => (
		<a className={className} href="/sessions/link">
			{children}
		</a>
	)}
/>;

// @ts-expect-error Host-rendered controls own disabled behavior.
<AgentSessionRow
	disabled
	label="Invalid"
	renderControl={({ children }) => <a href="/">{children}</a>}
/>;

// @ts-expect-error Host-rendered controls own selection behavior.
<AgentSessionRow
	label="Invalid"
	onSelect={() => undefined}
	renderControl={({ children }) => <a href="/">{children}</a>}
/>;
