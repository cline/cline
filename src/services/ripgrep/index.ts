// This service now delegates to the host bridge for cross-IDE compatibility
export { regexSearchFiles, getBinPath } from "@utils/search"

/*
This file previously provided functionality to perform regex searches on files using ripgrep.
The implementation has been moved to the host bridge system for cross-IDE compatibility.

The functions are now available through the host bridge:
- regexSearchFiles: Performs regex searches on files
- getBinPath: Locates the ripgrep binary within the host installation

For VSCode, the actual implementation is in src/hosts/vscode/search/
For other IDEs, different implementations can be provided through their respective host bridges.
*/
