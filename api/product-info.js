/**
 * AI Product Info — Backend Proxy
 * Deploy to Vercel / Netlify Functions / any Node.js server.
 *
 * Environment variables required:
 *   GROQ_API_KEY     — optional Groq API key (free at console.groq.com)
 *   GROQ_MODEL       — optional Groq model override
 *   GEMINI_API_KEY   — optional Gemini API key fallback
 *   GEMINI_MODEL     — optional Gemini model override
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

  // ── AI provider call ──────────────────────────────────────────────────────
  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!groqApiKey && !geminiApiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }
  const groqModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

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

  let rawAiContent = '';
  const providerErrors = [];

  if (groqApiKey) {
    try {
      rawAiContent = await callGroq({ apiKey: groqApiKey, model: groqModel, systemPrompt, productContext });
    } catch (err) {
      providerErrors.push(`Groq: ${err.message}`);
      console.error('Groq provider failed:', err);
    }
  }

  if (!rawAiContent && geminiApiKey) {
    try {
      rawAiContent = await callGemini({ apiKey: geminiApiKey, model: geminiModel, systemPrompt, productContext });
    } catch (err) {
      providerErrors.push(`Gemini: ${err.message}`);
      console.error('Gemini provider failed:', err);
    }
  }

  if (!rawAiContent) {
    return res.status(502).json({
      error: 'AI service unavailable',
      detail: providerErrors.join(' | ') || 'No AI provider returned a response',
    });
  }

  // ── Parse & convert to HTML ───────────────────────────────────────────────
  let parsed;
  try {
    // Strip markdown code fences if present
    const jsonStr = rawAiContent.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
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

async function callGroq({ apiKey, model, systemPrompt, productContext }) {
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
          { role: 'user', content: productContext },
        ],
      }),
    }
  );

  if (!groqResponse.ok) {
    const errBody = await groqResponse.text();
    console.error('Groq error:', errBody);
    throw new Error(parseGroqErrorMessage(errBody));
  }

  const groqData = await groqResponse.json();
  return groqData.choices?.[0]?.message?.content || '';
}

async function callGemini({ apiKey, model, systemPrompt, productContext }) {
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: productContext }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 600,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!geminiResponse.ok) {
    const errBody = await geminiResponse.text();
    console.error('Gemini error:', errBody);
    throw new Error(parseGeminiErrorMessage(errBody));
  }

  const geminiData = await geminiResponse.json();
  return geminiData.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

function parseGroqErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || body;
  } catch {
    return body;
  }
}

function parseGeminiErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || body;
  } catch {
    return body;
  }
}
