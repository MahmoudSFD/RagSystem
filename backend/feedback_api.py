import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional
from uuid import UUID

import requests
import weaviate
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langsmith import Client
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder, SentenceTransformer
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


load_dotenv()

app = FastAPI(
    title="RAG Feedback API",
    description="Backend API for chat, streaming responses, sources, feedback, and chat history.",
    version="1.0.0",
)

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

# -----------------------------
# Config
# -----------------------------

LOCAL_FEEDBACK_FILE = Path("feedback_logs.jsonl")

DATABASE_URL = "mysql+pymysql://root:rootpassword@127.0.0.1:3307/rag_app"

OLLAMA_MODEL = "qwen2.5:3b"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

langsmith_client = Client()

embedding_model = SentenceTransformer("BAAI/bge-small-en-v1.5")
reranker_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")


# -----------------------------
# Database initialization
# -----------------------------

def init_database():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS conversations (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    conversation_id INT NOT NULL,
                    role VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                        ON DELETE CASCADE
                )
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS message_sources (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    message_id INT NOT NULL,
                    title VARCHAR(255) NOT NULL,
                    page INT NULL,
                    snippet TEXT NULL,
                    FOREIGN KEY (message_id) REFERENCES messages(id)
                        ON DELETE CASCADE
                )
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS message_versions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    message_id INT NOT NULL,
                    version_number INT NOT NULL,
                    content TEXT NOT NULL,
                    run_id VARCHAR(255) NULL,
                    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at DATETIME NOT NULL,
                    FOREIGN KEY (message_id) REFERENCES messages(id)
                        ON DELETE CASCADE,
                    UNIQUE KEY unique_message_version (message_id, version_number)
                )
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS message_version_sources (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    version_id INT NOT NULL,
                    title VARCHAR(255) NOT NULL,
                    page INT NULL,
                    snippet TEXT NULL,
                    FOREIGN KEY (version_id) REFERENCES message_versions(id)
                        ON DELETE CASCADE
                )
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS feedback_entries (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    conversation_id INT NULL,
                    message_id INT NULL,
                    version_id INT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    feedback VARCHAR(20) NOT NULL,
                    score INT NOT NULL,
                    reason VARCHAR(255) NULL,
                    comment TEXT NULL,
                    run_id VARCHAR(255) NULL,
                    created_at DATETIME NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                        ON DELETE CASCADE,
                    FOREIGN KEY (message_id) REFERENCES messages(id)
                        ON DELETE SET NULL,
                    FOREIGN KEY (version_id) REFERENCES message_versions(id)
                        ON DELETE SET NULL
                )
                """
            )
        )


init_database()


# -----------------------------
# Data models
# -----------------------------

class Source(BaseModel):
    title: str
    page: Optional[int] = None
    snippet: str


class FeedbackRequest(BaseModel):
    question: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)
    feedback: Literal["thumbs_up", "thumbs_down"]
    comment: Optional[str] = None
    reason: Optional[str] = None
    conversation_id: Optional[int] = None
    message_id: Optional[int] = None
    version_id: Optional[int] = None
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
    conversation_id: Optional[int] = None


class ChatResponse(BaseModel):
    answer: str
    sources: List[Source]
    run_id: Optional[str] = None
    conversation_id: Optional[int] = None


class ConversationCreateRequest(BaseModel):
    title: str


class ConversationRenameRequest(BaseModel):
    title: str


class ConversationResponse(BaseModel):
    id: int
    title: str
    created_at: str
    updated_at: str


class MessageCreateRequest(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    sources: List[Source] = []


class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    sources: List[Source]
    created_at: str


class ConversationDetailResponse(BaseModel):
    id: int
    title: str
    created_at: str
    updated_at: str
    messages: List[MessageResponse]


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
# Conversation endpoints
# -----------------------------

@app.post("/api/conversations")
def create_conversation(payload: ConversationCreateRequest):
    title = payload.title.strip()

    if not title:
        title = "New chat"

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with SessionLocal() as session:
        result = session.execute(
            text(
                """
                INSERT INTO conversations (title, created_at, updated_at)
                VALUES (:title, :created_at, :updated_at)
                """
            ),
            {
                "title": title,
                "created_at": now,
                "updated_at": now,
            },
        )

        session.commit()
        conversation_id = result.lastrowid

    return {
        "id": conversation_id,
        "title": title,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }


@app.get("/api/conversations")
def list_conversations():
    with SessionLocal() as session:
        rows = session.execute(
            text(
                """
                SELECT id, title, created_at, updated_at
                FROM conversations
                ORDER BY updated_at DESC
                """
            )
        ).mappings().all()

    return {
        "conversations": [
            {
                "id": row["id"],
                "title": row["title"],
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
            }
            for row in rows
        ]
    }


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: int):
    with SessionLocal() as session:
        conversation = session.execute(
            text(
                """
                SELECT id, title, created_at, updated_at
                FROM conversations
                WHERE id = :conversation_id
                """
            ),
            {"conversation_id": conversation_id},
        ).mappings().first()

        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        messages = session.execute(
            text(
                """
                SELECT id, role, content, created_at
                FROM messages
                WHERE conversation_id = :conversation_id
                ORDER BY created_at ASC, id ASC
                """
            ),
            {"conversation_id": conversation_id},
        ).mappings().all()

        message_items = []

        for message in messages:
            source_rows = session.execute(
                text(
                    """
                    SELECT title, page, snippet
                    FROM message_sources
                    WHERE message_id = :message_id
                    ORDER BY id ASC
                    """
                ),
                {"message_id": message["id"]},
            ).mappings().all()

            selected_version = None

            if message["role"] == "assistant":
                selected_version = session.execute(
                    text(
                        """
                        SELECT id, version_number, run_id, is_selected
                        FROM message_versions
                        WHERE message_id = :message_id AND is_selected = TRUE
                        ORDER BY version_number DESC
                        LIMIT 1
                        """
                    ),
                    {"message_id": message["id"]},
                ).mappings().first()

            item = {
                "id": message["id"],
                "role": message["role"],
                "content": message["content"],
                "created_at": message["created_at"].isoformat(),
                "sources": [
                    {
                        "title": source["title"],
                        "page": source["page"],
                        "snippet": source["snippet"],
                    }
                    for source in source_rows
                ],
            }

            if selected_version:
                item["version_id"] = selected_version["id"]
                item["version_number"] = selected_version["version_number"]
                item["run_id"] = selected_version["run_id"]

            message_items.append(item)

    return {
        "id": conversation["id"],
        "title": conversation["title"],
        "created_at": conversation["created_at"].isoformat(),
        "updated_at": conversation["updated_at"].isoformat(),
        "messages": message_items,
    }


@app.patch("/api/conversations/{conversation_id}")
def rename_conversation(conversation_id: int, payload: ConversationRenameRequest):
    title = payload.title.strip()

    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with SessionLocal() as session:
        conversation = session.execute(
            text(
                """
                SELECT id
                FROM conversations
                WHERE id = :conversation_id
                """
            ),
            {"conversation_id": conversation_id},
        ).mappings().first()

        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        session.execute(
            text(
                """
                UPDATE conversations
                SET title = :title, updated_at = :updated_at
                WHERE id = :conversation_id
                """
            ),
            {
                "title": title,
                "updated_at": now,
                "conversation_id": conversation_id,
            },
        )

        session.commit()

    return {
        "status": "success",
        "conversation_id": conversation_id,
        "title": title,
        "updated_at": now.isoformat(),
    }


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: int):
    with SessionLocal() as session:
        conversation = session.execute(
            text(
                """
                SELECT id
                FROM conversations
                WHERE id = :conversation_id
                """
            ),
            {"conversation_id": conversation_id},
        ).mappings().first()

        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        session.execute(
            text(
                """
                DELETE FROM conversations
                WHERE id = :conversation_id
                """
            ),
            {"conversation_id": conversation_id},
        )

        session.commit()

    return {
        "status": "success",
        "message": "Conversation deleted successfully",
        "conversation_id": conversation_id,
    }


@app.post("/api/conversations/{conversation_id}/messages")
def save_message(conversation_id: int, payload: MessageCreateRequest):
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with SessionLocal() as session:
        conversation = session.execute(
            text(
                """
                SELECT id
                FROM conversations
                WHERE id = :conversation_id
                """
            ),
            {"conversation_id": conversation_id},
        ).mappings().first()

        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        result = session.execute(
            text(
                """
                INSERT INTO messages (conversation_id, role, content, created_at)
                VALUES (:conversation_id, :role, :content, :created_at)
                """
            ),
            {
                "conversation_id": conversation_id,
                "role": payload.role,
                "content": payload.content,
                "created_at": now,
            },
        )

        message_id = result.lastrowid

        for source in payload.sources:
            session.execute(
                text(
                    """
                    INSERT INTO message_sources (message_id, title, page, snippet)
                    VALUES (:message_id, :title, :page, :snippet)
                    """
                ),
                {
                    "message_id": message_id,
                    "title": source.title,
                    "page": source.page,
                    "snippet": source.snippet,
                },
            )

        session.execute(
            text(
                """
                UPDATE conversations
                SET updated_at = :updated_at
                WHERE id = :conversation_id
                """
            ),
            {
                "updated_at": now,
                "conversation_id": conversation_id,
            },
        )

        session.commit()

    return {
        "id": message_id,
        "conversation_id": conversation_id,
        "role": payload.role,
        "content": payload.content,
        "sources": payload.sources,
        "created_at": now.isoformat(),
    }


# -----------------------------
# Chat persistence helpers
# -----------------------------

def create_conversation_from_question(question: str) -> int:
    title = question.strip()[:60]

    if not title:
        title = "New chat"

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with SessionLocal() as session:
        result = session.execute(
            text(
                """
                INSERT INTO conversations (title, created_at, updated_at)
                VALUES (:title, :created_at, :updated_at)
                """
            ),
            {
                "title": title,
                "created_at": now,
                "updated_at": now,
            },
        )

        session.commit()
        return result.lastrowid


def save_chat_message(
    conversation_id: int,
    role: str,
    content: str,
    sources: Optional[list[dict]] = None,
) -> int:
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with SessionLocal() as session:
        result = session.execute(
            text(
                """
                INSERT INTO messages (conversation_id, role, content, created_at)
                VALUES (:conversation_id, :role, :content, :created_at)
                """
            ),
            {
                "conversation_id": conversation_id,
                "role": role,
                "content": content,
                "created_at": now,
            },
        )

        message_id = result.lastrowid

        if sources:
            for source in sources:
                session.execute(
                    text(
                        """
                        INSERT INTO message_sources (message_id, title, page, snippet)
                        VALUES (:message_id, :title, :page, :snippet)
                        """
                    ),
                    {
                        "message_id": message_id,
                        "title": source.get("title", "Unknown source"),
                        "page": source.get("page"),
                        "snippet": source.get("snippet", ""),
                    },
                )

        session.execute(
            text(
                """
                UPDATE conversations
                SET updated_at = :updated_at
                WHERE id = :conversation_id
                """
            ),
            {
                "updated_at": now,
                "conversation_id": conversation_id,
            },
        )

        session.commit()
        return message_id


def replace_message_content_and_sources(
    message_id: int,
    content: str,
    sources: Optional[list[dict]] = None,
) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with SessionLocal() as session:
        message = session.execute(
            text(
                """
                SELECT id, conversation_id
                FROM messages
                WHERE id = :message_id
                """
            ),
            {"message_id": message_id},
        ).mappings().first()

        if message is None:
            raise HTTPException(status_code=404, detail="Message not found")

        session.execute(
            text(
                """
                UPDATE messages
                SET content = :content
                WHERE id = :message_id
                """
            ),
            {
                "content": content,
                "message_id": message_id,
            },
        )

        session.execute(
            text(
                """
                DELETE FROM message_sources
                WHERE message_id = :message_id
                """
            ),
            {"message_id": message_id},
        )

        if sources:
            for source in sources:
                session.execute(
                    text(
                        """
                        INSERT INTO message_sources (message_id, title, page, snippet)
                        VALUES (:message_id, :title, :page, :snippet)
                        """
                    ),
                    {
                        "message_id": message_id,
                        "title": source.get("title", "Unknown source"),
                        "page": source.get("page"),
                        "snippet": source.get("snippet", ""),
                    },
                )

        session.execute(
            text(
                """
                UPDATE conversations
                SET updated_at = :updated_at
                WHERE id = :conversation_id
                """
            ),
            {
                "updated_at": now,
                "conversation_id": message["conversation_id"],
            },
        )

        session.commit()


def save_message_version(
    message_id: int,
    content: str,
    sources: Optional[list[dict]] = None,
    run_id: Optional[str] = None,
    is_selected: bool = True,
) -> int:
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with SessionLocal() as session:
        latest_version = session.execute(
            text(
                """
                SELECT COALESCE(MAX(version_number), 0) AS latest_version
                FROM message_versions
                WHERE message_id = :message_id
                """
            ),
            {"message_id": message_id},
        ).mappings().first()

        next_version_number = latest_version["latest_version"] + 1

        if is_selected:
            session.execute(
                text(
                    """
                    UPDATE message_versions
                    SET is_selected = FALSE
                    WHERE message_id = :message_id
                    """
                ),
                {"message_id": message_id},
            )

        result = session.execute(
            text(
                """
                INSERT INTO message_versions (
                    message_id,
                    version_number,
                    content,
                    run_id,
                    is_selected,
                    created_at
                )
                VALUES (
                    :message_id,
                    :version_number,
                    :content,
                    :run_id,
                    :is_selected,
                    :created_at
                )
                """
            ),
            {
                "message_id": message_id,
                "version_number": next_version_number,
                "content": content,
                "run_id": run_id,
                "is_selected": is_selected,
                "created_at": now,
            },
        )

        version_id = result.lastrowid

        if sources:
            for source in sources:
                session.execute(
                    text(
                        """
                        INSERT INTO message_version_sources (
                            version_id,
                            title,
                            page,
                            snippet
                        )
                        VALUES (
                            :version_id,
                            :title,
                            :page,
                            :snippet
                        )
                        """
                    ),
                    {
                        "version_id": version_id,
                        "title": source.get("title", "Unknown source"),
                        "page": source.get("page"),
                        "snippet": source.get("snippet", ""),
                    },
                )

        session.commit()
        return version_id


def get_message_versions(message_id: int) -> list[dict]:
    with SessionLocal() as session:
        version_rows = session.execute(
            text(
                """
                SELECT id, message_id, version_number, content, run_id, is_selected, created_at
                FROM message_versions
                WHERE message_id = :message_id
                ORDER BY version_number ASC
                """
            ),
            {"message_id": message_id},
        ).mappings().all()

        versions = []

        for version in version_rows:
            source_rows = session.execute(
                text(
                    """
                    SELECT title, page, snippet
                    FROM message_version_sources
                    WHERE version_id = :version_id
                    ORDER BY id ASC
                    """
                ),
                {"version_id": version["id"]},
            ).mappings().all()

            versions.append(
                {
                    "id": version["id"],
                    "message_id": version["message_id"],
                    "version_number": version["version_number"],
                    "content": version["content"],
                    "run_id": version["run_id"],
                    "is_selected": bool(version["is_selected"]),
                    "created_at": version["created_at"].isoformat(),
                    "sources": [
                        {
                            "title": source["title"],
                            "page": source["page"],
                            "snippet": source["snippet"],
                        }
                        for source in source_rows
                    ],
                }
            )

        return versions


def get_previous_user_question_for_assistant(message_id: int) -> dict:
    with SessionLocal() as session:
        assistant_message = session.execute(
            text(
                """
                SELECT id, conversation_id, role, created_at
                FROM messages
                WHERE id = :message_id
                """
            ),
            {"message_id": message_id},
        ).mappings().first()

        if assistant_message is None:
            raise HTTPException(status_code=404, detail="Message not found")

        if assistant_message["role"] != "assistant":
            raise HTTPException(
                status_code=400,
                detail="Only assistant messages can be regenerated",
            )

        user_message = session.execute(
            text(
                """
                SELECT id, content
                FROM messages
                WHERE conversation_id = :conversation_id
                  AND role = 'user'
                  AND id < :assistant_message_id
                ORDER BY id DESC
                LIMIT 1
                """
            ),
            {
                "conversation_id": assistant_message["conversation_id"],
                "assistant_message_id": message_id,
            },
        ).mappings().first()

        if user_message is None:
            raise HTTPException(
                status_code=400,
                detail="Could not find the original user question for this answer",
            )

        return {
            "conversation_id": assistant_message["conversation_id"],
            "question": user_message["content"],
        }


# -----------------------------
# RAG logic
# -----------------------------

def retrieve_relevant_chunks(
    question: str,
    retrieval_limit: int = 10,
    top_k: int = 4,
) -> list[dict]:
    client = weaviate.connect_to_local()

    try:
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

    finally:
        client.close()


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
- Cite sources using [1], [2], [3], etc. inside the answer.
- The citation [1] corresponds to Source 1, [2] corresponds to Source 2, and so on.

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


# -----------------------------
# Chat endpoints
# -----------------------------

@app.post("/api/chat")
def chat(request: ChatRequest):
    question = request.question.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    conversation_id = request.conversation_id

    if conversation_id is None:
        conversation_id = create_conversation_from_question(question)

    save_chat_message(
        conversation_id=conversation_id,
        role="user",
        content=question,
    )

    result = generate_rag_answer(question)

    assistant_message_id = save_chat_message(
        conversation_id=conversation_id,
        role="assistant",
        content=result["answer"],
        sources=result["sources"],
    )

    version_id = save_message_version(
        message_id=assistant_message_id,
        content=result["answer"],
        sources=result["sources"],
        run_id=None,
        is_selected=True,
    )

    return {
        "answer": result["answer"],
        "sources": result["sources"],
        "run_id": None,
        "conversation_id": conversation_id,
        "message_id": assistant_message_id,
        "version_id": version_id,
        "version_number": 1,
    }


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    question = request.question.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    conversation_id = request.conversation_id

    if conversation_id is None:
        conversation_id = create_conversation_from_question(question)

    save_chat_message(
        conversation_id=conversation_id,
        role="user",
        content=question,
    )

    result = generate_rag_answer(question)
    answer = result["answer"]
    sources = result["sources"]

    assistant_message_id = save_chat_message(
        conversation_id=conversation_id,
        role="assistant",
        content=answer,
        sources=sources,
    )

    version_id = save_message_version(
        message_id=assistant_message_id,
        content=answer,
        sources=sources,
        run_id=None,
        is_selected=True,
    )

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
            "conversation_id": conversation_id,
            "message_id": assistant_message_id,
            "version_id": version_id,
            "version_number": 1,
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


@app.post("/api/messages/{message_id}/regenerate")
def regenerate_message(message_id: int):
    original = get_previous_user_question_for_assistant(message_id)
    question = original["question"]
    conversation_id = original["conversation_id"]

    result = generate_rag_answer(question)

    version_id = save_message_version(
        message_id=message_id,
        content=result["answer"],
        sources=result["sources"],
        run_id=None,
        is_selected=True,
    )

    replace_message_content_and_sources(
        message_id=message_id,
        content=result["answer"],
        sources=result["sources"],
    )

    versions = get_message_versions(message_id)
    current_version = next(
        version for version in versions if version["id"] == version_id
    )

    return {
        "status": "success",
        "conversation_id": conversation_id,
        "message_id": message_id,
        "version": current_version,
        "answer": result["answer"],
        "sources": result["sources"],
        "run_id": None,
        "version_id": version_id,
        "version_number": current_version["version_number"],
    }


@app.get("/api/messages/{message_id}/versions")
def list_message_versions(message_id: int):
    with SessionLocal() as session:
        message = session.execute(
            text(
                """
                SELECT id
                FROM messages
                WHERE id = :message_id
                """
            ),
            {"message_id": message_id},
        ).mappings().first()

        if message is None:
            raise HTTPException(status_code=404, detail="Message not found")

    versions = get_message_versions(message_id)

    return {
        "message_id": message_id,
        "count": len(versions),
        "versions": versions,
    }


# -----------------------------
# Feedback logic
# -----------------------------

def save_feedback_locally(feedback_record: dict) -> None:
    with LOCAL_FEEDBACK_FILE.open("a", encoding="utf-8") as file:
        file.write(json.dumps(feedback_record, ensure_ascii=False) + "\n")


def save_feedback_to_database(payload: FeedbackRequest, score: int, timestamp: datetime) -> None:
    with SessionLocal() as session:
        session.execute(
            text(
                """
                INSERT INTO feedback_entries (
                    conversation_id,
                    message_id,
                    version_id,
                    question,
                    answer,
                    feedback,
                    score,
                    reason,
                    comment,
                    run_id,
                    created_at
                )
                VALUES (
                    :conversation_id,
                    :message_id,
                    :version_id,
                    :question,
                    :answer,
                    :feedback,
                    :score,
                    :reason,
                    :comment,
                    :run_id,
                    :created_at
                )
                """
            ),
            {
                "conversation_id": payload.conversation_id,
                "message_id": payload.message_id,
                "version_id": payload.version_id,
                "question": payload.question,
                "answer": payload.answer,
                "feedback": payload.feedback,
                "score": score,
                "reason": payload.reason,
                "comment": payload.comment,
                "run_id": str(payload.run_id) if payload.run_id else None,
                "created_at": timestamp,
            },
        )

        session.commit()


@app.post("/api/feedback", response_model=FeedbackResponse)
def collect_feedback(payload: FeedbackRequest):
    if payload.feedback == "thumbs_down" and not payload.reason:
        raise HTTPException(
            status_code=400,
            detail="A reason is required for negative feedback.",
        )

    score = 1 if payload.feedback == "thumbs_up" else 0
    feedback_key = "user_feedback"
    timestamp_dt = datetime.now(timezone.utc).replace(tzinfo=None)
    timestamp = timestamp_dt.isoformat()

    feedback_record = {
        "timestamp": timestamp,
        "question": payload.question,
        "answer": payload.answer,
        "feedback": payload.feedback,
        "score": score,
        "reason": payload.reason,
        "comment": payload.comment,
        "conversation_id": payload.conversation_id,
        "message_id": payload.message_id,
        "version_id": payload.version_id,
        "run_id": str(payload.run_id) if payload.run_id else None,
    }

    save_feedback_locally(feedback_record)
    save_feedback_to_database(payload, score, timestamp_dt)

    if payload.run_id is None:
        return FeedbackResponse(
            status="success",
            message="Feedback saved to MySQL and locally. No LangSmith run_id was provided.",
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
            comment=payload.comment or payload.reason or "",
        )

        return FeedbackResponse(
            status="success",
            message="Feedback recorded in LangSmith, MySQL, and local file.",
            feedback_key=feedback_key,
            score=score,
            logged_to_langsmith=True,
            saved_locally=True,
            timestamp=timestamp,
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Feedback was saved to MySQL and locally, but failed to log to LangSmith: {str(error)}",
        )


@app.get("/api/feedback")
def get_feedback_logs():
    with SessionLocal() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    id,
                    conversation_id,
                    message_id,
                    version_id,
                    question,
                    answer,
                    feedback,
                    score,
                    reason,
                    comment,
                    run_id,
                    created_at
                FROM feedback_entries
                ORDER BY created_at DESC, id DESC
                """
            )
        ).mappings().all()

    feedback_items = [
        {
            "id": row["id"],
            "conversation_id": row["conversation_id"],
            "message_id": row["message_id"],
            "version_id": row["version_id"],
            "question": row["question"],
            "answer": row["answer"],
            "feedback": row["feedback"],
            "score": row["score"],
            "reason": row["reason"],
            "comment": row["comment"],
            "run_id": row["run_id"],
            "timestamp": row["created_at"].isoformat(),
        }
        for row in rows
    ]

    return {
        "status": "success",
        "count": len(feedback_items),
        "feedback": feedback_items,
    }


@app.get("/api/feedback/summary")
def get_feedback_summary():
    with SessionLocal() as session:
        row = session.execute(
            text(
                """
                SELECT
                    COUNT(*) AS total_feedback,
                    SUM(CASE WHEN feedback = 'thumbs_up' THEN 1 ELSE 0 END) AS thumbs_up,
                    SUM(CASE WHEN feedback = 'thumbs_down' THEN 1 ELSE 0 END) AS thumbs_down
                FROM feedback_entries
                """
            )
        ).mappings().first()

    total_feedback = int(row["total_feedback"] or 0)
    thumbs_up = int(row["thumbs_up"] or 0)
    thumbs_down = int(row["thumbs_down"] or 0)

    return {
        "status": "success",
        "total_feedback": total_feedback,
        "thumbs_up": thumbs_up,
        "thumbs_down": thumbs_down,
    }