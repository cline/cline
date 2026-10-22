import type { ClineMessage } from "@shared/ExtensionMessage"

export function formatMessageTime(timestamp: number): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
		timeZoneName: "short",
	}).formatToParts(timestamp)
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
	return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`
}

export function MessageTimestamp({ timestamp, label }: { timestamp: number; label: string }) {
	return (
		<div className="text-xs text-description my-1">
			<time dateTime={new Date(timestamp).toISOString()}>
				{label}: {formatMessageTime(timestamp)}
			</time>
		</div>
	)
}

export function ResponseFinish({ message }: { message: ClineMessage }) {
	if (message.interruptedAt !== undefined) return <MessageTimestamp label="Interrupted" timestamp={message.interruptedAt} />
	if (message.partial || message.completedAt === undefined) return null
	return <MessageTimestamp label="Finished" timestamp={message.completedAt} />
}
