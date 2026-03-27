# AWS Bedrock AgentCore Integration

Combine Valyu's real-time search capabilities with AWS Bedrock AgentCore for secure, scalable, and auditable AI agent deployments.

Build sophisticated AI agents that can search financial data, academic papers, SEC filings, patents, and more with enterprise-grade security, OAuth authentication, and CloudTrail audit logging.

## Why AWS Bedrock AgentCore + Valyu?

- **7 Specialized Search Tools**: Financial data, SEC filings, academic papers, patents, biomedical research, web search, and economic indicators
- **Enterprise Security**: OAuth 2.0 authentication, Cognito integration, IAM policies, and CloudTrail audit logging
- **Production Infrastructure**: Deploy to AWS with managed scaling, monitoring, and high availability
- **Simple Integration**: Works with Strands Agents out of the box

## Available Search Tools

| Tool | Best For | Data Sources |
|------|----------|--------------|
| webSearch | News, current events, general information | Web pages, news sites |
| financeSearch | Stock prices, earnings, market analysis | Stocks, forex, crypto, balance sheets |
| paperSearch | Literature review, academic research | arXiv, PubMed, bioRxiv, medRxiv |
| bioSearch | Medical research, drug information | PubMed, clinical trials, FDA labels |
| patentSearch | Prior art, IP research | USPTO patents |
| secSearch | Company analysis, due diligence | SEC filings (10-K, 10-Q, 8-K, proxy) |
| economicsSearch | Economic indicators, policy research | BLS, FRED, World Bank, US Spending |

## Quick Start

### Installation

```bash
# For local development with Strands Agents
pip install "valyu-agentcore[strands]"

# For AWS AgentCore Gateway/Runtime deployment
pip install "valyu-agentcore[agentcore]"
```

### Environment Setup

```bash
export VALYU_API_KEY="your-valyu-api-key"
export AWS_REGION="us-east-1"  # Optional, defaults to us-east-1
```

### Your First Agent

```python
from valyu_agentcore import webSearch
from strands import Agent
from strands.models import BedrockModel

agent = Agent(
    model=BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"),
    tools=[webSearch()],
)

response = agent("What are the latest developments in quantum computing?")
print(response)
```

### Multi-Tool Agent

```python
from valyu_agentcore import webSearch, financeSearch, secSearch, paperSearch
from strands import Agent
from strands.models import BedrockModel

agent = Agent(
    model=BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"),
    tools=[
        webSearch(),
        financeSearch(),
        secSearch(),
        paperSearch(),
    ],
)

response = agent("Analyze NVIDIA's competitive position in the AI chip market")
print(response)
```

### Using Tool Groups

```python
from valyu_agentcore import ValyuTools
from strands import Agent
from strands.models import BedrockModel

tools = ValyuTools(max_num_results=5)

# Financial analysis agent
financial_agent = Agent(
    model=BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"),
    tools=tools.financial_tools(),  # Includes: financeSearch, secSearch, economicsSearch
)

# Research agent
research_agent = Agent(
    model=BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"),
    tools=tools.research_tools(),  # Includes: paperSearch, bioSearch, patentSearch
)

# All tools
complete_agent = Agent(
    model=BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"),
    tools=tools.all(),  # All 7 search tools
)
```

## Deployment Options

### Option 1: Local Development

Best for prototyping and testing.

```python
from valyu_agentcore import webSearch
from strands import Agent
from strands.models import BedrockModel

agent = Agent(
    model=BedrockModel(model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"),
    tools=[webSearch()],
)
```

### Option 2: AgentCore Gateway (Recommended for Production)

Enterprise-grade deployment with OAuth authentication, centralized API key management, and CloudTrail logging.

```python
from valyu_agentcore.gateway import setup_valyu_gateway, GatewayAgent

config = setup_valyu_gateway()
print(f"Gateway URL: {config.gateway_url}")

with GatewayAgent.from_config() as agent:
    response = agent("Search for NVIDIA SEC filings")
    print(response)
```

### Option 3: AgentCore Runtime

Full AWS-managed deployment with auto-scaling, streaming, and lifecycle management.

```bash
cd examples/runtime
agentcore configure --entrypoint agent.py --non-interactive --name valyuagent
agentcore launch
agentcore invoke '{"prompt": "What is NVIDIA stock price?"}'
```

## Tool Configuration

```python
from valyu_agentcore import financeSearch

tool = financeSearch(
    api_key="val_xxx",
    search_type="all",
    max_num_results=10,
    max_price=0.50,
    relevance_threshold=0.7,
    excluded_sources=["reddit.com"],
    included_sources=["reuters.com"],
    category="quarterly earnings",
)
```

## Resources

- **GitHub**: Source code, examples, and CloudFormation templates
- **AWS Bedrock AgentCore**: Official AWS documentation
- **Strands Agents**: Framework documentation
- **Get API Key**: Sign up for free $10 credit at platform.valyu.ai
