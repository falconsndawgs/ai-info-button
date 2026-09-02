/**
 * AI Product Info — Backend Proxy
 * Deploy to Vercel / Netlify Functions / any Node.js server.
 *
 * Environment variables required:
 *   GROQ_API_KEY     — your Groq API key (free at console.groq.com)
 *   GROQ_MODEL       — optional Groq model override
 *   ALLOWED_ORIGIN   — your Shopify store URL (e.g. https://your-store.myshopify.com)
 *
 * Endpoint: POST /api/product-info
 * Body: { title, vendor, type, tags, description, page_context, pageContext }
 * Returns: { html: "<formatted AI response>" }
 */

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
  const origin = req.headers.origin || '';

  if (allowedOrigin && origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { title, vendor, type, tags, description, page_context, pageContext } = req.body || {};

  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Missing product title' });
  }

  // Sanitise inputs — strip any injected prompt content
  const safe = (val) =>
    String(val || '')
      .replace(/[\u0000-\u001F]/g, ' ')
      .trim()
      .slice(0, 500);

  const safeLong = (val, maxLength = 9000) =>
    String(val || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
      .slice(0, maxLength);

  const pageContextText = safeLong(
    page_context ||
      (pageContext ? JSON.stringify(pageContext) : ''),
    9000
  );

  const productContext = [
    `Product: ${safe(title)}`,
    vendor      ? `Brand: ${safe(vendor)}`      : null,
    type        ? `Category: ${safe(type)}`      : null,
    tags        ? `Tags: ${safe(tags)}`          : null,
    description ? `Description: ${safe(description)}` : null,
    pageContextText ? `Page context:\n${pageContextText}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  // ── Groq call ─────────────────────────────────────────────────────────────
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }
  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

  const systemPrompt = `You are a knowledgeable mobility product advisor for Top Mobility.
Summarize the current product page for a shopper using only the provided product and page context. Do not invent specifications, pricing, warranties, compatibility, availability, or medical claims.

Return a helpful, structured summary using only these sections (omit any section if not applicable):
- What it is
- Key benefits
- Who it's for
- How to use
- Things to know

Use simple, friendly language. Keep each section concise (2-4 bullet points max). Prefer page-specific details over generic category advice.
Respond ONLY with valid JSON in this exact shape:
{ "sections": [ { "heading": "...", "bullets": ["...", "..."] } ] }`;

  let groqData;
  try {
    const groqResponse = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: productContext },
          ],
        }),
      }
    );

    if (!groqResponse.ok) {
      const errBody = await groqResponse.text();
      console.error('Groq error:', errBody);
      return res.status(502).json({
        error: 'AI service unavailable',
        detail: parseGroqErrorMessage(errBody),
      });
    }

    groqData = await groqResponse.json();
  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(502).json({ error: 'AI service unavailable' });
  }

  // ── Parse & convert to HTML ───────────────────────────────────────────────
  let parsed;
  try {
    const raw = groqData.choices?.[0]?.message?.content || '';
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    return res.status(500).json({ error: 'Could not parse AI response' });
  }

  const html = (parsed.sections || [])
    .map(({ heading, bullets }) => {
      const items = (bullets || [])
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join('');
      return `<h3>${escapeHtml(heading)}</h3><ul>${items}</ul>`;
    })
    .join('');

  return res.status(200).json({ html });
}

// ── Utility ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseGroqErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || body;
  } catch {
    return body;
  }
}
