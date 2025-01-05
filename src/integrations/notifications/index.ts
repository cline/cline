import { execa } from "execa"
import { platform } from "os"

interface NotificationOptions {
	title?: string
	subtitle?: string
	message: string
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
	const { subtitle, message } = options

	const script = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    $template = @"
    <toast>
        <visual>
            <binding template="ToastText02">
                <text id="1">${subtitle}</text>
                <text id="2">${message}</text>
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
	const { title = "", subtitle = "", message } = options

	// Combine subtitle and message if subtitle exists
	const fullMessage = subtitle ? `${subtitle}\n${message}` : message

	try {
		await execa("notify-send", [title, fullMessage])
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

		const escapedOptions = {
			...options,
			title: title.replace(/"/g, '\\"'),
			message: message.replace(/"/g, '\\"'),
			subtitle: options.subtitle?.replace(/"/g, '\\"') || "",
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
		console.error("Could not show system notification", error)
	}
}
