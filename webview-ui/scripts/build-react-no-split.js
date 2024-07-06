#!/usr/bin/env node

/**
 * A script that overrides some of the create-react-app build script configurations
 * in order to disable code splitting/chunking and rename the output build files so
 * they have no hash. (Reference: https://mtm.dev/disable-code-splitting-create-react-app).
 *
 * This is crucial for getting React webview code to run because VS Code expects a
 * single (consistently named) JavaScript and CSS file when configuring webviews.
 */

const rewire = require("rewire")
const defaults = rewire("react-scripts/scripts/build.js")
const config = defaults.__get__("config")

// Disable code splitting
config.optimization.splitChunks = {
	cacheGroups: {
		default: false,
	},
}

// Disable code chunks
config.optimization.runtimeChunk = false

// Rename main.{hash}.js to main.js
config.output.filename = "static/js/[name].js"

// Rename main.{hash}.css to main.css
config.plugins[5].options.filename = "static/css/[name].css"
config.plugins[5].options.moduleFilename = () => "static/css/main.css"
