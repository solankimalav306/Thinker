from utils.llm_text import reply_text
import os
import json
import requests
from typing import Dict, Optional


def _build_llm(api_key: str = None, model: str = "gemini-3.5-flash-lite",
               api_format: str = "gemini", api_url: str = ""):
    """Build the appropriate LangChain LLM for the given provider."""
    fmt = str(api_format or "gemini").strip().lower()
    mdl = str(model or "gemini-3.5-flash-lite").strip()
    key = str(api_key or "").strip()
    url = str(api_url or "").strip()

    if fmt in ("openai", "openai-compatible"):
        from langchain_openai import ChatOpenAI
        kwargs: dict = {"model": mdl, "temperature": 0.2}
        if key:
            kwargs["openai_api_key"] = key
        if url:
            kwargs["openai_api_base"] = url
        return ChatOpenAI(**kwargs)

    # Default: Gemini
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(model=mdl, google_api_key=key)


def get_llm_definition(word: str, context: str, api_key: str = None,
                       model: str = "gemini-3.5-flash-lite",
                       api_format: str = "gemini", api_url: str = "") -> Optional[Dict]:
    if not api_key and api_format in ("gemini", ""):
        return None  # No key and Gemini → skip LLM entirely

    try:
        llm = _build_llm(api_key=api_key, model=model, api_format=api_format, api_url=api_url)

        prompt_text = (
            f"Define the word '{word}' specifically in the context of the following passage:\n\n"
            f"'{context}'\n\n"
            f"Provide a concise, 1-2 sentence definition. Return the result in JSON format like this:\n"
            f'{{\"term\": \"{word}\", \"definition\": \"...\", \"source\": \"llm\"}}'
        )

        from langchain_core.messages import HumanMessage
        response = llm.invoke([HumanMessage(content=prompt_text)])

        content = reply_text(response).strip()
        if content.startswith("```json"):
            content = content[7:-3].strip()
        elif content.startswith("```"):
            content = content[3:-3].strip()

        if content.startswith("{"):
            return json.loads(content)
        return {"term": word, "definition": content, "source": "llm"}
    except Exception as e:
        print(f"LLM definition failed: {e}")
        return None


def get_api_definition(word: str) -> Optional[Dict]:
    try:
        url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list) and len(data) > 0:
                meanings = data[0].get("meanings", [])
                if meanings:
                    definitions = meanings[0].get("definitions", [])
                    if definitions:
                        return {
                            "term": word,
                            "definition": definitions[0].get("definition", ""),
                            "source": "api"
                        }
        return None
    except Exception as e:
        print(f"API definition failed: {e}")
        return None


def dictionary_service(word: str, context: str = "", api_key: str = None,
                       model: str = "gemini-3.5-flash-lite",
                       api_format: str = "gemini", api_url: str = ""):
    """Return a definition dict for word.
    Tries LLM first (context-aware), then free dictionary API.
    """
    # 1. LLM with context
    if context:
        result = get_llm_definition(word, context, api_key, model, api_format, api_url)
        if result:
            return result

    # 2. Free dictionary API
    result = get_api_definition(word)
    if result:
        return result

    # 3. LLM without context (best effort)
    result = get_llm_definition(word, "General knowledge", api_key, model, api_format, api_url)
    if result:
        return result

    return {
        "term": word,
        "definition": "Could not find a definition for this term.",
        "source": "none"
    }
