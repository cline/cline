#!/usr/bin/env node

/**
 * Valyu CLI Tool - Complete API Implementation
 * Supports: Search, Answer, Contents, DeepResearch
 * Usage: valyu <command> [options]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const VALYU_API_BASE = 'https://api.valyu.ai/v1';
const CONFIG_DIR = join(homedir(), '.valyu');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Get API key from multiple sources (in order of priority):
 * 1. Environment variable (VALYU_API_KEY)
 * 2. Config file (~/.valyu/config.json)
 */
function getApiKey() {
  // 1. Check environment variable first
  if (process.env.VALYU_API_KEY) {
    return process.env.VALYU_API_KEY;
  }

  // 2. Try config file (~/.valyu/config.json)
  if (existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.apiKey) {
        return config.apiKey;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  return null;
}

/**
 * Save API key to config file
 */
function saveApiKey(apiKey) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  let config = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (e) {
      // Start fresh if parse fails
    }
  }

  config.apiKey = apiKey;
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  return true;
}

/**
 * Return setup required response
 */
function setupRequiredResponse() {
  return {
    success: false,
    setup_required: true,
    message: "Valyu API key not configured. Please ask the user for their API key from https://platform.valyu.ai, then run: scripts/valyu setup <api-key>"
  };
}

// Search type configurations
const SEARCH_CONFIGS = {
  web: { search_type: 'web' },
  finance: {
    search_type: 'proprietary',
    included_sources: [
      'valyu/valyu-stocks', 'valyu/valyu-sec-filings', 'valyu/valyu-earnings-US',
      'valyu/valyu-balance-sheet-US', 'valyu/valyu-income-statement-US',
      'valyu/valyu-cash-flow-US', 'valyu/valyu-dividends-US',
      'valyu/valyu-insider-transactions-US', 'valyu/valyu-crypto', 'valyu/valyu-forex'
    ]
  },
  paper: {
    search_type: 'proprietary',
    included_sources: ['valyu/valyu-arxiv', 'valyu/valyu-biorxiv', 'valyu/valyu-medrxiv', 'valyu/valyu-pubmed']
  },
  bio: {
    search_type: 'proprietary',
    included_sources: [
      'valyu/valyu-pubmed', 'valyu/valyu-biorxiv', 'valyu/valyu-medrxiv',
      'valyu/valyu-clinical-trials', 'valyu/valyu-drug-labels'
    ]
  },
  patent: { search_type: 'proprietary', included_sources: ['valyu/valyu-patents'] },
  sec: { search_type: 'proprietary', included_sources: ['valyu/valyu-sec-filings'] },
  economics: {
    search_type: 'proprietary',
    included_sources: [
      'valyu/valyu-bls', 'valyu/valyu-fred', 'valyu/valyu-world-bank',
      'valyu/valyu-worldbank-indicators', 'valyu/valyu-usaspending'
    ]
  },
  news: { search_type: 'news' }
};

async function apiRequest(endpoint, payload) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('SETUP_REQUIRED');
  }

  const response = await fetch(`${VALYU_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

async function search(searchType, query, maxResults = 10) {
  const config = SEARCH_CONFIGS[searchType];
  if (!config) {
    throw new Error(`Invalid search type: ${searchType}`);
  }

  const payload = {
    query,
    max_num_results: maxResults,
    ...config
  };

  const data = await apiRequest('/search', payload);

  return {
    success: true,
    type: 'search',
    searchType,
    query,
    resultCount: data.results?.length || 0,
    results: (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,
      source: r.source,
      relevance_score: r.relevance_score
    })),
    cost: data.total_deduction_dollars || 0
  };
}

async function answer(query, options = {}) {
  const payload = {
    query,
    search_type: options.searchType || 'all',
    data_max_price: options.dataMaxPrice || 40.0,
    fast_mode: options.fastMode || false,
    system_instructions: options.systemInstructions,
    structured_output: options.structuredOutput,
    included_sources: options.includedSources,
    start_date: options.startDate,
    end_date: options.endDate
  };

  // Remove undefined fields
  Object.keys(payload).forEach(key => 
    payload[key] === undefined && delete payload[key]
  );

  const data = await apiRequest('/answer', payload);

  return {
    success: true,
    type: 'answer',
    query,
    answer: data.contents,
    data_type: data.data_type,
    sources: data.search_results || [],
    cost: data.cost?.total_deduction_dollars || 0
  };
}

async function contents(urls, options = {}) {
  const payload = {
    urls: Array.isArray(urls) ? urls : [urls],
    response_length: options.responseLength || 'medium',
    extract_effort: options.extractEffort || 'auto',
    summary: options.summary !== undefined ? options.summary : false,
    max_price_dollars: options.maxPriceDollars || 0.1
  };

  const data = await apiRequest('/contents', payload);

  return {
    success: data.success,
    type: 'contents',
    urls_requested: data.urls_requested,
    urls_processed: data.urls_processed,
    urls_failed: data.urls_failed,
    results: (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,
      data_type: r.data_type,
      summary_success: r.summary_success,
      length: r.length
    })),
    total_cost: data.total_cost_dollars || 0
  };
}

async function deepresearchCreate(input, options = {}) {
  const payload = {
    input,
    model: options.model || 'lite',
    output_formats: options.outputFormats || ['markdown'],
    search: options.search,
    urls: options.urls,
    files: options.files,
    webhook_url: options.webhookUrl
  };

  // Remove undefined fields
  Object.keys(payload).forEach(key => 
    payload[key] === undefined && delete payload[key]
  );

  const data = await apiRequest('/deepresearch/tasks', payload);

  return {
    success: true,
    type: 'deepresearch_create',
    deepresearch_id: data.deepresearch_id,
    status: data.status,
    query: data.query,
    model: data.mode,
    webhook_secret: data.webhook_secret,
    created_at: data.created_at
  };
}

async function deepresearchStatus(taskId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('SETUP_REQUIRED');
  }

  const response = await fetch(`${VALYU_API_BASE}/deepresearch/tasks/${taskId}/status`, {
    method: 'GET',
    headers: { 'x-api-key': apiKey }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    success: true,
    type: 'deepresearch_status',
    deepresearch_id: data.deepresearch_id,
    status: data.status,
    query: data.query,
    output: data.output,
    pdf_url: data.pdf_url,
    sources: data.sources,
    progress: data.progress,
    usage: data.usage,
    completed_at: data.completed_at
  };
}

function printUsage() {
  console.log(`
Valyu CLI - Complete API Tool

SETUP COMMAND:
  valyu setup <api-key>
    Save your API key to ~/.valyu/config.json
    Get your key at: https://platform.valyu.ai

SEARCH COMMANDS:
  valyu search <type> <query> [maxResults]
    Types: web, finance, paper, bio, patent, sec, economics, news
    Example: valyu search web "AI news" 10

ANSWER COMMAND:
  valyu answer <query> [options]
    Options: --fast, --structured <json-schema>
    Example: valyu answer "What is quantum computing?" --fast

CONTENTS COMMAND:
  valyu contents <url> [options]
    Options: --summary [instructions], --structured <json-schema>
    Example: valyu contents "https://example.com" --summary
    Example: valyu contents "https://example.com" --summary "Key findings in 2 paragraphs"

DEEPRESEARCH COMMANDS:
  valyu deepresearch create <query> [options]
    Options: --model <fast|lite|heavy>, --pdf, --json <schema>
    Example: valyu deepresearch create "AI market trends" --model heavy --pdf

  valyu deepresearch status <task-id>
    Example: valyu deepresearch status f992a8ab-4c91-4322-905f-190107bd5a5b

API Key: Set VALYU_API_KEY env var OR run 'valyu setup <key>'
  `);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0].toLowerCase();

  // Handle setup command separately (before API key check)
  if (command === 'setup') {
    const apiKey = args[1];
    if (!apiKey) {
      console.error(JSON.stringify({
        success: false,
        error: 'Usage: valyu setup <api-key>'
      }, null, 2));
      process.exit(1);
    }

    try {
      saveApiKey(apiKey);
      console.log(JSON.stringify({
        success: true,
        type: 'setup',
        message: 'API key saved successfully to ~/.valyu/config.json',
        config_path: CONFIG_FILE
      }, null, 2));
      process.exit(0);
    } catch (error) {
      console.error(JSON.stringify({
        success: false,
        error: `Failed to save API key: ${error.message}`
      }, null, 2));
      process.exit(1);
    }
  }

  try {
    let result;

    if (command === 'search') {
      const searchType = args[1]?.toLowerCase();
      const query = args[2];
      const maxResults = args[3] ? parseInt(args[3]) : 10;
      
      if (!searchType || !query) {
        console.error('Usage: valyu search <type> <query> [maxResults]');
        process.exit(1);
      }
      
      result = await search(searchType, query, maxResults);

    } else if (command === 'answer') {
      const query = args[1];
      if (!query) {
        console.error('Usage: valyu answer <query> [--fast] [--structured <schema>]');
        process.exit(1);
      }

      const options = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--fast') options.fastMode = true;
        if (args[i] === '--structured' && args[i + 1]) {
          options.structuredOutput = JSON.parse(args[i + 1]);
          i++;
        }
      }

      result = await answer(query, options);

    } else if (command === 'contents') {
      const url = args[1];
      if (!url) {
        console.error('Usage: valyu contents <url> [--summary [instructions]] [--structured <schema>]');
        process.exit(1);
      }

      const options = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--summary') {
          if (args[i + 1] && !args[i + 1].startsWith('--')) {
            options.summary = args[i + 1];
            i++;
          } else {
            options.summary = true;
          }
        }
        if (args[i] === '--structured' && args[i + 1]) {
          options.summary = JSON.parse(args[i + 1]);
          i++;
        }
      }

      result = await contents(url, options);

    } else if (command === 'deepresearch') {
      const subcommand = args[1]?.toLowerCase();

      if (subcommand === 'create') {
        const query = args[2];
        if (!query) {
          console.error('Usage: valyu deepresearch create <query> [--model <fast|lite|heavy>] [--pdf]');
          process.exit(1);
        }

        const options = {};
        for (let i = 3; i < args.length; i++) {
          if (args[i] === '--model' && args[i + 1]) {
            options.model = args[i + 1];
            i++;
          }
          if (args[i] === '--pdf') {
            options.outputFormats = ['markdown', 'pdf'];
          }
        }

        result = await deepresearchCreate(query, options);

      } else if (subcommand === 'status') {
        const taskId = args[2];
        if (!taskId) {
          console.error('Usage: valyu deepresearch status <task-id>');
          process.exit(1);
        }

        result = await deepresearchStatus(taskId);

      } else {
        console.error('Valid deepresearch subcommands: create, status');
        process.exit(1);
      }

    } else {
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    if (error.message === 'SETUP_REQUIRED') {
      // Output normally (not as error) - this is just a setup prompt, not an error
      console.log(JSON.stringify({
        success: false,
        setup_required: true,
        message: "I need your Valyu API key to proceed. You can get one at https://platform.valyu.ai — once you have it, just share it with me and I'll set it up for you."
      }, null, 2));
      process.exit(0);
    } else {
      console.error(JSON.stringify({
        success: false,
        error: error.message
      }, null, 2));
      process.exit(1);
    }
  }
}

main();
