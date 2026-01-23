import { config } from 'dotenv'
config()

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'

const app = new Hono()

app.use('/public/*', serveStatic({ root: './' }));


// Notion API configuration
const NOTION_API_KEY = process.env.NOTION_API_KEY
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID

console.log('🔧 Environment check:')
console.log('NOTION_API_KEY:', NOTION_API_KEY ? '✓ Loaded' : '✗ Not loaded')
console.log('NOTION_DATABASE_ID:', NOTION_DATABASE_ID ? '✓ Loaded' : '✗ Not loaded')

// Test route
app.get('/', (c) => {
  return c.text('Loyalty Card API is running! 🎉')
})

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
        body: JSON.stringify({
          page_size: 100
        })
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
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head><title>Card Not Found</title>
        <style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;text-align:center;}</style>
        </head>
        <body><div><h1>❌ Loyalty Card Not Found</h1><p>Code: ${loyaltyCode}</p></div></body>
        </html>
      `)
    }

    return c.html(generateCardHTML(cardData))
  } catch (error: any) {
    return c.html('<h1>Error: ' + error.message + '</h1>')
  }
})

// List all cards
app.get('/cards', async (c) => {
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

    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>All Loyalty Cards</title>
        <style>
          body{font-family:Arial;max-width:1200px;margin:0 auto;padding:20px;background:#f5f5f5;}
          h1{color:#667eea;}
          table{width:100%;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
          th,td{padding:12px;text-align:left;border-bottom:1px solid #eee;}
          th{background:#667eea;color:white;}
          tr:hover{background:#f9f9f9;}
          a{color:#667eea;text-decoration:none;font-weight:bold;}
          a:hover{text-decoration:underline;}
          .badge{display:inline-block;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:bold;}
          .active{background:#10b981;color:white;}
          .inactive{background:#ef4444;color:white;}
        </style>
      </head>
      <body>
        <h1>🎁 All Loyalty Cards (${cards.length})</h1>
        <table>
          <thead><tr><th>Customer</th><th>Loyalty Code</th><th>Points</th><th>Tier</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            ${cards.map(card => `
              <tr>
                <td>${card.customer}</td>
                <td><code>${card.loyaltyCode}</code></td>
                <td>${card.points}</td>
                <td>${card.tier}</td>
                <td><span class="badge ${card.active ? 'active' : 'inactive'}">${card.active ? 'Active' : 'Inactive'}</span></td>
                <td><a href="${card.url}">View Card →</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `)
  } catch (error: any) {
    return c.html('<h1>Error: ' + error.message + '</h1>')
  }
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
    }, 200, {
      'Content-Type': 'application/json'
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Generate card HTML - SINGLE-SIDED VERSION
function generateCardHTML(cardData: any): string {
  const code = cardData.loyaltyCode || 'N/A'
  const name = cardData.customerName || 'Customer'
  const points = cardData.points || 0
  const tier = cardData.tier || 'Bronze'
  const active = cardData.isActive ? 'Active' : 'Inactive'

  console.log('🎨 Generating single-sided card for:', code)

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Loyalty Card - ${name}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;background:#2a2a2a;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;}
.card{width:800px;min-height:520px;background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.5);overflow:visible;position:relative;display:flex;flex-direction:column;}
.card-header{background:linear-gradient(135deg,#14b8a6 0%,#0891b2 100%);padding:25px 40px;color:#fff;position:relative;}
.header-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
.logo-section{display:flex;gap:10px;}
.logo-circle{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;}
.logo-text{font-size:32px;font-weight:bold;color:#14b8a6;}
.brand-info{display:flex;flex-direction:column;}
.brand-name{font-size:28px;font-weight:bold;letter-spacing:3px;}
.tagline{font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:0.9;}
.status-badge{padding:6px 18px;border-radius:20px;font-size:12px;font-weight:bold;background:rgba(255,255,255,0.2);backdrop-filter:blur(10px);}
.customer-name{font-size:22px;font-weight:bold;letter-spacing:1px;}
.card-body{padding:30px 40px;display:grid;grid-template-columns:1fr 1fr;gap:30px;flex:1;}
.info-section{display:flex;flex-direction:column;gap:20px;}
.info-row{display:flex;flex-direction:column;gap:5px;}
.info-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;}
.info-value{font-size:18px;font-weight:bold;color:#0f172a;}
.points-display{background:linear-gradient(135deg,#14b8a6 0%,#0891b2 100%);color:#fff;padding:18px;border-radius:12px;text-align:center;}
.points-label{font-size:11px;text-transform:uppercase;letter-spacing:2px;opacity:0.9;margin-bottom:5px;}
.points-value{font-size:38px;font-weight:bold;}
.tier-badge{display:inline-block;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:bold;color:#fff;background:#f59e0b;}
.codes-section{display:flex;flex-direction:column;gap:15px;align-items:center;justify-content:center;}
.barcode-container{display:flex;flex-direction:column;align-items:center;gap:8px;background:#f8fafc;padding:15px;border-radius:12px;width:100%;}
.barcode-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;}
#barcode{margin:0;}
.barcode-number{font-family:'Courier New',monospace;font-size:12px;font-weight:bold;color:#0f172a;letter-spacing:2px;}
.qr-container{display:flex;flex-direction:column;align-items:center;gap:8px;}
.qr-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;}
.qr-code img{
max-width:110px;
max-height:110px;
}
.qr-code{border:8px solid #14b8a6;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#f8fafc;}
/* And add specific styling for logo images: */
.logo-circle img{
width:100%;
height:100%;
object-fit:contain;
}

.brand-info img{
height:50px;
width:auto;
}
.qr-placeholder{width:90px;height:90px;}
.footer{background:#f8fafc;padding:15px 40px;display:flex;justify-content:space-between;align-items:center;border-top:2px solid #e2e8f0;border-radius:0 0 20px 20px;}
.website{font-size:15px;font-weight:bold;color:#14b8a6;}
.promo{font-size:13px;color:#64748b;font-weight:600;}
</style>
</head>
<body>
<div class="card">
<div class="card-header">
<div class="header-top">
<div class="logo-section">
<div class="logo-circle">
<img src="/public/b-logo.svg" alt="b-logo" />
</div>
<div class="brand-info">
<img src="/public/logo.svg" alt="logo" />
</div>
</div>
<div class="status-badge">${active}</div>
</div>
<div class="customer-name">${name}</div>
</div>
<div class="card-body">
<div class="info-section">
<div class="points-display">
<div class="points-label">Loyalty Points</div>
<div class="points-value">${points}</div>
</div>
<div class="info-row">
<div class="info-label">Membership Tier</div>
<div><span class="tier-badge">${tier}</span></div>
</div>
<div class="info-row">
<div class="info-label">Loyalty ID</div>
<div class="info-value">${code}</div>
</div>
<div class="info-row">
<div class="info-label">Member Since</div>
<div class="info-value">${new Date(cardData.memberSince).toLocaleDateString()}</div>
</div>
</div>
<div class="codes-section">
<div class="barcode-container">
<div class="barcode-label">Scan at Checkout</div>
<svg id="barcode"></svg>
<div class="barcode-number">${code}</div>
</div>
<div class="qr-container">
<div class="qr-label">Contact Us</div>
<div class="qr-code">
<img src="/public/qr-code.svg" alt="qrcode" />
</div>
</div>
</div>
</div>
<div class="footer">
<div class="website">www.blueva.dz</div>
<div class="promo">BUY 7, GET 1 FREE</div>
</div>
</div>
<script>
const loyaltyData={code:"${code}",name:"${name}",points:${points},tier:"${tier}",active:${cardData.isActive}};
if(loyaltyData.code!=="N/A"&&loyaltyData.code){
try{
JsBarcode("#barcode",loyaltyData.code,{format:"CODE128",width:2,height:60,displayValue:false,margin:0});
}catch(e){console.error('Barcode error:',e);}
}
</script>
</body>
</html>`
}


const port = 3000
console.log(`🚀 Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port
})
