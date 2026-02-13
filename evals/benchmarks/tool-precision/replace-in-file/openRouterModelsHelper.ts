import axios from "axios";
import path from "path";
import fs from "fs/promises";

// Minimal type for what we need from OpenRouter model info in evals
export interface EvalOpenRouterModelInfo {
    id: string;
    contextWindow: number;
    inputPrice?: number; // Price per million tokens
    outputPrice?: number; // Price per million tokens
    // Add any other fields if they become necessary for evals
}

function logHelper(isVerbose: boolean, message: string) {
    if (isVerbose) {
        console.log(`[OpenRouterModelsHelper] ${message}`);
    }
}

/**
 * Ensures the cache directory exists within evals and returns its path
 */
async function ensureEvalCacheDirectoryExists(): Promise<string> {
    // Cache directory within evals, e.g., evals/.cache/
    const cacheDir = path.join(__dirname, "..", ".cache");
    await fs.mkdir(cacheDir, { recursive: true });
    return cacheDir;
}

/**
 * Fetches, parses, and caches OpenRouter model data.
 * Tries to read from a local cache first.
 * @param isVerbose Enable verbose logging
 * @returns A record of model IDs to their info.
 */
export async function loadOpenRouterModelData(isVerbose: boolean = false): Promise<Record<string, EvalOpenRouterModelInfo>> {
    const cacheDir = await ensureEvalCacheDirectoryExists();
    const cacheFilePath = path.join(cacheDir, "openRouterModels.json");
    let models: Record<string, EvalOpenRouterModelInfo> = {};

    try {
        const stats = await fs.stat(cacheFilePath).catch(() => null);
        // Use cache if less than 24 hours old
        if (stats && (Date.now() - stats.mtimeMs < 24 * 60 * 60 * 1000)) {
            logHelper(isVerbose, "Using cached OpenRouter model data.");
            const fileContents = await fs.readFile(cacheFilePath, "utf8");
            models = JSON.parse(fileContents);
            if (Object.keys(models).length > 0) {
                return models;
            }
            logHelper(isVerbose, "Cache was empty or invalid, fetching fresh data.");
        } else if (stats) {
            logHelper(isVerbose, "Cached OpenRouter model data is stale, fetching fresh data.");
        } else {
            logHelper(isVerbose, "No cached OpenRouter model data found, fetching fresh data.");
        }
    } catch (e) {
        logHelper(isVerbose, `Error accessing cache, fetching fresh data: ${e}`);
    }

    try {
        const response = await axios.get("https://openrouter.ai/api/v1/models");
        if (response.data?.data) {
            const rawModels = response.data.data;
            const parsedModels: Record<string, EvalOpenRouterModelInfo> = {};
            const parsePrice = (price: any) => price ? parseFloat(price) * 1_000_000 : undefined;

            for (const rawModel of rawModels) {
                parsedModels[rawModel.id] = {
                    id: rawModel.id,
                    contextWindow: rawModel.context_length ?? 0,
                    inputPrice: parsePrice(rawModel.pricing?.prompt),
                    outputPrice: parsePrice(rawModel.pricing?.completion),
                };
            }
            await fs.writeFile(cacheFilePath, JSON.stringify(parsedModels, null, 2));
            logHelper(isVerbose, `Fetched and cached ${Object.keys(parsedModels).length} OpenRouter models.`);
            return parsedModels;
        } else {
            logHelper(isVerbose, "Invalid response structure from OpenRouter API.");
        }
    } catch (error) {
        logHelper(isVerbose, `Error fetching OpenRouter models: ${error}. Attempting to use stale cache if available.`);
        // Attempt to read stale cache as a last resort if fetching failed
        try {
            const fileContents = await fs.readFile(cacheFilePath, "utf8");
            models = JSON.parse(fileContents);
            if (Object.keys(models).length > 0) {
                logHelper(isVerbose, "Successfully loaded stale cache after fetch failure.");
                return models;
            }
        } catch (cacheError) {
            logHelper(isVerbose, `Failed to read stale cache: ${cacheError}. Proceeding without OpenRouter model data.`);
        }
    }
    // Return empty if all attempts fail, so the caller can decide how to handle it
    return {};
}