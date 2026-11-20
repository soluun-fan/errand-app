update public.profiles
set desktop_work_enabled = false
where desktop_work_enabled;

delete from public.desktop_work_notice_preferences;
