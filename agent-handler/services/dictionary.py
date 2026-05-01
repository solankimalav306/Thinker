import os
import requests
from typing import Dict, Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate

def get_llm_definition(word: str, context: str, api_key: str = None, model: str = "gemini-2.5-flash-lite") -> Optional[Dict]:
    if not api_key:
        return None
    
    try:
        llm = ChatGoogleGenerativeAI(model=model, google_api_key=api_key)
        
        prompt = ChatPromptTemplate.from_template(
            "Define the word '{word}' specifically in the context of the following passage:\n\n"
            "'{context}'\n\n"
            "Provide a concise, 1-2 sentence definition. Return the result in JSON format like this:\n"
            "{{\"term\": \"{word}\", \"definition\": \"...\", \"source\": \"llm\"}}"
        )
        
        chain = prompt | llm
        response = chain.invoke({"word": word, "context": context})
        
        # Simple cleanup if LLM returns markdown blocks
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:-3].strip()
        elif content.startswith("{"):
            pass
        else:
            # Fallback parsing or just return as is
            return {"term": word, "definition": content, "source": "llm"}
            
        import json
        return json.loads(content)
    except Exception as e:
        print(f"LLM definition failed: {e}")
        return None

def get_api_definition(word: str) -> Optional[Dict]:
    try:
        # Using the free dictionary API
        url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list) and len(data) > 0:
                # Extract the first definition
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

def dictionary_service(word: str, context: str = "", api_key: str = None, model: str = "gemini-2.5-flash-lite"):
    # 1. Try LLM for context-aware definition
    if context:
        result = get_llm_definition(word, context, api_key, model)
        if result:
            return result
            
    # 2. Fallback to general API
    result = get_api_definition(word)
    if result:
        return result
        
    # 3. Final fallback: simple LLM without context if context was missing
    if not context:
        result = get_llm_definition(word, "General knowledge", api_key, model)
        if result:
            return result
            
    return {
        "term": word,
        "definition": "Could not find a definition for this term.",
        "source": "none"
    }
