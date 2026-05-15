import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PROMPT = `You are SIGNAL, an elite stock market intelligence AI. Search the web RIGHT NOW for breaking financial news from the last 2 hours and identify stocks with a genuine catalyst for a 5%+ upward move.

Look for: Earnings beats, raised guidance, M&A deals, FDA approvals, major contract wins, analyst upgrades, regulatory wins.

EXCLUDE: crypto, meme stocks, penny stocks under $5.

Return ONLY raw JSON no markdown:
{"alerts":[{"ticker":"NVDA","company":"NVIDIA Corporation","headline":"Short headline max 10 words","estimatedUpside":12,"catalystType":"Earnings Beat","urgency":"Critical","timeframe":"hours","summary":"2-3 sentences.","reasoning":"Why this causes 5%+ move.","confidence":85}],"storiesAnalyzed":14}

catalystType: Earnings Beat, M&A Deal, FDA Approval, Contract Win, Analyst Upgrade, Regulatory Win, Macro Tailwind, Short Squeeze, Guidance Raise
urgency: Critical, High, Medium
timeframe: hours, days, weeks

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
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
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
