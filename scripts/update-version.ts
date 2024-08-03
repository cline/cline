import * as fs from "fs"
import * as path from "path"

const newVersion = process.argv[2]

if (!newVersion) {
	console.error("Please provide a version number")
	process.exit(1)
}

// Update root package.json
const rootPackagePath = path.join(__dirname, "..", "package.json")
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, "utf8"))
rootPackage.version = newVersion
fs.writeFileSync(rootPackagePath, JSON.stringify(rootPackage, null, 2))

// Update Announcement.tsx
const announcementPath = path.join(__dirname, "..", "webview-ui", "src", "components", "Announcement.tsx")
let announcementContent = fs.readFileSync(announcementPath, "utf8")
announcementContent = announcementContent.replace(/New in v[\d.]+<\/h3>/, `New in v${newVersion}</h3>`)
fs.writeFileSync(announcementPath, announcementContent)

// Update SettingsView.tsx
const settingsViewPath = path.join(__dirname, "..", "webview-ui", "src", "components", "SettingsView.tsx")
let settingsViewContent = fs.readFileSync(settingsViewPath, "utf8")
settingsViewContent = settingsViewContent.replace(/>v[\d.]+<\/p>/, `>v${newVersion}</p>`)
fs.writeFileSync(settingsViewPath, settingsViewContent)

console.log(`Version updated to ${newVersion}`)
