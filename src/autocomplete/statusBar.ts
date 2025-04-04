import * as vscode from 'vscode'

export enum StatusBarStatus {
    Disabled,
    Enabled,
    Paused,
}

export const quickPickStatusText = (status: StatusBarStatus | undefined) => {
    switch (status) {
        case undefined:
        case StatusBarStatus.Disabled:
            return '$(circle-slash) Disable autocomplete'
        case StatusBarStatus.Enabled:
            return '$(check) Enable autocomplete'
        case StatusBarStatus.Paused:
            return '$(debug-pause) Pause autocomplete'
    }
}

export const getStatusBarStatusFromQuickPickItemLabel = (label: string): StatusBarStatus | undefined => {
    switch (label) {
        case '$(circle-slash) Disable autocomplete':
            return StatusBarStatus.Disabled
        case '$(check) Enable autocomplete':
            return StatusBarStatus.Enabled
        case '$(debug-pause) Pause autocomplete':
            return StatusBarStatus.Paused
        default:
            return undefined
    }
}

const statusBarItemText = (status: StatusBarStatus | undefined, loading?: boolean, error?: boolean) => {
    if (error) {
        return '$(alert) PostHog (FATAL ERROR)'
    }

    switch (status) {
        case StatusBarStatus.Disabled:
            return '$(circle-slash) PostHog'
        case StatusBarStatus.Enabled:
            return '$(check) PostHog'
        case StatusBarStatus.Paused:
            return '$(debug-pause) PostHog'
    }
    return ''
}

const statusBarItemTooltip = (status: StatusBarStatus | undefined) => {
    switch (status) {
        case undefined:
        case StatusBarStatus.Disabled:
            return 'Click to enable tab autocomplete'
        case StatusBarStatus.Enabled:
            return 'Tab autocomplete is enabled'
        case StatusBarStatus.Paused:
            return 'Tab autocomplete is paused'
    }
}

let statusBarStatus: StatusBarStatus | undefined = undefined
let statusBarItem: vscode.StatusBarItem | undefined = undefined
let statusBarFalseTimeout: NodeJS.Timeout | undefined = undefined
let statusBarError: boolean = false

export function stopStatusBarLoading() {
    statusBarFalseTimeout = setTimeout(() => {
        setupStatusBar(StatusBarStatus.Enabled, false)
    }, 100)
}

export function setupStatusBar(status: StatusBarStatus | undefined, loading?: boolean, error?: boolean) {
    if (loading !== false) {
        clearTimeout(statusBarFalseTimeout)
        statusBarFalseTimeout = undefined
    }

    // If statusBarItem hasn't been defined yet, create it
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
    }

    if (error !== undefined) {
        statusBarError = error

        if (status === undefined) {
            status = statusBarStatus
        }

        if (loading === undefined) {
            loading = loading
        }
    }

    statusBarItem.text = statusBarItemText(status, loading, statusBarError)
    statusBarItem.tooltip = statusBarItemTooltip(status ?? statusBarStatus)
    statusBarItem.command = 'posthog.openTabAutocompleteConfigMenu'

    statusBarItem.show()
    if (status !== undefined) {
        statusBarStatus = status
    }
}

export function getStatusBarStatus(): StatusBarStatus | undefined {
    return statusBarStatus
}
