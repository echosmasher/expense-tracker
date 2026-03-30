/**
 * Receipt parsing service — uses Anthropic multimodal API to extract
 * structured data from a receipt image (Norwegian/Swedish/English).
 *
 * SC-001: 15-second timeout enforced via Promise.race.
 * On timeout or API failure, returns empty items array (never throws to caller).
 */
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface ParsedReceiptItem {
  description: string
  quantity: number
  unitPriceOre: number
  confidenceLow: boolean
}

export interface ParsedReceipt {
  store: string | null
  date: string | null   // ISO 8601 date string or null
  detectedCardLastFour: string | null
  items: ParsedReceiptItem[]
}

const SYSTEM_PROMPT = `You are a receipt parsing assistant. Extract structured data from receipt images.
The receipt may be in Norwegian, Swedish, or English — handle all three languages correctly.
Always respond with valid JSON only, no markdown, no explanation.

Response format:
{
  "store": "<store name or null>",
  "date": "<YYYY-MM-DD or null>",
  "detectedCardLastFour": "<last 4 digits if visible on receipt, or null>",
  "items": [
    {
      "description": "<item name in original language>",
      "quantity": <number, default 1>,
      "unitPriceOre": <unit price in øre as integer, e.g. 4990 for kr 49.90>,
      "confidenceLow": <true if hard to read or uncertain>
    }
  ]
}

Rules:
- All prices must be in øre (multiply NOK/SEK by 100, round to integer)
- If a price is in SEK, convert 1:1 to øre (treat as same scale)
- If you cannot read an item clearly, include it with confidenceLow: true
- If you cannot read the total at all, return the items you can read
- Never invent items that are not visible on the receipt`

const USER_PROMPT = 'Parse this receipt image and return the structured JSON.'

const TIMEOUT_MS = 15_000

export async function parseReceipt(imageBuffer: Buffer, mimeType: string): Promise<ParsedReceipt> {
  const base64 = imageBuffer.toString('base64')

  const mediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

  const parsePromise = client.messages
    .create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    })
    .then((response) => {
      const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
      const parsed = JSON.parse(text) as ParsedReceipt
      // Ensure integers
      parsed.items = (parsed.items ?? []).map((item) => ({
        ...item,
        unitPriceOre: Math.round(item.unitPriceOre),
        quantity: item.quantity ?? 1,
      }))
      return parsed
    })

  const timeoutPromise = new Promise<ParsedReceipt>((resolve) =>
    setTimeout(
      () => resolve({ store: null, date: null, detectedCardLastFour: null, items: [] }),
      TIMEOUT_MS
    )
  )

  try {
    return await Promise.race([parsePromise, timeoutPromise])
  } catch {
    // API failure — return empty result
    return { store: null, date: null, detectedCardLastFour: null, items: [] }
  }
}
