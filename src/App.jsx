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
  Download,
  Columns3,
} from 'lucide-react'

import ReactMarkdown from 'react-markdown'

const FEEDBACK_API_URL = 'http://127.0.0.1:8000/api/feedback'
const FEEDBACK_SUMMARY_API_URL = 'http://127.0.0.1:8000/api/feedback/summary'
const CHAT_STREAM_API_URL = 'http://127.0.0.1:8000/api/chat/stream'
const CONVERSATIONS_API_URL = 'http://127.0.0.1:8000/api/conversations'
const MESSAGES_API_URL = 'http://127.0.0.1:8000/api/messages'

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
  backend_id: null,
  message_id: null,
  version_id: null,
  version_number: null,
}

const negativeFeedbackReasons = [
  'Incorrect answer',
  'Missing important context',
  'Weak or irrelevant sources',
  'Unclear explanation',
  'Other',
]

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
  const [showClearAllModal, setShowClearAllModal] = useState(false)
  const [isClearingHistory, setIsClearingHistory] = useState(false)

  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false)
  const [feedbackSummary, setFeedbackSummary] = useState(null)
  const [feedbackLogs, setFeedbackLogs] = useState([])
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false)

  const [feedbackTarget, setFeedbackTarget] = useState(null)
  const [feedbackReason, setFeedbackReason] = useState('')
  const [feedbackComment, setFeedbackComment] = useState('')

  const [versionCache, setVersionCache] = useState({})
  const [loadingVersionsFor, setLoadingVersionsFor] = useState(null)

  const [comparisonTarget, setComparisonTarget] = useState(null)
  const [comparisonVersions, setComparisonVersions] = useState([])
  const [isComparisonLoading, setIsComparisonLoading] = useState(false)
  const [openComparisonSources, setOpenComparisonSources] = useState({})

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

  function getBackendMessageId(message) {
    return message.backend_id || message.message_id || message.messageId || null
  }

  function getMessageVersionId(message) {
    return message.version_id || message.versionId || null
  }

  function getMessageVersionNumber(message) {
    return message.version_number || message.versionNumber || null
  }

  function normalizeCitationMarkdown(content) {
    if (!content) return ''

    return content.replace(/\[(\d+)\]/g, (match, number) => {
      return `[${match}](citation:${number})`
    })
  }

  function openCitationSource(messageId, sourceIndex) {
    setOpenSourcePanels((prev) => ({
      ...prev,
      [messageId]: true,
    }))

    setOpenSources((prev) => ({
      ...prev,
      [`${messageId}-${sourceIndex}`]: true,
    }))
  }

  function toggleComparisonSources(versionKey) {
    setOpenComparisonSources((prev) => ({
      ...prev,
      [versionKey]: !prev[versionKey],
    }))
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
          backend_id: message.id,
          message_id: message.id,
          role: message.role,
          content: message.content,
          sources: message.sources || [],
          feedbackStatus: null,
          run_id: message.run_id || null,
          version_id: message.version_id || null,
          version_number: message.version_number || null,
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
    if (isLoading || isClearingHistory) return
    setDeleteTarget(conversation)
  }

  async function confirmDeleteConversation() {
    if (!deleteTarget || isLoading || isClearingHistory) return

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

  async function confirmClearAllHistory() {
    if (isLoading || isClearingHistory || conversations.length === 0) return

    setIsClearingHistory(true)
    setErrorMessage('')

    try {
      const deleteRequests = conversations.map((conversation) =>
        fetch(`${CONVERSATIONS_API_URL}/${conversation.id}`, {
          method: 'DELETE',
        }),
      )

      const responses = await Promise.all(deleteRequests)
      const failedDelete = responses.some((response) => !response.ok)

      if (failedDelete) {
        throw new Error('One or more conversations could not be deleted')
      }

      setActiveConversationId(null)
      setMessages([welcomeMessage])
      setOpenSources({})
      setOpenSourcePanels({})
      setVersionCache({})
      setShowClearAllModal(false)
      saveTitleOverrides({})
      await loadConversations()
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not clear all chat history.')
    } finally {
      setIsClearingHistory(false)
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

  function exportConversationAsMarkdown() {
    const title =
      activeConversationTitle ||
      (activeConversationId ? `Conversation ${activeConversationId}` : 'New Chat')

    const createdAt = new Date().toLocaleString()

    const markdownLines = [
      `# ${title}`,
      '',
      `Exported at: ${createdAt}`,
      '',
      '---',
      '',
    ]

    messages
      .filter((message) => message.content && message.content.trim())
      .forEach((message) => {
        const speaker = message.role === 'user' ? 'User' : 'Assistant'

        markdownLines.push(`## ${speaker}`)
        markdownLines.push('')
        markdownLines.push(message.content.trim())
        markdownLines.push('')

        if (message.role === 'assistant') {
          const versionNumber = getMessageVersionNumber(message)

          if (versionNumber) {
            markdownLines.push(`**Version:** ${versionNumber}`)
            markdownLines.push('')
          }

          if (message.sources && message.sources.length > 0) {
            markdownLines.push('### Sources')
            markdownLines.push('')

            message.sources.forEach((source, index) => {
              markdownLines.push(
                `${index + 1}. ${source.title || 'Unknown source'}${
                  source.page ? ` — Page ${source.page}` : ''
                }`,
              )

              if (source.snippet) {
                markdownLines.push(`   - ${source.snippet}`)
              }
            })

            markdownLines.push('')
          }
        }

        markdownLines.push('---')
        markdownLines.push('')
      })

    const blob = new Blob([markdownLines.join('\n')], {
      type: 'text/markdown;charset=utf-8',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    const safeTitle = title
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .toLowerCase()

    link.href = url
    link.download = `${safeTitle || 'rag_conversation'}.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function exportConversationAsPdf() {
    const title =
      activeConversationTitle ||
      (activeConversationId ? `Conversation ${activeConversationId}` : 'New Chat')

    const createdAt = new Date().toLocaleString()

    const escapeHtml = (value) => {
      return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
    }

    const conversationHtml = messages
      .filter((message) => message.content && message.content.trim())
      .map((message) => {
        const speaker = message.role === 'user' ? 'User' : 'Assistant'
        const versionNumber = getMessageVersionNumber(message)

        const sourcesHtml =
          message.role === 'assistant' && message.sources && message.sources.length > 0
            ? `
              <div class="sources">
                <h3>Sources</h3>
                ${message.sources
                  .map(
                    (source, index) => `
                      <div class="source">
                        <strong>[${index + 1}] ${escapeHtml(source.title || 'Unknown source')}</strong>
                        ${source.page ? `<span> · Page ${escapeHtml(source.page)}</span>` : ''}
                        <p>${escapeHtml(source.snippet || 'No snippet available.')}</p>
                      </div>
                    `,
                  )
                  .join('')}
              </div>
            `
            : ''

        return `
          <section class="message ${message.role}">
            <h2>${speaker}</h2>
            ${
              versionNumber
                ? `<p class="version">Version: v${escapeHtml(versionNumber)}</p>`
                : ''
            }
            <div class="content">${escapeHtml(message.content).replaceAll('\n', '<br />')}</div>
            ${sourcesHtml}
          </section>
        `
      })
      .join('')

    const printWindow = window.open('', '_blank')

    if (!printWindow) {
      setErrorMessage('Could not open the PDF export window. Please allow pop-ups for this site.')
      return
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #111827;
              margin: 40px;
              line-height: 1.6;
            }

            h1 {
              margin-bottom: 4px;
              color: #064e3b;
            }

            .meta {
              color: #6b7280;
              font-size: 13px;
              margin-bottom: 24px;
            }

            .message {
              border: 1px solid #e5e7eb;
              border-radius: 12px;
              padding: 16px;
              margin-bottom: 18px;
              page-break-inside: avoid;
            }

            .message.user {
              background: #ecfdf5;
            }

            .message.assistant {
              background: #f8fafc;
            }

            h2 {
              font-size: 16px;
              margin: 0 0 8px;
              color: #065f46;
            }

            .version {
              font-size: 12px;
              color: #6b7280;
              margin-top: -4px;
            }

            .content {
              white-space: normal;
              font-size: 14px;
            }

            .sources {
              margin-top: 14px;
              border-top: 1px solid #e5e7eb;
              padding-top: 10px;
            }

            .sources h3 {
              font-size: 14px;
              margin: 0 0 8px;
              color: #374151;
            }

            .source {
              font-size: 12px;
              color: #4b5563;
              margin-bottom: 8px;
            }

            .source p {
              margin: 4px 0 0;
            }

            @media print {
              body {
                margin: 24px;
              }

              button {
                display: none;
              }
            }
          </style>
        </head>

        <body>
          <h1>${escapeHtml(title)}</h1>
          <p class="meta">Exported at: ${escapeHtml(createdAt)}</p>
          ${conversationHtml}
          <script>
            window.onload = function () {
              window.print()
            }
          </script>
        </body>
      </html>
    `)

    printWindow.document.close()
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
        backend_id: null,
        message_id: null,
        role: 'user',
        content: currentQuestion,
        sources: [],
      })
    }

    newMessages.push({
      id: assistantMessageId,
      backend_id: null,
      message_id: null,
      role: 'assistant',
      content: '',
      sources: [],
      run_id: null,
      question: currentQuestion,
      feedbackStatus: null,
      isRegenerated: !appendUserMessage,
      version_id: null,
      version_number: null,
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
                      backend_id: data.message_id || null,
                      message_id: data.message_id || null,
                      version_id: data.version_id || null,
                      version_number: data.version_number || null,
                      conversation_id: data.conversation_id || null,
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
        'Could not stream the answer from the backend. Make sure FastAPI, Weaviate, MySQL, and Ollama are running.',
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

  async function regenerateAnswer(message) {
    if (isLoading) return

    const backendMessageId = getBackendMessageId(message)

    if (!backendMessageId) {
      setErrorMessage('Could not regenerate this answer because its backend message ID was not found.')
      return
    }

    setIsLoading(true)
    setLoadingStage('Regenerating answer...')
    setErrorMessage('')

    try {
      const response = await fetch(`${MESSAGES_API_URL}/${backendMessageId}/regenerate`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to regenerate answer')
      }

      const data = await response.json()
      const version = data.version || {}

      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) =>
          currentMessage.id === message.id
            ? {
                ...currentMessage,
                content: data.answer || version.content || currentMessage.content,
                sources: data.sources || version.sources || [],
                run_id: data.run_id || version.run_id || null,
                version_id: data.version_id || version.id || null,
                version_number: data.version_number || version.version_number || null,
                feedbackStatus: null,
              }
            : currentMessage,
        ),
      )

      setVersionCache((prev) => {
        const existingVersions = prev[backendMessageId] || []
        const nextVersion = data.version

        if (!nextVersion) return prev

        const filteredVersions = existingVersions.filter(
          (item) => item.id !== nextVersion.id,
        )

        return {
          ...prev,
          [backendMessageId]: [...filteredVersions, nextVersion].sort(
            (a, b) => a.version_number - b.version_number,
          ),
        }
      })

      await loadConversations()
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not regenerate this answer.')
    } finally {
      setIsLoading(false)
      setLoadingStage('')
    }
  }

  async function loadVersions(message) {
    const backendMessageId = getBackendMessageId(message)

    if (!backendMessageId) {
      setErrorMessage('Could not load versions because the backend message ID was not found.')
      return
    }

    setLoadingVersionsFor(message.id)
    setErrorMessage('')

    try {
      const response = await fetch(`${MESSAGES_API_URL}/${backendMessageId}/versions`)

      if (!response.ok) {
        throw new Error('Failed to load versions')
      }

      const data = await response.json()

      setVersionCache((prev) => ({
        ...prev,
        [backendMessageId]: data.versions || [],
      }))
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not load answer versions.')
    } finally {
      setLoadingVersionsFor(null)
    }
  }

  function selectVersion(message, version) {
    setMessages((currentMessages) =>
      currentMessages.map((currentMessage) =>
        currentMessage.id === message.id
          ? {
              ...currentMessage,
              content: version.content || currentMessage.content,
              sources: version.sources || [],
              run_id: version.run_id || null,
              version_id: version.id,
              version_number: version.version_number,
              feedbackStatus: null,
            }
          : currentMessage,
      ),
    )
  }

  async function generateComparison(message) {
    if (isLoading || isComparisonLoading) return

    const backendMessageId = getBackendMessageId(message)

    if (!backendMessageId) {
      setErrorMessage('Could not compare this answer because its backend message ID was not found.')
      return
    }

    setErrorMessage('')
    setComparisonTarget(message)
    setComparisonVersions([])
    setOpenComparisonSources({})
    setIsComparisonLoading(true)

    try {
      const firstResponse = await fetch(`${MESSAGES_API_URL}/${backendMessageId}/regenerate`, {
        method: 'POST',
      })

      if (!firstResponse.ok) {
        throw new Error('Failed to generate first comparison answer')
      }

      const firstData = await firstResponse.json()

      const secondResponse = await fetch(`${MESSAGES_API_URL}/${backendMessageId}/regenerate`, {
        method: 'POST',
      })

      if (!secondResponse.ok) {
        throw new Error('Failed to generate second comparison answer')
      }

      const secondData = await secondResponse.json()

      const firstVersion = firstData.version || {
        id: firstData.version_id,
        content: firstData.answer,
        sources: firstData.sources || [],
        version_number: firstData.version_number,
      }

      const secondVersion = secondData.version || {
        id: secondData.version_id,
        content: secondData.answer,
        sources: secondData.sources || [],
        version_number: secondData.version_number,
      }

      setComparisonVersions([firstVersion, secondVersion])

      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) =>
          currentMessage.id === message.id
            ? {
                ...currentMessage,
                content: secondVersion.content || secondData.answer,
                sources: secondVersion.sources || secondData.sources || [],
                version_id: secondVersion.id || secondData.version_id,
                version_number: secondVersion.version_number || secondData.version_number,
                feedbackStatus: null,
              }
            : currentMessage,
        ),
      )

      setVersionCache((prev) => {
        const existingVersions = prev[backendMessageId] || []
        const nextVersions = [firstVersion, secondVersion].filter(Boolean)

        const merged = [...existingVersions]

        nextVersions.forEach((version) => {
          const existingIndex = merged.findIndex((item) => item.id === version.id)

          if (existingIndex >= 0) {
            merged[existingIndex] = version
          } else {
            merged.push(version)
          }
        })

        return {
          ...prev,
          [backendMessageId]: merged.sort(
            (a, b) => a.version_number - b.version_number,
          ),
        }
      })

      await loadConversations()
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not generate comparison answers.')
    } finally {
      setIsComparisonLoading(false)
    }
  }

  function closeComparisonModal() {
    setComparisonTarget(null)
    setComparisonVersions([])
    setOpenComparisonSources({})
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

  async function sendFeedback(message, feedbackType, options = {}) {
    setErrorMessage('')

    const backendMessageId = getBackendMessageId(message)
    const versionId = getMessageVersionId(message)

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
          reason: options.reason || null,
          comment:
            options.comment ||
            (feedbackType === 'thumbs_up'
              ? 'User marked the answer as helpful.'
              : 'User marked the answer as needing work.'),
          conversation_id: activeConversationId,
          message_id: backendMessageId,
          version_id: versionId,
          run_id: message.run_id || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || 'Feedback request failed')
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

      if (showFeedbackPanel) {
        loadFeedbackData()
      }
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error.message ||
          'Could not send feedback. Make sure the FastAPI backend is running.',
      )
    }
  }

  function openNegativeFeedbackModal(message) {
    setFeedbackTarget(message)
    setFeedbackReason('')
    setFeedbackComment('')
  }

  function closeNegativeFeedbackModal() {
    setFeedbackTarget(null)
    setFeedbackReason('')
    setFeedbackComment('')
  }

  async function submitNegativeFeedback() {
    if (!feedbackTarget) return

    if (!feedbackReason) {
      setErrorMessage('Please select a reason before submitting negative feedback.')
      return
    }

    await sendFeedback(feedbackTarget, 'thumbs_down', {
      reason: feedbackReason,
      comment: feedbackComment || `Reason: ${feedbackReason}`,
    })

    closeNegativeFeedbackModal()
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
      <style>
        {`
          * {
            scrollbar-width: thin;
            scrollbar-color: #334155 #020617;
          }

          *::-webkit-scrollbar {
            width: 10px;
            height: 10px;
          }

          *::-webkit-scrollbar-track {
            background: #020617;
            border-radius: 999px;
          }

          *::-webkit-scrollbar-thumb {
            background: #334155;
            border-radius: 999px;
            border: 2px solid #020617;
          }

          *::-webkit-scrollbar-thumb:hover {
            background: #475569;
          }
        `}
      </style>

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

      {showClearAllModal && (
        <div className="fixed inset-0 z-[121] flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-red-500/10 p-3 text-red-300">
                <AlertTriangle size={24} />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-white">Clear all chat history?</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  This will delete all saved conversations, messages, sources, and version history from the database.
                </p>

                <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {conversations.length} conversation(s) will be deleted.
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowClearAllModal(false)}
                disabled={isClearingHistory}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmClearAllHistory}
                disabled={isClearingHistory}
                className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isClearingHistory && <Loader2 size={16} className="animate-spin" />}
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}

      {feedbackTarget && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-red-300">
                  Negative Feedback
                </p>
                <h2 className="mt-1 text-2xl font-bold text-white">
                  Why does this answer need work?
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  A reason is required before saving negative feedback.
                </p>
              </div>

              <button
                type="button"
                onClick={closeNegativeFeedbackModal}
                className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              {negativeFeedbackReasons.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setFeedbackReason(reason)}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                    feedbackReason === reason
                      ? 'border-red-400 bg-red-400/10 text-red-200'
                      : 'border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            <textarea
              value={feedbackComment}
              onChange={(event) => setFeedbackComment(event.target.value)}
              className="mt-4 min-h-24 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400"
              placeholder="Optional comment..."
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeNegativeFeedbackModal}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={submitNegativeFeedback}
                disabled={!feedbackReason}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit feedback
              </button>
            </div>
          </div>
        </div>
      )}

      {comparisonTarget && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/80 px-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-emerald-400">
                  Response Comparison Mode
                </p>
                <h2 className="mt-1 text-2xl font-bold text-white">
                  Compare two regenerated answers
                </h2>
              </div>

              <button
                type="button"
                onClick={closeComparisonModal}
                className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-6">
              {isComparisonLoading ? (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-4 text-slate-300">
                  <Loader2 className="animate-spin" size={18} />
                  Generating two regenerated answers for comparison...
                </div>
              ) : comparisonVersions.length < 2 ? (
                <p className="text-sm text-slate-400">
                  No comparison versions generated yet.
                </p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {comparisonVersions.map((version, index) => {
                    const versionKey = version.id || `comparison-${index}`
                    const isSourcesOpen = openComparisonSources[versionKey]

                    return (
                      <div
                        key={versionKey}
                        className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h3 className="font-semibold text-white">
                            Option {index + 1}
                          </h3>

                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                            v{version.version_number || version.versionNumber || '?'}
                          </span>
                        </div>

                        <div className="text-sm leading-relaxed text-slate-200">
                          <ReactMarkdown>{version.content || ''}</ReactMarkdown>
                        </div>

                        {version.sources && version.sources.length > 0 && (
                          <div className="mt-4">
                            <button
                              type="button"
                              onClick={() => toggleComparisonSources(versionKey)}
                              className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
                            >
                              <FileText size={15} />
                              Sources ({version.sources.length})
                              {isSourcesOpen ? (
                                <ChevronDown size={15} />
                              ) : (
                                <ChevronRight size={15} />
                              )}
                            </button>

                            {isSourcesOpen && (
                              <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-3">
                                <div className="space-y-2">
                                  {version.sources.map((source, sourceIndex) => (
                                    <div
                                      key={`${versionKey}-${sourceIndex}`}
                                      className="rounded-lg border border-white/10 bg-slate-950/50 p-2 text-xs text-slate-400"
                                    >
                                      <p className="font-medium text-slate-200">
                                        [{sourceIndex + 1}] {source.title || 'Unknown source'}
                                        {source.page ? ` · Page ${source.page}` : ''}
                                      </p>

                                      <p className="mt-1 line-clamp-3">
                                        {source.snippet || 'No snippet available.'}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
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
                        {feedbackLogs.slice(0, 8).map((item, index) => (
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

                            {item.reason && (
                              <p className="mt-2 text-xs text-red-300">
                                Reason: {item.reason}
                              </p>
                            )}
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

            <button
              type="button"
              onClick={exportConversationAsMarkdown}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 font-semibold text-slate-200 hover:bg-white/10"
            >
              <Download size={18} />
              Export Markdown
            </button>

            <button
              type="button"
              onClick={exportConversationAsPdf}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 font-semibold text-slate-200 hover:bg-white/10"
            >
              <FileText size={18} />
              Export PDF
            </button>

            <button
              type="button"
              onClick={() => setShowClearAllModal(true)}
              disabled={isLoading || isClearingHistory || conversations.length === 0}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 font-semibold text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={18} />
              Clear All History
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

              <div className="hidden items-center gap-2 md:flex">
                <button
                  type="button"
                  onClick={exportConversationAsMarkdown}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                >
                  <Download size={16} />
                  Export MD
                </button>

                <button
                  type="button"
                  onClick={exportConversationAsPdf}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                >
                  <FileText size={16} />
                  Export PDF
                </button>

                <button
                  type="button"
                  onClick={openFeedbackPanel}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                >
                  <BarChart3 size={16} />
                  Feedback
                </button>
              </div>
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
                const backendMessageId = getBackendMessageId(message)
                const versions = backendMessageId ? versionCache[backendMessageId] || [] : []
                const currentVersionNumber = getMessageVersionNumber(message)

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

                      {!isUser && currentVersionNumber && (
                        <p className="mt-1 text-xs text-slate-400">
                          Current version: v{currentVersionNumber}
                        </p>
                      )}

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
                              a: ({ href, children }) => {
                                if (href && href.startsWith('citation:')) {
                                  const citationNumber = Number(
                                    href.replace('citation:', ''),
                                  )
                                  const sourceIndex = citationNumber - 1
                                  const source = message.sources?.[sourceIndex]

                                  return (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openCitationSource(message.id, sourceIndex)
                                      }
                                      className="group relative mx-0.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-xs font-bold text-emerald-300 hover:bg-emerald-400/20"
                                    >
                                      {children}

                                      {source && (
                                        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-72 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-950 p-3 text-left text-xs font-normal text-slate-300 shadow-2xl group-hover:block">
                                          <span className="mb-1 block font-semibold text-white">
                                            {source.title || 'Source'}
                                            {source.page ? ` · Page ${source.page}` : ''}
                                          </span>
                                          <span className="line-clamp-5">
                                            {source.snippet || 'No snippet available.'}
                                          </span>
                                        </span>
                                      )}
                                    </button>
                                  )
                                }

                                return (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-emerald-300 underline"
                                  >
                                    {children}
                                  </a>
                                )
                              },
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
                            {normalizeCitationMarkdown(message.content)}
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
                                          [{index + 1}] {source.title}
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
                        <div className="mt-4">
                          <div
                            className={`flex flex-wrap items-center gap-2 ${getTourHighlightClass(
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
                              onClick={() => openNegativeFeedbackModal(message)}
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

                            <button
                              onClick={() => generateComparison(message)}
                              disabled={isLoading || isComparisonLoading || !message.content}
                              className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Columns3 size={15} />
                              Compare
                            </button>

                            {backendMessageId && (
                              <button
                                onClick={() => loadVersions(message)}
                                disabled={loadingVersionsFor === message.id}
                                className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {loadingVersionsFor === message.id ? (
                                  <Loader2 size={15} className="animate-spin" />
                                ) : (
                                  <ChevronDown size={15} />
                                )}
                                Load versions
                              </button>
                            )}

                            {message.feedbackStatus && (
                              <span className="ml-2 text-xs text-slate-400">
                                Feedback saved
                              </span>
                            )}
                          </div>

                          {versions.length > 0 && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 p-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Versions
                              </span>

                              {versions.map((version) => {
                                const isCurrent =
                                  currentVersionNumber === version.version_number

                                return (
                                  <button
                                    key={version.id}
                                    type="button"
                                    onClick={() => selectVersion(message, version)}
                                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                                      isCurrent
                                        ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200'
                                        : 'border-white/10 text-slate-300 hover:bg-white/10'
                                    }`}
                                  >
                                    v{version.version_number}
                                  </button>
                                )
                              })}
                            </div>
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