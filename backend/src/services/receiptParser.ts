/**
 * Receipt parsing service — uses OpenAI multimodal (gpt-4o-mini) to extract
 * structured data from a receipt image (Norwegian/Swedish/English).
 *
 * 15-second timeout enforced via AbortSignal so the underlying request is
 * actually cancelled — not just orphaned to burn quota in the background.
 * On timeout or API failure, returns empty items array (never throws to caller).
 */
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

const EMPTY: ParsedReceipt = { store: null, date: null, detectedCardLastFour: null, items: [] }

export async function parseReceipt(imageBuffer: Buffer, mimeType: string): Promise<ParsedReceipt> {
  const base64 = imageBuffer.toString('base64')

  try {
    const response = await client.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
              { type: 'text', text: USER_PROMPT },
            ],
          },
        ],
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    )

    const text = response.choices[0]?.message?.content ?? ''
    const parsed = JSON.parse(text) as ParsedReceipt
    parsed.items = (parsed.items ?? []).map((item) => ({
      ...item,
      unitPriceOre: Math.max(0, Math.round(item.unitPriceOre)),
      quantity: Math.max(1, Math.round(item.quantity ?? 1)),
    }))
    return parsed
  } catch (err) {
    // Timeout (AbortError), API failure, or invalid JSON — degrade to empty so
    // the user can still hand-enter the line items.
    console.warn('Receipt parse failed:', err instanceof Error ? err.message : err)
    return EMPTY
  }
}
