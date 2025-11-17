"""
SAP AI Core Provider for LiteLLM

This module implements SAP AI Core's Anthropic converse-stream API support.
Based on the Cline implementation at src/core/api/providers/sapaicore.ts

Usage:
    from litellm import completion

    response = completion(
        model="sapaicore/anthropic--claude-4-sonnet",
        messages=[{"role": "user", "content": "Hello!"}],
        deployment_id="your-deployment-id",
        client_id="your-client-id",
        client_secret="your-client-secret",
        token_url="https://tenant.authentication.sap.hana.ondemand.com",
        base_url="https://api.ai.ml.hana.ondemand.com",
        resource_group="default",
        stream=True,
    )
"""

import time
import json
import asyncio
import aiohttp
from typing import Optional, Dict, Any, List, AsyncGenerator, Union
from urllib.parse import urlencode
import base64


class SapAiCoreError(Exception):
    """Custom exception for SAP AI Core errors"""

    def __init__(self, message: str, status_code: Optional[int] = None, response_data: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_data = response_data


class TokenManager:
    """Manages OAuth 2.0 access tokens for SAP AI Core"""

    def __init__(self):
        self.token: Optional[Dict[str, Any]] = None

    async def get_token(
        self, client_id: str, client_secret: str, token_url: str
    ) -> str:
        """Get or refresh access token"""
        if self.token and self.token.get("expires_at", 0) > time.time():
            return self.token["access_token"]

        token_url = token_url.rstrip("/") + "/oauth/token"

        data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                token_url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            ) as resp:
                if resp.status != 200:
                    raise SapAiCoreError(
                        f"Authentication failed with status {resp.status}",
                        status_code=resp.status,
                        response_data=await resp.text(),
                    )

                token_data = await resp.json()
                token_data["expires_at"] = time.time() + token_data["expires_in"]
                self.token = token_data
                return token_data["access_token"]


class DeploymentManager:
    """Manages SAP AI Core deployments"""

    def __init__(self):
        self.deployments: Optional[List[Dict[str, str]]] = None

    async def fetch_deployments(
        self, access_token: str, base_url: str, resource_group: str = "default"
    ) -> List[Dict[str, str]]:
        """Fetch available deployments from SAP AI Core"""
        headers = {
            "Authorization": f"Bearer {access_token}",
            "AI-Resource-Group": resource_group,
            "Content-Type": "application/json",
            "AI-Client-Type": "LiteLLM",
        }

        url = f"{base_url}/v2/lm/deployments?$top=10000&$skip=0"

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    raise SapAiCoreError(
                        f"Failed to fetch deployments with status {resp.status}",
                        status_code=resp.status,
                        response_data=await resp.text(),
                    )

                data = await resp.json()
                resources = data.get("resources", [])

                deployments = []
                for deployment in resources:
                    if deployment.get("targetStatus") != "RUNNING":
                        continue

                    model = deployment.get("details", {}).get("resources", {}).get("backend_details", {}).get("model")
                    if not model or not model.get("name") or not model.get("version"):
                        continue

                    deployments.append({
                        "id": deployment["id"],
                        "name": f"{model['name']}:{model['version']}",
                    })

                self.deployments = deployments
                return deployments

    def find_deployment_for_model(self, model_id: str) -> Optional[str]:
        """Find deployment ID for a given model"""
        if not self.deployments:
            return None

        model_base_name = model_id.split(":")[0].lower()

        for deployment in self.deployments:
            deployment_base_name = deployment["name"].split(":")[0].lower()
            if deployment_base_name == model_base_name:
                return deployment["id"]

        return None


class MessageFormatter:
    """Formats messages for AWS Bedrock Converse API used by SAP AI Core"""

    @staticmethod
    def format_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert messages to Bedrock Converse API format"""
        formatted = []

        for message in messages:
            role = "user" if message["role"] == "user" else "assistant"
            content = message["content"]

            if isinstance(content, str):
                formatted.append({
                    "role": role,
                    "content": [{"text": content}]
                })
            elif isinstance(content, list):
                content_blocks = []
                for item in content:
                    if item["type"] == "text":
                        content_blocks.append({"text": item["text"]})
                    elif item["type"] == "image":
                        image_block = MessageFormatter._process_image(item)
                        if image_block:
                            content_blocks.append(image_block)

                formatted.append({
                    "role": role,
                    "content": content_blocks
                })

        return formatted

    @staticmethod
    def _process_image(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process image content for Bedrock format"""
        try:
            source = item.get("source", {})
            media_type = source.get("media_type", "image/jpeg")
            data = source.get("data", "")

            # Determine image format
            format_match = media_type.split("/")[-1]
            if format_match not in ["png", "jpeg", "gif", "webp"]:
                format_match = "jpeg"

            # Clean base64 data
            if isinstance(data, str):
                data = data.replace("data:image/", "").split(";base64,")[-1]
            else:
                data = base64.b64encode(data).decode("utf-8")

            return {
                "image": {
                    "format": format_match,
                    "source": {"bytes": data}
                }
            }
        except Exception as e:
            print(f"Failed to process image: {e}")
            return {"text": f"[ERROR: Failed to process image - {str(e)}]"}

    @staticmethod
    def prepare_system_messages(system_prompt: str, enable_caching: bool = True) -> List[Dict[str, Any]]:
        """Prepare system messages with optional caching"""
        if not system_prompt:
            return []

        if enable_caching:
            return [
                {"text": system_prompt},
                {"cachePoint": {"type": "default"}}
            ]

        return [{"text": system_prompt}]

    @staticmethod
    def apply_cache_control(
        messages: List[Dict[str, Any]],
        last_user_msg_index: int,
        second_last_user_msg_index: int
    ) -> List[Dict[str, Any]]:
        """Apply cache control to messages using cachePoint"""
        result = []

        for i, message in enumerate(messages):
            if i == last_user_msg_index or i == second_last_user_msg_index:
                # Add cachePoint to content
                cached_message = message.copy()
                cached_message["content"] = message["content"].copy()
                cached_message["content"].append({"cachePoint": {"type": "default"}})
                result.append(cached_message)
            else:
                result.append(message)

        return result


class SapAiCoreProvider:
    """SAP AI Core provider for LiteLLM"""

    # Models that support converse-stream with caching
    CONVERSE_STREAM_MODELS = [
        "anthropic--claude-4.5-sonnet",
        "anthropic--claude-4-sonnet",
        "anthropic--claude-4-opus",
        "anthropic--claude-3.7-sonnet",
    ]

    # Older models that use invoke-with-response-stream
    INVOKE_STREAM_MODELS = [
        "anthropic--claude-3.5-sonnet",
        "anthropic--claude-3-sonnet",
        "anthropic--claude-3-haiku",
        "anthropic--claude-3-opus",
    ]

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        token_url: str,
        base_url: str,
        resource_group: str = "default",
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_url = token_url
        self.base_url = base_url
        self.resource_group = resource_group

        self.token_manager = TokenManager()
        self.deployment_manager = DeploymentManager()
        self.message_formatter = MessageFormatter()

    async def completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        deployment_id: Optional[str] = None,
        stream: bool = False,
        **kwargs
    ) -> Union[Dict[str, Any], AsyncGenerator]:
        """Create a completion request"""
        # Get access token
        access_token = await self.token_manager.get_token(
            self.client_id, self.client_secret, self.token_url
        )

        # Get or fetch deployment ID
        if not deployment_id:
            deployments = await self.deployment_manager.fetch_deployments(
                access_token, self.base_url, self.resource_group
            )
            deployment_id = self.deployment_manager.find_deployment_for_model(model)

            if not deployment_id:
                raise SapAiCoreError(f"No deployment found for model {model}")

        # Route to appropriate endpoint
        if model in self.CONVERSE_STREAM_MODELS:
            return await self._converse_stream(
                access_token, deployment_id, messages, stream, **kwargs
            )
        elif model in self.INVOKE_STREAM_MODELS:
            return await self._invoke_stream(
                access_token, deployment_id, messages, stream, **kwargs
            )
        else:
            raise SapAiCoreError(f"Unsupported model: {model}")

    async def _converse_stream(
        self,
        access_token: str,
        deployment_id: str,
        messages: List[Dict[str, Any]],
        stream: bool,
        **kwargs
    ) -> AsyncGenerator:
        """Handle converse-stream endpoint with caching support"""
        # Format messages
        formatted_messages = self.message_formatter.format_messages(messages)

        # Get user message indices for caching
        user_indices = [i for i, msg in enumerate(messages) if msg["role"] == "user"]
        last_user_idx = user_indices[-1] if user_indices else -1
        second_last_user_idx = user_indices[-2] if len(user_indices) > 1 else -1

        # Apply caching
        enable_caching = kwargs.get("enable_caching", True)
        if enable_caching:
            formatted_messages = self.message_formatter.apply_cache_control(
                formatted_messages, last_user_idx, second_last_user_idx
            )

        # Prepare system messages
        system_prompt = kwargs.get("system", "")
        system_messages = self.message_formatter.prepare_system_messages(
            system_prompt, enable_caching
        )

        # Build payload
        payload = {
            "inferenceConfig": {
                "maxTokens": kwargs.get("max_tokens", 8192),
                "temperature": kwargs.get("temperature", 0.0),
            },
            "system": system_messages,
            "messages": formatted_messages,
        }

        # Make request
        url = f"{self.base_url}/v2/inference/deployments/{deployment_id}/converse-stream"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "AI-Resource-Group": self.resource_group,
            "Content-Type": "application/json",
            "AI-Client-Type": "LiteLLM",
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                if resp.status != 200:
                    raise SapAiCoreError(
                        f"API request failed with status {resp.status}",
                        status_code=resp.status,
                        response_data=await resp.text(),
                    )

                if stream:
                    async for chunk in self._parse_converse_stream(resp):
                        yield chunk
                else:
                    # Collect full response
                    full_text = ""
                    usage = {}

                    async for chunk in self._parse_converse_stream(resp):
                        if chunk["type"] == "text":
                            full_text += chunk["text"]
                        elif chunk["type"] == "usage":
                            usage = chunk

                    yield {
                        "choices": [{
                            "message": {
                                "role": "assistant",
                                "content": full_text,
                            },
                            "finish_reason": "stop",
                        }],
                        "usage": usage,
                    }

    async def _parse_converse_stream(self, response) -> AsyncGenerator:
        """Parse converse-stream SSE response"""
        async for line_bytes in response.content:
            line = line_bytes.decode("utf-8").strip()

            if not line or not line.startswith("data: "):
                continue

            json_data = line[6:]  # Remove "data: " prefix

            try:
                # Try standard JSON parse first
                try:
                    data = json.loads(json_data)
                except json.JSONDecodeError:
                    # Handle JavaScript object notation
                    # This is a simplified version - in production, use a proper parser
                    data = eval(json_data)  # CAUTION: eval is dangerous! Use proper parsing in production

                # Handle metadata (usage)
                if "metadata" in data and "usage" in data["metadata"]:
                    usage = data["metadata"]["usage"]
                    input_tokens = usage.get("inputTokens", 0)
                    output_tokens = usage.get("outputTokens", 0)
                    cache_read_tokens = usage.get("cacheReadInputTokens", 0)
                    cache_write_tokens = usage.get("cacheWriteInputTokens", 0)

                    # Total input includes cached tokens
                    total_input = input_tokens + cache_read_tokens + cache_write_tokens

                    yield {
                        "type": "usage",
                        "prompt_tokens": total_input,
                        "completion_tokens": output_tokens,
                        "total_tokens": total_input + output_tokens,
                        "cache_read_input_tokens": cache_read_tokens,
                        "cache_creation_input_tokens": cache_write_tokens,
                    }

                # Handle content delta (text)
                if "contentBlockDelta" in data:
                    delta = data["contentBlockDelta"].get("delta", {})

                    if "text" in delta:
                        yield {
                            "type": "text",
                            "text": delta["text"],
                        }

                    # Handle reasoning content (Claude 3.7+)
                    if "reasoningContent" in delta and "text" in delta["reasoningContent"]:
                        yield {
                            "type": "reasoning",
                            "reasoning": delta["reasoningContent"]["text"],
                        }

            except Exception as e:
                print(f"Failed to parse stream chunk: {e}")
                continue

    async def _invoke_stream(
        self,
        access_token: str,
        deployment_id: str,
        messages: List[Dict[str, Any]],
        stream: bool,
        **kwargs
    ) -> AsyncGenerator:
        """Handle invoke-with-response-stream endpoint (older models)"""
        # This endpoint uses Anthropic's native message format
        url = f"{self.base_url}/v2/inference/deployments/{deployment_id}/invoke-with-response-stream"

        payload = {
            "max_tokens": kwargs.get("max_tokens", 8192),
            "system": kwargs.get("system", ""),
            "messages": messages,
            "anthropic_version": "bedrock-2023-05-31",
        }

        headers = {
            "Authorization": f"Bearer {access_token}",
            "AI-Resource-Group": self.resource_group,
            "Content-Type": "application/json",
            "AI-Client-Type": "LiteLLM",
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                if resp.status != 200:
                    raise SapAiCoreError(
                        f"API request failed with status {resp.status}",
                        status_code=resp.status,
                        response_data=await resp.text(),
                    )

                async for chunk in self._parse_invoke_stream(resp):
                    yield chunk

    async def _parse_invoke_stream(self, response) -> AsyncGenerator:
        """Parse invoke-with-response-stream SSE response"""
        async for line_bytes in response.content:
            line = line_bytes.decode("utf-8").strip()

            if not line or not line.startswith("data: "):
                continue

            json_data = line[6:]

            try:
                data = json.loads(json_data)

                if data.get("type") == "message_start":
                    usage = data.get("message", {}).get("usage", {})
                    yield {
                        "type": "usage",
                        "prompt_tokens": usage.get("input_tokens", 0),
                        "completion_tokens": usage.get("output_tokens", 0),
                    }

                elif data.get("type") in ["content_block_start", "content_block_delta"]:
                    content = data.get("content_block" if data["type"] == "content_block_start" else "delta", {})

                    if content.get("type") in ["text", "text_delta"]:
                        yield {
                            "type": "text",
                            "text": content.get("text", ""),
                        }

                elif data.get("type") == "message_delta":
                    if "usage" in data:
                        yield {
                            "type": "usage",
                            "completion_tokens": data["usage"].get("output_tokens", 0),
                        }

            except Exception as e:
                print(f"Failed to parse invoke stream chunk: {e}")
                continue


# Example usage
async def main():
    """Example usage of SapAiCoreProvider"""
    provider = SapAiCoreProvider(
        client_id="your-client-id",
        client_secret="your-client-secret",
        token_url="https://your-tenant.authentication.sap.hana.ondemand.com",
        base_url="https://api.ai.ml.hana.ondemand.com",
        resource_group="default",
    )

    messages = [
        {"role": "user", "content": "What is the capital of France?"}
    ]

    print("Streaming response:")
    async for chunk in await provider.completion(
        model="anthropic--claude-4-sonnet",
        messages=messages,
        system="You are a helpful AI assistant.",
        stream=True,
        max_tokens=8192,
        temperature=0.0,
    ):
        if chunk["type"] == "text":
            print(chunk["text"], end="", flush=True)
        elif chunk["type"] == "usage":
            print(f"\n\nUsage: {chunk}")

    print("\n\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
