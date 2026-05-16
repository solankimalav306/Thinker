import os
import json
import re
from typing import Annotated, Dict, List, TypedDict, Union, Literal
from langgraph.graph import StateGraph, END
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from services.retrieval import retrieval_service
from services.dictionary import dictionary_service
from duckduckgo_search import DDGS

class AgentState(TypedDict):
    user_query: str
    pdf_id: str
    storage_path: str
    api_key: str
    model: str
    user_context: str
    intent: str
    rag_chunks: List[str]
    rag_hits: List[Dict]
    actions: List[Dict]
    glossary_terms: List[Dict]
    messages: List[Dict]
    parts: List[Dict]
    response_text: str
    evaluation: Dict

def supervisor_node(state: AgentState):
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    
    # Classify intent
    prompt = f"""You are a supervisor for a PDF reading assistant.
    Classify the user query into one of these intents: 
    - "ask" (general question about the PDF)
    - "define" (asking for a definition of a term)
    - "highlight" (asking to highlight specific concepts or text)
    - "note" (asking to create notes or a summary)
    - "mindmap" (asking to generate a mind map)
    - "search" (asking for information not in the PDF or general web info)
    - "comment" (asking to add a sticky note or comment on a page)
    
    User Query: {state['user_query']}
    User Context (selected text): {state['user_context']}
    
    Return ONLY the intent string.
    """
    
    # Construct multi-modal content if parts are present
    content = [{"type": "text", "text": prompt}]
    if state.get("parts"):
        for p in state["parts"]:
            if "inline_data" in p:
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{p['inline_data']['mime_type']};base64,{p['inline_data']['data']}"
                    }
                })
    
    response = llm.invoke([HumanMessage(content=content)])
    intent = response.content.strip().lower()
    
    # Clean up intent (LLM might return extra text)
    for possible in ["ask", "define", "highlight", "note", "mindmap", "search", "comment"]:
        if possible in intent:
            intent = possible
            break
    else:
        intent = "ask"
        
    # Retrieve RAG context
    rag_res = retrieval_service({
        "query": state["user_query"],
        "pdfId": state["pdf_id"],
        "storagePath": state["storage_path"]
    })

    hits = rag_res.get("chunks", []) if isinstance(rag_res, dict) else []
    chunks = []
    for hit in hits:
        page = hit.get("page", "?")
        text = hit.get("text", "")
        chunks.append(f"[Page {page}] {text}")
    
    return {
        "intent": intent,
        "rag_chunks": chunks,
        "rag_hits": hits
    }

def dictionary_node(state: AgentState):
    # If the user context is empty, try to use the query itself as the word
    word = state["user_context"] if state["user_context"] else state["user_query"]
    res = dictionary_service(word, state["user_context"], state["api_key"], state["model"])
    
    return {
        "response_text": f"Definition: {res['definition']}",
        "glossary_terms": [res] if res.get("source") != "none" else []
    }

def ask_node(state: AgentState):
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    
    context = "\n".join(state["rag_chunks"])
    
    # Format history
    history = ""
    for msg in state.get("messages", [])[-5:]:  # Last 5 messages
        role = "User" if msg.get("role") == "user" else "Assistant"
        text = msg.get("text", "")
        history += f"{role}: {text}\n"

    prompt = f"""You are an intelligent PDF assistant. Answer the user's question accurately using the provided context from the document and the conversation history.
    
    Conversation History:
    {history}

    Context from PDF:
    {context}
    
    User's Highlighted Text:
    {state['user_context']}
    
    User's Question:
    {state['user_query']}
    
    Answer concisely and include citations if possible (e.g., [Page X]).
    """
    
    content = [{"type": "text", "text": prompt}]
    if state.get("parts"):
        for p in state["parts"]:
            if "inline_data" in p:
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{p['inline_data']['mime_type']};base64,{p['inline_data']['data']}"
                    }
                })
    
    response = llm.invoke([HumanMessage(content=content)])
    return {"response_text": response.content}

def highlight_node(state: AgentState):
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    rag_hits = state.get("rag_hits", [])
    snippets = []
    for idx, hit in enumerate(rag_hits[:8], start=1):
      page = hit.get("page", "?")
      text = re.sub(r"\s+", " ", str(hit.get("text", ""))).strip()
      snippets.append(f"{idx}. PAGE={page} | {text}")
    context = "\n".join(snippets)
    
    prompt = f"""You are a precision highlighting assistant.
    Choose 3-7 exact short spans (2-12 words each) from the snippets below that best answer the user query.
    Every span must be copied exactly from the snippet text to improve matching quality in the PDF text layer.
    Return ONLY valid JSON in this format:
    [{{"text":"exact phrase","page":3}}]
    
    Rules:
    - "text" must be exact, concise, and not paraphrased.
    - "page" must be the PAGE value of the snippet the phrase came from.
    - Avoid duplicates.
    - Do not include markdown or explanation.
    
    Query: {state['user_query']}
    Context: {context}
    """
    
    response = llm.invoke(prompt)
    try:
        content = response.content.strip()
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        parsed = json.loads(content)
        highlights = []
        if isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, dict):
                    text = str(item.get("text", "")).strip()
                    page = item.get("page")
                    if text:
                        highlights.append({"type": "highlight", "text": text, "page": page})
                elif isinstance(item, str):
                    text = item.strip()
                    if text:
                        highlights.append({"type": "highlight", "text": text})
    except Exception:
        highlights = []

    if not highlights:
        fallback = []
        for hit in rag_hits[:3]:
            txt = re.sub(r"\s+", " ", str(hit.get("text", ""))).strip()
            if not txt:
                continue
            fallback.append({
                "type": "highlight",
                "text": txt[:90],
                "page": hit.get("page")
            })
        highlights = fallback
        
    return {
        "response_text": f"I've highlighted {len(highlights)} key passages with page-level precision.",
        "actions": highlights
    }

def notes_node(state: AgentState):
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    context = "\n".join(state["rag_chunks"])
    
    prompt = f"""Generate structured markdown notes based on the following PDF content.
    Include key concepts, definitions, and summaries.
    
    Context:
    {context}
    
    Specific Request:
    {state['user_query']}
    """
    
    response = llm.invoke(prompt)
    return {
        "response_text": "I've generated some comprehensive notes for you in the Research Notes panel.",
        "actions": [{"type": "note", "content": response.content}]
    }

def mindmap_node(state: AgentState):
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    context = "\n".join(state["rag_chunks"])
    
    prompt = f"""Create a deep, multi-level mind map using Markdown.
    The mind map must visualize the core concepts and their recursive sub-topics.

Rules:
- Return ONLY the Markdown code, no markdown fences or explanation.
- Start with EXACTLY one '# ' header for the Root Topic.
- Use EXACTLY '-' for all branches and sub-levels.
- Indent EXACTLY 2 spaces for each deeper level (recursive).
- You MUST map at least 3-4 levels deep where appropriate.
- Keep labels concise (1 to 5 words).

Output format example:
# Root Topic
- Main Branch 1
  - Sub-topic 1.1
    - Detail 1.1.1
    - Detail 1.1.2
  - Sub-topic 1.2
- Main Branch 2
  - Sub-topic 2.1

Context:
{context}
"""
    
    response = llm.invoke(prompt)
    return {
        "response_text": "I've visualized the concepts as a mind map.",
        "actions": [{"type": "mindmap", "code": response.content}]
    }

def websearch_node(state: AgentState):
    query = state["user_query"]
    results = []
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
        results_str = json.dumps(results)
    except Exception as e:
        print(f"Web search failed: {e}")
        results_str = "No results found due to an error."
    
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    prompt = f"""Based on the following web search results, answer the user's question.
    
    Question: {query}
    Search Results: {results_str}
    
    Provide a concise summary of the findings.
    """
    
    response = llm.invoke(prompt)
    return {
        "response_text": response.content,
        "actions": [{"type": "websearch", "results": results}]
    }

def comment_node(state: AgentState):
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    rag_hits = state.get("rag_hits", [])
    snippets = []
    for idx, hit in enumerate(rag_hits[:10], start=1):
        page = hit.get("page", "?")
        text = re.sub(r"\s+", " ", str(hit.get("text", ""))).strip()
        snippets.append(f"{idx}. PAGE={page} | {text}")

    prompt = f"""You are a sticky-note planner for a PDF reader.
    Create 3-7 concise sticky notes distributed across relevant pages.
    Return ONLY valid JSON in this format:
    [{{"text":"short note","page":3,"x":0.12,"y":0.2}}]

    Rules:
    - text: max 120 chars, useful for revision.
    - page: integer from snippets.
    - x and y: normalized 0..1 coordinates for note anchor.
    - spread notes across different pages where possible.
    - no markdown fences or explanation.
    
    Query: {state['user_query']}
    Selected Context: {state['user_context']}
    Snippets:
    {chr(10).join(snippets)}
    """
    
    response = llm.invoke(prompt)
    comments = []
    try:
        content = response.content.strip()
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        parsed = json.loads(content)
        if isinstance(parsed, list):
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("text", "")).strip()
                page = int(item.get("page", 1))
                x = float(item.get("x", 0.12))
                y = float(item.get("y", 0.16))
                if text:
                    comments.append({
                        "text": text[:120],
                        "page": max(1, page),
                        "x": max(0.05, min(0.92, x)),
                        "y": max(0.07, min(0.9, y))
                    })
    except Exception:
        comments = []

    if not comments:
        for idx, hit in enumerate(rag_hits[:4]):
            txt = re.sub(r"\s+", " ", str(hit.get("text", ""))).strip()
            if not txt:
                continue
            comments.append({
                "text": txt[:95],
                "page": int(hit.get("page", 1) or 1),
                "x": 0.1 + (idx % 2) * 0.32,
                "y": 0.14 + (idx % 3) * 0.22
            })

    response_text = f"Added {len(comments)} sticky notes across relevant pages."
    return {
        "response_text": response_text,
        "actions": [{"type": "comment", "comments": comments}]
    }

def critic_node(state: AgentState):
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    
    # Input is the generated response or notes
    generated = state.get("response_text", "")
    context = "\n".join(state.get("rag_chunks", []))
    
    prompt = f"""Review the following generated AI response against the provided document context.
    Identify any hallucinations, factual errors, or unsupported claims.
    If the response is accurate, return it as is.
    If there are errors, correct them and provide the improved version.
    
    Document Context: {context}
    Generated Response: {generated}
    
    Return ONLY the final (corrected) response text.
    """
    
    response = llm.invoke(prompt)
    return {"response_text": response.content}

def precision_node(state: AgentState):
    llm = ChatGoogleGenerativeAI(model=state["model"], google_api_key=state["api_key"])
    generated = state.get("response_text", "")
    context = "\n".join(state.get("rag_chunks", []))
    query = state.get("user_query", "")

    prompt = f"""You are a strict response quality evaluator for a PDF assistant.
    Score the response on factual accuracy and grounding in the provided context.
    Return ONLY valid JSON:
    {{"score":0.0,"improvements":["..."],"should_regenerate":false}}

    Rules:
    - score is a float 0..1 (1 is best).
    - improvements is an array of short, concrete fixes (max 3 items).
    - should_regenerate is true if score < 0.7.

    User Query: {query}
    Context: {context}
    Response: {generated}
    """

    response = llm.invoke(prompt)
    content = response.content.strip()
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0].strip()
    try:
        parsed = json.loads(content)
        score = float(parsed.get("score", 0))
        improvements = parsed.get("improvements", [])
        should_regenerate = bool(parsed.get("should_regenerate", score < 0.7))
        return {"evaluation": {
            "score": max(0.0, min(1.0, score)),
            "improvements": improvements if isinstance(improvements, list) else [],
            "should_regenerate": should_regenerate
        }}
    except Exception:
        return {"evaluation": {"score": 0.0, "improvements": ["Unable to score response."], "should_regenerate": False}}


# Define the graph
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("supervisor", supervisor_node)
workflow.add_node("dictionary", dictionary_node)
workflow.add_node("ask", ask_node)
workflow.add_node("highlighter", highlight_node)
workflow.add_node("notes", notes_node)
workflow.add_node("mindmap", mindmap_node)
workflow.add_node("websearch", websearch_node)
workflow.add_node("comment", comment_node)
workflow.add_node("critic", critic_node)
workflow.add_node("precision", precision_node)

# Define edges
workflow.set_entry_point("supervisor")

def route_intent(state):
    intent = state["intent"]
    if intent == "define":
        return "dictionary"
    if intent == "highlight":
        return "highlighter"
    if intent == "note":
        return "notes"
    if intent == "mindmap":
        return "mindmap"
    if intent == "search":
        return "websearch"
    if intent == "comment":
        return "comment"
    return "ask"

workflow.add_conditional_edges(
    "supervisor",
    route_intent,
    {
        "dictionary": "dictionary",
        "highlighter": "highlighter",
        "notes": "notes",
        "mindmap": "mindmap",
        "websearch": "websearch",
        "comment": "comment",
        "ask": "ask"
    }
)

workflow.add_edge("dictionary", "precision")
workflow.add_edge("ask", "critic")
workflow.add_edge("highlighter", END)
workflow.add_edge("notes", "critic")
workflow.add_edge("mindmap", END)
workflow.add_edge("websearch", "critic")
workflow.add_edge("comment", END)
workflow.add_edge("critic", "precision")
workflow.add_edge("precision", END)

# Compile the graph
app = workflow.compile()

def invoke_agent(query_data: dict):
    initial_state = {
        "user_query": query_data.get("query", ""),
        "pdf_id": query_data.get("pdfId", ""),
        "storage_path": query_data.get("storagePath", ""),
        "api_key": query_data.get("apiKey", ""),
        "model": query_data.get("model", "gemini-2.5-flash-lite"),
        "user_context": query_data.get("context", ""),
        "intent": "",
        "rag_chunks": [],
        "rag_hits": [],
        "actions": [],
        "glossary_terms": [],
        "messages": query_data.get("messages", []),
        "parts": query_data.get("parts", []),
        "response_text": "",
        "evaluation": {}
    }
    
    final_state = app.invoke(initial_state)
    return {
        "intent": final_state["intent"],
        "response_text": final_state["response_text"],
        "actions": final_state["actions"],
        "glossary_terms": final_state["glossary_terms"],
        "evaluation": final_state.get("evaluation", {})
    }
