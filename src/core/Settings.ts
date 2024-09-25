import * as vscode from "vscode"

type SettingKey =
	| "alwaysAllowReadOnly"

export class Settings {
	private static instance: Settings
	private constructor() {}

	public static getInstance(): Settings {
		if (!Settings.instance) {
			Settings.instance = new Settings()
		}
		return Settings.instance
	}

	private config = () => vscode.workspace.getConfiguration("claudeDev")

	private getValue<T>(key: SettingKey, defaultValue: T): T {
		return this.config().get(key, defaultValue)
	}

	private setValue<T>(key: SettingKey, value: T): Thenable<void> {
		return this.config().update(key, value, vscode.ConfigurationTarget.Global)
	}

	public get alwaysAllowReadOnly(): boolean {
		return this.getValue("alwaysAllowReadOnly", false)
	}

	public set alwaysAllowReadOnly(value: boolean) {
		this.setValue("alwaysAllowReadOnly", value)
	}
}
