import type { UIMessage } from 'ai'
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, smoothStream, stepCountIs, streamText } from 'ai'
import { db, schema } from 'hub:db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createOpenAI } from '@ai-sdk/openai'

defineRouteMeta({
  openAPI: {
    description: 'Chat with AI.',
    tags: ['ai']
  }
})

function extractUserText(message?: UIMessage): string {
  if (!message || message.role !== 'user') {
    return ''
  }

  const text = (message.parts || [])
    .filter(part => part.type === 'text')
    .map(part => ('text' in part ? (part.text || '') : ''))
    .join(' ')
    .trim()

  return text
}

function createFallbackTitle(message?: UIMessage): string {
  const text = extractUserText(message)
  if (!text) {
    return 'New chat'
  }

  // Keep title concise and avoid noisy punctuation.
  return text.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 30) || 'New chat'
}

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const config = useRuntimeConfig(event)
  const hasYuanqiConfig = Boolean(config.yuanqiApiBase && config.yuanqiAppkey && config.yuanqiAssistantId)
  if (!hasYuanqiConfig) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Yuanqi is not configured. Please set YUANQI_API_BASE, YUANQI_APPKEY and YUANQI_ASSISTANT_ID.'
    })
  }

  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.string()
  }).parse)

  const { messages } = await readValidatedBody(event, z.object({
    messages: z.array(z.custom<UIMessage>())
  }).parse)

  const chat = await db.query.chats.findFirst({
    where: () => and(
      eq(schema.chats.id, id as string),
      eq(schema.chats.userId, session.user?.id || session.id)
    ),
    with: {
      messages: true
    }
  })
  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: 'Chat not found' })
  }

  if (!chat.title) {
    const title = createFallbackTitle(messages[0])

    await db.update(schema.chats).set({ title }).where(eq(schema.chats.id, id as string))
  }

  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role === 'user' && messages.length > 1) {
    await db.insert(schema.messages).values({
      id: lastMessage.id,
      chatId: id as string,
      role: 'user',
      parts: lastMessage.parts
    }).onConflictDoUpdate({ target: schema.messages.id, set: { parts: lastMessage.parts } })
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const systemPrompt = `You are a knowledgeable and helpful AI assistant. ${session.user?.username ? `The user's name is ${session.user.username}.` : ''} Your goal is to provide clear, accurate, and well-structured responses.

**FORMATTING RULES (CRITICAL):**
- ABSOLUTELY NO MARKDOWN HEADINGS: Never use #, ##, ###, ####, #####, or ######
- NO underline-style headings with === or ---
- Use **bold text** for emphasis and section labels instead
- Examples:
  * Instead of "## Usage", write "**Usage:**" or just "Here's how to use it:"
  * Instead of "# Complete Guide", write "**Complete Guide**" or start directly with content
- Start all responses with content, never with a heading

**WEB SEARCH:**
- You have access to a web search tool to find current, up-to-date information
- Only use it when the user explicitly asks about recent events, real-time data, or current facts
- Do NOT search proactively — rely on your knowledge first
- Cite your sources when providing information from web search results

**RESPONSE QUALITY:**
- Be concise yet comprehensive
- Use examples when helpful
- Break down complex topics into digestible parts
- Maintain a friendly, professional tone`
      const modelMessages = await convertToModelMessages(messages)

      const yuanqi = createOpenAI({
          apiKey: config.yuanqiAppkey,
          baseURL: `${config.yuanqiApiBase}/agent`,
          fetch: async (input, init) => {
            const body = JSON.parse(String(init?.body || '{}')) as {
              stream?: boolean
              messages?: Array<{ role: string, content: unknown }>
            }
            const toParts = (content: unknown) => {
              if (Array.isArray(content)) {
                return content
              }

              return [{
                type: 'text',
                text: typeof content === 'string' ? content : JSON.stringify(content)
              }]
            }

            // Yuanqi requires user/assistant turns and first role must be user.
            const normalized = (body.messages || [])
              .filter(message => message.role === 'user' || message.role === 'assistant')
              .map(message => ({
                role: message.role as 'user' | 'assistant',
                content: toParts(message.content)
              }))

            while (normalized.length && normalized[0]!.role !== 'user') {
              normalized.shift()
            }

            const mergedMessages = normalized.reduce<Array<{ role: 'user' | 'assistant', content: unknown[] }>>((acc, current) => {
              const prev = acc[acc.length - 1]
              if (prev && prev.role === current.role) {
                prev.content.push(...current.content)
              } else {
                acc.push({
                  role: current.role,
                  content: [...current.content]
                })
              }
              return acc
            }, [])

            if (mergedMessages.length === 0) {
              throw createError({
                statusCode: 400,
                statusMessage: 'Invalid messages for Yuanqi API after normalization.'
              })
            }

            const mappedMessages = mergedMessages

            if (systemPrompt.trim()) {
              mappedMessages[0]!.content.unshift({
                type: 'text',
                text: `System instruction:\n${systemPrompt}`
              })
            }

            const yuanqiBody = {
              assistant_id: config.yuanqiAssistantId,
              user_id: session.user?.id || session.id,
              stream: body.stream ?? true,
              messages: mappedMessages
            }

            return fetch(input, {
              ...init,
              body: JSON.stringify(yuanqiBody)
            })
          }
        })

      const result = streamText({
        model: yuanqi.chat('yuanqi-agent'),
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: stepCountIs(5),
        experimental_transform: smoothStream()
      })

      if (!chat.title) {
        writer.write({
          type: 'data-chat-title',
          data: { message: 'Generating title...' },
          transient: true
        })
      }

      writer.merge(result.toUIMessageStream({
        sendSources: true,
        sendReasoning: true
      }))
    },
    onFinish: async ({ messages }) => {
      await db.insert(schema.messages).values(messages.map(message => ({
        id: message.id,
        chatId: chat.id,
        role: message.role as 'user' | 'assistant',
        parts: message.parts
      }))).onConflictDoNothing()
    }
  })

  return createUIMessageStreamResponse({
    stream
  })
})
