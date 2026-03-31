-- AI analysis cache (replaces local filesystem cache)
CREATE TABLE IF NOT EXISTS analysis_cache (
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  cache_key  TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  value      JSONB NOT NULL,
  PRIMARY KEY (user_id, cache_key)
);

ALTER TABLE analysis_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_cache" ON analysis_cache FOR ALL USING (auth.uid() = user_id);
