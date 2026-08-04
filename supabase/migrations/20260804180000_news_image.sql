-- Optional cover image for news articles
alter table public.news_posts
  add column if not exists image_url text;

comment on column public.news_posts.image_url is
  'Optional public image URL for the article. Empty/null means no image is shown.';
