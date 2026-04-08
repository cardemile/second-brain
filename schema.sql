-- ─── SECOND BRAIN — Supabase Schema ─────────────────────────────────────────
-- Run this in Supabase → SQL Editor → New Query → Run

-- Projects table
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text default '#c9a96e',
  keywords text[] default '{}',
  created_at timestamptz default now()
);

-- Items table
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'link',        -- link | image | note
  url text,
  title text,
  content text,                             -- for notes
  summary text,                             -- AI-generated
  tags text[] default '{}',                -- AI-generated
  favicon text,
  source_url text,
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz default now()
);

-- Enable realtime so the web page updates live
alter publication supabase_realtime add table items;
alter publication supabase_realtime add table projects;

-- Seed default projects (Frajna's setup)
insert into projects (name, color, keywords) values
  ('Bali Water', '#4a9eba', '{"water","drink","hydration","beverage","bottle","packaging","bali","product"}'),
  ('Modern Women Bali', '#c47fb0', '{"women","lifestyle","bali","community","modern","feminine","wellness","culture","reels","instagram"}'),
  ('Bali Prime Travel', '#7ab87a', '{"travel","bali","tourism","destination","hotel","villa","experience","trip"}'),
  ('Brand Identity', '#c9a96e', '{"brand","identity","logo","typography","color","visual","design","creative","moodboard"}'),
  ('Content Strategy', '#9b8bc4', '{"content","strategy","social","reels","instagram","hooks","copy","storytelling","AB"}')
on conflict do nothing;

-- Done! ✦
