import { useEffect, useMemo, useRef, useState } from 'react'
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
  BarChart3,
  RotateCcw,
  Pencil,
  X,
  Check,
  AlertTriangle,
  Loader2,
} from 'lucide-react'

import ReactMarkdown from 'react-markdown'

const FEEDBACK_API_URL = 'http://127.0.0.1:8000/api/feedback'
const FEEDBACK_SUMMARY_API_URL = 'http://127.0.0.1:8000/api/feedback/summary'
const CHAT_STREAM_API_URL = 'http://127.0.0.1:8000/api/chat/stream'
const CONVERSATIONS_API_URL = 'http://127.0.0.1:8000/api/conversations'

const TITLE_OVERRIDES_KEY = 'ragConversationTitleOverrides'

const welcomeMessage = {
  id: 1,
  role: 'assistant',
  content:
    'Hello! I can help answer questions using the knowledge base and show the sources used for each response.',
  sources: [],
  feedbackStatus: null,
  run_id: null,
  question: null,
}

function App() {
  const [messages, setMessages] = useState([welcomeMessage])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [openSources, setOpenSources] = useState({})
  const [openSourcePanels, setOpenSourcePanels] = useState({})
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  const [deleteTarget, setDeleteTarget] = useState(null)

  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false)
  const [feedbackSummary, setFeedbackSummary] = useState(null)
  const [feedbackLogs, setFeedbackLogs] = useState([])
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false)

  const [renamingConversationId, setRenamingConversationId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [titleOverrides, setTitleOverrides] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(TITLE_OVERRIDES_KEY) || '{}')
    } catch {
      return {}
    }
  })

  const [showTour, setShowTour] = useState(() => {
    return localStorage.getItem('ragTourCompleted') !== 'true'
  })
  const [tourStep, setTourStep] = useState(0)

  const messagesEndRef = useRef(null)

  const activeConversation = useMemo(() => {
    return conversations.find((conversation) => conversation.id === activeConversationId)
  }, [conversations, activeConversationId])

  const activeConversationTitle =
    activeConversationId && titleOverrides[activeConversationId]
      ? titleOverrides[activeConversationId]
      : activeConversation?.title

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

  function getConversationTitle(conversation) {
    return titleOverrides[conversation.id] || conversation.title || 'Untitled chat'
  }

  function saveTitleOverrides(nextOverrides) {
    setTitleOverrides(nextOverrides)
    localStorage.setItem(TITLE_OVERRIDES_KEY, JSON.stringify(nextOverrides))
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
    if (isLoading || renamingConversationId) return

    try {
      setErrorMessage('')

      const response = await fetch(`${CONVERSATIONS_API_URL}/${conversationId}`)

      if (!response.ok) {
        throw new Error('Failed to load conversation')
      }

      const data = await response.json()

      const loadedMessages = data.messages.map((message, index, allMessages) => {
        const previousUserMessage = [...allMessages]
          .slice(0, index)
          .reverse()
          .find((item) => item.role === 'user')

        return {
          id: `${data.id}-${message.id}`,
          role: message.role,
          content: message.content,
          sources: message.sources || [],
          feedbackStatus: null,
          run_id: message.run_id || null,
          question:
            message.role === 'assistant'
              ? previousUserMessage?.content || 'Loaded from history'
              : null,
        }
      })

      setActiveConversationId(data.id)
      setMessages(loadedMessages.length > 0 ? loadedMessages : [welcomeMessage])
      setOpenSources({})
      setOpenSourcePanels({})
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not load this conversation.')
    }
  }

  function requestDeleteConversation(conversation) {
    if (isLoading) return
    setDeleteTarget(conversation)
  }

  async function confirmDeleteConversation() {
    if (!deleteTarget || isLoading) return

    try {
      setErrorMessage('')

      const response = await fetch(`${CONVERSATIONS_API_URL}/${deleteTarget.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete conversation')
      }

      if (deleteTarget.id === activeConversationId) {
        setActiveConversationId(null)
        setMessages([welcomeMessage])
        setOpenSources({})
        setOpenSourcePanels({})
      }

      const nextOverrides = { ...titleOverrides }
      delete nextOverrides[deleteTarget.id]
      saveTitleOverrides(nextOverrides)

      setDeleteTarget(null)
      await loadConversations()
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not delete this conversation.')
    }
  }

  function startRename(conversation) {
    setRenamingConversationId(conversation.id)
    setRenameValue(getConversationTitle(conversation))
  }

  function cancelRename() {
    setRenamingConversationId(null)
    setRenameValue('')
  }

  function saveRename(conversationId) {
    const cleanedTitle = renameValue.trim()

    if (!cleanedTitle) {
      cancelRename()
      return
    }

    const nextOverrides = {
      ...titleOverrides,
      [conversationId]: cleanedTitle,
    }

    saveTitleOverrides(nextOverrides)
    setRenamingConversationId(null)
    setRenameValue('')
  }

  function startNewChat() {
    if (isLoading) return

    setActiveConversationId(null)
    setMessages([welcomeMessage])
    setInput('')
    setErrorMessage('')
    setOpenSources({})
    setOpenSourcePanels({})
  }

  async function loadFeedbackData() {
    setIsFeedbackLoading(true)
    setErrorMessage('')

    try {
      const [summaryResponse, logsResponse] = await Promise.all([
        fetch(FEEDBACK_SUMMARY_API_URL),
        fetch(FEEDBACK_API_URL),
      ])

      if (!summaryResponse.ok) {
        throw new Error('Failed to load feedback summary')
      }

      if (!logsResponse.ok) {
        throw new Error('Failed to load feedback logs')
      }

      const summaryData = await summaryResponse.json()
      const logsData = await logsResponse.json()

      setFeedbackSummary(summaryData)
      setFeedbackLogs(logsData.feedback || logsData.logs || logsData.items || logsData || [])
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not load feedback dashboard.')
    } finally {
      setIsFeedbackLoading(false)
    }
  }

  function openFeedbackPanel() {
    setShowFeedbackPanel(true)
    loadFeedbackData()
  }

  useEffect(() => {
    loadConversations()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading, loadingStage])

  async function streamQuestion(question, options = {}) {
    const { appendUserMessage = true } = options

    if (!question.trim() || isLoading) return

    const currentQuestion = question.trim()
    const userMessageId = Date.now()
    const assistantMessageId = userMessageId + 1

    const newMessages = []

    if (appendUserMessage) {
      newMessages.push({
        id: userMessageId,
        role: 'user',
        content: currentQuestion,
        sources: [],
      })
    }

    newMessages.push({
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      sources: [],
      run_id: null,
      question: currentQuestion,
      feedbackStatus: null,
      isRegenerated: !appendUserMessage,
    })

    setMessages((prev) => [...prev, ...newMessages])
    setInput('')
    setIsLoading(true)
    setLoadingStage('Retrieving relevant chunks...')
    setErrorMessage('')

    try {
      const response = await fetch(CHAT_STREAM_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: currentQuestion,
          conversation_id: activeConversationId,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error('Failed to stream answer from backend')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let hasStartedAnswer = false

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
            if (!hasStartedAnswer) {
              hasStartedAnswer = true
              setLoadingStage('Generating answer...')
            }

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
            setLoadingStage('Attaching sources...')

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
            setLoadingStage('')
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
      setLoadingStage('')
    }
  }

  async function handleSendMessage() {
    await streamQuestion(input, { appendUserMessage: true })
  }

  function regenerateAnswer(message) {
    if (isLoading) return

    const question = message.question

    if (!question || question === 'Loaded from history') {
      setErrorMessage('Could not regenerate this answer because the original question was not found.')
      return
    }

    streamQuestion(question, { appendUserMessage: true })
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSendMessage()
    }
  }

  function toggleSourcePanel(messageId) {
    setOpenSourcePanels((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }))
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

  function getFeedbackMetric(possibleKeys, fallback = 0) {
    if (!feedbackSummary || typeof feedbackSummary !== 'object') return fallback

    for (const key of possibleKeys) {
      if (feedbackSummary[key] !== undefined) {
        return feedbackSummary[key]
      }
    }

    return fallback
  }

  const totalFeedback =
    getFeedbackMetric(['total_feedback', 'total', 'count'], null) ??
    (Array.isArray(feedbackLogs) ? feedbackLogs.length : 0)

  const positiveFeedback = getFeedbackMetric(
    ['positive_feedback', 'thumbs_up', 'positive', 'helpful'],
    0,
  )

  const negativeFeedback = getFeedbackMetric(
    ['negative_feedback', 'thumbs_down', 'negative', 'needs_work'],
    0,
  )

  const positiveRate =
    totalFeedback > 0 ? Math.round((Number(positiveFeedback) / Number(totalFeedback)) * 100) : 0

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

      {deleteTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-red-500/10 p-3 text-red-300">
                <AlertTriangle size={24} />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-white">Delete conversation?</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  This will permanently delete the chat and its saved messages from the database.
                </p>

                <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                  {getConversationTitle(deleteTarget)}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmDeleteConversation}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showFeedbackPanel && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 px-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-emerald-400">
                  Feedback Dashboard
                </p>
                <h2 className="mt-1 text-2xl font-bold text-white">
                  Answer quality monitoring
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setShowFeedbackPanel(false)}
                className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-6">
              {isFeedbackLoading ? (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-4 text-slate-300">
                  <Loader2 className="animate-spin" size={18} />
                  Loading feedback data...
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Total
                      </p>
                      <p className="mt-2 text-3xl font-bold text-white">
                        {totalFeedback}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                      <p className="text-xs uppercase tracking-wide text-emerald-300">
                        Helpful
                      </p>
                      <p className="mt-2 text-3xl font-bold text-emerald-200">
                        {positiveFeedback}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4">
                      <p className="text-xs uppercase tracking-wide text-red-300">
                        Needs work
                      </p>
                      <p className="mt-2 text-3xl font-bold text-red-200">
                        {negativeFeedback}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Positive rate
                      </p>
                      <p className="mt-2 text-3xl font-bold text-white">
                        {positiveRate}%
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="font-semibold text-white">Recent feedback</h3>

                      <button
                        type="button"
                        onClick={loadFeedbackData}
                        className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
                      >
                        Refresh
                      </button>
                    </div>

                    {!Array.isArray(feedbackLogs) || feedbackLogs.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        No feedback entries found yet. Try pressing Helpful or Needs work on an answer.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {feedbackLogs.slice(-8).reverse().map((item, index) => (
                          <div
                            key={`${item.timestamp || item.created_at || index}`}
                            className="rounded-xl border border-white/10 bg-slate-900/80 p-3"
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <span
                                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                  item.feedback === 'thumbs_up' ||
                                  item.feedback === 'helpful'
                                    ? 'bg-emerald-400/10 text-emerald-300'
                                    : 'bg-red-400/10 text-red-300'
                                }`}
                              >
                                {item.feedback || item.score || 'feedback'}
                              </span>

                              <span className="text-xs text-slate-500">
                                {item.timestamp || item.created_at || ''}
                              </span>
                            </div>

                            <p className="line-clamp-2 text-sm text-slate-300">
                              {item.question || 'No question available'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
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

            <button
              type="button"
              onClick={openFeedbackPanel}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 font-semibold text-slate-200 hover:bg-white/10"
            >
              <BarChart3 size={18} />
              Feedback Dashboard
            </button>

            <div className={`mt-5 rounded-xl ${getTourHighlightClass('history')}`}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Chat History
              </p>

              <div className="space-y-2">
                {conversations.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-4 text-sm text-slate-400">
                    <p className="font-medium text-slate-300">No saved chats yet.</p>
                    <p className="mt-1 text-xs">
                      Ask your first question and the chat will appear here automatically.
                    </p>
                  </div>
                ) : (
                  conversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId
                    const isRenaming = renamingConversationId === conversation.id

                    return (
                      <div
                        key={conversation.id}
                        className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                          isActive
                            ? 'border-emerald-400 bg-emerald-400/10 text-emerald-100'
                            : 'border-white/10 bg-slate-900/60 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        {isRenaming ? (
                          <div className="space-y-2">
                            <input
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') saveRename(conversation.id)
                                if (event.key === 'Escape') cancelRename()
                              }}
                              autoFocus
                              className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                            />

                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={cancelRename}
                                className="rounded-lg border border-white/10 p-1 text-slate-400 hover:bg-white/10"
                              >
                                <X size={15} />
                              </button>

                              <button
                                type="button"
                                onClick={() => saveRename(conversation.id)}
                                className="rounded-lg bg-emerald-500 p-1 text-slate-950 hover:bg-emerald-400"
                              >
                                <Check size={15} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
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
                                {getConversationTitle(conversation)}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => startRename(conversation)}
                              disabled={isLoading}
                              className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Rename chat"
                            >
                              <Pencil size={14} />
                            </button>

                            <button
                              type="button"
                              onClick={() => requestDeleteConversation(conversation)}
                              disabled={isLoading}
                              className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Delete chat"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-emerald-400">
                  Dar Technology Department
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight">
                  RAG Assistant
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Ask questions, review sourced answers, and monitor answer quality.
                </p>

                {activeConversationId && (
                  <p className="mt-2 text-xs text-slate-500">
                    Active chat: {activeConversationTitle || `Conversation ${activeConversationId}`}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={openFeedbackPanel}
                className="hidden items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 md:flex"
              >
                <BarChart3 size={16} />
                Feedback
              </button>
            </div>
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
              {messages.length === 1 && messages[0].id === welcomeMessage.id && (
                <div className="mb-4 rounded-2xl border border-white/10 bg-slate-900/40 p-5">
                  <p className="text-sm font-semibold uppercase tracking-wide text-emerald-400">
                    Suggested questions
                  </p>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {[
                      'What are the CIS Controls?',
                      'Why are CIS Controls useful?',
                      'Summarize Control 01.',
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setInput(suggestion)}
                        className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-left text-sm text-slate-300 hover:border-emerald-400/40 hover:bg-emerald-400/10"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => {
                const isUser = message.role === 'user'
                const isSourcePanelOpen = openSourcePanels[message.id]

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
                          <div className="flex items-center gap-2 text-slate-400">
                            <Loader2 size={16} className="animate-spin" />
                            <span>{loadingStage || 'Starting response...'}</span>
                          </div>
                        )}
                      </div>

                      {!isUser && message.sources && message.sources.length > 0 && (
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => toggleSourcePanel(message.id)}
                            className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
                          >
                            <FileText size={15} />
                            Sources ({message.sources.length})
                            {isSourcePanelOpen ? (
                              <ChevronDown size={15} />
                            ) : (
                              <ChevronRight size={15} />
                            )}
                          </button>

                          {isSourcePanelOpen && (
                            <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-3">
                              <div className="space-y-2">
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
                                            <p>
                                              Page: {source.page || 'Not available'}
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {!isUser && (
                        <div
                          className={`mt-4 flex flex-wrap items-center gap-2 ${getTourHighlightClass(
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

                          <button
                            onClick={() => regenerateAnswer(message)}
                            disabled={isLoading || !message.content}
                            className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RotateCcw size={15} />
                            Regenerate
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

              {isLoading && loadingStage && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 size={16} className="animate-spin" />
                  {loadingStage}
                </div>
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