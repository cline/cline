import { execa } from "execa"
import { platform } from "os"
import { Logger } from "@/shared/services/Logger"

interface NotificationOptions {
	title?: string
	subtitle?: string
	message: string
}

type ExecaFn = typeof execa
let execaImpl: ExecaFn = execa
let platformImpl: typeof platform = platform

export function setNotificationExecaForTesting(mock: ExecaFn | null): void {
	execaImpl = mock ?? execa
}

export function setNotificationPlatformForTesting(mock: typeof platform | null): void {
	platformImpl = mock ?? platform
}

function escapeAppleScriptString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function escapePowerShellSingleQuotedString(value: string): string {
	return value.replace(/'/g, "''")
}

export function buildWindowsToastNotificationScript(options: NotificationOptions): string {
	const { subtitle = "", message } = options
	const safeSubtitle = escapePowerShellSingleQuotedString(subtitle)
	const safeMessage = escapePowerShellSingleQuotedString(message)

	return `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    $subtitle = '${safeSubtitle}'
    $message = '${safeMessage}'

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1"></text><text id="2"></text></binding></visual></toast>')

    $textNodes = $xml.GetElementsByTagName('text')
    $textNodes.Item(0).InnerText = $subtitle
    $textNodes.Item(1).InnerText = $message

    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Cline').Show($toast)
    `
}

async function showMacOSNotification(options: NotificationOptions): Promise<void> {
	const { title, subtitle = "", message } = options

	const script = `display notification "${escapeAppleScriptString(message)}" with title "${escapeAppleScriptString(title || "")}" subtitle "${escapeAppleScriptString(subtitle)}" sound name "Tink"`

	try {
		await execaImpl("osascript", ["-e", script])
	} catch (error) {
		throw new Error(`Failed to show macOS notification: ${error}`)
	}
}

async function showWindowsNotification(options: NotificationOptions): Promise<void> {
	const script = buildWindowsToastNotificationScript(options)

	try {
		await execaImpl("powershell", ["-NoProfile", "-NonInteractive", "-Command", script])
	} catch (error) {
		throw new Error(`Failed to show Windows notification: ${error}`)
	}
}

async function showLinuxNotification(options: NotificationOptions): Promise<void> {
	const { title = "", subtitle = "", message } = options

	// Combine subtitle and message if subtitle exists
	const fullMessage = subtitle ? `${subtitle}\n${message}` : message

	try {
		await execaImpl("notify-send", [title, fullMessage])
	} catch (error) {
		throw new Error(`Failed to show Linux notification: ${error}`)
	}
}

export async function showSystemNotification(options: NotificationOptions): Promise<void> {
	try {
		const { title = "Cline", message } = options

		if (!message) {
			throw new Error("Message is required")
		}

		const normalizedOptions = {
			...options,
			title,
			subtitle: options.subtitle || "",
		}

		switch (platformImpl()) {
			case "darwin":
				await showMacOSNotification(normalizedOptions)
				break
			case "win32":
				await showWindowsNotification(normalizedOptions)
				break
			case "linux":
				await showLinuxNotification(normalizedOptions)
				break
			default:
				throw new Error("Unsupported platform")
		}
	} catch (error) {
		Logger.error("Could not show system notification", error)
	}
}
