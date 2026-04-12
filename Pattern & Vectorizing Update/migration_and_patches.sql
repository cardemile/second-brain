-- ════════════════════════════════════════════════════════════════════════════
-- MOODBASE — VECTOR PIPELINE MIGRATION
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Enable pgvector extension (once per project)
create extension if not exists vector;

-- 2. Add new columns to items table
alter table items
  add column if not exists visual_description text,
  add column if not exists embedding vector(1536);

-- 3. Create an HNSW index for fast cosine similarity search
--    (much faster than exact search at 1000+ rows)
create index if not exists items_embedding_idx
  on items using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- 4. Create the RPC function that /api/chat.js calls
--    Accepts optional project_id filter so "Ask about this project" works too
create or replace function match_items(
  query_embedding vector(1536),
  match_count     int      default 14,
  filter_project_id uuid   default null
)
returns table (
  id                uuid,
  title             text,
  url               text,
  type              text,
  summary           text,
  tags              text[],
  project_id        uuid,
  visual_description text,
  created_at        timestamptz,
  similarity        float
)
language plpgsql
as $$
begin
  return query
  select
    i.id,
    i.title,
    i.url,
    i.type,
    i.summary,
    i.tags,
    i.project_id,
    i.visual_description,
    i.created_at,
    1 - (i.embedding <=> query_embedding) as similarity
  from items i
  where
    i.embedding is not null
    and (filter_project_id is null or i.project_id = filter_project_id)
  order by i.embedding <=> query_embedding
  limit match_count;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- VERCEL ENV VARS TO ADD  (vercel.com → project → Settings → Environment)
-- ════════════════════════════════════════════════════════════════════════════
--
--   OPENAI_API_KEY          = sk-...        (from platform.openai.com)
--   SUPABASE_URL            = https://xxx.supabase.co
--   SUPABASE_SERVICE_KEY    = eyJ...        (Settings → API → service_role key)
--   ANTHROPIC_API_KEY       = sk-ant-...    (already set)
--
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- INDEX.HTML — replace sendChat() with this version
-- Find the existing sendChat function and swap it out entirely
-- ════════════════════════════════════════════════════════════════════════════

/*

async function sendChat(msg) {
  msg = (msg || document.getElementById("chatInput").value).trim();
  if (!msg) return;

  document.getElementById("chatInput").value = "";
  document.getElementById("chatSuggestions").style.display = "none";
  document.getElementById("chatSend").disabled = true;

  appendMsg("user", msg);
  chatHistory.push({ role: "user", content: msg });
  appendMsg("ai", "· · ·", true);

  try {
    // Pass the active project filter so vector search stays scoped when needed
    const body = {
      messages: chatHistory,
      query: msg,
      projectFilter: activeProject !== "ALL" ? activeProject : null,
    };

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    const reply = data.content?.[0]?.text || data.error || "Sorry, something went wrong.";

    document.querySelector(".chat-msg.loading")?.remove();
    chatHistory.push({ role: "assistant", content: reply });
    appendMsg("ai", reply);
  } catch (err) {
    document.querySelector(".chat-msg.loading")?.remove();
    appendMsg("ai", "Connection error: " + err.message);
  }

  document.getElementById("chatSend").disabled = false;
}

*/


-- ════════════════════════════════════════════════════════════════════════════
-- BACKGROUND.JS — persist embedding + visual_description after categorize
-- In the section where you call sbInsert / sbUpdate after runAI(), add:
-- ════════════════════════════════════════════════════════════════════════════

/*

// After getting `aiResult` from runAI(), spread the new fields into the upsert:
const itemPayload = {
  type: raw.type || "link",
  url: raw.url || null,
  title: raw.title || "Untitled",
  content: raw.content || null,
  summary: aiResult.summary || "",
  tags: aiResult.tags || [],
  favicon: raw.favicon || "",
  source_url: raw.sourceUrl || raw.url || "",
  project_id: projectId,
  // NEW — from categorize.js response
  visual_description: aiResult.visual_description || null,
  embedding: aiResult.embedding || null,   // pgvector accepts a JS array directly via Supabase JS client
};

await sbInsert("items", itemPayload);

*/
