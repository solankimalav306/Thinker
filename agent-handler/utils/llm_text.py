def reply_text(response) -> str:
    """Plain text of a chat model reply.

    Newer Gemini models return content as a list of blocks
    ([{"type": "text", "text": "..."}, ...]) instead of a string.
    """
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type", "text") == "text":
                parts.append(str(block.get("text", "")))
        return "".join(parts)
    return str(content or "")
