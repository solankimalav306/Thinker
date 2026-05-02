import os
import json
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
    actions: List[Dict]
    glossary_terms: List[Dict]
    messages: List[Dict]
    parts: List[Dict]
    response_text: str

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
    
    chunks = [c["text"] for c in rag_res.get("chunks", [])]
    
    return {
        "intent": intent,
        "rag_chunks": chunks
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
    context = "\n".join(state["rag_chunks"])
    
    prompt = f"""Identify the top 3-5 most important key terms or short phrases from the context below that relate to the user's query.
    Return ONLY a JSON list of strings.
    
    Query: {state['user_query']}
    Context: {context}
    """
    
    response = llm.invoke(prompt)
    try:
        content = response.content.strip()
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        highlights = json.loads(content)
    except:
        highlights = []
        
    return {
        "response_text": f"I've highlighted {len(highlights)} key concepts for you.",
        "actions": [{"type": "highlight", "text": t} for t in highlights]
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
    prompt = f"""Create a short, insightful sticky note or comment based on the following query and context.
    The comment should be concise and helpful for future review.
    
    Query: {state['user_query']}
    Context: {state['user_context']}
    
    Return ONLY the comment text.
    """
    
    response = llm.invoke(prompt)
    return {
        "response_text": "I've added a sticky note for you.",
        "actions": [{"type": "comment", "text": response.content}]
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

workflow.add_edge("dictionary", END)
workflow.add_edge("ask", "critic")
workflow.add_edge("highlighter", END)
workflow.add_edge("notes", "critic")
workflow.add_edge("mindmap", END)
workflow.add_edge("websearch", "critic")
workflow.add_edge("comment", END)
workflow.add_edge("critic", END)

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
        "actions": [],
        "glossary_terms": [],
        "messages": query_data.get("messages", []),
        "parts": query_data.get("parts", []),
        "response_text": ""
    }
    
    final_state = app.invoke(initial_state)
    return {
        "intent": final_state["intent"],
        "response_text": final_state["response_text"],
        "actions": final_state["actions"],
        "glossary_terms": final_state["glossary_terms"]
    }
