import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class EmulatorFinder {
    private isWindows: boolean;
    private adbPath: string | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this.isWindows = os.platform() === 'win32';
    }

    async findAndCaptureEmulator(): Promise<{ screenshot: string }> {
        try {
            const platform = os.platform();
            if (this.isWindows || platform === 'linux') {
                // Attempt to locate adb
                this.adbPath = await this.findAdb();

                if (!this.adbPath) {
                    throw new Error('ADB executable not found. Please ensure the Android SDK is installed.');
                }

                return await this.handleAndroidEmulator();
            } else if (platform === 'darwin') {
                return await this.handleIOSSimulator();
            } else {
                throw new Error('Unsupported operating system');
            }
        } catch (error: any) {
            console.error(`Error in findAndCaptureEmulator: ${error.message}`);
            throw error;
        }
    }

    private async findAdb(): Promise<string | null> {
        const potentialPaths: string[] = [];

        if (this.isWindows) {
            potentialPaths.push(
                path.join(process.env['LOCALAPPDATA'] || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
                path.join('C:', 'Android', 'sdk', 'platform-tools', 'adb.exe'),
                path.join(process.env['ProgramFiles'] || '', 'Android', 'android-sdk', 'platform-tools', 'adb.exe')
            );
        } else if (os.platform() === 'linux') {
            potentialPaths.push(
                path.join(process.env['HOME'] || '', 'Android', 'Sdk', 'platform-tools', 'adb'),
                '/usr/bin/adb',
                '/usr/local/bin/adb'
            );
        } else if (os.platform() === 'darwin') {
            potentialPaths.push(
                path.join(process.env['HOME'] || '', 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
                '/usr/bin/adb',
                '/usr/local/bin/adb'
            );
        }

        for (const adbPath of potentialPaths) {
            if (await this.fileExists(adbPath)) {
                return adbPath;
            }
        }

        return null;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async handleAndroidEmulator(): Promise<{ screenshot: string }> {
        try {
            // Get list of connected devices
            const { stdout: devicesOutput } = await execFileAsync(this.adbPath as string, ['devices']);
            const deviceLines = devicesOutput.trim().split('\n').slice(1); // Skip the first line
            const devices = deviceLines
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line) => {
                    const [id, status] = line.split('\t');
                    return { id, status };
                })
                .filter((device) => device.id.startsWith('emulator') && device.status === 'device');

            if (devices.length === 0) {
                throw new Error('No running Android emulators found');
            }

            const deviceId = devices[0].id;

            // Capture screenshot
            const screenshotPath = path.join(os.tmpdir(), 'emulator_screenshot.png');
            await execFileAsync(this.adbPath as string, ['-s', deviceId, 'exec-out', 'screencap', '-p'], {
                maxBuffer: 1024 * 1024 * 10, // 10 MB buffer for screenshot
                encoding: 'buffer'
            }).then(({ stdout }) => {
                return fs.writeFile(screenshotPath, stdout);
            });

            const screenshotBuffer = await fs.readFile(screenshotPath);
            const screenshotBase64 = screenshotBuffer.toString('base64');

            const screenshot = `data:image/png;base64,${screenshotBase64}`;

            return { screenshot };
        } catch (error: any) {
            console.error(`Error handling Android emulator: ${error.message}`);
            throw error;
        }
    }

    private async handleIOSSimulator(): Promise<{ screenshot: string }> {
        try {
            const xcrunPath = await this.findXcrun();

            if (!xcrunPath) {
                throw new Error('xcrun not found. Please ensure Xcode Command Line Tools are installed.');
            }

            const execFileAsyncXcrun = promisify(execFile);

            const { stdout } = await execFileAsyncXcrun(xcrunPath, ['simctl', 'list', 'devices', '--json']);
            const devicesInfo = JSON.parse(stdout);

            const bootedDevices: Array<{ udid: string; state: string }> = [];
            for (const runtime in devicesInfo.devices) {
                for (const device of devicesInfo.devices[runtime]) {
                    if (device.state === 'Booted') {
                        bootedDevices.push(device);
                    }
                }
            }

            if (bootedDevices.length === 0) {
                throw new Error('No running iOS simulators found');
            }

            const simulatorId = bootedDevices[0].udid;

            const screenshotPath = path.join(os.tmpdir(), 'simulator_screenshot.png');
            await execFileAsyncXcrun(xcrunPath, ['simctl', 'io', simulatorId, 'screenshot', screenshotPath]);

            const screenshotBuffer = await fs.readFile(screenshotPath);
            const screenshotBase64 = screenshotBuffer.toString('base64');

            const screenshot = `data:image/png;base64,${screenshotBase64}`;

            return { screenshot };
        } catch (error: any) {
            console.error(`Error handling iOS simulator: ${error.message}`);
            throw error;
        }
    }

    private async findXcrun(): Promise<string | null> {
        const potentialPaths = ['/usr/bin/xcrun', '/usr/local/bin/xcrun'];

        for (const xcrunPath of potentialPaths) {
            if (await this.fileExists(xcrunPath)) {
                return xcrunPath;
            }
        }

        try {
            const { stdout } = await execFileAsync('which', ['xcrun']);
            const xcrunPath = stdout.trim();
            if (xcrunPath && await this.fileExists(xcrunPath)) {
                return xcrunPath;
            }
        } catch {
            // Ignore errors
        }

        return null;
    }
}