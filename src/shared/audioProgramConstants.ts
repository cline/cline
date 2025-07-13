export const AUDIO_PROGRAM_CONFIG = {
	darwin: {
		command: "rec",
		fallbackPaths: ["/usr/local/bin/rec", "/opt/homebrew/bin/rec"],
		getArgs: (outputFile: string) => ["-c", "1", "-e", "signed", "-b", "16", outputFile],
		error: "It looks like your system is missing the 'SoX' audio utility, which is required for voice recording. To install it, please ensure you are in **Act Mode** and then send this message. I will handle the installation for you.\n\n**Installation command:** `brew install sox`",
	},
	linux: {
		command: "arecord",
		fallbackPaths: ["/usr/bin/arecord"],
		getArgs: (outputFile: string) => ["-f", "cd", "-t", "wav", "-d", "0", "-c", "1", outputFile],
		error: "It looks like your system is missing the 'ALSA' audio utility, which is required for voice recording. To install it, please ensure you are in **Act Mode** and then send this message. I will handle the installation for you.\n\n**Installation command:** `sudo apt-get install alsa-utils`",
	},
	win32: {
		command: "sox",
		fallbackPaths: ["C:\\Program Files (x86)\\sox\\sox.exe"],
		getArgs: (outputFile: string) => ["-t", "waveaudio", "default", "-c", "1", "-e", "signed", "-b", "16", outputFile],
		error: "It looks like your system is missing the 'SoX' audio utility, which is required for voice recording. To install it, please ensure you are in **Act Mode** and then send this message. I will handle the installation for you.\n\n**Installation command:** `winget install ChrisBagwell.SoX`",
	},
}
