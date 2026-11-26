-- 2026-11-26: someone who joined through the private-test shortcut and was later approved through a
-- real ID review kept the test flag, so they'd be blocked as soon as test mode is switched off
-- (owner saw "Баталгаажлаа! Одоо ажил авч болно." but couldn't work). A real approval wins.
update public.profiles p
   set test_helper = false
 where p.test_helper
   and exists (
     select 1 from public.helper_applications a
      where a.user_id = p.id and a.purpose = 'helper' and a.status = 'approved'
   );
