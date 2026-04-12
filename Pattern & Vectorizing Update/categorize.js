// /api/categorize.js
// On save:
//   1. Claude categorizes the item (project, tags, summary) — existing behaviour
//   2. If the item is an image, Claude Vision generates a rich visual description
//   3. The combined text (summary + visual description) gets embedded via OpenAI
//      text-embedding-3-small and stored as visual_embedding + visual_description
//      so chat can do semantic retrieval instead of dumping all saves into context.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { raw, projects } = req.body || {};
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

    // ── 1. CATEGORIZE (existing logic, unchanged) ────────────────────────────
    const projectList = (projects || [])
      .map(p => `- slug: "${p.name?.toLowerCase().replace(/\s+/g, "-")}", name: "${p.name}"`)
      .join("\n");

    const contentDesc =
      raw.type === "note"
        ? `TEXT: "${raw.content}"`
        : `PAGE: "${raw.title}" URL: ${raw.url}`;

    const categorizePrompt = `Analyze this saved item and return ONLY a JSON object.

ITEM: ${contentDesc}

PROJECTS:
${projectList}

Return: {"project": "<slug or general>", "tags": ["tag1","tag2","tag3"], "summary": "<1-2 sentences>"}`;

    const categorizeResp = await claudeText(anthropicKey, categorizePrompt, 400);
    const clean = categorizeResp.trim().replace(/```json|```/g, "").trim();
    const categorized = JSON.parse(clean);

    // ── 2. VISION ANALYSIS (images only) ─────────────────────────────────────
    let visualDescription = null;

    if (raw.type === "image" && raw.url && looksLikeImage(raw.url)) {
      try {
        const visionPrompt = `You are a visual analyst for a creative curation platform called Moodbase.
Analyze this image and write a rich visual description optimised for semantic search.
Cover: overall mood and atmosphere, dominant and accent colors (be specific — not just "blue" but "dusty slate blue"), 
textures and materials, visual style (editorial, organic, brutalist, soft, etc.), 
lighting quality, compositional feel, and the emotional response it might evoke in a creative professional.
Be specific and evocative. 3-5 sentences. No bullet points. No preamble.`;

        visualDescription = await claudeVision(anthropicKey, visionPrompt, raw.url);
      } catch (visionErr) {
        // Vision failing should never block the save
        console.error("[categorize] vision error:", visionErr.message);
      }
    }

    // ── 3. EMBED (if OpenAI key available) ───────────────────────────────────
    let embedding = null;

    if (openaiKey) {
      try {
        // Combine every text signal we have into one rich embedding document
        const embedText = [
          raw.title || "",
          categorized.summary || "",
          (categorized.tags || []).join(", "),
          visualDescription || "",
        ]
          .filter(Boolean)
          .join(". ");

        embedding = await openaiEmbed(openaiKey, embedText);
      } catch (embedErr) {
        console.error("[categorize] embedding error:", embedErr.message);
      }
    }

    // ── 4. RETURN everything so the caller (background.js) can persist it ────
    return res.status(200).json({
      ...categorized,
      visual_description: visualDescription,   // stored in Supabase items.visual_description
      embedding,                                // stored in Supabase items.embedding (vector(1536))
    });
  } catch (err) {
    console.error("[categorize] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function looksLikeImage(url) {
  return /\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i.test(url) ||
    url.includes("images.") ||
    url.includes("/image/") ||
    url.includes("cdn.") ||
    url.includes("static.");
}

async function claudeText(apiKey, prompt, maxTokens = 400) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content[0].text;
}

async function claudeVision(apiKey, prompt, imageUrl) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: imageUrl },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "Claude Vision error");
  return data.content[0].text;
}

async function openaiEmbed(apiKey, text) {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "OpenAI embedding error");

  const vector = data.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("No embedding returned");
  return vector;
}
