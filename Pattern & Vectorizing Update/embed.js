// /api/embed.js
// Generates a text-embedding-3-small vector (1536 dims) for a given text string.
// Called internally by categorize.js after vision analysis — not exposed to client.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY not configured" });

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000), // token-safe truncation
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI embedding error");
    }

    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw new Error("No embedding returned");

    return res.status(200).json({ embedding });
  } catch (err) {
    console.error("[embed] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
