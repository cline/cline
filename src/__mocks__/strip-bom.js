// Mock implementation of strip-bom
module.exports = function stripBom(string) {
	if (typeof string !== "string") {
		throw new TypeError("Expected a string")
	}

	// Removes UTF-8 BOM
	if (string.charCodeAt(0) === 0xfeff) {
		return string.slice(1)
	}

	return string
}
