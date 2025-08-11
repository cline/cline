import type { IncomingMessage, Server, ServerResponse } from "node:http"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { openExternal } from "@/utils/env"
import { SharedUriHandler } from "@/services/uri/SharedUriHandler"

const SERVER_TIMEOUT = 10 * 60 * 1000 // 10 minutes

/**
 * Handles OAuth authentication flow by creating a local server to receive tokens.
 */
export class AuthHandler {
	private static instance: AuthHandler | null = null

	private port = 0
	private server: Server | null = null
	private serverCreationPromise: Promise<void> | null = null
	private timeoutId: NodeJS.Timeout | null = null
	private enabled: boolean = false

	private constructor() {}

	/**
	 * Gets the singleton instance of AuthHandler
	 * @returns The singleton AuthHandler instance
	 */
	public static getInstance(): AuthHandler {
		if (!AuthHandler.instance) {
			AuthHandler.instance = new AuthHandler()
		}
		return AuthHandler.instance
	}

	public setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}

	public async getCallbackUri(): Promise<string> {
		if (!this.enabled) {
			throw Error("AuthHandler was not enabled")
		}

		if (!this.server) {
			// If server creation is already in progress, wait for it
			if (this.serverCreationPromise) {
				await this.serverCreationPromise
			} else {
				// Start server creation and track the promise
				this.serverCreationPromise = this.createServer()
				await this.serverCreationPromise
			}
		} else {
			this.updateTimeout()
		}

		return `http://127.0.0.1:${this.port}`
	}

	private async createServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				const server = http.createServer(this.handleRequest.bind(this))

				// Use callback to ensure server is ready before getting address
				server.listen(0, "127.0.0.1", () => {
					const address = server.address()
					if (!address) {
						console.error("AuthHandler: Failed to get server address")
						this.server = null
						this.port = 0
						this.serverCreationPromise = null
						reject(new Error("Failed to get server address"))
						return
					}

					// Get the assigned port and set up the server
					this.port = (address as AddressInfo).port
					this.server = server
					console.log("AuthHandler: Server started on port", this.port)
					this.updateTimeout()
					this.serverCreationPromise = null
					resolve()
				})

				server.on("error", (error) => {
					console.error("AuthHandler: Server error", error)
					this.server = null
					this.port = 0
					this.serverCreationPromise = null
					reject(error)
				})
			} catch (error) {
				console.error("AuthHandler: Failed to create server", error)
				this.server = null
				this.port = 0
				this.serverCreationPromise = null
				reject(error)
			}
		})
	}

	private updateTimeout(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
		}

		this.timeoutId = setTimeout(() => this.stop(), SERVER_TIMEOUT)
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		console.log("AuthHandler: Received request", req.url)

		if (!req.url) {
			this.sendResponse(res, 404, "text/plain", "Not found")
			return
		}

		try {
			// Convert HTTP URL to vscode.Uri and use shared handler directly
			const fullUrl = `http://127.0.0.1:${this.port}${req.url}`
			const uri = SharedUriHandler.convertHttpUrlToUri(fullUrl)

			// Use SharedUriHandler directly - it handles all validation and processing
			const success = await SharedUriHandler.handleUri(uri)

			if (success) {
				this.sendResponse(res, 200, "text/html", TOKEN_REQUEST_VIEW)
			} else {
				this.sendResponse(res, 400, "text/plain", "Bad request")
			}
		} catch (error) {
			console.error("AuthHandler: Error processing request", error)
			this.sendResponse(res, 400, "text/plain", "Bad request")
		} finally {
			// Stop the server after handling any request (success or failure)
			this.stop()
		}
	}

	private sendResponse(res: ServerResponse, status: number, type: string, content: string): void {
		res.writeHead(status, { "Content-Type": type })
		res.end(content)
	}

	private async openBrowser(callbackUrl: URL): Promise<void> {
		await openExternal(callbackUrl.toString())
	}

	public stop(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
			this.timeoutId = null
		}

		if (this.server) {
			this.server.close()
			this.server = null
		}

		this.serverCreationPromise = null
		this.port = 0
	}

	public dispose(): void {
		this.stop()
	}
}

const TOKEN_REQUEST_VIEW = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cline - Authentication Success</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@300;400;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Azeret Mono', monospace;
            background-color: #ffffff;
            color: #333333;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1.25;
        }
        
        .container {
            text-align: center;
            padding: 32px;
            background-color: #f8f8f8;
            border: 1px solid #e1e1e1;
            border-radius: 6px;
            max-width: 480px;
            width: 90%;
        }
        
        .checkmark {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background-color: #73c991;
            margin: 0 auto 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .checkmark::after {
            content: '✓';
            font-size: 24px;
            color: #ffffff;
            font-weight: bold;
        }
        
        h1 {
            font-size: 1.5rem;
            margin-bottom: 16px;
            font-weight: 400;
            color: #333333;
        }
        
        p {
            font-size: 0.875rem;
            line-height: 1.5;
            margin-bottom: 24px;
            color: #666666;
        }
        
        .countdown {
            font-size: 0.8125rem;
            color: #666666;
            background-color: #ffffff;
            border: 1px solid #d1d1d1;
            padding: 8px 16px;
            border-radius: 4px;
            display: inline-block;
        }
        
        @media (max-width: 480px) {
            .container {
                padding: 24px 16px;
            }
            
            h1 {
                font-size: 1.25rem;
            }
            
            p {
                font-size: 0.8125rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark"></div>
        <h1>Authentication Successful</h1>
        <p>Your authentication token has been securely sent back to your IDE. You can now return to your development environment to continue working.</p>
        <div class="countdown">Feel free to close this window and continue in your IDE</div>
    </div>
</body>
</html>`
