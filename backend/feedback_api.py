import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional, List
from uuid import UUID
import requests
import weaviate
from sentence_transformers import SentenceTransformer, CrossEncoder
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langsmith import Client
from pydantic import BaseModel, Field


load_dotenv()

app = FastAPI(
    title="RAG Feedback API",
    description="Backend API for chat, streaming responses, sources, and feedback.",
    version="1.0.0",
)

# Allow React frontend to call FastAPI backend.
# React: http://localhost:5173
# FastAPI: http://127.0.0.1:8000
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

langsmith_client = Client()

LOCAL_FEEDBACK_FILE = Path("feedback_logs.jsonl")

OLLAMA_MODEL = "qwen2.5:7b"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"

embedding_model = SentenceTransformer("BAAI/bge-small-en-v1.5")
reranker_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")


def get_weaviate_collection():
    client = weaviate.connect_to_local()
    return client.collections.get("CISControlsChunks")
# -----------------------------
# Data models
# -----------------------------

class FeedbackRequest(BaseModel):
    question: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)
    feedback: Literal["thumbs_up", "thumbs_down"]
    comment: Optional[str] = None
    run_id: Optional[UUID] = None


class FeedbackResponse(BaseModel):
    status: str
    message: str
    feedback_key: str
    score: int
    logged_to_langsmith: bool
    saved_locally: bool
    timestamp: str


class ChatRequest(BaseModel):
    question: str


class Source(BaseModel):
    title: str
    page: Optional[int] = None
    snippet: str


class ChatResponse(BaseModel):
    answer: str
    sources: List[Source]
    run_id: Optional[str] = None


# -----------------------------
# Health check
# -----------------------------

@app.get("/")
def health_check():
    return {
        "status": "ok",
        "message": "RAG Feedback API is running",
    }


# -----------------------------
# Mock RAG logic for Day 2
# Later this will be replaced by real retrieval + generation.
# -----------------------------

def generate_mock_rag_answer(question: str) -> dict:
    question_lower = question.lower()

    if "control 01" in question_lower or "control 1" in question_lower:
        return {
            "answer": (
                "**Control 01** is about the **inventory and control of enterprise assets**.\n\n"
                "Its goal is to help an organization know exactly what devices, systems, "
                "and assets are connected to its environment.\n\n"
                "This matters because:\n"
                "- you cannot protect assets you do not know exist,\n"
                "- unknown devices can create security risks,\n"
                "- accurate inventories help teams monitor and secure their systems."
            ),
            "sources": [
                {
                    "title": "CIS Controls v8 PDF",
                    "page": 11,
                    "snippet": "Control 01 focuses on the inventory and control of enterprise assets.",
                }
            ],
        }

    if "cis controls" in question_lower:
        return {
            "answer": (
                "**The CIS Controls** are a prioritized set of cybersecurity best practices.\n\n"
                "They help organizations reduce risk by focusing on practical defensive "
                "actions against common cyber threats.\n\n"
                "Key ideas include:\n"
                "- identifying important assets,\n"
                "- protecting systems and data,\n"
                "- detecting weaknesses early,\n"
                "- improving the organization’s security posture over time."
            ),
            "sources": [
                {
                    "title": "CIS Controls v8 PDF",
                    "page": 11,
                    "snippet": "The CIS Controls are defensive actions that help organizations improve cybersecurity.",
                }
            ],
        }

    return {
        "answer": (
            "I received your question successfully.\n\n"
            "For now, this endpoint is still using **mock RAG logic**. "
            "The frontend and backend are connected, and the response is being streamed "
            "from FastAPI to React.\n\n"
            "The next step will be to connect this endpoint to the real RAG retrieval pipeline."
        ),
        "sources": [
            {
                "title": "Mock backend response",
                "page": None,
                "snippet": "This confirms that the backend chat endpoint is working and ready for RAG integration.",
            }
        ],
    }


# -----------------------------
# Normal chat endpoint
# Returns the full answer at once.
# Good fallback endpoint.
# -----------------------------
def retrieve_relevant_chunks(
    question: str,
    retrieval_limit: int = 10,
    top_k: int = 4,
) -> list[dict]:
    client = weaviate.connect_to_local()
    collection = client.collections.get("CISControlsChunks")

    question_vector = embedding_model.encode(
        question,
        normalize_embeddings=True,
    )

    results = collection.query.near_vector(
        near_vector=question_vector.tolist(),
        limit=retrieval_limit,
        return_properties=["text", "source", "page_number", "chunk_id"],
    )

    chunks = []

    for obj in results.objects:
        props = obj.properties

        chunks.append(
            {
                "text": props.get("text", ""),
                "source": props.get("source", "CIS Controls v8 PDF"),
                "page_number": props.get("page_number"),
                "chunk_id": props.get("chunk_id"),
            }
        )

    client.close()

    if not chunks:
        return []

    pairs = [(question, chunk["text"]) for chunk in chunks]
    scores = reranker_model.predict(pairs)

    ranked_chunks = []

    for chunk, score in zip(chunks, scores):
        ranked_chunks.append(
            {
                **chunk,
                "rerank_score": float(score),
            }
        )

    ranked_chunks.sort(
        key=lambda item: item["rerank_score"],
        reverse=True,
    )

    return ranked_chunks[:top_k]


def build_rag_prompt(question: str, chunks: list[dict]) -> str:
    context_blocks = []

    for index, chunk in enumerate(chunks, start=1):
        context_blocks.append(
            f"[Source {index}]\n"
            f"Document: {chunk.get('source')}\n"
            f"Page: {chunk.get('page_number')}\n"
            f"Text:\n{chunk.get('text')}"
        )

    context = "\n\n".join(context_blocks)

    return f"""
You are a cybersecurity assistant answering questions using the CIS Controls context below.

Rules:
- Use only the provided context.
- If the context does not contain enough information, say that the document context does not provide enough information.
- Keep the answer clear and concise.
- Use markdown formatting.
- Cite sources using [Source 1], [Source 2], etc.

Context:
{context}

Question:
{question}

Answer:
""".strip()


def ask_ollama(prompt: str) -> str:
    response = requests.post(
        OLLAMA_URL,
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
            },
        },
        timeout=120,
    )

    response.raise_for_status()

    data = response.json()
    return data.get("response", "").strip()


def generate_rag_answer(question: str) -> dict:
    chunks = retrieve_relevant_chunks(question)

    if not chunks:
        return {
            "answer": (
                "I could not find relevant information in the CIS Controls knowledge base "
                "for this question."
            ),
            "sources": [],
        }

    prompt = build_rag_prompt(question, chunks)
    answer = ask_ollama(prompt)

    sources = []

    for chunk in chunks:
        text = chunk.get("text", "")
        snippet = text[:350] + "..." if len(text) > 350 else text

        sources.append(
            {
                "title": chunk.get("source", "CIS Controls v8 PDF"),
                "page": chunk.get("page_number"),
                "snippet": snippet,
            }
        )

    return {
        "answer": answer,
        "sources": sources,
    }
    
@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    question = request.question.strip()

    result = generate_rag_answer(question)

    return {
        "answer": result["answer"],
        "sources": result["sources"],
        "run_id": None,
    }


# -----------------------------
# Streaming chat endpoint
# Sends the answer gradually using Server-Sent Events.
# -----------------------------

@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    question = request.question.strip()

    result = generate_rag_answer(question)
    answer = result["answer"]
    sources = result["sources"]

    async def event_generator():
        words = answer.split(" ")

        for word in words:
            event_data = {
                "type": "token",
                "content": word + " ",
            }

            yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)

        sources_event = {
            "type": "sources",
            "sources": sources,
            "run_id": None,
        }

        yield f"data: {json.dumps(sources_event, ensure_ascii=False)}\n\n"

        done_event = {
            "type": "done",
        }

        yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
    )


# -----------------------------
# Feedback logic
# -----------------------------

def save_feedback_locally(feedback_record: dict) -> None:
    with LOCAL_FEEDBACK_FILE.open("a", encoding="utf-8") as file:
        file.write(json.dumps(feedback_record, ensure_ascii=False) + "\n")


@app.post("/api/feedback", response_model=FeedbackResponse)
def collect_feedback(payload: FeedbackRequest):
    score = 1 if payload.feedback == "thumbs_up" else 0
    feedback_key = "user_feedback"
    timestamp = datetime.now(timezone.utc).isoformat()

    feedback_record = {
        "timestamp": timestamp,
        "question": payload.question,
        "answer": payload.answer,
        "feedback": payload.feedback,
        "score": score,
        "comment": payload.comment,
        "run_id": str(payload.run_id) if payload.run_id else None,
    }

    # Always save locally, so feedback is not lost.
    save_feedback_locally(feedback_record)

    # If no LangSmith run_id is provided, feedback cannot be attached to a trace yet.
    if payload.run_id is None:
        return FeedbackResponse(
            status="success",
            message="Feedback saved locally. No LangSmith run_id was provided, so it was not attached to LangSmith.",
            feedback_key=feedback_key,
            score=score,
            logged_to_langsmith=False,
            saved_locally=True,
            timestamp=timestamp,
        )

    try:
        langsmith_client.create_feedback(
            run_id=payload.run_id,
            key=feedback_key,
            score=score,
            comment=payload.comment or "",
        )

        return FeedbackResponse(
            status="success",
            message="Feedback recorded successfully in LangSmith and saved locally.",
            feedback_key=feedback_key,
            score=score,
            logged_to_langsmith=True,
            saved_locally=True,
            timestamp=timestamp,
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Feedback was saved locally, but failed to log to LangSmith: {str(error)}",
        )


@app.get("/api/feedback")
def get_feedback_logs():
    if not LOCAL_FEEDBACK_FILE.exists():
        return {
            "status": "success",
            "count": 0,
            "feedback": [],
        }

    feedback_items = []

    with LOCAL_FEEDBACK_FILE.open("r", encoding="utf-8") as file:
        for line in file:
            feedback_items.append(json.loads(line))

    return {
        "status": "success",
        "count": len(feedback_items),
        "feedback": feedback_items,
    }


@app.get("/api/feedback/summary")
def get_feedback_summary():
    if not LOCAL_FEEDBACK_FILE.exists():
        return {
            "status": "success",
            "total_feedback": 0,
            "thumbs_up": 0,
            "thumbs_down": 0,
        }

    thumbs_up = 0
    thumbs_down = 0
    total = 0

    with LOCAL_FEEDBACK_FILE.open("r", encoding="utf-8") as file:
        for line in file:
            item = json.loads(line)
            total += 1

            if item["feedback"] == "thumbs_up":
                thumbs_up += 1
            elif item["feedback"] == "thumbs_down":
                thumbs_down += 1

    return {
        "status": "success",
        "total_feedback": total,
        "thumbs_up": thumbs_up,
        "thumbs_down": thumbs_down,
    }