import {
	AgentSessionRow,
	type AgentSessionRowProps,
} from "../components/agent-session-row.js";

const renderLink: NonNullable<AgentSessionRowProps["renderControl"]> = ({
	className,
	children,
}) => (
	<a className={className} href="/sessions/link">
		{children}
	</a>
);

<AgentSessionRow disabled label="Native" onSelect={() => undefined} />;
<AgentSessionRow label="Link" renderControl={renderLink} />;

// @ts-expect-error Host-rendered controls own disabled behavior.
<AgentSessionRow disabled label="Invalid" renderControl={renderLink} />;

// @ts-expect-error Host-rendered controls own selection behavior.
<AgentSessionRow
	label="Invalid"
	onSelect={() => undefined}
	renderControl={renderLink}
/>;
