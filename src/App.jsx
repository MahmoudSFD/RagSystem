import { useEffect, useRef, useState } from 'react'
import {
  Send,
  ThumbsUp,
  ThumbsDown,
  FileText,
  ChevronDown,
  ChevronRight,
  Plus,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from 'lucide-react'

import ReactMarkdown from 'react-markdown'

const FEEDBACK_API_URL = 'http://127.0.0.1:8000/api/feedback'
const CHAT_STREAM_API_URL = 'http://127.0.0.1:8000/api/chat/stream'
const CONVERSATIONS_API_URL = 'http://127.0.0.1:8000/api/conversations'

const welcomeMessage = {
  id: 1,
  role: 'assistant',
  content:
    'Hello! I can help answer questions using the knowledge base and show the sources used for each response.',
  sources: [],
  feedbackStatus: null,
}

function App() {
  const [messages, setMessages] = useState([welcomeMessage])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [openSources, setOpenSources] = useState({})
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  const [showTour, setShowTour] = useState(() => {
    return localStorage.getItem('ragTourCompleted') !== 'true'
  })
  const [tourStep, setTourStep] = useState(0)

  const messagesEndRef = useRef(null)

  const tourSteps = [
    {
      key: 'new-chat',
      title: 'Start a new chat',
      text: 'Click New Chat when you want to begin a fresh conversation.',
    },
    {
      key: 'history',
      title: 'Open previous conversations',
      text: 'Saved chats appear here. Click any chat to reload its messages from the database.',
    },
    {
      key: 'chat-area',
      title: 'Read streamed answers',
      text: 'The assistant streams answers here and keeps the conversation saved.',
    },
    {
      key: 'sources-feedback',
      title: 'Check sources and give feedback',
      text: 'Answers can include document sources. You can also mark answers as Helpful or Needs work.',
    },
    {
      key: 'input',
      title: 'Ask your question',
      text: 'Type your question here and press Send. The backend will save the chat automatically.',
    },
  ]

  function getTourHighlightClass(key) {
    if (!showTour) return ''

    return tourSteps[tourStep].key === key
      ? 'relative z-30 ring-2 ring-emerald-400 ring-offset-4 ring-offset-slate-950'
      : ''
  }

  function getTourCardPositionClass() {
    const currentKey = tourSteps[tourStep].key

    if (currentKey === 'new-chat' || currentKey === 'history') {
      return 'right-6 top-6'
    }

    return 'left-6 top-6'
  }

  async function loadConversations() {
    try {
      const response = await fetch(CONVERSATIONS_API_URL)

      if (!response.ok) {
        throw new Error('Failed to load conversations')
      }

      const data = await response.json()
      setConversations(data.conversations || [])
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not load chat history from the backend.')
    }
  }

  async function loadConversation(conversationId) {
    if (isLoading) return

    try {
      setErrorMessage('')

      const response = await fetch(`${CONVERSATIONS_API_URL}/${conversationId}`)

      if (!response.ok) {
        throw new Error('Failed to load conversation')
      }

      const data = await response.json()

      const loadedMessages = data.messages.map((message) => ({
        id: `${data.id}-${message.id}`,
        role: message.role,
        content: message.content,
        sources: message.sources || [],
        feedbackStatus: null,
        run_id: null,
        question: message.role === 'assistant' ? 'Loaded from history' : null,
      }))

      setActiveConversationId(data.id)
      setMessages(loadedMessages.length > 0 ? loadedMessages : [welcomeMessage])
      setOpenSources({})
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not load this conversation.')
    }
  }

  async function deleteConversation(conversationId) {
    if (isLoading) return

    const confirmed = window.confirm('Delete this chat? This cannot be undone.')

    if (!confirmed) return

    try {
      setErrorMessage('')

      const response = await fetch(`${CONVERSATIONS_API_URL}/${conversationId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete conversation')
      }

      if (conversationId === activeConversationId) {
        setActiveConversationId(null)
        setMessages([welcomeMessage])
        setOpenSources({})
      }

      await loadConversations()
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not delete this conversation.')
    }
  }

  function startNewChat() {
    if (isLoading) return

    setActiveConversationId(null)
    setMessages([welcomeMessage])
    setInput('')
    setErrorMessage('')
    setOpenSources({})
  }

  useEffect(() => {
    loadConversations()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

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
          conversation_id: activeConversationId,
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

            if (data.conversation_id) {
              setActiveConversationId(data.conversation_id)
              loadConversations()
            }
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

  function handleNextTourStep() {
    if (tourStep < tourSteps.length - 1) {
      setTourStep((currentStep) => currentStep + 1)
      return
    }

    localStorage.setItem('ragTourCompleted', 'true')
    setShowTour(false)
  }

  function handleSkipTour() {
    localStorage.setItem('ragTourCompleted', 'true')
    setShowTour(false)
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {showTour && (
        <>
          <div className="pointer-events-none fixed inset-0 z-20 bg-slate-950/70" />

          <div
            className={`fixed z-[100] w-full max-w-md rounded-2xl border border-emerald-400/40 bg-slate-900 p-6 shadow-2xl transition-all duration-300 ${getTourCardPositionClass()}`}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-400">
                Guided Tour
              </p>

              <button
                type="button"
                onClick={handleSkipTour}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                Skip
              </button>
            </div>

            <h2 className="text-2xl font-bold text-white">
              {tourSteps[tourStep].title}
            </h2>

            <p className="mt-3 leading-relaxed text-slate-300">
              {tourSteps[tourStep].text}
            </p>

            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-2">
                {tourSteps.map((step, index) => (
                  <span
                    key={step.key}
                    className={`h-2 w-2 rounded-full ${
                      index === tourStep ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={handleNextTourStep}
                className="rounded-xl bg-emerald-500 px-5 py-2 font-semibold text-slate-950 hover:bg-emerald-400"
              >
                {tourStep === tourSteps.length - 1 ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="flex h-full w-full overflow-hidden px-4 py-6">
        <button
          type="button"
          onClick={() => setIsSidebarOpen((current) => !current)}
          className="mr-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {isSidebarOpen ? (
            <PanelLeftClose size={20} />
          ) : (
            <PanelLeftOpen size={20} />
          )}
        </button>

        {isSidebarOpen && (
          <aside className="mr-4 flex h-full w-80 shrink-0 flex-col overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-4 shadow-xl">
            <button
              type="button"
              onClick={startNewChat}
              disabled={isLoading}
              className={`flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 ${getTourHighlightClass(
                'new-chat',
              )}`}
            >
              <Plus size={18} />
              New Chat
            </button>

            <div className={`mt-5 rounded-xl ${getTourHighlightClass('history')}`}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Chat History
              </p>

              <div className="space-y-2">
                {conversations.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-3 text-sm text-slate-400">
                    No saved chats yet.
                  </p>
                ) : (
                  conversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId

                    return (
                      <div
                        key={conversation.id}
                        className={`flex items-start gap-2 rounded-xl border px-3 py-3 text-left text-sm transition ${
                          isActive
                            ? 'border-emerald-400 bg-emerald-400/10 text-emerald-100'
                            : 'border-white/10 bg-slate-900/60 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => loadConversation(conversation.id)}
                          disabled={isLoading}
                          className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <MessageSquare
                            size={16}
                            className={
                              isActive ? 'text-emerald-300' : 'text-slate-500'
                            }
                          />

                          <span className="line-clamp-2">
                            {conversation.title || 'Untitled chat'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteConversation(conversation.id)}
                          disabled={isLoading}
                          className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Delete chat"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </aside>
        )}

        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="mb-4 shrink-0 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 shadow-xl">
            <p className="text-sm font-medium text-emerald-400">
              Dar Technology Department
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              RAG Assistant
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Ask questions, review sourced answers, and provide feedback.
            </p>

            {activeConversationId && (
              <p className="mt-2 text-xs text-slate-500">
                Active conversation ID: {activeConversationId}
              </p>
            )}
          </header>

          {errorMessage && (
            <div className="mb-4 shrink-0 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {errorMessage}
            </div>
          )}

          <main
            className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl ${getTourHighlightClass(
              'chat-area',
            )}`}
          >
            <section className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
              {messages.map((message) => {
                const isUser = message.role === 'user'

                return (
                  <div
                    key={message.id}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-3xl rounded-2xl px-5 py-4 shadow ${
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
                                      <ChevronDown
                                        size={16}
                                        className="text-slate-400"
                                      />
                                    ) : (
                                      <ChevronRight
                                        size={16}
                                        className="text-slate-400"
                                      />
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
                        <div
                          className={`mt-4 flex items-center gap-2 ${getTourHighlightClass(
                            'sources-feedback',
                          )}`}
                        >
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

              <div ref={messagesEndRef} />
            </section>

            <footer
              className={`shrink-0 border-t border-white/10 p-4 ${getTourHighlightClass(
                'input',
              )}`}
            >
              <div className="flex gap-3">
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Ask a question about the document..."
                />

                <button
                  onClick={handleSendMessage}
                  disabled={isLoading || !input.trim()}
                  className="flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send size={18} />
                  Send
                </button>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  )
}

export default App