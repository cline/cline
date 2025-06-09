import asyncio
import logging
import json
from typing import Any

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.shared.session import RequestResponder
import mcp.types as types

# Configure logging to show timestamps
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Silence httpx logs
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("mcp.client.streamable_http").setLevel(logging.WARNING)


async def realtime_message_handler(
    message: RequestResponder[types.ServerRequest, types.ClientResult]
    | types.ServerNotification
    | Exception,
) -> None:
    """Handle incoming messages and display notifications in real-time."""
    
    # Handle notifications
    if isinstance(message, types.ServerNotification):
        # Check if it's a log message notification
        if hasattr(message.root, 'method') and message.root.method == "notifications/message":
            if hasattr(message.root, 'params'):
                level = getattr(message.root.params, 'level', 'info')
                data = getattr(message.root.params, 'data', '')
                
                # Try to parse as JSON for structured updates
                try:
                    progress_data = json.loads(data)
                    display_structured_progress(progress_data)
                except (json.JSONDecodeError, TypeError):
                    # Free-form text update
                    logger.info(f"📢 NOTIFICATION: {data}")
    
    # Handle other message types (requests, exceptions)
    elif isinstance(message, Exception):
        logger.error(f"Error: {message}")


def display_structured_progress(data: dict):
    """Display structured progress updates."""
    progress_type = data.get("type")
    status = data.get("status")
    
    if progress_type == "progress":
        if status == "acknowledged":
            logger.info(f"✅ ACKNOWLEDGED: {data.get('message')}")
            
        elif status == "milestone":
            logger.info(f"🎯 MILESTONE: {data.get('message')}")
            if data.get("estimated_time_remaining"):
                logger.info(f"   ⏱️  ETR: {data.get('estimated_time_remaining')}")
                
        elif status == "update":
            percent = data.get("progress_percent", 0)
            message = data.get("message", "")
            etr = data.get("estimated_time_remaining", "")
            
            # Display progress
            bar_width = 50
            filled = int(bar_width * percent / 100)
            bar = '█' * filled + '░' * (bar_width - filled)
            logger.info(f"[{bar}] {percent:.1f}% | {message} | ETR: {etr}")
            
        elif status == "milestone_complete":
            logger.info(f"✅ {data.get('message')} (took {data.get('stage_duration', 0)}s)")
            
        elif status == "complete":
            logger.info(f"🎉 {data.get('message')}")
            logger.info(f"   Total time: {data.get('total_duration', 0)}s")
            logger.info(f"   Records processed: {data.get('records_processed', 0)}")


async def main():
    url = "http://127.0.0.1:8000/mcp"
    
    logger.info(f"🚀 Connecting to server at {url}")
    logger.info("📌 Using SDK's built-in real-time support (single connection)")
    
    async with streamablehttp_client(url) as (read_stream, write_stream, get_session_id):
        # Create session with our custom message handler
        async with ClientSession(
            read_stream, 
            write_stream,
            message_handler=realtime_message_handler  # This enables real-time display!
        ) as session:
            # Initialize the session
            await session.initialize()
            logger.info("✅ Session initialized")
            
            # The SDK automatically creates a GET SSE stream after initialization
            # for receiving standalone notifications in real-time
            
            session_id = get_session_id()
            if session_id:
                logger.info(f"📌 Session ID: {session_id}")
                logger.info("🔄 SDK has automatically established SSE stream for notifications")
            
            # List available tools
            tools = await session.list_tools()
            logger.info(f"🔧 Available tools: {[tool.name for tool in tools.tools]}")
            
            # Call the tool to start notifications
            logger.info("📡 Calling start_notifications tool...")
            logger.info("⏳ Notifications will arrive in real-time via SDK's built-in SSE stream")
            logger.info("-" * 60)
            
            # Call tool - notifications will be displayed in real-time by our handler
            result = await session.call_tool(
                "start_notifications", 
                {"count": 5}
            )
            
            logger.info("-" * 60)
            # Extract the result text
            result_text = result.content[0].text if result.content else 'No content'
            logger.info(f"✅ Tool completed: {result_text}")
            
            logger.info("👋 Client finished")
            logger.info("💡 All notifications were received via SDK's automatic SSE stream!")


if __name__ == "__main__":
    asyncio.run(main())
