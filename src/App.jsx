import { useState } from 'react'
import {
  Send,
  ThumbsUp,
  ThumbsDown,
  FileText,
  ChevronDown,
  ChevronRight,
}  from 'lucide-react'

import ReactMarkdown from 'react-markdown'

const FEEDBACK_API_URL = 'http://127.0.0.1:8000/api/feedback'
const CHAT_STREAM_API_URL = 'http://127.0.0.1:8000/api/chat/stream'

const initialMessages = [
  {
    id: 1,
    role: 'assistant',
    content:
      'Hello! I can help answer questions using the knowledge base and show the sources used for each response.',
    sources: [],
    feedbackStatus: null,
  },
  {
    id: 2,
    role: 'user',
    content: 'What are the CIS Controls?',
    sources: [],
  },
  {
    id: 3,
    role: 'assistant',
    content:
      '**The CIS Controls** are a set of defensive actions led by the Center for Internet Security. They help organizations focus on important steps to defend against common real-world cyberattacks.',
    sources: [
      {
        title: 'CIS Controls v8 PDF',
        page: 11,
        snippet: 'Example source from the CIS Controls document.',
      },
    ],
    question: 'What are the CIS Controls?',
    feedbackStatus: null,
    run_id: null,
  },
]

function App() {
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [openSources, setOpenSources] = useState({})

  async function handleSendMessage() {
    if (!input.trim() || isLoading) return

    const currentInput = input
    const userMessageId = Date.now()
    const assistantMessageId = userMessageId + 1

    const userMessage = {
      id: userMessageId,
      role: 'user',
      content: currentInput,
      sources: [],
    }

    const assistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      sources: [],
      run_id: null,
      question: currentInput,
      feedbackStatus: null,
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setInput('')
    setIsLoading(true)
    setErrorMessage('')

    try {
      const response = await fetch(CHAT_STREAM_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: currentInput,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error('Failed to stream answer from backend')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          if (!event.startsWith('data: ')) continue

          const jsonString = event.replace('data: ', '')
          const data = JSON.parse(jsonString)

          if (data.type === 'token') {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: message.content + data.content,
                    }
                  : message,
              ),
            )
          }

          if (data.type === 'sources') {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      sources: data.sources || [],
                      run_id: data.run_id || null,
                    }
                  : message,
              ),
            )
          }

          if (data.type === 'done') {
            setIsLoading(false)
          }
        }
      }
    } catch (error) {
      console.error(error)
      setErrorMessage(
        'Could not stream the answer from the backend. Make sure FastAPI is running.',
      )

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content:
                  'Sorry, I could not connect to the backend streaming endpoint.',
              }
            : message,
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSendMessage()
    }
  }
function toggleSource(messageId, sourceIndex) {
  const key = `${messageId}-${sourceIndex}`

  setOpenSources((prev) => ({
    ...prev,
    [key]: !prev[key],
  }))
}
  async function sendFeedback(message, feedbackType) {
    setErrorMessage('')

    try {
      const response = await fetch(FEEDBACK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: message.question || 'Unknown question',
          answer: message.content,
          feedback: feedbackType,
          comment:
            feedbackType === 'thumbs_up'
              ? 'User marked the answer as helpful.'
              : 'User marked the answer as needing work.',
          run_id: message.run_id || null,
        }),
      })

      if (!response.ok) {
        throw new Error('Feedback request failed')
      }

      const data = await response.json()
      console.log('Feedback saved:', data)

      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) => {
          if (currentMessage.id === message.id) {
            return {
              ...currentMessage,
              feedbackStatus: feedbackType,
            }
          }

          return currentMessage
        }),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        'Could not send feedback. Make sure the FastAPI backend is running.',
      )
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6">
        <header className="mb-6 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 shadow-xl">
          <p className="text-sm font-medium text-emerald-400">
            Dar Technology Department
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            RAG Assistant
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Ask questions, review sourced answers, and provide feedback.
          </p>
        </header>

        {errorMessage && (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <main className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl">
          <section className="flex-1 space-y-4 overflow-y-auto p-6">
            {messages.map((message) => {
              const isUser = message.role === 'user'

              return (
                <div
                  key={message.id}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-2xl rounded-2xl px-5 py-4 shadow ${
                      isUser
                        ? 'rounded-tr-sm bg-emerald-500 text-slate-950'
                        : 'rounded-tl-sm bg-slate-800 text-slate-100'
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${
                        isUser ? 'text-slate-950' : 'text-emerald-400'
                      }`}
                    >
                      {isUser ? 'You' : 'Assistant'}
                    </p>

                    <div
                      className={`mt-2 leading-relaxed ${
                        isUser ? 'text-slate-950' : 'text-slate-100'
                      }`}
                    >
                      {isUser ? (
                        <p>{message.content}</p>
                      ) : message.content ? (
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => (
                              <p className="mb-2">{children}</p>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-bold text-white">
                                {children}
                              </strong>
                            ),
                            ul: ({ children }) => (
                              <ul className="mb-2 ml-5 list-disc space-y-1">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="mb-2 ml-5 list-decimal space-y-1">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => <li>{children}</li>,
                            code: ({ children }) => (
                              <code className="rounded bg-slate-950 px-1 py-0.5 text-sm text-emerald-300">
                                {children}
                              </code>
                            ),
                            pre: ({ children }) => (
                              <pre className="my-3 overflow-x-auto rounded-xl bg-slate-950 p-3 text-sm">
                                {children}
                              </pre>
                            ),
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        <p className="text-slate-400">Starting response...</p>
                      )}
                    </div>

                    {!isUser && message.sources && message.sources.length > 0 && (
  <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3">
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
      <FileText size={14} />
      Sources
    </p>

    <div className="mt-3 space-y-2">
      {message.sources.map((source, index) => {
        const sourceKey = `${message.id}-${index}`
        const isOpen = openSources[sourceKey]

        return (
          <div
            key={sourceKey}
            className="rounded-lg border border-white/10 bg-slate-950/50"
          >
            <button
              type="button"
              onClick={() => toggleSource(message.id, index)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
            >
              <span className="font-medium">
                {source.title}
                {source.page ? ` · Page ${source.page}` : ''}
              </span>

              {isOpen ? (
                <ChevronDown size={16} className="text-slate-400" />
              ) : (
                <ChevronRight size={16} className="text-slate-400" />
              )}
            </button>

            {isOpen && (
              <div className="border-t border-white/10 px-3 py-2 text-sm text-slate-400">
                <p>{source.snippet}</p>

                <div className="mt-2 text-xs text-slate-500">
                  <p>Document: {source.title}</p>
                  <p>Page: {source.page || 'Not available'}</p>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  </div>
)}
                    {!isUser && (
                      <div className="mt-4 flex items-center gap-2">
                        <button
                          onClick={() => sendFeedback(message, 'thumbs_up')}
                          disabled={isLoading && !message.content}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                            message.feedbackStatus === 'thumbs_up'
                              ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200'
                              : 'border-white/10 text-slate-300 hover:bg-white/10'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <ThumbsUp size={15} />
                          Helpful
                        </button>

                        <button
                          onClick={() => sendFeedback(message, 'thumbs_down')}
                          disabled={isLoading && !message.content}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                            message.feedbackStatus === 'thumbs_down'
                              ? 'border-red-400 bg-red-400/20 text-red-200'
                              : 'border-white/10 text-slate-300 hover:bg-white/10'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <ThumbsDown size={15} />
                          Needs work
                        </button>

                        {message.feedbackStatus && (
                          <span className="ml-2 text-xs text-slate-400">
                            Feedback saved
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {isLoading && (
              <p className="text-sm text-slate-400">Assistant is typing...</p>
            )}
          </section>

          <footer className="border-t border-white/10 p-4">
            <div className="flex gap-3">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Ask a question about the document..."
              />

              <button
                onClick={handleSendMessage}
                disabled={isLoading || !input.trim()}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send size={18} />
                Send
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}

export default App