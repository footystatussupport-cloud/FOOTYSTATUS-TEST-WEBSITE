-- =============================================================================
-- Player profiles: replace the Website link with a Highlight Reel link
-- =============================================================================
-- Player accounts now store an external highlight video link (YouTube, Vimeo,
-- Hudl, Google Drive, ...) instead of a generic website.
--
--   1. Allow the new 'highlight_reel' contact type on public.user_contacts.
--   2. Repurpose each PLAYER account's existing 'website' row by renaming its
--      contact_type to 'highlight_reel' — the saved value is preserved exactly,
--      so no existing player profile loses its link.
--
-- Scope: PLAYER accounts only. Team / club / school / coach / staff / scout /
-- referee / parent website rows are left completely untouched, as are every
-- account type's Instagram / TikTok / YouTube rows.
--
-- Safe to run repeatedly (idempotent). Deletes nothing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Allow the new contact type.
-- ---------------------------------------------------------------------------
alter table public.user_contacts
  drop constraint if exists user_contacts_contact_type_check;

alter table public.user_contacts
  add constraint user_contacts_contact_type_check check (
    contact_type in (
      'player_email',
      'player_phone',
      'coach_email',
      'coach_phone',
      'highlight_reel',
      'instagram',
      'tiktok',
      'youtube',
      'website'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Repurpose existing PLAYER website rows as their highlight reel link.
--    Only rows belonging to a player account are touched, and only when that
--    player does not already have a highlight_reel row (so the unique
--    (user_id, contact_type) index can never be violated and a real highlight
--    reel is never overwritten by an old website value).
-- ---------------------------------------------------------------------------
update public.user_contacts uc
set contact_type = 'highlight_reel',
    updated_at = now()
where uc.contact_type = 'website'
  and exists (
    select 1
    from public.profiles p
    where p.user_id = uc.user_id
      and (
        lower(coalesce(p.account_role, '')) = 'player'
        or lower(coalesce(p.account_category, '')) = 'player'
        or lower(coalesce(p.role::text, '')) = 'player'
      )
  )
  and not exists (
    select 1
    from public.user_contacts existing
    where existing.user_id = uc.user_id
      and existing.contact_type = 'highlight_reel'
  );

-- =============================================================================
-- ROLLBACK (manual, if ever needed):
--   update public.user_contacts set contact_type = 'website'
--     where contact_type = 'highlight_reel';
--   alter table public.user_contacts drop constraint user_contacts_contact_type_check;
--   alter table public.user_contacts add constraint user_contacts_contact_type_check
--     check (contact_type in ('player_email','player_phone','coach_email',
--       'coach_phone','instagram','tiktok','youtube','website'));
-- =============================================================================
