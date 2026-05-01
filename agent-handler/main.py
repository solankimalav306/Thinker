from fastapi import FastAPI
from services.indexing import indexing_service
from services.retrieval import retrieval_service
from services.dictionary import dictionary_service
from graph import invoke_agent

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.post("/index")
def index_pdf(data: dict):
    return indexing_service(data)

@app.post("/query")
def query_pdf(data: dict):
    hello  = retrieval_service(data)
    print("Query result:", hello)
    return hello

@app.post("/define")
def define_word(data: dict):
    word = data.get("word")
    context = data.get("context", "")
    api_key = data.get("apiKey")
    model = data.get("model", "gemini-2.5-flash-lite")
    return dictionary_service(word, context, api_key, model)

@app.post("/agent/invoke")
def agent_invoke(data: dict):
    try:
        return invoke_agent(data)
    except Exception as e:
        print(f"Agent invocation failed: {e}")
        return {"error": str(e)}