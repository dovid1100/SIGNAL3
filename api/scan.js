import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PROMPT = `You are SIGNAL, an elite stock market intelligence AI. Search the web RIGHT NOW for breaking financial news from the last 2 hours.

You must search for ALL types of stocks including:
- Large cap stocks (S&P 500)
- Mid cap stocks
- Small cap stocks
- Micro cap stocks
- Penny stocks (even under $5)
- Biotech and pharma stocks of any size
- Any stock with a genuine catalyst

DO NOT exclude any stock based on price or market cap.
ONLY exclude: cryptocurrency, crypto tokens, crypto ETFs.

Search for these specific catalysts:
1. FDA approvals, drug trial results, clinical trial data
2. Earnings beats with EPS surprises
3. Raised guidance
4. M&A acquisitions at a premium
5. Major contract wins
6. Analyst upgrades with price target increases
7. Short squeeze setups with real catalysts
8. Regulatory approvals
9. Small cap breakouts on high volume
10. Biotech catalyst events

For EACH alert you find, you MUST include:
- The exact source URL where you found this news
- The publication name
- The approximate time the news was published

Return ONLY a raw JSON object, no markdown, no explanation:
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

IMPORTANT: Every single alert MUST have a real source URL. If you cannot find a real URL for a story, do not include that alert.

If nothing qualifies: {"alerts":[],"storiesAnalyzed":10}`;

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

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      messages: [{ role: "user", content: PROMPT }],
    });

    const text = (response.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    let parsed = { alerts: [], storiesAnalyzed: 0 };
    try {
      const m = text.replace(/```[\w]*\n?/g, "").match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch {}

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message, alerts: [], storiesAnalyzed: 0 });
  }
}
