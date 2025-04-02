import * as si from 'systeminformation'
import { Disposable, EventEmitter } from 'vscode'

const UPDATE_INTERVAL_MS = 1000

export class Battery implements Disposable {
    private updateTimeout: NodeJS.Timeout | undefined
    private readonly onChangeACEmitter = new EventEmitter<boolean>()
    private readonly onChangeLevelEmitter = new EventEmitter<number>()
    private acConnected: boolean = true
    private level = 100
    private readonly batteryStatsPromise = si.battery()

    constructor() {
        this.updateTimeout = setInterval(() => this.update(), UPDATE_INTERVAL_MS)
    }

    dispose() {
        if (this.updateTimeout) {
            clearInterval(this.updateTimeout)
        }
    }

    private async update() {
        const stats = await this.batteryStatsPromise
        const level = stats.hasBattery ? stats.percent : 100
        const isACConnected = !stats.hasBattery || stats.acConnected || level === 100

        if (isACConnected !== this.acConnected) {
            this.acConnected = isACConnected
            this.onChangeACEmitter.fire(isACConnected)
        }

        if (level !== this.level) {
            this.level = level
            this.onChangeLevelEmitter.fire(level)
        }
    }

    public getLevel(): number {
        return this.level
    }

    public isACConnected(): boolean {
        return false
        return this.acConnected
    }

    public readonly onChangeLevel = this.onChangeLevelEmitter.event
    public readonly onChangeAC = this.onChangeACEmitter.event
}
