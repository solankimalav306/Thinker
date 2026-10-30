import os
import json
import re
import datetime
import threading
from typing import Annotated, Dict, List, TypedDict, Union, Literal
from langgraph.graph import StateGraph, END
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from services.retrieval import retrieval_service, pages_service, retrieval_multi
from utils.page_refs import extract_page_refs
from utils.intents import constrain_intent
from utils.sources import sources_from_hits
from services.dictionary import dictionary_service
from duckduckgo_search import DDGS
import concurrent.futures
import string
from utils.llm_text import reply_text
from prompts import build_ask_prompt, normalize_mode

# ---------------------------------------------------------------------------
# Multi-provider LLM factory
# ---------------------------------------------------------------------------
def create_llm(state: dict):
    """Return the right LangChain chat model based on api_format in state.
    Supports:
      - "gemini"  (default) -> ChatGoogleGenerativeAI
      - "openai"  -> ChatOpenAI (works for OpenAI, OpenRouter, local Ollama, etc.)
    """
    api_format = str(state.get("api_format", "") or "gemini").strip().lower()
    model = str(state.get("model", "") or "gemini-3.5-flash-lite").strip()
    api_key = str(state.get("api_key", "") or "").strip()
    api_url  = str(state.get("api_url",  "") or "").strip()

    if api_format in ("openai", "openai-compatible"):
        from langchain_openai import ChatOpenAI
        kwargs = {"model": model, "temperature": 0.2}
        if api_key:
            kwargs["openai_api_key"] = api_key
        if api_url:
            kwargs["openai_api_base"] = api_url
        return ChatOpenAI(**kwargs)

    # Default: Gemini
    # A stalled request must fail instead of leaving the chat on "thinking" forever.
    return ChatGoogleGenerativeAI(model=model, google_api_key=api_key, timeout=90, max_retries=1)


FOCUS_GROUPS = {
    "academic_paper": ["Problem", "Methodology", "Experiments", "Results", "Limitations", "Future Work"],
    "survey_paper": ["Scope", "Taxonomy", "Key Contributions", "Open Challenges"],
    "textbook": ["Concepts", "Definitions", "Examples", "Formulas", "Exam Notes"],
    "slides": ["Speaker Notes", "Missing Context", "Expanded Explanations"],
    "contract": ["Parties", "Obligations", "Risky Clauses", "Termination", "Liability"],
    "court_judgement": ["Facts", "Issues", "Arguments", "Decision", "Reasoning", "Precedents"],
    "business_report": ["Executive Summary", "Financial Performance", "Key Operations", "Future Outlook"],
    "default": ["Overview", "Key Concepts", "Detailed Summary", "Key Takeaways"]
}

SUBTYPE_TO_FOCUS_GROUP = {
    # Academic
    "research_paper": "academic_paper",
    "survey_paper": "survey_paper",
    "systematic_review": "academic_paper",
    "thesis": "academic_paper",
    "dissertation": "academic_paper",
    "conference_paper": "academic_paper",
    "technical_report": "academic_paper",
    "whitepaper": "academic_paper",
    # Education
    "textbook": "textbook",
    "textbook_chapter": "textbook",
    "lecture_notes": "textbook",
    "slides": "slides",
    "lab_manual": "textbook",
    "assignment": "textbook",
    "tutorial": "textbook",
    "study_material": "textbook",
    # Legal
    "contract": "contract",
    "agreement": "contract",
    "nda": "contract",
    "court_judgement": "court_judgement",
    "legal_brief": "court_judgement",
    "statute": "court_judgement",
    "policy_document": "contract",
    "compliance_document": "contract",
    # Business
    "annual_report": "business_report",
    "financial_report": "business_report",
    "business_plan": "business_report",
    "project_proposal": "business_report",
    "meeting_minutes": "business_report",
    "product_requirements_document": "business_report",
    # Technical
    "documentation": "textbook",
    "api_reference": "textbook",
    "software_design_doc": "textbook",
    "architecture_doc": "textbook",
    "research_specification": "academic_paper",
    # Personal / Misc
    "resume": "default",
    "cv": "default",
    "ebook": "default",
    "article": "default",
    "news_report": "default",
    "manual": "default",
    "form": "default"
}

STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "arent",
    "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
    "cant", "cannot", "could", "couldnt", "did", "didnt", "do", "does", "doesnt", "doing", "dont",
    "down", "during", "each", "few", "for", "from", "further", "had", "hadnt", "has", "hasnt", "have",
    "havent", "having", "he", "hed", "hell", "hes", "her", "here", "heres", "hers", "herself", "him",
    "himself", "his", "how", "hows", "i", "id", "ill", "im", "ive", "if", "in", "into", "is", "isnt",
    "it", "its", "itself", "lets", "me", "more", "most", "mustnt", "my", "myself", "no", "nor", "not",
    "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out",
    "over", "own", "same", "shant", "she", "shed", "shell", "shes", "should", "shouldnt", "so",
    "some", "such", "than", "that", "thats", "the", "their", "theirs", "them", "themselves", "then",
    "there", "theres", "these", "they", "theyd", "theyll", "theyre", "theyve", "this", "those",
    "through", "to", "too", "under", "until", "up", "very", "was", "wasnt", "we", "wed", "well",
    "were", "weve", "werent", "what", "whats", "when", "whens", "where", "wheres", "which", "while",
    "who", "whos", "whom", "why", "whys", "with", "wont", "would", "wouldnt", "you", "youd", "youll",
    "youre", "youve", "your", "yours", "yourself", "yourselves"
}

class AgentState(TypedDict):
    user_query: str
    pdf_id: str
    storage_path: str
    api_key: str
    api_format: str   # "gemini" | "openai" | "openai-compatible"
    api_url: str       # base URL for OpenAI-compatible endpoints
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
    beginning_text: str
    plan: Dict
    analysis: Dict
    drafts: List[Dict]
    verified_drafts: List[Dict]
    cache_summary: str
    conversation_id: str
    mode: str          # "auto" | "document"
    instructions: List[Dict]   # layered user instructions
    docs: List[Dict]   # a Thinkspace chat: [{pdfId, title}] searched together
    artifacts: bool    # the reply may be a styled HTML artifact
    doc_title: str     # the open document's title, used to label its pages in an artifact

# Per-request token accumulator (reset at start of invoke_agent)
_token_session = {"calls": [], "totals": {"input": 0, "output": 0, "context": 0, "history": 0, "selected_text": 0, "prompt": 0}}
_token_lock = threading.Lock()

def reset_token_session():
    with _token_lock:
        _token_session["calls"] = []
        _token_session["totals"] = {"input": 0, "output": 0, "context": 0, "history": 0, "selected_text": 0, "prompt": 0}

def get_token_session() -> dict:
    with _token_lock:
        totals = dict(_token_session["totals"])
        return {"calls": list(_token_session["calls"]), "totals": totals}

def compute_similarity(v1, v2) -> float:
    import numpy as np
    a = np.array(v1)
    b = np.array(v2)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def cache_id(source) -> str:
    """Key of the knowledge cache: one per chat, so separate conversations do not share history.

    `source` is the agent state or the raw request; both carry the document id and, optionally,
    the conversation id.
    """
    get = source.get
    pdf = get("pdf_id") or get("pdfId") or ""
    conv = str(get("conversation_id") or get("conversationId") or "")
    return f"{pdf}_{conv}" if pdf and _SAFE_ID.match(conv) else pdf


def load_knowledge_cache(storage_path: str, pdf_id: str) -> dict:
    if not storage_path or not pdf_id:
        return {}
    cache_path = os.path.join(storage_path, f"{pdf_id}_knowledge_cache.json")
    if not os.path.exists(cache_path):
        return {}
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[knowledge_cache] Error loading cache: {e}", flush=True)
        return {}

def save_knowledge_cache(storage_path: str, pdf_id: str, cache_data: dict):
    if not storage_path or not pdf_id:
        return
    cache_path = os.path.join(storage_path, f"{pdf_id}_knowledge_cache.json")
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, ensure_ascii=False, indent=2)
            print(f"[knowledge_cache] Cache successfully updated and saved to {cache_path}", flush=True)
    except Exception as e:
        print(f"[knowledge_cache] Error saving cache: {e}", flush=True)

def normalize_knowledge_cache(cache: dict) -> dict:
    """Ensure cache follows {messages, summary, vector} structure; migrate legacy format."""
    if not cache:
        return {"messages": [], "summary": {}, "vector": {}}

    if "messages" in cache or "vector" in cache:
        cache.setdefault("messages", [])
        cache.setdefault("summary", {})
        cache.setdefault("vector", {})
        return cache

    vector = {}
    for key in ("category", "sub_type", "reasoning", "focus_areas", "abstract", "queries"):
        if key in cache:
            vector[key] = cache[key]

    messages = []
    for intent in cache.get("user_intents", []):
        messages.append({
            "role": "user",
            "text": intent.get("query", ""),
            "context": intent.get("context", ""),
            "ts": intent.get("timestamp", "")
        })

    return {"messages": messages, "summary": {}, "vector": vector}

def get_unsummarized_messages(cache: dict) -> list:
    return cache.get("messages", [])

def append_cache_message(cache: dict, role: str, text: str, context: str = ""):
    entry = {"role": role, "text": text, "ts": str(datetime.datetime.now())}
    if context:
        entry["context"] = context
    cache.setdefault("messages", []).append(entry)

def build_cache_history_text(cache: dict, max_recent: int = 3) -> str:
    """Build conversation context from summary + recent unsummarized messages."""
    parts = []
    summary_text = cache.get("summary", {}).get("text", "")
    if summary_text:
        parts.append(f"Previous Conversation Summary:\n{summary_text}")

    for msg in get_unsummarized_messages(cache)[-max_recent:]:
        role = "User" if msg.get("role") == "user" else "Assistant"
        text = msg.get("text", "")
        if msg.get("context"):
            text = f"[Context: {msg['context']}] {text}"
        parts.append(f"{role}: {text}")

    return "\n\n".join(parts)

def summarize_cache_conversation(llm, state: dict, cache: dict, force: bool = False) -> str:
    """Summarize unsummarized cache messages into cache['summary']. Returns summary text or empty."""
    unsummarized = get_unsummarized_messages(cache)
    if not force and len(unsummarized) < 5:
        return ""

    conv_lines = []
    for msg in unsummarized:
        role = "User" if msg.get("role") == "user" else "Assistant"
        text = msg.get("text", "")
        if msg.get("context"):
            text = f"[Selected: {msg['context']}] {text}"
        conv_lines.append(f"{role}: {text}")

    existing = cache.get("summary", {}).get("text", "")
    previous_block = f"Previous summary/cache to update:\n{existing}\n\n" if existing else ""
    conv_text = "\n".join(conv_lines)

    pdf_abstract = cache.get("vector", {}).get("abstract", "")
    abstract_context = f"Document Abstract/Overview:\n{pdf_abstract}\n\n" if pdf_abstract else ""

    prompt = f"""You are a knowledge caching assistant for a PDF research helper.
Your job is to update a concise, token-efficient, bullet-pointed Knowledge Cache representing:
1. A short abstract/overview of the PDF (1-2 sentences).
2. The core information/concepts from the PDF discussed so far.
3. The user's query intent (the types of questions they are asking).
4. Confirmed facts and conclusions reached in the conversation.

Keep the output extremely concise and token-efficient using bullet points. Avoid any conversational filler or duplication.

{abstract_context}{previous_block}New conversation to incorporate:
{conv_text}

Provide the updated cache in this structure:
### Abstract
- [1-2 sentence abstract]

### Key Document Info Discussed
- [Key concepts discussed]

### User Search Intent
- [Specific kinds of questions the user is interested in/asking]

### Key Conclusions & Facts
- [Specific answers/conclusions reached]
"""

    response = invoke_llm_tracked(llm, state, prompt, node="cache_summarize")
    summary_text = reply_text(response).strip()

    try:
        from embeddings import embed
        summary_emb = embed([summary_text])[0].tolist()
    except Exception as e:
        print(f"[cache_summarize] Failed to embed summary: {e}", flush=True)
        summary_emb = None

    cache.setdefault("summary", {})
    cache["summary"]["text"] = summary_text
    cache["summary"]["updated_at"] = str(datetime.datetime.now())
    if summary_emb:
        cache["summary"]["embedding"] = summary_emb
    cache["messages"] = []  # Clear messages pool once summarized

    return summary_text

def get_document_beginning(state: AgentState) -> str:
    """Reads the first chunk of metadata to provide document context to the planner."""
    pdf_id = state["pdf_id"]
    storage = state["storage_path"]
    meta_path = os.path.join(storage, f"{pdf_id}.json")
    print(f"[get_document_beginning] Checking metadata file at: {meta_path}", flush=True)
    if not os.path.exists(meta_path):
        print(f"[get_document_beginning] Metadata file does not exist: {meta_path}", flush=True)
        return ""
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
            # Read only the first chunk to optimize token counts!
            chunks = [metadata[i].get("text", "") for i in range(min(1, len(metadata)))]
            print(f"[get_document_beginning] Loaded {len(chunks)} chunks successfully (optimized to 1 chunk).", flush=True)
            return "\n".join(chunks)
    except Exception as e:
        print(f"[get_document_beginning] Error loading metadata: {e}", flush=True)
        return ""


def estimate_input_tokens(llm, state: dict, prompt: str) -> dict:
    context = ""
    if state.get("rag_chunks"):
        context = "\n".join(state["rag_chunks"])

    history = ""
    storage_path = state.get("storage_path")
    pdf_id = cache_id(state)
    if storage_path and pdf_id:
        cache = normalize_knowledge_cache(load_knowledge_cache(storage_path, pdf_id))
        history = build_cache_history_text(cache, max_recent=5)
    elif state.get("messages"):
        for msg in state["messages"][-5:]:
            role = "User" if msg.get("role") == "user" else "Assistant"
            history += f"{role}: {msg.get('text', '')}\n"

    selected_text = state.get("user_context", "")

    try:
        context_tokens = llm.get_num_tokens(context)
        history_tokens = llm.get_num_tokens(history)
        selected_text_tokens = llm.get_num_tokens(selected_text or "")
        prompt_tokens = llm.get_num_tokens(prompt)
    except Exception as e:
        print(f"Error calculating token counts: {e}", flush=True)
        context_tokens = len(context) // 4
        history_tokens = len(history) // 4
        selected_text_tokens = len(selected_text or "") // 4
        prompt_tokens = len(prompt) // 4

    return {
        "context": context_tokens,
        "history": history_tokens,
        "selected_text": selected_text_tokens,
        "prompt": prompt_tokens,
    }

def print_llm_tokens(llm, state: dict, prompt: str):
    breakdown = estimate_input_tokens(llm, state, prompt)
    print("Context Tokens:", breakdown["context"], flush=True)
    print("History Tokens:", breakdown["history"], flush=True)
    print("Selected Text Tokens:", breakdown["selected_text"], flush=True)
    print("Prompt Tokens:", breakdown["prompt"], flush=True)
    return breakdown

def extract_output_tokens(llm, response) -> int:
    try:
        meta = getattr(response, "usage_metadata", None) or getattr(response, "response_metadata", {}) or {}
        if isinstance(meta, dict):
            usage = meta.get("usage_metadata") or meta.get("token_usage") or meta
            for key in ("output_tokens", "completion_tokens", "candidates_token_count"):
                val = usage.get(key)
                if val is not None:
                    return int(val)
            total = usage.get("total_tokens") or usage.get("total_token_count")
            input_t = usage.get("input_tokens") or usage.get("prompt_tokens") or usage.get("prompt_token_count") or 0
            if total is not None:
                return max(0, int(total) - int(input_t))
    except Exception:
        pass

    try:
        content = reply_text(response)
        return llm.get_num_tokens(content or "")
    except Exception:
        text = reply_text(response)
        return len(text or "") // 4

def record_token_usage(node: str, input_breakdown: dict, output_tokens: int):
    input_total = sum(input_breakdown.values())
    with _token_lock:
        _token_session["calls"].append({
            "node": node,
            "input": input_total,
            "output": output_tokens,
            "breakdown": dict(input_breakdown),
        })
        _token_session["totals"]["input"] += input_total
        _token_session["totals"]["output"] += output_tokens
        for key in ("context", "history", "selected_text", "prompt"):
            _token_session["totals"][key] += input_breakdown.get(key, 0)

def extract_provider_usage(response):
    """What the provider says a request cost: (input, output) tokens, or None when it did not say.

    Output counts everything after the input (so a model's private thinking is included, as it is billed).
    """
    try:
        meta = getattr(response, "usage_metadata", None)
        if not isinstance(meta, dict):
            return None
        input_t = meta.get("input_tokens")
        if input_t is None or int(input_t) <= 0:
            return None
        input_t = int(input_t)
        output_t = int(meta.get("output_tokens") or 0)
        total = meta.get("total_tokens")
        if total is not None:
            output_t = max(output_t, int(total) - input_t)
        return input_t, max(0, output_t)
    except Exception:
        return None


def reconcile_input(estimate: dict, real_input=None) -> dict:
    """Split what was really sent into where it went.

    The estimate counts the whole prompt, and the document passages, the chat history and the selected text are
    already inside that prompt, so adding them on top would count them twice. Here the prompt is the whole, the three
    parts are slices of it, and "prompt" is what is left (instructions and the question). When the provider gave the
    real total, the slices are scaled to it.
    """
    context = int(estimate.get("context", 0))
    history = int(estimate.get("history", 0))
    selected = int(estimate.get("selected_text", 0))
    whole = int(estimate.get("prompt", 0))
    estimated_total = max(whole, context + history + selected)
    target = int(real_input) if real_input else estimated_total
    if estimated_total <= 0:
        return {"context": 0, "history": 0, "selected_text": 0, "prompt": max(0, target)}
    scale = target / estimated_total
    context_s = round(context * scale)
    history_s = round(history * scale)
    selected_s = round(selected * scale)
    return {
        "context": context_s,
        "history": history_s,
        "selected_text": selected_s,
        "prompt": max(0, target - context_s - history_s - selected_s),
    }


def invoke_llm_tracked(llm, state: dict, prompt: str, node: str = "unknown", messages=None):
    estimate = print_llm_tokens(llm, state, prompt)
    if messages is not None:
        response = llm.invoke(messages)
    else:
        response = llm.invoke(prompt)
    real = extract_provider_usage(response)
    if real:
        input_breakdown = reconcile_input(estimate, real[0])
        output_tokens = real[1]
    else:
        # a local model that reports nothing: our own count of what we sent and received
        input_breakdown = reconcile_input(estimate)
        output_tokens = extract_output_tokens(llm, response)
    print(f"[tokens] node={node} counted_in={sum(input_breakdown.values())} counted_out={output_tokens} from={'provider' if real else 'estimate'} (the old way would have said {sum(estimate.values())} in)", flush=True)
    record_token_usage(node, input_breakdown, output_tokens)
    return response

def supervisor_node(state: AgentState):
    llm = create_llm(state)

    storage_path = state.get("storage_path")
    pdf_id = cache_id(state)
    cache = normalize_knowledge_cache(load_knowledge_cache(storage_path, pdf_id))
    append_cache_message(cache, "user", state.get("user_query", ""), state.get("user_context", ""))

    cache_summary = ""
    if len(get_unsummarized_messages(cache)) >= 5:
        cache_summary = summarize_cache_conversation(llm, state, cache) or ""
        print(f"[supervisor_node] Auto-summarized knowledge cache ({len(cache.get('messages', []))} messages)", flush=True)

    save_knowledge_cache(storage_path, pdf_id, cache)
    # Classify intent with an explicit, unambiguous prompt
    prompt = f"""You are an intent classifier for a PDF assistant. Your job is to map a user query to EXACTLY ONE intent label.

Intent definitions (read carefully before deciding):
- "ask"      : The user is asking a question or wants an explanation, summary, or analysis about the PDF content. This is the DEFAULT for any question.
- "define"   : The user wants a dictionary/glossary definition of a SINGLE specific technical word or acronym (e.g. "What does RAG mean?", "Define entropy"). Do NOT use this for multi-word questions or general queries.
- "highlight": The user explicitly asks to highlight, mark, or underline text passages.
- "note"     : The user explicitly asks to create, generate, or write notes, a summary document, or study guide.
- "mindmap"  : The user explicitly asks for a mind map or concept map.
- "search"   : The user asks for information clearly NOT in the PDF (e.g. current events, prices, external URLs).
- "comment"  : The user explicitly asks to add a sticky note or comment on a specific page.

Critical rules:
- When in doubt, return "ask".
- "define" ONLY when the entire query is about defining ONE word/term.
- Questions starting with "what", "how", "why", "explain", "summarize" are almost always "ask".

User Query: {state['user_query']}
Selected Text (context): {state['user_context']}

Return ONLY the intent label (one of: ask, define, highlight, note, mindmap, search, comment). No other text."""
    
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
    
    response = invoke_llm_tracked(llm, state, prompt, node="supervisor", messages=[HumanMessage(content=content)])
    raw_intent = reply_text(response).strip().lower()
    print(f"[supervisor_node] Raw intent from LLM: '{raw_intent}'", flush=True)
    
    # Strict exact-word matching (avoids substring false-positives)
    VALID_INTENTS = ["ask", "define", "highlight", "note", "mindmap", "search", "comment"]
    intent = "ask"  # safe default
    for possible in VALID_INTENTS:
        # Match whole word so "define" doesn't accidentally match inside "undefined"
        if re.search(rf"\b{possible}\b", raw_intent):
            intent = possible
            break

    intent = constrain_intent(intent, normalize_mode(state.get("mode")), multi=bool(state.get("docs")))
    print(f"[supervisor_node] Final intent: '{intent}'", flush=True)
    
    # Retrieve RAG context with token-saving dynamic context reduction
    k_val = 3
    summary_emb = cache.get("summary", {}).get("embedding")
    if summary_emb and state["user_query"]:
        try:
            from embeddings import embed
            q_emb = embed(["query: " + state["user_query"]])[0].tolist()
            similarity = compute_similarity(q_emb, summary_emb)
            print(f"[supervisor_node] Query vs Cache Similarity: {similarity:.4f}", flush=True)
            # High semantic overlap: reduce RAG size to save tokens!
            if similarity > 0.75:
                k_val = 1
                print(f"[supervisor_node] High similarity (>0.75) detected. Reducing RAG chunks to k=1.", flush=True)
            elif similarity > 0.65:
                k_val = 2
                print(f"[supervisor_node] Moderate similarity (>0.65) detected. Reducing RAG chunks to k=2.", flush=True)
        except Exception as e:
            print(f"[supervisor_node] Error evaluating query-cache similarity: {e}", flush=True)

    if state.get("docs"):
        rag_res = retrieval_multi({
            "query": state["user_query"],
            "docs": state["docs"],
            "storagePath": state["storage_path"],
            "k": 6,
            "perDoc": 3
        })
    else:
        rag_res = retrieval_service({
            "query": state["user_query"],
            "pdfId": state["pdf_id"],
            "storagePath": state["storage_path"],
            "k": k_val
        })

    hits = rag_res.get("chunks", []) if isinstance(rag_res, dict) else []

    # A question that names a page ("summarise page 10") is answered from that page, not from whatever
    # happens to be closest in meaning.
    named = [] if state.get("docs") else extract_page_refs(state["user_query"])
    if named:
        named_res = pages_service({"pdfId": state["pdf_id"], "storagePath": state["storage_path"], "pages": named})
        named_hits = named_res.get("chunks", []) if isinstance(named_res, dict) else []
        if named_hits:
            seen = {(h.get("page"), h.get("text")) for h in named_hits}
            hits = named_hits + [h for h in hits if (h.get("page"), h.get("text")) not in seen]

    chunks = []
    for hit in hits:
        page = hit.get("page", "?")
        text = hit.get("text", "")
        if hit.get("doc"):
            chunks.append(f"[{hit['doc']}, page {page}] {text}")
        else:
            chunks.append(f"[Page {page}] {text}")
    
    return {
        "intent": intent,
        "rag_chunks": chunks,
        "rag_hits": hits,
        "cache_summary": cache_summary,
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
    llm = create_llm(state)

    context = "\n".join(state["rag_chunks"])

    cache = normalize_knowledge_cache(load_knowledge_cache(state.get("storage_path"), cache_id(state)))
    history = build_cache_history_text(cache, max_recent=3)

    vector = cache.get("vector", {})
    doc_info = ""
    if vector.get("category") or vector.get("abstract"):
        doc_info = f"Document Type: {vector.get('category')} ({vector.get('sub_type', 'default')})\n"
        if vector.get("abstract"):
            doc_info += f"Document Overview: {vector.get('abstract')}\n"

    prompt = build_ask_prompt(
        doc_info=doc_info,
        history=history,
        context=context,
        selected_text=state.get("user_context", ""),
        question=state["user_query"],
        mode=state.get("mode"),
        instructions=state.get("instructions"),
        multi=bool(state.get("docs")),
        artifacts=bool(state.get("artifacts")),
        doc_title=state.get("doc_title") or "",
    )
    
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
    
    response = invoke_llm_tracked(llm, state, prompt, node="ask", messages=[HumanMessage(content=content)])
    return {"response_text": reply_text(response)}

def highlight_node(state: AgentState):
    llm = create_llm(state)
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
    
    response = invoke_llm_tracked(llm, state, prompt, node="highlight")
    try:
        content = reply_text(response).strip()
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
    print("[notes_node] Starting notes pipeline...", flush=True)
    beginning_text = get_document_beginning(state)
    if not beginning_text:
        print("[notes_node] Beginning text empty, using user query as fallback.", flush=True)
        beginning_text = state.get("user_query", "")
    print(f"[notes_node] Prepared beginning_text (length: {len(beginning_text)} chars).", flush=True)
    return {"beginning_text": beginning_text}

def mindmap_node(state: AgentState):
    llm = create_llm(state)
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
    
    response = invoke_llm_tracked(llm, state, prompt, node="mindmap")
    return {
        "response_text": "I've visualized the concepts as a mind map.",
        "actions": [{"type": "mindmap", "code": reply_text(response)}]
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
    
    llm = create_llm(state)
    prompt = f"""Based on the following web search results, answer the user's question.
    
    Question: {query}
    Search Results: {results_str}
    
    Provide a concise summary of the findings.
    """
    
    response = invoke_llm_tracked(llm, state, prompt, node="websearch")
    return {
        "response_text": reply_text(response),
        "actions": [{"type": "websearch", "results": results}]
    }

def run_notes_planner(state: AgentState) -> Dict:
    print("[run_notes_planner] Initiating planner node...", flush=True)
    
    # Check cache first
    cache = normalize_knowledge_cache(load_knowledge_cache(state.get("storage_path"), cache_id(state)))
    vector = cache.get("vector", {})
    if vector.get("category") and vector.get("sub_type") and vector.get("focus_areas"):
        print("[run_notes_planner] Cache HIT! Skipping Planner LLM call.", flush=True)
        plan = {
            "category": vector["category"],
            "sub_type": vector["sub_type"],
            "reasoning": vector.get("reasoning", "Loaded from cache."),
            "focus_areas": vector["focus_areas"]
        }
        return {"plan": plan}
        
    print("[run_notes_planner] Cache MISS! Running Planner LLM...", flush=True)
    llm = create_llm(state)
    beginning_text = state.get("beginning_text", "")
    if not beginning_text:
        print("[run_notes_planner] beginning_text not found in state. Querying metadata...", flush=True)
        beginning_text = get_document_beginning(state) or state.get("user_query", "")
    
    prompt = f"""You are a PDF Notes Planner. Read this sample of the document's beginning:
    {beginning_text}
    
    1. Classify this PDF into one of these Categories and Sub-types:
    - Academic: research_paper, survey_paper, systematic_review, thesis, dissertation, conference_paper, technical_report, whitepaper
    - Education: textbook, textbook_chapter, lecture_notes, slides, lab_manual, assignment, tutorial, study_material
    - Legal: contract, agreement, nda, court_judgement, legal_brief, statute, policy_document, compliance_document
    - Business: annual_report, financial_report, business_plan, project_proposal, meeting_minutes, product_requirements_document
    - Technical: documentation, api_reference, software_design_doc, architecture_doc, research_specification
    - Personal / Misc: resume, cv, ebook, article, news_report, manual, form
    
    2. Output a JSON response in this exact format:
    {{
        "category": "Academic",
        "sub_type": "research_paper",
        "reasoning": "Brief explanation of classification..."
    }}
    Return ONLY valid JSON. Do not include markdown wraps.
    """
    
    print("[run_notes_planner] Calling LLM...", flush=True)
    response = invoke_llm_tracked(llm, state, prompt, node="notes_planner")
    print("[run_notes_planner] LLM response received.", flush=True)
    content = reply_text(response).strip()
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0].strip()
    elif content.startswith("```"):
        content = content.strip("`").strip()
        
    try:
        plan = json.loads(content)
        sub_type = str(plan.get("sub_type", "default")).lower().strip().replace(" ", "_").replace("-", "_")
        plan["sub_type"] = sub_type
        group = SUBTYPE_TO_FOCUS_GROUP.get(sub_type, "default")
        plan["focus_areas"] = FOCUS_GROUPS.get(group, FOCUS_GROUPS["default"])
        
        # Save to cache vector section
        cache.setdefault("vector", {})
        cache["vector"]["category"] = plan.get("category", "Document")
        cache["vector"]["sub_type"] = sub_type
        cache["vector"]["reasoning"] = plan.get("reasoning", "")
        cache["vector"]["focus_areas"] = plan["focus_areas"]
        save_knowledge_cache(state.get("storage_path"), cache_id(state), cache)
        
        print(f"[run_notes_planner] Successfully parsed plan and updated cache: {plan}", flush=True)
        return {"plan": plan}
    except Exception as e:
        print(f"[run_notes_planner] Error parsing Planner JSON: {e}", flush=True)
        fallback = {
            "plan": {
                "category": "Personal / Misc",
                "sub_type": "default",
                "reasoning": "Fallback to default category due to parsing failure.",
                "focus_areas": FOCUS_GROUPS["default"]
            }
        }
        print(f"[run_notes_planner] Using fallback plan: {fallback}", flush=True)
        return fallback

def run_document_analyzer(state: AgentState) -> Dict:
    print("[run_document_analyzer] Initiating document analyzer node...", flush=True)
    
    # Check cache first
    cache = normalize_knowledge_cache(load_knowledge_cache(state.get("storage_path"), cache_id(state)))
    vector = cache.get("vector", {})
    if vector.get("abstract") and vector.get("queries"):
        print("[run_document_analyzer] Cache HIT! Skipping Analyzer LLM call.", flush=True)
        analysis = {
            "abstract": vector["abstract"],
            "queries": vector["queries"]
        }
        return {"analysis": analysis}
        
    print("[run_document_analyzer] Cache MISS! Running Document Analyzer LLM...", flush=True)
    llm = create_llm(state)
    plan = state.get("plan", {})
    beginning_text = state.get("beginning_text", "")
    if not beginning_text:
        print("[run_document_analyzer] beginning_text not found in state. Querying metadata...", flush=True)
        beginning_text = get_document_beginning(state) or state.get("user_query", "")
    
    prompt = f"""You are a Document Analyzer. Analyze this document beginning context:
    {beginning_text}
    
    Notes Focus Areas for this document type ({plan.get('sub_type', 'default')}): {plan.get('focus_areas', [])}
    
    1. Extract a concise Abstract/Overview of the document.
    2. For each focus area, provide a specific search query or keywords to retrieve the relevant text from our local index.
    
    Return a JSON response in this exact format:
    {{
        "abstract": "Concise abstract summarizing core topic...",
        "queries": {{
            "FocusArea1": "specific search query...",
            "FocusArea2": "specific search query..."
        }}
    }}
    Return ONLY valid JSON.
    """
    
    print("[run_document_analyzer] Calling LLM...", flush=True)
    response = invoke_llm_tracked(llm, state, prompt, node="document_analyzer")
    print("[run_document_analyzer] LLM response received.", flush=True)
    content = reply_text(response).strip()
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0].strip()
    elif content.startswith("```"):
        content = content.strip("`").strip()
        
    try:
        analysis = json.loads(content)
        
        # Save to cache vector section
        cache.setdefault("vector", {})
        cache["vector"]["abstract"] = analysis.get("abstract", "")
        cache["vector"]["queries"] = analysis.get("queries", {})
        save_knowledge_cache(state.get("storage_path"), cache_id(state), cache)
        
        print(f"[run_document_analyzer] Successfully parsed analysis and updated cache: {analysis}", flush=True)
        return {"analysis": analysis}
    except Exception as e:
        print(f"[run_document_analyzer] Error parsing Document Analyzer JSON: {e}", flush=True)
        fallback = {
            "analysis": {
                "abstract": "Overview of the document context.",
                "queries": {area: f"{area} in document" for area in plan.get("focus_areas", [])}
            }
        }
        print(f"[run_document_analyzer] Using fallback analysis: {fallback}", flush=True)
        return fallback

def run_parallel_workers(state: AgentState) -> Dict:
    print("[run_parallel_workers] Initiating parallel workers node...", flush=True)
    llm = create_llm(state)
    plan = state.get("plan", {})
    analysis = state.get("analysis", {})
    queries = analysis.get("queries", {})
    
    def draft_section(title: str) -> Dict:
        try:
            search_query = queries.get(title, f"{title} in document")
            print(f"  [Worker - {title}] Querying local RAG index with: '{search_query}'", flush=True)
            
            # Local RAG retrieval with k=3 to optimize tokens (down from k=5)
            rag_res = retrieval_service({
                "query": search_query,
                "pdfId": state["pdf_id"],
                "storagePath": state["storage_path"],
                "k": 3
            })
            hits = rag_res.get("chunks", []) if isinstance(rag_res, dict) else []
            chunks = [f"[Page {h.get('page', '?')}] {h.get('text', '')}" for h in hits]
            section_context = "\n".join(chunks)
            print(f"  [Worker - {title}] Retrieved {len(hits)} RAG chunks (total context: {len(section_context)} chars). Calling LLM...", flush=True)
            
            prompt = f"""You are a Topic Expert Worker writing a section of study notes.
            Write a concise, informative, and detailed note section for: "{title}"
            Use the following retrieved document context:
            {section_context}
            
            Include key insights and definitions. Be direct and clear. Limit the output to 200 words.
            Do not add overall headers, just write the paragraph content of this section.
            """
            response = invoke_llm_tracked(llm, state, prompt, node=f"worker_{title}")
            print(f"  [Worker - {title}] LLM output completed (length: {len(reply_text(response))} chars).", flush=True)
            return {
                "title": title,
                "content": reply_text(response),
                "context_chunks": [h.get("text", "") for h in hits]
            }
        except Exception as ex:
            print(f"  [Worker - {title}] Error during draft execution: {ex}", flush=True)
            return {
                "title": title,
                "content": f"Failed to draft notes for this section due to error: {ex}",
                "context_chunks": []
            }
        
    drafts = []
    focus_areas = plan.get("focus_areas", [])
    print(f"[run_parallel_workers] Launching ThreadPoolExecutor with {len(focus_areas)} workers...", flush=True)
    
    max_workers = max(1, len(focus_areas))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(draft_section, area): area for area in focus_areas}
        for future in concurrent.futures.as_completed(futures):
            area_name = futures[future]
            try:
                result = future.result()
                drafts.append(result)
                print(f"[run_parallel_workers] Finished thread for area: {area_name}", flush=True)
            except Exception as e:
                print(f"[run_parallel_workers] Thread for area {area_name} raised an exception: {e}", flush=True)
                
    # Sort drafts back into the order of focus_areas
    drafts_dict = {d["title"]: d for d in drafts}
    sorted_drafts = []
    for area in focus_areas:
        if area in drafts_dict:
            sorted_drafts.append(drafts_dict[area])
            
    print(f"[run_parallel_workers] Parallel drafting finished. Total sections drafted: {len(sorted_drafts)}", flush=True)
    return {"drafts": sorted_drafts}

def run_local_fact_checker(state: AgentState) -> Dict:
    """Evaluates lexical term overlap between drafts and source RAG context locally (no LLM calls)."""
    print("[run_local_fact_checker] Starting local fact check...", flush=True)
    drafts = state.get("drafts", [])
    print(f"[run_local_fact_checker] Processing {len(drafts)} drafted sections.", flush=True)
    
    def tokenize(text: str) -> set:
        # Lowercase, strip punctuation, split into words
        text = text.lower()
        text = text.translate(str.maketrans("", "", string.punctuation))
        words = text.split()
        # Filter stopwords and short terms
        return {w for w in words if w not in STOPWORDS and len(w) > 2}
    checked_drafts = []
    for draft in drafts:
        title = draft["title"]
        content = draft["content"]
        source_text = " ".join(draft["context_chunks"])
        source_words = tokenize(source_text)
        
        # Split draft content into sentences
        # Simple sentence splitter on punctuation
        sentences = re.split(r'(?<=[.!?]) +', content)
        checked_sentences = []
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            sentence_words = tokenize(sentence)
            
            if not sentence_words:
                checked_sentences.append(sentence)
                continue
                
            # Compute term overlap score
            overlap = len(sentence_words & source_words) / len(sentence_words)
            
            # If overlap score is below 15%, flag it as unverified
            if overlap < 0.15:
                checked_sentences.append(f"{sentence} ⚠️ *[Unverified Claim]*")
            else:
                checked_sentences.append(sentence)
                
        checked_drafts.append({
            "title": title,
            "content": " ".join(checked_sentences)
        })
        print(f"[run_local_fact_checker] Completed local check for: {title}", flush=True)
        
    print(f"[run_local_fact_checker] Finished fact check node.", flush=True)
    return {"verified_drafts": checked_drafts}

def run_markdown_formatter(state: AgentState) -> Dict:
    print("[run_markdown_formatter] Initiating markdown formatter node...", flush=True)
    llm = create_llm(state)
    plan = state.get("plan", {})
    analysis = state.get("analysis", {})
    verified_drafts = state.get("verified_drafts", [])
    
    sections_text = ""
    for d in verified_drafts:
        sections_text += f"### {d['title']}\n{d['content']}\n\n"
        
    prompt = f"""You are a Notes Formatter. Organize and compile the following note sections into a unified, premium study guide.
    
    Document Category: {plan.get('category', 'Document')} ({plan.get('sub_type', 'default')})
    Abstract: {analysis.get('abstract', '')}
    
    Draft Sections:
    {sections_text}
    
    Rules:
    - Add a beautiful Markdown Title based on the core topic.
    - Render the 'Abstract / Executive Summary' right under the title.
    - Use clear markdown headers, bold text, lists, and blockquotes for key insights.
    - Format key terms in **bold** and append a mini-glossary of defined terms at the bottom.
    - Create structured comparison tables where appropriate to summarize topics.
    - Use LaTeX formatting for equations if any are present.
    - Preserve any '⚠️ [Unverified Claim]' flags exactly where they appear in the draft text.
    - Make the styling highly readable and professional.
    """
    
    print("[run_markdown_formatter] Calling LLM to format notes...", flush=True)
    response = invoke_llm_tracked(llm, state, prompt, node="markdown_formatter")
    print("[run_markdown_formatter] Formatting completed successfully.", flush=True)
    
    sub_type_label = plan.get('sub_type', 'document').replace('_', ' ')
    response_text = f"I've generated comprehensive notes for the {sub_type_label}."
    
    return {
        "response_text": response_text,
        "actions": [{"type": "note", "content": reply_text(response)}]
    }


def comment_node(state: AgentState):
    llm = create_llm(state)
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
    
    response = invoke_llm_tracked(llm, state, prompt, node="comment")
    comments = []
    try:
        content = reply_text(response).strip()
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
    llm = create_llm(state)
    
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
    
    response = invoke_llm_tracked(llm, state, prompt, node="critic")
    return {"response_text": reply_text(response)}

def precision_node(state: AgentState):
    llm = create_llm(state)
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

    response = invoke_llm_tracked(llm, state, prompt, node="precision")
    content = reply_text(response).strip()
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
workflow.add_node("plan", run_notes_planner)
workflow.add_node("analyze", run_document_analyzer)
workflow.add_node("parallel", run_parallel_workers)
workflow.add_node("checker", run_local_fact_checker)
workflow.add_node("formatter", run_markdown_formatter)
# workflow.add_node("critic", critic_node)
# workflow.add_node("precision", precision_node)


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
        # Document-only chats never leave the PDF, so web search is off.
        return "ask" if state.get("mode") == "document" else "websearch"
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
workflow.add_edge("ask", END)
workflow.add_edge("highlighter", END)
workflow.add_edge("notes", "plan")
workflow.add_edge("plan", "analyze")
workflow.add_edge("analyze", "parallel")
workflow.add_edge("parallel", "checker")
workflow.add_edge("checker", "formatter")
workflow.add_edge("formatter", END)
workflow.add_edge("mindmap", END)
workflow.add_edge("websearch", END)
workflow.add_edge("comment", END)
# workflow.add_edge("critic", END)
# workflow.add_edge("precision", END)

# Compile the graph
app = workflow.compile()

def invoke_agent(query_data: dict):
    reset_token_session()

    # Resolve provider info from nested profile or flat keys
    profile = query_data.get("profile") or {}
    profile_id = str(profile.get("id") or query_data.get("profileId") or "default").strip()
    api_format = str(profile.get("format") or query_data.get("apiFormat") or "gemini").strip().lower()
    api_url    = str(profile.get("url")    or query_data.get("apiUrl")    or "").strip()
    api_key    = str(profile.get("key")    or query_data.get("apiKey")    or "").strip()
    model      = str(profile.get("model")  or query_data.get("model")     or "gemini-3.5-flash-lite").strip()

    initial_state = {
        "user_query": query_data.get("query", ""),
        "pdf_id": query_data.get("pdfId", ""),
        "conversation_id": query_data.get("conversationId", ""),
        "storage_path": query_data.get("storagePath", ""),
        "api_key": api_key,
        "api_format": api_format,
        "api_url": api_url,
        "model": model,
        "user_context": query_data.get("context", ""),
        "intent": "",
        "rag_chunks": [],
        "rag_hits": [],
        "actions": [],
        "glossary_terms": [],
        "messages": query_data.get("messages", []),
        "parts": query_data.get("parts", []),
        "response_text": "",
        "evaluation": {},
        "cache_summary": "",
        "mode": normalize_mode(query_data.get("mode")),
        "instructions": query_data.get("instructions") or [],
        "docs": [d for d in (query_data.get("docs") or []) if isinstance(d, dict) and d.get("pdfId")][:12],
        "artifacts": bool(query_data.get("artifacts")),
        "doc_title": str(query_data.get("docTitle") or "")[:200],
    }

    print(f"[invoke_agent] Provider: format={api_format}, url={api_url or '(default)'}, model={model}", flush=True)

    final_state = app.invoke(initial_state)

    storage_path = query_data.get("storagePath", "")
    pdf_id = cache_id(query_data)
    if final_state.get("response_text") and storage_path and pdf_id:
        cache = normalize_knowledge_cache(load_knowledge_cache(storage_path, pdf_id))
        append_cache_message(cache, "assistant", final_state["response_text"])
        save_knowledge_cache(storage_path, pdf_id, cache)

    token_data = get_token_session()
    return {
        "intent": final_state["intent"],
        "response_text": final_state["response_text"],
        "actions": final_state["actions"],
        "glossary_terms": final_state["glossary_terms"],
        "evaluation": final_state.get("evaluation", {}),
        "sources": sources_from_hits([{**h, "doc": h.get("doc") or final_state.get("doc_title") or ""} for h in (final_state.get("rag_hits") or []) if isinstance(h, dict)]),
        "cache_summary": final_state.get("cache_summary", ""),
        "usage": {
            "profile_id": profile_id,
            "prompt_tokens": token_data["totals"]["input"],
            "response_tokens": token_data["totals"]["output"],
            "total_tokens": token_data["totals"]["input"] + token_data["totals"]["output"],
            "breakdown": {
                "context": token_data["totals"]["context"],
                "history": token_data["totals"]["history"],
                "selected_text": token_data["totals"]["selected_text"],
                "prompt": token_data["totals"]["prompt"],
            },
            "calls": token_data["calls"],
        },
    }

def summarize_knowledge_cache(query_data: dict):
    """Manually summarize the knowledge cache for a PDF."""
    reset_token_session()

    profile = query_data.get("profile") or {}
    api_format = str(profile.get("format") or query_data.get("apiFormat") or "gemini").strip().lower()
    api_url    = str(profile.get("url")    or query_data.get("apiUrl")    or "").strip()
    api_key    = str(profile.get("key")    or query_data.get("apiKey")    or "").strip()
    model      = str(profile.get("model")  or query_data.get("model")     or "gemini-3.5-flash-lite").strip()
    storage_path = query_data.get("storagePath", "")
    pdf_id = cache_id(query_data)

    state = {
        "storage_path": storage_path,
        "pdf_id": pdf_id,
        "api_key": api_key,
        "api_format": api_format,
        "api_url": api_url,
        "model": model,
        "user_context": "",
        "rag_chunks": [],
        "messages": [],
    }

    cache = normalize_knowledge_cache(load_knowledge_cache(storage_path, pdf_id))
    unsummarized = get_unsummarized_messages(cache)

    if not unsummarized:
        return {
            "summary": cache.get("summary", {}).get("text", ""),
            "message": "No messages to summarize.",
            "usage": {
                "profile_id": str(profile.get("id") or query_data.get("profileId") or "default"),
                "prompt_tokens": 0,
                "response_tokens": 0,
                "total_tokens": 0,
                "breakdown": {"context": 0, "history": 0, "selected_text": 0, "prompt": 0},
                "calls": [],
            },
        }

    llm = create_llm(state)
    summary_text = summarize_cache_conversation(llm, state, cache, force=True)
    save_knowledge_cache(storage_path, pdf_id, cache)

    token_data = get_token_session()
    profile_id = str(profile.get("id") or query_data.get("profileId") or "default").strip()

    return {
        "summary": summary_text,
        "message_count": len(cache.get("messages", [])),
        "usage": {
            "profile_id": profile_id,
            "prompt_tokens": token_data["totals"]["input"],
            "response_tokens": token_data["totals"]["output"],
            "total_tokens": token_data["totals"]["input"] + token_data["totals"]["output"],
            "breakdown": {
                "context": token_data["totals"]["context"],
                "history": token_data["totals"]["history"],
                "selected_text": token_data["totals"]["selected_text"],
                "prompt": token_data["totals"]["prompt"],
            },
            "calls": token_data["calls"],
        },
    }
