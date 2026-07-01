create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  /*
    Google OAuth creates an auth.users row as soon as the user chooses a
    Google account. That auth row is only a login shell and must not become a
    Footy Status account yet.

    Footy Status profiles, roles, usernames, Explore visibility, and
    account-specific records are created only by finish_account_onboarding()
    after the user presses Create Account on the signup questionnaire.
  */
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
