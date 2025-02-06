/**
 * See: https://code.visualstudio.com/api/working-with-extensions/testing-extension
 */

import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	label: 'integrationTest',
	files: 'out-integration/test/**/*.test.js',
	workspaceFolder: '.',
	mocha: {
		ui: 'tdd',
		timeout: 60000,
	},
	launchArgs: [
		'--enable-proposed-api=RooVeterinaryInc.roo-cline',
		'--disable-extensions'
	]
});
