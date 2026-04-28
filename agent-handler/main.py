from fastapi import FastAPI
from services.indexing import indexing_service
from services.retrieval import retrieval_service

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