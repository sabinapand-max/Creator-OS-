import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/pilot/db/client.ts'
import { requireUser } from '@/lib/pilot/web/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUFFER_API_URL = 'https://api.buffer.com'

/**
 * Publishing is OFF unless the operator explicitly turns it on in the server
 * environment. This route really can create a Buffer post, and the pilot rule is
 * that nothing gets published while it is being tested, so the default has to be
 * a refusal rather than a working call.
 */
function publishingEnabled(): boolean {
  return (process.env.PILOT_PUBLISHING_ENABLED || '').trim().toLowerCase() === 'true'
}

// GraphQL query to get user's channels
const GET_CHANNELS_QUERY = `
  query GetChannels {
    channels {
      id
      name
      service
      avatar
    }
  }
`

// GraphQL mutation to create a scheduled post
const CREATE_POST_MUTATION = `
  mutation CreatePost($text: String!, $channelId: ID!, $dueAt: DateTime, $mode: PostSharingMode!) {
    createPost(input: {
      text: $text,
      channelId: $channelId,
      schedulingType: automatic,
      mode: $mode,
      dueAt: $dueAt
    }) {
      ... on PostActionSuccess {
        post {
          id
          text
          dueAt
          status
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`

async function bufferGraphQL(query: string, variables: Record<string, unknown> = {}, apiKey: string) {
  const response = await fetch(BUFFER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Buffer API error: ${response.status} - ${errorText}`)
  }

  return response.json()
}

export async function POST(request: NextRequest) {
  if (!publishingEnabled()) {
    return NextResponse.json(
      {
        code: 'publishing_disabled',
        error:
          'Publishing is disabled during this pilot: nothing is scheduled or posted. To turn it on, set PILOT_PUBLISHING_ENABLED=true and BUFFER_API_KEY in the server environment. Never in the browser.',
      },
      { status: 403 }
    )
  }

  // Same rule as every other pilot route: identity comes from the session
  // cookie, never from the request body.
  const auth = await requireUser(getDb())
  if (!auth.ok) {
    return NextResponse.json({ code: 'unauthenticated', error: auth.error }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { action, apiKey: browserKey, text, channelId, scheduledAt } = body

    if (browserKey) {
      return NextResponse.json(
        {
          code: 'client_key_rejected',
          error:
            'A Buffer API key must not be sent from the browser. It belongs in BUFFER_API_KEY on the server.',
        },
        { status: 400 }
      )
    }

    const apiKey = process.env.BUFFER_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { code: 'publishing_not_configured', error: 'BUFFER_API_KEY is not set on the server.' },
        { status: 503 }
      )
    }

    switch (action) {
      case 'getChannels': {
        const result = await bufferGraphQL(GET_CHANNELS_QUERY, {}, apiKey)
        
        if (result.errors) {
          return NextResponse.json({ error: result.errors[0].message }, { status: 400 })
        }
        
        return NextResponse.json({ 
          channels: result.data?.channels || [],
          success: true 
        })
      }

      case 'schedulePost': {
        if (!text || !channelId) {
          return NextResponse.json({ error: 'Text and channelId are required' }, { status: 400 })
        }

        // Determine if we should schedule for a specific time or add to queue
        const mode = scheduledAt ? 'customScheduled' : 'addToQueue'
        const variables: Record<string, unknown> = {
          text,
          channelId,
          mode,
        }
        
        if (scheduledAt) {
          variables.dueAt = scheduledAt
        }

        const result = await bufferGraphQL(CREATE_POST_MUTATION, variables, apiKey)
        
        if (result.errors) {
          return NextResponse.json({ error: result.errors[0].message }, { status: 400 })
        }

        const postResult = result.data?.createPost
        if (postResult?.message) {
          // MutationError
          return NextResponse.json({ error: postResult.message }, { status: 400 })
        }

        return NextResponse.json({ 
          post: postResult?.post,
          success: true 
        })
      }

      case 'testConnection': {
        // Simple test - try to get channels
        const result = await bufferGraphQL(GET_CHANNELS_QUERY, {}, apiKey)
        
        if (result.errors) {
          return NextResponse.json({ 
            connected: false, 
            error: result.errors[0].message 
          }, { status: 400 })
        }
        
        return NextResponse.json({ 
          connected: true,
          channels: result.data?.channels || []
        })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[Buffer API Error]:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
