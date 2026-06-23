import anthropic

anthropic.Anthropic().messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, world"}
    ]
)