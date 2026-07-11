-- Extra fixture fields the Footy Status admin can edit: competition structure,
-- timezone, additional officials, and match-day details. Admin-only, no lock.

alter table public.matches
  add column if not exists match_week text,
  add column if not exists group_name text,
  add column if not exists knockout_round text,
  add column if not exists timezone text,
  add column if not exists assistant_referee_1 text,
  add column if not exists assistant_referee_2 text,
  add column if not exists fourth_official text,
  add column if not exists weather text,
  add column if not exists attendance integer;

create or replace function public.update_match_extra_details(
  _match_id uuid,
  _match_week text default null,
  _group_name text default null,
  _knockout_round text default null,
  _timezone text default null,
  _assistant_referee_1 text default null,
  _assistant_referee_2 text default null,
  _fourth_official text default null,
  _weather text default null,
  _attendance integer default null
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row public.matches;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can edit fixtures.';
  end if;

  update public.matches
  set match_week = _match_week,
      group_name = _group_name,
      knockout_round = _knockout_round,
      timezone = _timezone,
      assistant_referee_1 = _assistant_referee_1,
      assistant_referee_2 = _assistant_referee_2,
      fourth_official = _fourth_official,
      weather = _weather,
      attendance = _attendance,
      updated_at = now()
  where id = _match_id
  returning * into result_row;

  if result_row.id is null then
    raise exception 'Match not found.';
  end if;

  return result_row;
end;
$$;

grant execute on function public.update_match_extra_details(uuid, text, text, text, text, text, text, text, text, integer) to authenticated;
