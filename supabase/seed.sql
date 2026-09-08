-- =============================================================================
-- seed.sql — Startdaten (Rollen-Whitelist, Schnellauswahl-Beträge)
-- =============================================================================
-- Läuft nach 0001–0004. Mehrfaches Ausführen ist unschädlich.
--
-- WICHTIG — vor dem Einspielen ersetzen:
--   ADMIN_EMAIL_1 / ADMIN_EMAIL_2 / ADMIN_EMAIL_3 sind Platzhalter.
--   Ersetze sie durch die echten Gmail-Adressen (Suchen & Ersetzen im Editor).
--   Nicht benötigte Zeilen einfach löschen.
--
-- Echte Adressen gehören NICHT in Git. Zwei Wege:
--   a) Diese Datei nur im SQL-Editor bearbeiten, nicht speichern/committen.
--   b) Eine Kopie als `supabase/seed.local.sql` anlegen (ist in .gitignore) und
--      die echten Adressen dort eintragen.
--
-- Das `lower(...)` ist Absicht: `role_whitelist.email` hat einen Check
-- `email = lower(email)`, und Google liefert Adressen gern gemischt.
--
-- Wirkung: Beim ERSTEN Login eines Google-Kontos setzt der Trigger
-- handle_new_auth_user() die hier hinterlegte Rolle. Wer schon eingeloggt war,
-- behält seine Rolle in `app_users` — die ändert ein Admin in der App
-- (bzw. per UPDATE unten, siehe „Nachträglich hochstufen“).
-- =============================================================================

insert into public.role_whitelist (email, role, note) values
  (lower('ADMIN_EMAIL_1'), 'admin', 'Platzhalter – vor dem Einspielen ersetzen'),
  (lower('ADMIN_EMAIL_2'), 'admin', 'Platzhalter – vor dem Einspielen ersetzen'),
  (lower('ADMIN_EMAIL_3'), 'admin', 'Platzhalter – vor dem Einspielen ersetzen')
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;

-- Editoren nach Bedarf ergänzen (Kommentarzeichen entfernen und Adresse eintragen):
-- insert into public.role_whitelist (email, role, note) values
--   (lower('EDITOR_EMAIL_1'), 'editor', 'darf erfassen, nicht mit Differenz abschließen')
-- on conflict (email) do update set role = excluded.role, note = excluded.note;

-- -----------------------------------------------------------------------------
-- Schnellauswahl-Beträge für Buy-ins (SPEC 4: Default 50 / 100 / 200 €)
-- -----------------------------------------------------------------------------

insert into public.settings (key, value)
values ('quick_amounts_cents', '[5000,10000,20000]'::jsonb)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Nachträglich hochstufen (nur nötig, wenn sich jemand schon eingeloggt hatte,
-- bevor seine Adresse in der Whitelist stand):
--
--   update public.app_users set role = 'admin' where email = lower('ADMIN_EMAIL_1');
--
-- Kontrolle:
--   select email, role from public.app_users order by role, email;
-- -----------------------------------------------------------------------------
