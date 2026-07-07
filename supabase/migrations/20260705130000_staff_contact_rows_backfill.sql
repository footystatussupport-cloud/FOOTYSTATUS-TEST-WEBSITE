-- Coach / staff contact information lives exclusively in the privacy-controlled
-- Contact Information section (user_contacts + can_view_contact_info).
-- Backfill rows for staff accounts created after the original 20260619143000
-- backfill so their signup contact info appears there (idempotent).

insert into public.user_contacts (user_id, contact_type, value, visibility)
select sp.user_id, 'coach_email', lower(trim(sp.contact_email)),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.staff_profiles sp
left join public.user_settings us on us.user_id = sp.user_id
where sp.user_id is not null and nullif(trim(sp.contact_email), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select sp.user_id, 'coach_phone', trim(sp.contact_phone),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.staff_profiles sp
left join public.user_settings us on us.user_id = sp.user_id
where sp.user_id is not null and nullif(trim(sp.contact_phone), '') is not null
on conflict (user_id, contact_type) do nothing;
