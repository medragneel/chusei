import { config } from 'dotenv'
config()

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import Handlebars from 'handlebars'
import fs from 'fs'
import path from 'path'

const app = new Hono()

app.use('/public/*', serveStatic({ root: './' }));

// Notion API configuration
const NOTION_API_KEY = process.env.NOTION_API_KEY
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID

console.log('🔧 Environment check:')
console.log('NOTION_API_KEY:', NOTION_API_KEY ? '✓ Loaded' : '✗ Not loaded')
console.log('NOTION_DATABASE_ID:', NOTION_DATABASE_ID ? '✓ Loaded' : '✗ Not loaded')

// Load and compile Handlebars templates
const templatesDir = path.join(process.cwd(), 'templates')

const templates = {
  home: Handlebars.compile(fs.readFileSync(path.join(templatesDir, 'home.hbs'), 'utf8')),
  card: Handlebars.compile(fs.readFileSync(path.join(templatesDir, 'card.hbs'), 'utf8')),
  cardsList: Handlebars.compile(fs.readFileSync(path.join(templatesDir, 'cards-list.hbs'), 'utf8')),
  notFound: Handlebars.compile(fs.readFileSync(path.join(templatesDir, 'not-found.hbs'), 'utf8')),
  error: Handlebars.compile(fs.readFileSync(path.join(templatesDir, 'error.hbs'), 'utf8'))
}

// Register Handlebars helpers
Handlebars.registerHelper('formatDate', function(date) {
  return new Date(date).toLocaleDateString()
})

Handlebars.registerHelper('eq', function(a, b) {
  return a === b
})

// Environment check
const isDevelopment = process.env.NODE_ENV !== 'production'

// Home page
app.get('/', (c) => {
  return c.html(templates.home({ isDevelopment }))
})

// Parse Notion page
function parseNotionPage(page: any) {
  const props = page.properties
  console.log('🔍 Parsing properties...')

  const customerName = props.Customer?.title?.[0]?.plain_text || 'Valued Customer'
  const loyaltyCode = props['Loyalty ID']?.formula?.string || 'N/A'
  const points = props.Points?.number || 0
  const tier = props.Tier?.select?.name || 'Bronze'
  const memberSince = props.Created?.created_time || new Date().toISOString()
  const isActive = props.Active?.checkbox || false

  console.log('✅ Parsed:', { customerName, loyaltyCode, points, tier })

  return {
    customerId: loyaltyCode,
    customerName,
    loyaltyCode,
    points,
    tier,
    memberSince,
    isActive
  }
}

// Fetch by loyalty code
async function fetchLoyaltyCardByCode(loyaltyCode: string) {
  try {
    console.log('🔍 Searching for loyalty code:', loyaltyCode)

    const response = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100 })
      }
    )

    const data = await response.json()
    console.log(`📦 Fetched ${data.results?.length || 0} records`)

    if (!data.results || data.results.length === 0) {
      return null
    }

    for (const page of data.results) {
      const code = page.properties['Loyalty ID']?.formula?.string
      if (code === loyaltyCode) {
        console.log('✅ Found match!')
        return parseNotionPage(page)
      }
    }

    console.log('❌ No match found')
    return null
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Fetch by customer name
async function fetchLoyaltyCardByName(customerName: string) {
  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            property: 'Customer',
            title: { equals: customerName }
          }
        })
      }
    )

    const data = await response.json()

    if (data.results && data.results.length > 0) {
      return parseNotionPage(data.results[0])
    }

    return null
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// API endpoint - get by loyalty code
app.get('/api/loyalty-card/:loyaltyCode', async (c) => {
  try {
    const loyaltyCode = c.req.param('loyaltyCode')
    const cardData = await fetchLoyaltyCardByCode(loyaltyCode)

    if (!cardData) {
      return c.json({ error: 'Loyalty card not found' }, 404)
    }

    return c.json({ success: true, data: cardData })
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch loyalty card', details: error.message }, 500)
  }
})

// API endpoint - get by customer name
app.get('/api/customer/:customerName', async (c) => {
  try {
    const customerName = c.req.param('customerName')
    const cardData = await fetchLoyaltyCardByName(customerName)

    if (!cardData) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    return c.json({ success: true, data: cardData })
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch customer', details: error.message }, 500)
  }
})

// HTML endpoint - display card
app.get('/card/:loyaltyCode', async (c) => {
  try {
    const loyaltyCode = c.req.param('loyaltyCode')
    const cardData = await fetchLoyaltyCardByCode(loyaltyCode)

    if (!cardData) {
      return c.html(templates.notFound({ loyaltyCode }))
    }

    return c.html(templates.card(cardData))
  } catch (error: any) {
    return c.html(templates.error({ message: error.message }))
  }
})

// List all cards (protect in production or remove)
app.get('/cards', async (c) => {
  // Optional: Add authentication check here in production
  if (!isDevelopment) {
    return c.json({ error: 'Not available in production' }, 403)
  }

  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        }
      }
    )

    const data = await response.json()

    const cards = data.results?.map((page: any) => {
      const props = page.properties
      const loyaltyCode = props['Loyalty ID']?.formula?.string || 'N/A'

      return {
        customer: props.Customer?.title?.[0]?.plain_text || 'N/A',
        loyaltyCode: loyaltyCode,
        points: props.Points?.number || 0,
        tier: props.Tier?.select?.name || 'None',
        active: props.Active?.checkbox || false,
        url: `/card/${loyaltyCode}`
      }
    }) || []

    return c.html(templates.cardsList({ cards, count: cards.length }))
  } catch (error: any) {
    return c.html(templates.error({ message: error.message }))
  }
})

// Development-only routes
if (isDevelopment) {
  // Test endpoint
  app.get('/test', (c) => {
    return c.json({
      status: 'OK',
      message: 'Server is working',
      env: {
        hasNotionKey: !!NOTION_API_KEY,
        hasNotionDB: !!NOTION_DATABASE_ID
      }
    })
  })

  // Debug endpoint
  app.get('/debug-raw', async (c) => {
    try {
      const response = await fetch(
        `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          }
        }
      )

      const data = await response.json()

      const debug = data.results?.map((page: any) => ({
        pageId: page.id,
        customer: page.properties.Customer?.title?.[0]?.plain_text,
        loyaltyIdFromFormula: page.properties['Loyalty ID']?.formula?.string,
        createdTime: page.properties.Created?.created_time,
        rawCreatedProperty: page.properties.Created,
        rawLoyaltyIdProperty: page.properties['Loyalty ID']
      }))

      return c.json({
        databaseId: NOTION_DATABASE_ID,
        totalRecords: data.results?.length || 0,
        records: debug,
        fullRawData: data.results
      })
    } catch (error: any) {
      return c.json({ error: error.message }, 500)
    }
  })
}

const port = 3000
console.log(`🚀 Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port
})
