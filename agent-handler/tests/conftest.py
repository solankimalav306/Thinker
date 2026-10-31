import os
import sys

# Tests import backend modules the same way uvicorn does: from the agent-handler directory.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# No test may download or run the reranking model.
os.environ.setdefault("THINKER_RERANK", "off")
