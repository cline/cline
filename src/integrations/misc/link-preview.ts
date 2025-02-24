import * as vscode from "vscode"
import axios from "axios"
import ogs from 'open-graph-scraper'

interface OpenGraphData {
  title?: string
  description?: string
  image?: string
  url?: string
  siteName?: string
  type?: string
}

/**
 * Fetches Open Graph metadata from a URL
 * @param url The URL to fetch metadata from
 * @returns Promise resolving to OpenGraphData
 */
export async function fetchOpenGraphData(url: string): Promise<OpenGraphData> {
  try {
    const options = {
      url: url,
      timeout: 5000,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; VSCodeExtension/1.0; +https://cline.bot)'
      },
      onlyGetOpenGraphInfo: false, // Get all metadata, not just Open Graph
      fetchOptions: {
        redirect: 'follow' // Follow redirects
      } as any
    }
    
    const { result } = await ogs(options)
    
    // Use type assertion to avoid TypeScript errors
    const data = result as any
    
    // Handle image URLs
    let imageUrl = data.ogImage?.[0]?.url || data.twitterImage?.[0]?.url
    
    // If the image URL is relative, make it absolute
    if (imageUrl && (imageUrl.startsWith('/') || imageUrl.startsWith('./'))) {
      try {
        // Extract the base URL and make the relative URL absolute
        const urlObj = new URL(url)
        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`
        imageUrl = new URL(imageUrl, baseUrl).href
      } catch (error) {
        console.error(`Error converting relative URL to absolute: ${imageUrl}`, error)
      }
    }
    
    return {
      title: data.ogTitle || data.twitterTitle || data.dcTitle || data.title || new URL(url).hostname,
      description: data.ogDescription || data.twitterDescription || data.dcDescription || data.description || 'No description available',
      image: imageUrl,
      url: data.ogUrl || url,
      siteName: data.ogSiteName || new URL(url).hostname,
      type: data.ogType
    }
  } catch (error) {
    console.error(`Error fetching Open Graph data for ${url}:`, error)
    // Return basic information based on the URL
    try {
      const urlObj = new URL(url)
      return {
        title: urlObj.hostname,
        description: url,
        url: url,
        siteName: urlObj.hostname
      }
    } catch {
      return {
        title: url,
        description: url,
        url: url
      }
    }
  }
}

/**
 * Checks if a URL is an image by making a HEAD request and checking the content type
 * @param url The URL to check
 * @returns Promise resolving to boolean indicating if the URL is an image
 */
export async function isImageUrl(url: string): Promise<boolean> {
  try {
    const response = await axios.head(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VSCodeExtension/1.0; +https://cline.bot)'
      },
      timeout: 3000
    })
    
    const contentType = response.headers['content-type']
    return contentType && contentType.startsWith('image/')
  } catch (error) {
    console.error(`Error checking if URL is an image: ${url}`, error)
    // If we can't determine, fall back to checking the file extension
    return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)
  }
}

/**
 * Opens a link preview in a VS Code webview panel
 * @param url The URL to preview
 */
export async function openLinkPreview(url: string): Promise<void> {
  // First check if it's an image
  const isImage = await isImageUrl(url)
  
  if (isImage) {
    // If it's an image, show it directly
    openImagePreview(url)
    return
  }
  
  // Otherwise, fetch Open Graph data and show a rich preview
  const ogData = await fetchOpenGraphData(url)
  openRichLinkPreview(url, ogData)
}

/**
 * Opens an image preview in a VS Code webview panel
 * @param imageUrl The URL of the image to preview
 */
function openImagePreview(imageUrl: string): void {
  const panel = vscode.window.createWebviewPanel(
    'linkPreview',
    'Image Preview',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  )
  
  panel.webview.html = getImagePreviewHtml(imageUrl)
}

/**
 * Opens a rich link preview in a VS Code webview panel
 * @param url The URL to preview
 * @param ogData The Open Graph data for the URL
 */
function openRichLinkPreview(url: string, ogData: OpenGraphData): void {
  const panel = vscode.window.createWebviewPanel(
    'linkPreview',
    ogData.title || 'Link Preview',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  )
  
  panel.webview.html = getRichLinkPreviewHtml(url, ogData)
}

/**
 * Generates HTML for an image preview
 * @param imageUrl The URL of the image to preview
 * @returns HTML content as a string
 */
function getImagePreviewHtml(imageUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Preview</title>
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
        .open-browser {
            margin-top: 15px;
            cursor: pointer;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 2px;
            font-family: var(--vscode-font-family);
        }
        .open-browser:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="image-container">
        <img src="${imageUrl}" alt="Image Preview" />
    </div>
    <div class="url-display">
        Source: ${imageUrl}
    </div>
    <button class="open-browser" onclick="openInBrowser()">Open in Browser</button>
    <script>
        function openInBrowser() {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({
                type: 'openInBrowser',
                url: '${imageUrl}'
            });
        }
    </script>
</body>
</html>`
}

/**
 * Generates HTML for a rich link preview
 * @param url The URL to preview
 * @param ogData The Open Graph data for the URL
 * @returns HTML content as a string
 */
function getRichLinkPreviewHtml(url: string, ogData: OpenGraphData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${ogData.title || 'Link Preview'}</title>
    <style>
        body {
            display: flex;
            flex-direction: column;
            padding: 20px;
            box-sizing: border-box;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            line-height: 1.5;
        }
        .preview-container {
            max-width: 800px;
            margin: 0 auto;
            width: 100%;
        }
        .preview-header {
            margin-bottom: 20px;
        }
        .preview-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .preview-site {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 5px;
        }
        .preview-url {
            font-size: 14px;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 15px;
            word-break: break-all;
        }
        .preview-image {
            max-width: 100%;
            max-height: 400px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        .preview-description {
            font-size: 16px;
            margin-bottom: 20px;
            line-height: 1.6;
        }
        .open-browser {
            cursor: pointer;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            font-family: var(--vscode-font-family);
            align-self: flex-start;
        }
        .open-browser:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .no-data {
            font-style: italic;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="preview-container">
        <div class="preview-header">
            <div class="preview-title">${ogData.title || 'No title available'}</div>
            <div class="preview-site">${ogData.siteName || new URL(url).hostname}</div>
            <div class="preview-url">${ogData.url || url}</div>
        </div>
        
        ${ogData.image ? `<img class="preview-image" src="${ogData.image}" alt="Preview image" />` : ''}
        
        <div class="preview-description">
            ${ogData.description || '<span class="no-data">No description available</span>'}
        </div>
        
        <button class="open-browser" onclick="openInBrowser()">Open in Browser</button>
    </div>
    
    <script>
        function openInBrowser() {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({
                type: 'openInBrowser',
                url: '${url}'
            });
        }
    </script>
</body>
</html>`
}
