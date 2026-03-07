import { execa } from "execa"
import { platform } from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

interface NotificationOptions {
	title?: string
	subtitle?: string
	message: string
	iconPath?: string
}

async function showMacOSNotification(options: NotificationOptions): Promise<void> {
	const { title, subtitle = "", message } = options

	const script = `display notification "${message}" with title "${title}" subtitle "${subtitle}" sound name "Tink"`

	try {
		await execa("osascript", ["-e", script])
	} catch (error) {
		throw new Error(`Failed to show macOS notification: ${error}`)
	}
}

async function showWindowsNotification(options: NotificationOptions): Promise<void> {
	const { subtitle, message, iconPath } = options

	const imageElement = iconPath ? `<image placement="appLogoOverride" src="file:///${iconPath.replace(/\\/g, "/")}" />` : ""

	const script = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    $template = @"
    <toast>
        <visual>
            <binding template="ToastGeneric">
                <text>${subtitle}</text>
                <text>${message}</text>
                ${imageElement}
            </binding>
        </visual>
    </toast>
"@

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Cline").Show($toast)
    `

	try {
		await execa("powershell", ["-Command", script])
	} catch (error) {
		throw new Error(`Failed to show Windows notification: ${error}`)
	}
}

async function showLinuxNotification(options: NotificationOptions): Promise<void> {
	const { title = "", subtitle = "", message, iconPath } = options

	// Combine subtitle and message if subtitle exists
	const fullMessage = subtitle ? `${subtitle}\n${message}` : message

	try {
		const args = iconPath ? ["-i", iconPath, title, fullMessage] : [title, fullMessage]
		await execa("notify-send", args)
	} catch (error) {
		throw new Error(`Failed to show Linux notification: ${error}`)
	}
}

/**
 * Resolves the path to the Cline extension icon.
 * The icon is at `assets/icons/icon.png` relative to the extension root.
 * At runtime, this module is bundled into `dist/`, so the extension root is one level up.
 */
function getIconPath(): string | undefined {
	try {
		return path.join(__dirname, "..", "assets", "icons", "icon.png")
	} catch {
		return undefined
	}
}

export async function showSystemNotification(options: NotificationOptions): Promise<void> {
	try {
		const { title = "Cline", message } = options

		if (!message) {
			throw new Error("Message is required")
		}

		const escapedOptions = {
			...options,
			title: title.replace(/"/g, '\\"'),
			message: message.replace(/"/g, '\\"'),
			subtitle: options.subtitle?.replace(/"/g, '\\"') || "",
			iconPath: options.iconPath || getIconPath(),
		}

		switch (platform()) {
			case "darwin":
				await showMacOSNotification(escapedOptions)
				break
			case "win32":
				await showWindowsNotification(escapedOptions)
				break
			case "linux":
				await showLinuxNotification(escapedOptions)
				break
			default:
				throw new Error("Unsupported platform")
		}
	} catch (error) {
		Logger.error("Could not show system notification", error)
	}
}
