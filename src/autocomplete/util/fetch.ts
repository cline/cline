import { globalAgent } from 'https'
import * as fs from 'node:fs'
import tls from 'node:tls'
import * as z from 'zod'

import * as followRedirects from 'follow-redirects'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import fetch, { RequestInit, Response } from 'node-fetch'

export const clientCertificateOptionsSchema = z.object({
    cert: z.string(),
    key: z.string(),
    passphrase: z.string().optional(),
})

export const requestOptionsSchema = z.object({
    timeout: z.number().optional(),
    verifySsl: z.boolean().optional(),
    caBundlePath: z.union([z.string(), z.array(z.string())]).optional(),
    proxy: z.string().optional(),
    headers: z.record(z.string()).optional(),
    extraBodyProperties: z.record(z.any()).optional(),
    noProxy: z.array(z.string()).optional(),
    clientCertificate: clientCertificateOptionsSchema.optional(),
})

export type RequestOptions = z.infer<typeof requestOptionsSchema>

const { http, https } = (followRedirects as any).default

export function fetchwithRequestOptions(
    url_: URL | string,
    init?: RequestInit,
    requestOptions?: RequestOptions
): Promise<Response> {
    let url = url_
    if (typeof url === 'string') {
        url = new URL(url)
    }

    const TIMEOUT = 7200 // 7200 seconds = 2 hours

    let globalCerts: string[] = []
    if (process.env.IS_BINARY) {
        if (Array.isArray(globalAgent.options.ca)) {
            globalCerts = [...globalAgent.options.ca.map((cert) => cert.toString())]
        } else if (typeof globalAgent.options.ca !== 'undefined') {
            globalCerts.push(globalAgent.options.ca.toString())
        }
    }
    const ca = Array.from(new Set([...tls.rootCertificates, ...globalCerts]))
    const customCerts =
        typeof requestOptions?.caBundlePath === 'string' ? [requestOptions?.caBundlePath] : requestOptions?.caBundlePath
    if (customCerts) {
        ca.push(...customCerts.map((customCert) => fs.readFileSync(customCert, 'utf8')))
    }

    const timeout = (requestOptions?.timeout ?? TIMEOUT) * 1000 // measured in ms

    const agentOptions: { [key: string]: any } = {
        ca,
        rejectUnauthorized: requestOptions?.verifySsl,
        timeout,
        sessionTimeout: timeout,
        keepAlive: true,
        keepAliveMsecs: timeout,
    }

    // Handle ClientCertificateOptions
    if (requestOptions?.clientCertificate) {
        agentOptions.cert = fs.readFileSync(requestOptions.clientCertificate.cert, 'utf8')
        agentOptions.key = fs.readFileSync(requestOptions.clientCertificate.key, 'utf8')
        if (requestOptions.clientCertificate.passphrase) {
            agentOptions.passphrase = requestOptions.clientCertificate.passphrase
        }
    }

    const proxy = requestOptions?.proxy

    // Create agent
    const protocol = url.protocol === 'https:' ? https : http
    const agent =
        proxy && !requestOptions?.noProxy?.includes(url.hostname)
            ? protocol === https
                ? new HttpsProxyAgent(proxy, agentOptions)
                : new HttpProxyAgent(proxy, agentOptions)
            : new protocol.Agent(agentOptions)

    let headers: { [key: string]: string } = {}
    for (const [key, value] of Object.entries(init?.headers || {})) {
        headers[key] = value as string
    }
    headers = {
        ...headers,
        ...requestOptions?.headers,
    }

    // Replace localhost with 127.0.0.1
    if (url.hostname === 'localhost') {
        url.hostname = '127.0.0.1'
    }

    // add extra body properties if provided
    let updatedBody: string | undefined = undefined
    try {
        if (requestOptions?.extraBodyProperties && typeof init?.body === 'string') {
            const parsedBody = JSON.parse(init.body)
            updatedBody = JSON.stringify({
                ...parsedBody,
                ...requestOptions.extraBodyProperties,
            })
        }
    } catch (e) {
        console.log('Unable to parse HTTP request body: ', e)
    }

    // fetch the request with the provided options
    const resp = fetch(url, {
        ...init,
        body: updatedBody ?? init?.body,
        headers: headers,
        agent: agent,
    })

    return resp
}

export interface APIError extends Error {
    response?: Response
}
export const RETRY_AFTER_HEADER = 'Retry-After'

export const withExponentialBackoff = async <T>(apiCall: () => Promise<T>, maxTries = 5, initialDelaySeconds = 1) => {
    for (let attempt = 0; attempt < maxTries; attempt++) {
        try {
            const result = await apiCall()
            return result
        } catch (error: any) {
            if ((error as APIError).response?.status === 429) {
                const retryAfter = (error as APIError).response?.headers.get(RETRY_AFTER_HEADER)
                const delay = retryAfter ? parseInt(retryAfter, 10) : initialDelaySeconds * 2 ** attempt
                console.log(`Hit rate limit. Retrying in ${delay} seconds (attempt ${attempt + 1})`)
                await new Promise((resolve) => setTimeout(resolve, delay * 1000))
            } else {
                throw error // Re-throw other errors
            }
        }
    }
    throw new Error(`Failed to make API call after ${maxTries} retries`)
}
