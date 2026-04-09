export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { raw, projects } = req.body || {};
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) return res.status(500).json({ error: "API key not configured" });

    const projectList = projects.map(p =>
      `- slug: "${p.name?.toLowerCase().replace(/\s+/g, "-")}", name: "${p.name}"`
    ).join("\n");

    const contentDesc = raw.type === "note"
      ? `TEXT: "${raw.content}"`
      : `PAGE: "${raw.title}" URL: ${raw.url}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        messages: [{ role: "user", content: `Analyze this saved item and return ONLY a JSON object.\n\nITEM: ${contentDesc}\n\nPROJECTS:\n${projectList}\n\nReturn: {"project": "<slug or general>", "tags": ["tag1","tag2","tag3"], "summary": "<1-2 sentences>"}` }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "API error");
    const clean = data.content[0].text.trim().replace(/```json|```/g, "").trim();
    return res.status(200).json(JSON.parse(clean));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
