import asyncio
import logging
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass
from uuid import uuid4

import anyio
import uvicorn
from starlette.applications import Starlette
from starlette.routing import Mount

import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.streamable_http import (
    EventCallback,
    EventId,
    EventMessage,
    EventStore,
    StreamId,
)
from mcp.types import JSONRPCMessage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Simple in-memory event store
@dataclass
class EventEntry:
    event_id: EventId
    stream_id: StreamId
    message: JSONRPCMessage


class InMemoryEventStore(EventStore):
    def __init__(self, max_events_per_stream: int = 100):
        self.max_events_per_stream = max_events_per_stream
        self.streams: dict[StreamId, deque[EventEntry]] = {}
        self.event_index: dict[EventId, EventEntry] = {}

    async def store_event(
        self, stream_id: StreamId, message: JSONRPCMessage
    ) -> EventId:
        event_id = str(uuid4())
        event_entry = EventEntry(
            event_id=event_id, stream_id=stream_id, message=message
        )

        if stream_id not in self.streams:
            self.streams[stream_id] = deque(maxlen=self.max_events_per_stream)

        if len(self.streams[stream_id]) == self.max_events_per_stream:
            oldest_event = self.streams[stream_id][0]
            self.event_index.pop(oldest_event.event_id, None)

        self.streams[stream_id].append(event_entry)
        self.event_index[event_id] = event_entry

        return event_id

    async def replay_events_after(
        self,
        last_event_id: EventId,
        send_callback: EventCallback,
    ) -> StreamId | None:
        if last_event_id not in self.event_index:
            logger.warning(f"Event ID {last_event_id} not found in store")
            return None

        last_event = self.event_index[last_event_id]
        stream_id = last_event.stream_id
        stream_events = self.streams.get(last_event.stream_id, deque())

        found_last = False
        for event in stream_events:
            if found_last:
                await send_callback(EventMessage(event.message, event.event_id))
            elif event.event_id == last_event_id:
                found_last = True

        return stream_id


# Create the MCP server
app = Server("realtime-notification-server")


@app.call_tool()
async def start_notifications(
    name: str, arguments: dict
) -> list[types.TextContent]:
    """Tool that sends notifications with random delays"""
    import random
    
    ctx = app.request_context
    count = arguments.get("count", 5)
    
    logger.info(f"Starting notification stream for {count} notifications")
    
    # Track total time for fun
    start_time = asyncio.get_event_loop().time()
    
    # Send notifications with random delays
    for i in range(count):
        # Random delay between 0.5 and 5 seconds
        delay = random.uniform(0.5, 5.0)
        logger.info(f"Waiting {delay:.2f} seconds before notification {i+1}")
        
        await anyio.sleep(delay)
        
        # Send notification WITHOUT related_request_id
        # This makes it a standalone notification that arrives immediately
        elapsed = asyncio.get_event_loop().time() - start_time
        await ctx.session.send_log_message(
            level="info",
            data=f"Notification {i+1}/{count} sent after {elapsed:.2f}s total (waited {delay:.2f}s)",
            logger="notification_demo",
            # NO related_request_id - this is the key!
        )
        logger.info(f"Sent notification {i+1}/{count} after {delay:.2f}s delay")
    
    total_time = asyncio.get_event_loop().time() - start_time
    return [
        types.TextContent(
            type="text",
            text=f"Successfully sent {count} notifications over {total_time:.2f} seconds"
        )
    ]


@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="start_notifications",
            description="Starts sending server notifications with random delays",
            inputSchema={
                "type": "object",
                "properties": {
                    "count": {
                        "type": "number",
                        "description": "Number of notifications to send",
                        "default": 5
                    }
                },
            },
        )
    ]


async def main():
    port = 8000
    
    # Create event store for resumability
    event_store = InMemoryEventStore()
    
    # Create the session manager with our app and event store
    session_manager = StreamableHTTPSessionManager(
        app=app,
        event_store=event_store,
    )
    
    # ASGI handler for streamable HTTP connections
    async def handle_streamable_http(scope, receive, send):
        await session_manager.handle_request(scope, receive, send)
    
    # Lifespan context manager
    @asynccontextmanager
    async def lifespan(app):
        async with session_manager.run():
            logger.info("StreamableHTTP session manager started!")
            yield
            logger.info("StreamableHTTP session manager stopped!")
    
    # Create Starlette app
    starlette_app = Starlette(
        debug=True,
        routes=[
            Mount("/mcp", app=handle_streamable_http),
        ],
        lifespan=lifespan,
    )
    
    # Run the server
    config = uvicorn.Config(
        starlette_app, 
        host="127.0.0.1", 
        port=port, 
        log_level="info"
    )
    server = uvicorn.Server(config)
    logger.info(f"Starting server on http://127.0.0.1:{port}")
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
