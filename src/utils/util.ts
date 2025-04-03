const os = require('node:os')

type Platform = 'mac' | 'linux' | 'windows' | 'unknown'

export function getPlatform(): Platform {
    const platform = os.platform()
    if (platform === 'darwin') {
        return 'mac'
    } else if (platform === 'linux') {
        return 'linux'
    } else if (platform === 'win32') {
        return 'windows'
    } else {
        return 'unknown'
    }
}

export function getMetaKeyLabel() {
    const platform = getPlatform()
    switch (platform) {
        case 'mac':
            return '⌘'
        case 'linux':
        case 'windows':
            return 'Ctrl'
        default:
            return 'Ctrl'
    }
}

export function getMetaKeyName() {
    const platform = getPlatform()
    switch (platform) {
        case 'mac':
            return 'Cmd'
        case 'linux':
        case 'windows':
            return 'Ctrl'
        default:
            return 'Ctrl'
    }
}
