# AWS Bedrock Model Updates and Cost Calculation Improvements

## Overview

This pull request updates the AWS Bedrock model definitions with the latest pricing information and improves cost calculation for API providers. The changes ensure accurate cost tracking for both standard API calls and prompt cache operations.

## Changes

### 1. Updated AWS Bedrock Model Definitions

- Updated pricing information for all AWS Bedrock models to match the published list prices for US-West-2 as of March 11, 2025
- Added support for new models:
    - Amazon Nova Pro with latency optimized inference
    - Meta Llama 3.3 (70B) Instruct
    - Meta Llama 3.2 models (90B, 11B, 3B, 1B)
    - Meta Llama 3.1 models (405B, 70B, 8B)
- Added detailed model descriptions for better user understanding
- Added `supportsComputerUse` flag to relevant models

### 2. Enhanced Cost Calculation

- Implemented a unified internal cost calculation function that handles:
    - Base input token costs
    - Output token costs
    - Cache creation (writes) costs
    - Cache read costs
- Created two specialized cost calculation functions:
    - `calculateApiCostAnthropic`: For Anthropic-compliant usage where input tokens count does NOT include cached tokens
    - `calculateApiCostOpenAI`: For OpenAI-compliant usage where input tokens count INCLUDES cached tokens

### 3. Improved Custom ARN Handling in Bedrock Provider

- Enhanced model detection for custom ARNs by implementing a normalized string comparison
- Added better error handling and user feedback for custom ARN issues
- Improved region handling for cross-region inference
- Fixed AWS cost calculation when using a custom ARN, including ARNs for intelligent prompt routing

### 4. Comprehensive Test Coverage

- Added extensive unit tests for both cost calculation functions
- Tests cover various scenarios including:
    - Basic input/output costs
    - Cache writes costs
    - Cache reads costs
    - Combined cost calculations
    - Edge cases (missing prices, zero tokens, undefined values)

## Benefits

1. **Accurate Cost Tracking**: Users will see more accurate cost estimates for their API usage, including prompt cache operations
2. **Support for Latest Models**: Access to the newest AWS Bedrock models with correct pricing information
3. **Better Error Handling**: Improved feedback when using custom ARNs or encountering region-specific issues
4. **Consistent Cost Calculation**: Standardized approach to cost calculation across different API providers

## Testing

All tests are passing, including the new cost calculation tests and updated Bedrock provider tests.
