import os

from xai_sdk import Client
from xai_sdk.chat import user, system

client = Client(
  api_key=os.getenv("XAI_API_KEY"),
  timeout=3600,  # Override default timeout with longer timeout for reasoning models
)

chat = client.chat.create(model="grok-4")
chat.append(system("You are a PhD-level mathematician."))
chat.append(user("What is 2 + 2?"))

response = chat.sample()
print(response.content)