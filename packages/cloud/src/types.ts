import { AuthServiceEvents } from "./auth"
import { SettingsServiceEvents } from "./CloudSettingsService"

export type CloudServiceEvents = AuthServiceEvents & SettingsServiceEvents
