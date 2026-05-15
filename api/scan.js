 import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/* ================================================================
   MARKET HOURS GATE
   Trading + extended hours: 4:00 AM – 8:00 PM Eastern Time
   Returns true if scanning is appropriate right now.
================================================================ */
function isMarketHours() {
  const now = new Date();
  // Convert to US/Eastern (handles EST/EDT automatically)
  const et = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const day = et.getDay(); // 0 = Sunday, 6 = Saturday

  // No scanning on weekends — markets are closed
  if (day === 0 || day === 6) return false;

  // 4:00 AM to 7:59 PM ET (pre-market open through after-hours close)
  const minuteOfDay = hours * 60 + minutes;
  return minuteOfDay >= 4 * 60 && minuteOfDay < 20 * 60;
}

/* ================================================================
   PROMPT 1 — LARGE CAP + MID CAP + GENERAL CATALYST SCAN
   Covers S&P 500 / NASDAQ, earnings, M&A, FDA, upgrades, etc.
================================================================ */
const PROMPT_LARGE = `You are SIGNAL, an elite stock market intelligence AI. Search the web RIGHT NOW for breaking financial news from the last 2 hours.

Search for these catalysts across large cap and mid cap US stocks (NYSE, NASDAQ, AMEX):
1. FDA approvals or drug trial results
2. Earnings beats with EPS surprises (current earnings season)
3. Raised full-year guidance
4. M&A acquisitions announced at a premium
5. Major contract wins or government contracts
6. Analyst upgrades with significant price target increases
7. Regulatory approvals (FCC, FTC, EU, DOJ clearance)
8. Clinical trial phase readouts (Phase 2, Phase 3, NDA submissions)

ONLY exclude: cryptocurrency, crypto tokens, crypto ETFs, forex, commodities.

Return ONLY a raw JSON object — no markdown, no explanation, no code fences:
{
  "alerts": [
    {
      "ticker": "AAPL",
      "company": "Apple Inc",
      "headline": "Short headline max 10 words",
      "estimatedUpside": 8,
      "catalystType": "Earnings Beat",
      "urgency": "High",
      "timeframe": "hours",
      "summary": "2-3 sentences explaining exactly what happened.",
      "reasoning": "Why this specifically causes a 5%+ move.",
      "confidence": 82,
      "source": "https://www.reuters.com/article/exact-url-here",
      "sourceName": "Reuters",
      "newsTime": "Today at 9:45 AM ET"
    }
  ],
  "storiesAnalyzed": 15
}

catalystType must be one of: Earnings Beat, M&A Deal, FDA Approval, Contract Win, Analyst Upgrade, Regulatory Win, Macro Tailwind, Guidance Raise, Clinical Trial, Biotech Catalyst
urgency must be one of: Critical, High, Medium
timeframe must be one of: hours, days, weeks

RULES:
- Only include stocks where you found a REAL, SPECIFIC news story published in the last 2 hours
- Every alert MUST have a real, working source URL. If you cannot find the URL, skip that alert entirely
- estimatedUpside must be ≥ 5 (only include if you genuinely expect 5%+ move)
- confidence must reflect real conviction — do not inflate
- If nothing qualifies: {"alerts":[],"storiesAnalyzed":10}`;

/* ================================================================
   PROMPT 2 — SMALL CAP, MICRO CAP, PENNY STOCK, SHORT SQUEEZE SCAN
   Dedicated pass for sub-$2B market cap stocks, OTC, SEC filings.
================================================================ */
const PROMPT_SMALLCAP = `You are SIGNAL, a stock market intelligence AI specializing in small cap and micro cap stocks. Search the web RIGHT NOW for the following, published in the last 3 hours:

SEARCH TARGETS — focus exclusively on these:

1. SEC EDGAR 8-K filings from today — search "SEC 8-K filing today" and "SEC EDGAR 8-K 2025" for small companies announcing material events: LOIs, contract wins, management changes, asset acquisitions
2. OTC Markets news — stocks trading on OTC Pink, OTCQB, OTCQX with major announcements
3. Short squeeze candidates — search "short squeeze today 2025" and "high short interest catalyst" for stocks with >20% short float that just received a positive catalyst
4. Micro cap FDA events — search "FDA approval small cap today" and "IND approval biotech 2025" for micro-cap biotech/pharma (under $500M market cap) receiving FDA fast track, orphan drug, or IND approvals
5. Penny stock volume spikes — search "unusual volume penny stock today" and "stock unusual volume spike 2025" for sub-$5 stocks with volume 5x+ their average on a real catalyst
6. Small cap earnings surprises — search "small cap earnings beat today 2025" for companies under $1B market cap that beat estimates by >20%
7. Reverse merger or uplisting announcements — search "uplisting NYSE NASDAQ 2025" and "reverse merger announcement today"

For any alert you find:
- ticker must be a real US stock ticker
- estimatedUpside must be ≥ 5%
- confidence should be LOWER for penny stocks (max 70) — they are volatile and harder to predict
- source must be a real URL you actually found

Return ONLY a raw JSON object — no markdown, no explanation, no code fences:
{
  "alerts": [
    {
      "ticker": "MXCT",
      "company": "MaxCyte Inc",
      "headline": "Short headline max 10 words",
      "estimatedUpside": 35,
      "catalystType": "FDA Approval",
      "urgency": "Critical",
      "timeframe": "hours",
      "summary": "2-3 sentences explaining exactly what happened.",
      "reasoning": "Why this specifically causes a 5%+ move. Note any short interest or volume data if relevant.",
      "confidence": 65,
      "source": "https://www.sec.gov/Archives/exact-url-here",
      "sourceName": "SEC EDGAR",
      "newsTime": "Today at 8:30 AM ET"
    }
  ],
  "storiesAnalyzed": 15
}

catalystType must be one of: Earnings Beat, M&A Deal, FDA Approval, Contract Win, Analyst Upgrade, Regulatory Win, Short Squeeze, Guidance Raise, Clinical Trial, Biotech Catalyst
urgency must be one of: Critical, High, Medium
timeframe must be one of: hours, days, weeks

RULES:
- ONLY include stocks where you found a real, specific news story or SEC filing
- Every alert MUST have a real source URL — skip alerts without one
- Do NOT include any alert you are not confident actually happened today
- If nothing qualifies: {"alerts":[],"storiesAnalyzed":10}`;

/* ================================================================
   VALIDATION — Strip alerts that fail quality checks
================================================================ */
function validateAlerts(alerts) {
  if (!Array.isArray(alerts)) return [];

  return alerts.filter((a) => {
    // Must have ticker and headline
    if (!a || typeof a.ticker !== "string" || !a.ticker.trim()) return false;
    if (!a.headline || typeof a.headline !== "string") return false;

    // Must have a real source URL (not a placeholder or empty)
    if (!a.source || typeof a.source !== "string") return false;
    const src = a.source.trim().toLowerCase();
    if (!src.startsWith("http")) return false;
    if (
      src.includes("example.com") ||
      src.includes("placeholder") ||
      src.includes("url-here") ||
      src.includes("your-url") ||
      src === "https://"
    )
      return false;

    // Must have a meaningful upside estimate
    const upside = Number(a.estimatedUpside);
    if (isNaN(upside) || upside < 5) return false;

    // Confidence sanity check
    const conf = Number(a.confidence);
    if (isNaN(conf) || conf < 1 || conf > 100) return false;

    // urgency must be valid
    if (!["Critical", "High", "Medium"].includes(a.urgency)) return false;

    return true;
  });
}

/* ================================================================
   DEDUP — Remove duplicate tickers across the two scan passes
================================================================ */
function dedupAlerts(alerts) {
  const seen = new Set();
  return alerts.filter((a) => {
    const key = a.ticker.toUpperCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ================================================================
   HANDLER
================================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── MARKET HOURS GATE ──
  if (!isMarketHours()) {
    const now = new Date();
    const et = new Date(
      now.toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    return res.status(200).json({
      marketClosed: true,
      alerts: [],
      storiesAnalyzed: 0,
      message: `Market scanning paused. Extended hours are 4:00 AM – 8:00 PM ET. Current ET time: ${et.toLocaleTimeString("en-US", { timeZone: "America/New_York" })}.`,
    });
  }

  try {
    // Run both scans in parallel to save time
    const [largeCapResponse, smallCapResponse] = await Promise.all([
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 6,
          },
        ],
        messages: [{ role: "user", content: PROMPT_LARGE }],
      }),
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 6,
          },
        ],
        messages: [{ role: "user", content: PROMPT_SMALLCAP }],
      }),
    ]);

    // Extract text from both responses
    function extractText(response) {
      return (response.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }

    function parseAlerts(text) {
      try {
        const clean = text.replace(/```[\w]*\n?/g, "");
        const m = clean.match(/\{[\s\S]*\}/);
        if (!m) return { alerts: [], storiesAnalyzed: 0 };
        return JSON.parse(m[0]);
      } catch {
        return { alerts: [], storiesAnalyzed: 0 };
      }
    }

    const largeParsed = parseAlerts(extractText(largeCapResponse));
    const smallParsed = parseAlerts(extractText(smallCapResponse));

    // Merge, validate, dedup
    const combined = [
      ...(largeParsed.alerts || []),
      ...(smallParsed.alerts || []),
    ];
    const validated = validateAlerts(combined);
    const deduped = dedupAlerts(validated);

    // Sort: Critical first, then by estimatedUpside desc
    deduped.sort((a, b) => {
      const urgencyOrder = { Critical: 0, High: 1, Medium: 2 };
      const uDiff =
        (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2);
      if (uDiff !== 0) return uDiff;
      return (b.estimatedUpside || 0) - (a.estimatedUpside || 0);
    });

    const storiesAnalyzed =
      (largeParsed.storiesAnalyzed || 0) + (smallParsed.storiesAnalyzed || 0);

    return res.status(200).json({
      alerts: deduped,
      storiesAnalyzed,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error.message, alerts: [], storiesAnalyzed: 0 });
  }
}
