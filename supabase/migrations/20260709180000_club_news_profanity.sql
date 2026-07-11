-- Extend the centralized profanity filter (public.contains_profanity, which
-- already handles case, spacing, symbol/leet substitution, and repeated
-- characters) to club/team news posts (title + body). Enforced in the database
-- on insert AND update so neither new nor edited posts can bypass it.

create or replace function public.enforce_club_news_profanity()
returns trigger
language plpgsql
as $$
begin
  if public.contains_profanity(new.title)
     or public.contains_profanity(new.body) then
    raise exception 'Your post contains inappropriate language. Please edit it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_club_news_profanity_trigger on public.club_news_posts;
create trigger enforce_club_news_profanity_trigger
before insert or update of title, body on public.club_news_posts
for each row execute function public.enforce_club_news_profanity();
