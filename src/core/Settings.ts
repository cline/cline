import * as vscode from 'vscode';

export class Settings {
    private static instance: Settings;
    private constructor() {}

    public static getInstance(): Settings {
        if (!Settings.instance) {
            Settings.instance = new Settings();
        }
        return Settings.instance;
    }

    public get alwaysAllowReadOnly(): boolean {
        return vscode.workspace.getConfiguration('claudeDev').get('alwaysAllowReadOnly', false);
    }

    public set alwaysAllowReadOnly(value: boolean) {
        vscode.workspace.getConfiguration('claudeDev').update('alwaysAllowReadOnly', value, vscode.ConfigurationTarget.Global);
    }
}
