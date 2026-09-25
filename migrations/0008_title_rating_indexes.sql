-- Top-rated lists inside a kind (topic pages "高分", channel year filters). With only
-- ix_titles_rated (indexable, vote_average) such a query walks every indexable title by
-- rating until it finds 12 matches: ~66k rows for a year topic such as "2026年电影".
CREATE INDEX ix_titles_kind_year_rated ON titles (indexable, kind, year, vote_average);
CREATE INDEX ix_titles_kind_rated ON titles (indexable, kind, vote_average);
