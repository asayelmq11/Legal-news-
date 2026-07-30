-- =============================================================================
-- DEVELOPMENT AND TEST FIXTURES — NOT A MIGRATION
--
-- ┌────────────────────────────────────────────────────────────────────────────┐
-- │ NEVER RUN THIS AGAINST PRODUCTION.                                         │
-- │                                                                            │
-- │ These are INVENTED legal updates. They are plausible-looking Arabic legal  │
-- │ text attributed to real authorities, which is exactly the kind of content  │
-- │ that must never reach a real archive a lawyer relies on. Every row is      │
-- │ marked with ai_model = 'FIXTURE' and a source_url on a .invalid host so    │
-- │ that a stray row is trivially identifiable and can never resolve.          │
-- │                                                                            │
-- │ This file lives outside supabase/migrations/ so `supabase db push` cannot  │
-- │ pick it up.                                                                │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- Purpose: exercise the M5 archive query paths — search, every filter,
-- pagination boundaries, timeline grouping, and the unsafe-link warning.
--
-- Deliberately included edge cases:
--   * unvocalised and vocalised spellings of the same term
--   * teh marbuta / hamza variants that only match after normalisation
--   * NULL effective_date (the AI is instructed never to guess one)
--   * a row whose source_url host is NOT in its source's allowed_domains,
--     to prove the detail page refuses to render it as a link
--   * confidence values spanning the range, for the admin-only filter
-- =============================================================================

-- A dedicated fixture source, so fixture rows never attach to a real authority.
insert into public.sources (
  country, authority_ar, authority_en, source_type, base_url,
  parser_type, parser_config, allowed_domains, priority, active, config_status, notes
) values
  ('SA', 'مصدر تجريبي — بيانات وهمية', 'ZZ Fixture Source', 'government',
   'https://fixture-archive.invalid', 'unknown', '{}'::jsonb,
   array['fixture-archive.invalid'], 5, false, 'pending_verification',
   'FIXTURE ONLY — not a real authority. Used by supabase/fixtures/dev_legal_updates.sql.')
on conflict (country, authority_en) do nothing;

insert into public.legal_updates (
  source_id, content_hash, source_url, title_ar, summary_ar,
  country, category, document_type, legal_status, is_legal_update, confidence,
  effective_date, publication_date, affected_entities, keywords, raw_excerpt, ai_model
)
select
  s.id, v.content_hash, v.source_url, v.title_ar, v.summary_ar,
  v.country::public.country_code, v.category::public.legal_category,
  v.document_type::public.document_type, v.legal_status::public.legal_status,
  true, v.confidence,
  v.effective_date, v.publication_date,
  v.affected_entities, v.keywords, v.raw_excerpt, 'FIXTURE'
from public.sources s,
(values
  -- ── tax / Saudi ─────────────────────────────────────────────────────────
  (repeat('a1', 32), 'https://fixture-archive.invalid/1',
   'تعديل أحكام اللائحة التنفيذية لنظام ضريبة القيمة المضافة',
   'صدر قرار بتعديل عدد من أحكام اللائحة التنفيذية لنظام ضريبة القيمة المضافة، ويشمل التعديل أحكام الفوترة الإلكترونية ومواعيد الإقرار.',
   'SA','tax','executive_regulation','amended', 0.97,
   date '2026-09-01', date '2026-07-20',
   array['المنشآت الخاضعة للضريبة','مقدمو الخدمات المالية'],
   array['ضريبة القيمة المضافة','فوترة إلكترونية'],
   'نص المصدر الأصلي كما ورد دون تعديل.'),

  -- unvocalised spelling of the same terms: only matches after normalisation
  (repeat('a2', 32), 'https://fixture-archive.invalid/2',
   'اللائحه التنفيذيه لنظام العمل — تعديلات على احكام ساعات العمل',
   'تعديلات تتعلق باحكام ساعات العمل الاضافيه وضوابط العمل عن بعد.',
   'SA','employment','executive_regulation','effective', 0.93,
   date '2026-08-15', date '2026-07-18',
   array['أصحاب العمل','العاملون'],
   array['نظام العمل','ساعات العمل'],
   'نص المصدر الأصلي.'),

  -- fully vocalised: must match an unvocalised query
  (repeat('a3', 32), 'https://fixture-archive.invalid/3',
   'مَرْسُومٌ مَلَكِيٌّ بِالْمُوَافَقَةِ عَلَى نِظَامِ حِمَايَةِ الْبَيَانَاتِ الشَّخْصِيَّةِ',
   'الموافقة على نظام حماية البيانات الشخصية وتحديد الجهة المختصة بالإشراف على تطبيقه.',
   'SA','data_privacy','royal_decree','enacted', 0.99,
   null, date '2026-07-15',
   array['جميع المنشآت'],
   array['حماية البيانات','خصوصية'],
   'نص المصدر الأصلي.'),

  -- same publication date as the next row → exercises timeline grouping
  (repeat('a4', 32), 'https://fixture-archive.invalid/4',
   'تعميم بشأن ضوابط الأمن السيبراني للمؤسسات المالية',
   'إلزام المؤسسات المالية بتطبيق الضوابط الأساسية للأمن السيبراني خلال مهلة محددة.',
   'SA','cybersecurity','circular','effective', 0.95,
   date '2026-10-01', date '2026-07-15',
   array['البنوك','شركات التأمين'],
   array['الأمن السيبراني','امتثال'],
   'نص المصدر الأصلي.'),

  -- ── UAE ─────────────────────────────────────────────────────────────────
  (repeat('b1', 32), 'https://fixture-archive.invalid/5',
   'قرار مجلس الوزراء بشأن ضريبة الشركات على الكيانات الحرة',
   'توضيح معاملة الكيانات المؤهلة في المناطق الحرة لأغراض ضريبة الشركات.',
   'AE','tax','ministerial_decision','effective', 0.96,
   date '2026-09-15', date '2026-07-12',
   array['المناطق الحرة','الشركات المؤهلة'],
   array['ضريبة الشركات','مناطق حرة'],
   'نص المصدر الأصلي.'),

  (repeat('b2', 32), 'https://fixture-archive.invalid/6',
   'مشروع لائحة تنظيم الأصول الافتراضية — مطروح للاستطلاع',
   'طرح مشروع لائحة تنظيمية للأصول الافتراضية لاستطلاع آراء العموم قبل الإصدار.',
   'AE','financial','consultation_draft','draft', 0.91,
   null, date '2026-07-10',
   array['مقدمو خدمات الأصول الافتراضية'],
   array['أصول افتراضية','استطلاع'],
   'نص المصدر الأصلي.'),

  -- ── Kuwait / Qatar / Oman / Bahrain / GCC ───────────────────────────────
  (repeat('c1', 32), 'https://fixture-archive.invalid/7',
   'تعليمات بنك الكويت المركزي بشأن الحد الأقصى لنسبة التمويل',
   'تحديث التعليمات الرقابية المتعلقة بنسب التمويل العقاري للأفراد.',
   'KW','banking','circular','effective', 0.94,
   date '2026-08-01', date '2026-07-08',
   array['البنوك المحلية'],
   array['تمويل عقاري','رقابة مصرفية'],
   'نص المصدر الأصلي.'),

  (repeat('d1', 32), 'https://fixture-archive.invalid/8',
   'قرار هيئة قطر للأسواق المالية بشأن إفصاح الشركات المدرجة',
   'تحديث متطلبات الإفصاح الدوري للشركات المدرجة في البورصة.',
   'QA','capital_markets','ministerial_decision','effective', 0.92,
   date '2026-09-30', date '2026-07-05',
   array['الشركات المدرجة'],
   array['إفصاح','أسواق مالية'],
   'نص المصدر الأصلي.'),

  (repeat('e1', 32), 'https://fixture-archive.invalid/9',
   'مرسوم سلطاني بإصدار قانون المنافسة ومنع الاحتكار',
   'إصدار قانون المنافسة ومنع الاحتكار وتحديد الجهة المختصة بتطبيقه.',
   'OM','competition','royal_decree','enacted', 0.98,
   date '2026-11-01', date '2026-07-03',
   array['جميع المنشآت التجارية'],
   array['منافسة','احتكار'],
   'نص المصدر الأصلي.'),

  (repeat('f1', 32), 'https://fixture-archive.invalid/10',
   'قرار مصرف البحرين المركزي بتحديث متطلبات كفاية رأس المال',
   'تحديث متطلبات كفاية رأس المال للمصارف التقليدية والإسلامية.',
   'BH','banking','regulatory_framework','effective', 0.90,
   date '2026-12-31', date '2026-07-01',
   array['المصارف'],
   array['كفاية رأس المال','بازل'],
   'نص المصدر الأصلي.'),

  (repeat('ae', 32), 'https://fixture-archive.invalid/11',
   'النظام الموحد لحماية المستهلك في دول مجلس التعاون',
   'اعتماد النظام الموحد لحماية المستهلك ليطبق في دول المجلس بعد إقراره محلياً.',
   'GCC','trade','law','enacted', 0.96,
   null, date '2026-06-28',
   array['التجار','المستهلكون'],
   array['حماية المستهلك','نظام موحد'],
   'نص المصدر الأصلي.'),

  -- ── low confidence: below the 0.90 gate. Storable, because the threshold is
  --    an n8n decision, not a database constraint. Exercises the admin filter.
  (repeat('bd', 32), 'https://fixture-archive.invalid/12',
   'إعلان عن تحديث تنظيمي محتمل',
   'محتوى غير واضح التصنيف، أُدرج هنا لاختبار مرشّح الثقة الخاص بالمسؤولين.',
   'SA','general','official_notice','pending', 0.42,
   null, date '2026-06-25',
   array[]::text[],
   array['اختبار'],
   'نص المصدر الأصلي.'),

  -- ── UNSAFE LINK: host is NOT in the fixture source's allowed_domains.
  --    The detail page must refuse to render this as a clickable link.
  (repeat('ce', 32), 'https://totally-unrelated-host.invalid/attack',
   'تحديث برابط خارج النطاقات المعتمدة',
   'صف هذا التحديث رابطاً لا ينتمي إلى نطاقات المصدر، لاختبار رفض الروابط غير الموثوقة.',
   'SA','general','official_notice','enacted', 0.95,
   null, date '2026-06-20',
   array[]::text[],
   array['اختبار الروابط'],
   'نص المصدر الأصلي.')
) as v(content_hash, source_url, title_ar, summary_ar, country, category,
       document_type, legal_status, confidence, effective_date, publication_date,
       affected_entities, keywords, raw_excerpt)
where s.authority_en = 'ZZ Fixture Source'
on conflict (content_hash) do nothing;

-- Bulk filler so pagination boundaries are exercised with more than one page.
insert into public.legal_updates (
  source_id, content_hash, source_url, title_ar, summary_ar,
  country, category, document_type, legal_status, is_legal_update, confidence,
  publication_date, raw_excerpt, ai_model
)
select
  s.id,
  lpad(to_hex(900000 + n), 64, '0'),
  'https://fixture-archive.invalid/bulk/' || n,
  'تحديث تنظيمي تجريبي رقم ' || n,
  'ملخص تجريبي لأغراض اختبار الترقيم والتصفح في الأرشيف.',
  'SA', 'general', 'circular', 'enacted', true, 0.95,
  date '2026-06-19' - n,
  'نص تجريبي.', 'FIXTURE'
from public.sources s, generate_series(1, 30) as n
where s.authority_en = 'ZZ Fixture Source'
on conflict (content_hash) do nothing;
