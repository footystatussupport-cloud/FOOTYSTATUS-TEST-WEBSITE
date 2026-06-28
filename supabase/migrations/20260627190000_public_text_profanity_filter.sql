create or replace function public.profanity_normalized_text(_text text)
returns text
language plpgsql
immutable
as $$
declare
  value text := lower(coalesce(_text, ''));
begin
  value := replace(value, '0', 'o');
  value := replace(value, '1', 'i');
  value := replace(value, '!', 'i');
  value := replace(value, '|', 'i');
  value := replace(value, '3', 'e');
  value := replace(value, '4', 'a');
  value := replace(value, '@', 'a');
  value := replace(value, '5', 's');
  value := replace(value, '$', 's');
  value := replace(value, '7', 't');
  value := replace(value, '+', 't');
  value := replace(value, '8', 'b');
  return value;
end;
$$;

create or replace function public.profanity_compact_text(_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(public.profanity_normalized_text(coalesce(_text, '')), '[^a-z]+', '', 'g');
$$;

create or replace function public.profanity_squeezed_text(_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(public.profanity_compact_text(coalesce(_text, '')), '([a-z])\1+', '\1', 'g');
$$;

create or replace function public.contains_profanity(_text text)
returns boolean
language plpgsql
immutable
as $$
declare
  normalized text := public.profanity_normalized_text(_text);
  compact text := public.profanity_compact_text(_text);
  squeezed text := public.profanity_squeezed_text(_text);
  term text;
  compact_terms text[] := array[
    'fuck',
    'fucker',
    'fucking',
    'motherfucker',
    'shit',
    'shitty',
    'bitch',
    'bitches',
    'cunt',
    'pussy',
    'asshole',
    'bastard',
    'douche',
    'douchebag',
    'nigger',
    'nigga',
    'faggot',
    'retard',
    'slut',
    'whore'
  ];
begin
  if coalesce(_text, '') = '' then
    return false;
  end if;

  foreach term in array compact_terms loop
    if normalized ~* ('(^|[^a-z])' || term || '([^a-z]|$)') then
      return true;
    end if;

    if compact like '%' || term || '%' then
      return true;
    end if;

    if squeezed like '%' || regexp_replace(term, '([a-z])\1+', '\1', 'g') || '%' then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

create or replace function public.enforce_match_comment_profanity()
returns trigger
language plpgsql
as $$
begin
  if public.contains_profanity(new.body) then
    raise exception 'Your comment contains inappropriate language. Please edit it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_match_comment_profanity_trigger on public.match_comments;
create trigger enforce_match_comment_profanity_trigger
before insert or update of body on public.match_comments
for each row execute function public.enforce_match_comment_profanity();

create or replace function public.enforce_clip_comment_profanity()
returns trigger
language plpgsql
as $$
begin
  if public.contains_profanity(new.content) then
    raise exception 'Your comment contains inappropriate language. Please edit it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_clip_comment_profanity_trigger on public.clip_comments;
create trigger enforce_clip_comment_profanity_trigger
before insert or update of content on public.clip_comments
for each row execute function public.enforce_clip_comment_profanity();

create or replace function public.enforce_clip_public_text_profanity()
returns trigger
language plpgsql
as $$
begin
  if public.contains_profanity(new.title)
     or public.contains_profanity(new.caption)
     or public.contains_profanity(new.description) then
    raise exception 'Your post contains inappropriate language. Please edit it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_clip_public_text_profanity_trigger on public.clips;
create trigger enforce_clip_public_text_profanity_trigger
before insert or update of title, caption, description on public.clips
for each row execute function public.enforce_clip_public_text_profanity();

grant execute on function public.contains_profanity(text) to authenticated;
