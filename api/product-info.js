/**
 * AI Product Info — Backend Proxy
 * Deploy to Vercel / Netlify Functions / any Node.js server.
 *
 * Environment variables required:
 *   GEMINI_API_KEY   — your Google Gemini API key (free at aistudio.google.com)
 *   ALLOWED_ORIGIN   — your Shopify store URL (e.g. https://your-store.myshopify.com)
 *
 * Endpoint: POST /api/product-info
 * Body: { title, vendor, type, tags, description }
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
  const { title, vendor, type, tags, description } = req.body || {};

  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Missing product title' });
  }

  // Sanitise inputs — strip any injected prompt content
  const safe = (val) =>
    String(val || '')
      .replace(/[\u0000-\u001F]/g, ' ')
      .trim()
      .slice(0, 500);

  const productContext = [
    `Product: ${safe(title)}`,
    vendor      ? `Brand: ${safe(vendor)}`      : null,
    type        ? `Category: ${safe(type)}`      : null,
    tags        ? `Tags: ${safe(tags)}`          : null,
    description ? `Description: ${safe(description)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  // ── OpenAI call ───────────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  const systemPrompt = `You are a knowledgeable product advisor.
When given a product, return a helpful, structured summary using only these sections (omit any section if not applicable):
- What it is
- Key benefits
- Who it's for
- How to use
- Things to know

Use simple, friendly language. Keep each section concise (2-4 bullet points max).
Respond ONLY with valid JSON in this exact shape:
{ "sections": [ { "heading": "...", "bullets": ["...", "..."] } ] }`;

  let geminiData;
  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: productContext }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      console.error('Gemini error:', errBody);
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    geminiData = await geminiResponse.json();
  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(502).json({ error: 'AI service unavailable' });
  }

  // ── Parse & convert to HTML ───────────────────────────────────────────────
  let parsed;
  try {
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
