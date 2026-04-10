// /api/chat.js
// Replaces the "dump all saves" pattern in index.html.
// Flow:
//   1. Embed the user's query with OpenAI text-embedding-3-small
//   2. Call Supabase match_items RPC (pgvector cosine similarity) → top 12 saves
//   3. Fall back to recency-sorted saves if vector search returns nothing
//   4. Pass those 12 saves (with visual_description) to Claude for a grounded reply

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, query, projectFilter } = req.body || {};

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey    = process.env.OPENAI_API_KEY;
    const supabaseUrl  = process.env.SUPABASE_URL;
    const supabaseKey  = process.env.SUPABASE_SERVICE_KEY; // service key for server-side calls

    if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: "Supabase env vars not configured" });

    const userQuery = query || messages?.findLast(m => m.role === "user")?.content || "";

    // ── 1. EMBED THE QUERY ────────────────────────────────────────────────────
    let relevantItems = [];
    let retrievalMode = "recency"; // for debug logging

    if (openaiKey && userQuery) {
      try {
        const embedResp = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: userQuery.slice(0, 8000),
          }),
        });

        const embedData = await embedResp.json();
        if (!embedResp.ok) throw new Error(embedData.error?.message || "Embed error");

        const queryVector = embedData.data?.[0]?.embedding;
        if (!Array.isArray(queryVector)) throw new Error("No query embedding");

        // ── 2. VECTOR SEARCH via Supabase RPC ──────────────────────────────
        // Requires this SQL function in your Supabase project (see SQL block below)
        const matchResp = await fetch(`${supabaseUrl}/rest/v1/rpc/match_items`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            query_embedding: queryVector,
            match_count: 14,
            // Optional: filter to active project
            ...(projectFilter ? { filter_project_id: projectFilter } : {}),
          }),
        });

        const matchData = await matchResp.json();

        if (Array.isArray(matchData) && matchData.length > 0) {
          relevantItems = matchData;
          retrievalMode = "vector";
        }
      } catch (vectorErr) {
        console.error("[chat] vector retrieval failed, falling back:", vectorErr.message);
      }
    }

    // ── 3. FALLBACK: recency sort (original behaviour) ────────────────────────
    if (relevantItems.length === 0) {
      let url = `${supabaseUrl}/rest/v1/items?select=id,title,url,type,summary,tags,project_id,visual_description,created_at&order=created_at.desc&limit=50`;
      if (projectFilter) url += `&project_id=eq.${projectFilter}`;

      const fallbackResp = await fetch(url, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      relevantItems = await fallbackResp.json();
    }

    console.log(`[chat] retrieval=${retrievalMode} count=${relevantItems.length}`);

    // ── 4. BUILD CONTEXT BLOCK ────────────────────────────────────────────────
    const context = relevantItems
      .map((item, i) => {
        const parts = [
          `[${i + 1}] "${item.title || "Untitled"}"`,
          item.summary ? `Summary: ${item.summary}` : null,
          item.visual_description ? `Visual: ${item.visual_description}` : null,
          item.tags?.length ? `Tags: ${item.tags.join(", ")}` : null,
          item.url ? `URL: ${item.url}` : null,
        ].filter(Boolean);
        return parts.join("\n");
      })
      .join("\n\n");

    const systemPrompt = `You are the AI assistant inside Moodbase — a visual curation platform where the user saves images, links, and notes.

You have access to the ${relevantItems.length} most semantically relevant saves from the user's library (${retrievalMode === "vector" ? "retrieved by visual/semantic similarity to their question" : "most recent saves"}).

Be specific. Reference actual saves by title or visual description. Identify patterns, moods, and creative threads. 
If asked about visual qualities (color, texture, mood, style), use the Visual field — it's a Claude Vision analysis of the image.
Be concise and useful. Speak like a thoughtful creative collaborator, not a search engine.

The user's relevant saves:

${context}`;

    // ── 5. CALL CLAUDE ────────────────────────────────────────────────────────
    const chatResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages || [{ role: "user", content: userQuery }],
      }),
    });

    const chatData = await chatResp.json();
    if (!chatResp.ok) throw new Error(chatData.error?.message || "Claude error");

    return res.status(200).json({
      content: chatData.content,
      retrieval_mode: retrievalMode,
      item_count: relevantItems.length,
    });
  } catch (err) {
    console.error("[chat] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
