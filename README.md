# RAG Assistant

A full-stack Retrieval-Augmented Generation assistant built during the Dar Technology Department internship sprint. The application allows users to ask questions over a document knowledge base and receive streamed, source-grounded AI answers with citations, feedback, version history, and persistent chat history.

## Features

- RAG-based question answering
- Streaming AI responses
- Inline clickable citations
- Source snippet hover previews
- Collapsible source metadata
- Chat history persistence
- Response regeneration
- Answer version history and version switching
- Thumbs up / thumbs down feedback
- Mandatory reason selection for negative feedback
- Feedback dashboard
- Markdown export
- PDF export
- Side-by-side response comparison mode
- Delete individual chats
- Clear all chat history
- Guided tour restart button
- Responsive dark UI

## Tech Stack

### Frontend
- React
- Vite
- Tailwind CSS
- React Markdown
- Lucide React icons

### Backend
- FastAPI
- Python
- Server-sent-style streaming responses

### AI / RAG
- Weaviate vector database
- Sentence Transformers embeddings
- Cross-encoder reranking
- Ollama with Qwen model

### Database
- MySQL
- PyMySQL / SQLAlchemy-style connection

## Architecture

The system follows this flow:

```text
User Question
→ React Frontend
→ FastAPI Backend
→ Sentence Transformer Embedding
→ Weaviate Vector Search
→ Cross-Encoder Reranking
→ Prompt Construction
→ Ollama / Qwen Generation
→ Streamed Answer
→ Citations and Sources
→ MySQL Persistence

Running Locally
1. Start MySQL
docker start rag_mysql
2. Start Weaviate
docker start gracious_lalande

Or, if needed:

cd C:\Projects\rag_setup
docker compose up -d
3. Start Ollama
ollama serve

If Ollama is already running, this may say the address is already in use, which is fine.

4. Start Backend
cd C:\Users\mahmo\RagSystem\backend
uv run uvicorn feedback_api:app --reload

Backend URL:

http://127.0.0.1:8000

Swagger:

http://127.0.0.1:8000/docs
5. Start Frontend
cd C:\Users\mahmo\RagSystem
npm run dev

Frontend URL:

http://localhost:5173
