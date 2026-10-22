import hmac
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from services.indexing import indexing_service
from services.retrieval import retrieval_service
from services.dictionary import dictionary_service
from graph import invoke_agent, summarize_knowledge_cache

app = FastAPI()

# The Electron main process generates a per-launch token and passes it in the environment.
# Without it (e.g. a stray local process hitting the port) every request is refused.
API_TOKEN = os.environ.get("THINKER_TOKEN", "")


@app.middleware("http")
async def require_token(request: Request, call_next):
    if API_TOKEN:
        supplied = request.headers.get("x-thinker-token", "")
        if not hmac.compare_digest(supplied, API_TOKEN):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/index")
def index_pdf(data: dict):
    return indexing_service(data)

@app.post("/query")
def query_pdf(data: dict):
    return retrieval_service(data)

@app.post("/define")
def define_word(data: dict):
    word = data.get("word")
    context = data.get("context", "")
    api_key = data.get("apiKey")
    model = data.get("model", "gemini-3.5-flash-lite")
    api_format = data.get("apiFormat", "gemini")
    api_url = data.get("apiUrl", "")
    return dictionary_service(word, context, api_key, model, api_format, api_url)

@app.post("/agent/invoke")
def agent_invoke(data: dict):
    try:
        return invoke_agent(data)
    except Exception as e:
        print(f"Agent invocation failed: {e}")
        return {"error": str(e)}

@app.post("/agent/summarize-cache")
def agent_summarize_cache(data: dict):
    try:
        return summarize_knowledge_cache(data)
    except Exception as e:
        print(f"Cache summarization failed: {e}")
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    import sys
    import os
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    else:
        port = int(os.environ.get("PORT", 8000))
    print(f"Starting uvicorn server on port {port}...", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port)
