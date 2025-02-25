import * as vscode from "vscode"

/**
 * Opens an image in a VS Code webview panel
 * @param imageUrl The URL of the image to open
 * @param title Optional title for the webview panel
 */
export function openImageInWebview(imageUrl: string, title: string = "Image Viewer") {
	// Create and show panel
	const panel = vscode.window.createWebviewPanel("imageViewer", title, vscode.ViewColumn.One, {
		enableScripts: true,
		retainContextWhenHidden: true,
	})

	// Set the webview's HTML content
	panel.webview.html = getWebviewContent(imageUrl)
}

/**
 * Generates the HTML content for the webview panel
 * @param imageUrl The URL of the image to display
 * @returns HTML content as a string
 */
function getWebviewContent(imageUrl: string) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Viewer</title>
    <style>
        body {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
        }
        .image-container {
            max-width: 100%;
            max-height: 90vh;
            overflow: auto;
            margin-bottom: 10px;
            text-align: center;
        }
        img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 0 auto;
        }
        .url-display {
            margin-top: 10px;
            word-break: break-all;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="image-container">
        <img src="${imageUrl}" alt="Image" />
    </div>
    <div class="url-display">
        Source: ${imageUrl}
    </div>
</body>
</html>`
}
