// Edge Function — Vercel Edge Runtime (30s timeout on free Hobby plan)
// Keep at: api/scan.js
export const config = { runtime: "edge" };

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

const PROMPT = `You are SIGNAL, an elite stock market intelligence AI. Search the web RIGHT NOW for breaking financial news published in the last 2 hours that will cause a US stock to move 5%+ upward.

Cover ALL market caps — large cap, mid cap, small cap, micro cap, penny stocks. Search for:
1. FDA approvals, drug trial results, clinical data (any size biotech/pharma)
2. Earnings beats with EPS surprises
3. Raised full-year guidance
4. M&A acquisitions at a premium
5. Major contract or government wins
6. Analyst upgrades with significant price target increases
7. SEC 8-K filings — material events for small/micro cap companies
8. Short squeeze setups — high short interest plus real catalyst
9. Penny stock volume spikes — sub-$5 with 5x+ volume on a real catalyst
10. Uplisting to NYSE or NASDAQ

ONLY exclude: cryptocurrency, crypto tokens, crypto ETFs.

Return ONLY a raw JSON object, no markdown, no code fences, no explanation:
{
  "alerts": [
    {
      "ticker": "HCWB",
      "company": "HCW Biologics Inc",
      "headline": "Short headline max 10 words",
      "estimatedUpside": 25,
      "catalystType": "FDA Approval",
      "urgency": "Critical",
      "timeframe": "hours",
      "summary": "2-3 sentences explaining exactly what happened.",
      "reasoning": "Why this specifically causes a 5%+ move.",
      "confidence": 85,
      "source": "https://www.reuters.com/article/exact-url-here",
      "sourceName": "Reuters",
      "newsTime": "Today at 9:45 AM ET"
    }
  ],
  "storiesAnalyzed": 20
}

catalystType: Earnings Beat, M&A Deal, FDA Approval, Contract Win, Analyst Upgrade, Regulatory Win, Macro Tailwind, Short Squeeze, Guidance Raise, Clinical Trial, Biotech Catalyst
urgency: Critical, High, Medium
timeframe: hours, days, weeks

RULES:
- Every alert MUST have a real source URL starting with https://
- estimatedUpside must be >= 5
- confidence max 70 for penny stocks
- If nothing qualifies: {"alerts":[],"storiesAnalyzed":10}`;

function isMarketHours() {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 4 * 60 && mins < 20 * 60;
}

function validateAlerts(alerts) {
  if (!Array.isArray(alerts)) return [];
  return alerts.filter(a => {
    if (!a || typeof a.ticker !== "string" || !a.ticker.trim()) return false;
    if (!a.headline) return false;
    if (!a.source || !String(a.source).trim().toLowerCase().startsWith("http")) return false;
    const src = a.source.toLowerCase();
    if (src.includes("example.com") || src.includes("url-here") || src.includes("placeholder")) return false;
    if (isNaN(Number(a.estimatedUpside)) || Number(a.estimatedUpside) < 5) return false;
    if (!["Critical", "High", "Medium"].includes(a.urgency)) return false;
    return true;
  });
}

export default async function handler(req) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  if (!isMarketHours()) {
    const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    return new Response(JSON.stringify({
      marketClosed: true, alerts: [], storiesAnalyzed: 0,
      message: `Scanning paused. Hours: 4:00 AM-8:00 PM ET Mon-Fri. Current ET: ${et.toLocaleTimeString("en-US")}`
    }), { status: 200, headers: cors });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured", alerts: [], storiesAnalyzed: 0 }), { status: 500, headers: cors });

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: PROMPT }],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: `Anthropic error ${res.status}: ${t.slice(0, 200)}`, alerts: [], storiesAnalyzed: 0 }), { status: 500, headers: cors });
    }

    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

    let parsed = { alerts: [], storiesAnalyzed: 0 };
    try {
      const m = text.replace(/```[\w]*\n?/g, "").match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch (_) {}

    const validated = validateAlerts(parsed.alerts || []);
    validated.sort((a, b) => {
      const ord = { Critical: 0, High: 1, Medium: 2 };
      const d = (ord[a.urgency] ?? 2) - (ord[b.urgency] ?? 2);
      return d !== 0 ? d : (b.estimatedUpside || 0) - (a.estimatedUpside || 0);
    });

    return new Response(JSON.stringify({ alerts: validated, storiesAnalyzed: parsed.storiesAnalyzed || 0 }), { status: 200, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err), alerts: [], storiesAnalyzed: 0 }), { status: 500, headers: cors });
  }
}
