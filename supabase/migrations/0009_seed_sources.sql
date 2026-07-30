-- =============================================================================
-- 0009 — Trusted source registry seed
--
-- ┌─ READ THIS BEFORE ACTIVATING ANYTHING ─────────────────────────────────────┐
-- │                                                                            │
-- │ Every row is seeded with:                                                  │
-- │     parser_type   = 'unknown'                                              │
-- │     parser_config = '{}'                                                   │
-- │     config_status = 'pending_verification'                                 │
-- │     active        = false                                                  │
-- │                                                                            │
-- │ This is deliberate and required, not an oversight.                         │
-- │                                                                            │
-- │ Selectors, feed URLs and API mappings CANNOT be authored without loading   │
-- │ each site and reading its markup. Inventing them would produce a registry   │
-- │ that looks complete, silently scrapes the wrong elements, and feeds the AI  │
-- │ garbage that the Publishing Gate would then wave through — the archive      │
-- │ would fill with plausible nonsense attributed to a real ministry.           │
-- │                                                                            │
-- │ So this migration seeds only what can be stated with confidence: the        │
-- │ authority, its official domain, its classification, and how often it is     │
-- │ worth polling. Everything mechanical is left blank and explicitly marked.   │
-- │                                                                            │
-- │ Activation procedure is in supabase/SOURCE_REGISTRY.md. In short: open the  │
-- │ site, confirm the domain, find the feed or the listing markup, fill in      │
-- │ parser_type and parser_config, set config_status = 'verified', then set     │
-- │ active = true. The sources_no_active_pending constraint enforces that       │
-- │ order — an unverified source physically cannot be switched on.              │
-- │                                                                            │
-- │ Priorities and poll intervals ARE meaningful and can be relied upon.        │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- poll_interval_minutes: NULL means "use the priority tier default" from
-- app_settings.ingestion.priority_intervals. It is set explicitly only where a
-- source's real publication rhythm differs from its tier — a gazette that comes
-- out weekly does not deserve hourly polling.
--
-- Idempotent via ON CONFLICT on the (country, authority_en) natural key, so
-- re-running never disturbs a source an admin has since verified and tuned.
-- =============================================================================

insert into public.sources (
  country, authority_ar, authority_en, source_type, base_url,
  parser_type, parser_config, allowed_domains,
  priority, poll_interval_minutes, active, config_status, notes
) values

-- ═══════════════════════════ SAUDI ARABIA ═══════════════════════════════════
('SA', 'أم القرى — الجريدة الرسمية', 'Umm Al-Qura Official Gazette', 'official_gazette',
 'https://www.uqn.gov.sa', 'unknown', '{}'::jsonb,
 array['www.uqn.gov.sa','uqn.gov.sa'], 1, 720, false, 'pending_verification',
 'الجريدة الرسمية للمملكة. تصدر أسبوعياً (الجمعة) — لذلك فترة الاستطلاع 12 ساعة بدلاً من ساعة. ISSUES ARE PUBLISHED AS PDF: expect the PDF enrichment stage to carry the substance, and archive the original to Storage.'),

('SA', 'هيئة الخبراء بمجلس الوزراء', 'Bureau of Experts at the Council of Ministers', 'government',
 'https://laws.boe.gov.sa', 'unknown', '{}'::jsonb,
 array['laws.boe.gov.sa','boe.gov.sa'], 1, null, false, 'pending_verification',
 'البوابة الرسمية للأنظمة واللوائح السعودية. المرجع الأدق للنص النظامي. Many entries link to PDF copies of the instrument.'),

('SA', 'وزارة العدل', 'Ministry of Justice', 'government',
 'https://www.moj.gov.sa', 'unknown', '{}'::jsonb,
 array['www.moj.gov.sa','moj.gov.sa'], 2, null, false, 'pending_verification',
 'التعاميم القضائية والمبادئ القضائية. Judicial circulars are frequently PDF attachments.'),

('SA', 'وزارة التجارة', 'Ministry of Commerce', 'government',
 'https://mc.gov.sa', 'unknown', '{}'::jsonb,
 array['mc.gov.sa','www.mc.gov.sa'], 2, null, false, 'pending_verification',
 'أنظمة الشركات والسجل التجاري والغش التجاري.'),

('SA', 'وزارة الموارد البشرية والتنمية الاجتماعية', 'Ministry of Human Resources and Social Development', 'government',
 'https://www.hrsd.gov.sa', 'unknown', '{}'::jsonb,
 array['www.hrsd.gov.sa','hrsd.gov.sa'], 2, null, false, 'pending_verification',
 'أنظمة العمل والسعودة والقرارات الوزارية المتعلقة بالعمالة.'),

('SA', 'هيئة الزكاة والضريبة والجمارك', 'Zakat, Tax and Customs Authority (ZATCA)', 'regulator',
 'https://zatca.gov.sa', 'unknown', '{}'::jsonb,
 array['zatca.gov.sa','www.zatca.gov.sa'], 1, null, false, 'pending_verification',
 'الضريبة والزكاة والجمارك — مصدر عالي الأولوية. Guidelines and rulings are usually PDF; the site is behind a WAF that rejects datacentre IPs, so n8n may need an allow-listed egress address.'),

('SA', 'البنك المركزي السعودي', 'Saudi Central Bank (SAMA)', 'regulator',
 'https://www.sama.gov.sa', 'unknown', '{}'::jsonb,
 array['www.sama.gov.sa','sama.gov.sa'], 1, null, false, 'pending_verification',
 'التعاميم والقواعد الرقابية للبنوك والتأمين والتمويل. Circulars are predominantly PDF.'),

('SA', 'هيئة السوق المالية', 'Capital Market Authority (CMA)', 'regulator',
 'https://cma.org.sa', 'unknown', '{}'::jsonb,
 array['cma.org.sa','www.cma.org.sa'], 1, null, false, 'pending_verification',
 'لوائح السوق المالية وقرارات المجلس. Note the .org.sa domain, not .gov.sa.'),

('SA', 'الهيئة السعودية للملكية الفكرية', 'Saudi Authority for Intellectual Property (SAIP)', 'regulator',
 'https://www.saip.gov.sa', 'unknown', '{}'::jsonb,
 array['www.saip.gov.sa','saip.gov.sa'], 3, null, false, 'pending_verification',
 'أنظمة ولوائح الملكية الفكرية.'),

('SA', 'المركز الوطني للتنافسية', 'National Competitiveness Center', 'government',
 'https://www.ncc.gov.sa', 'unknown', '{}'::jsonb,
 array['www.ncc.gov.sa','ncc.gov.sa'], 3, null, false, 'pending_verification',
 'الإصلاحات التنظيمية ومنصة استطلاع الآراء. Consultation drafts appear here first.'),

('SA', 'الهيئة العامة للمنافسة', 'General Authority for Competition', 'regulator',
 'https://gac.gov.sa', 'unknown', '{}'::jsonb,
 array['gac.gov.sa','www.gac.gov.sa'], 2, null, false, 'pending_verification',
 'نظام المنافسة وقرارات التركزات الاقتصادية.'),

('SA', 'الهيئة السعودية للبيانات والذكاء الاصطناعي', 'Saudi Data and AI Authority (SDAIA)', 'regulator',
 'https://sdaia.gov.sa', 'unknown', '{}'::jsonb,
 array['sdaia.gov.sa','www.sdaia.gov.sa'], 2, null, false, 'pending_verification',
 'نظام حماية البيانات الشخصية ولوائحه التنفيذية — المرجع لحماية البيانات في المملكة.'),

('SA', 'الهيئة الوطنية للأمن السيبراني', 'National Cybersecurity Authority (NCA)', 'regulator',
 'https://nca.gov.sa', 'unknown', '{}'::jsonb,
 array['nca.gov.sa','www.nca.gov.sa'], 2, null, false, 'pending_verification',
 'الضوابط والأطر التنظيمية للأمن السيبراني. Frameworks are published as PDF.'),

-- ═══════════════════════════ KUWAIT ═════════════════════════════════════════
('KW', 'الكويت اليوم — الجريدة الرسمية', 'Kuwait Al-Youm Official Gazette', 'official_gazette',
 'https://e.gov.kw', 'unknown', '{}'::jsonb,
 array['e.gov.kw','www.e.gov.kw'], 1, 720, false, 'pending_verification',
 'BLOCKED PENDING A ROUTE: no public crawlable endpoint was identified. Kuwait Al-Youm is distributed by paid electronic subscription and a mobile app published by the Ministry of Information; the e.gov.kw entry is the subscription service, not a readable index. An ingestion route must be agreed with the Legal Department before this source can be verified — it may require a subscribed account. Do not activate until resolved.'),

('KW', 'وزارة العدل', 'Ministry of Justice', 'government',
 'https://www.moj.gov.kw', 'unknown', '{}'::jsonb,
 array['www.moj.gov.kw','moj.gov.kw'], 2, null, false, 'pending_verification',
 'القرارات الوزارية والأحكام القضائية.'),

('KW', 'الأمانة العامة لمجلس الوزراء', 'General Secretariat of the Council of Ministers', 'government',
 'https://www.cmgs.gov.kw', 'unknown', '{}'::jsonb,
 array['www.cmgs.gov.kw','cmgs.gov.kw'], 2, null, false, 'pending_verification',
 'قرارات مجلس الوزراء والمراسيم.'),

('KW', 'مجلس الأمة', 'National Assembly', 'government',
 'https://www.kna.kw', 'unknown', '{}'::jsonb,
 array['www.kna.kw','kna.kw'], 3, null, false, 'pending_verification',
 'مشاريع القوانين والمداولات التشريعية. Draft legislation — expect legal_status = draft.'),

('KW', 'الهيئة العامة للقوى العاملة', 'Public Authority for Manpower', 'regulator',
 'https://www.manpower.gov.kw', 'unknown', '{}'::jsonb,
 array['www.manpower.gov.kw','manpower.gov.kw'], 3, null, false, 'pending_verification',
 'قرارات العمالة الوافدة وتصاريح العمل.'),

('KW', 'وزارة التجارة والصناعة', 'Ministry of Commerce and Industry', 'government',
 'https://www.moci.gov.kw', 'unknown', '{}'::jsonb,
 array['www.moci.gov.kw','moci.gov.kw'], 2, null, false, 'pending_verification',
 'قرارات الشركات والتراخيص التجارية.'),

('KW', 'هيئة أسواق المال', 'Capital Markets Authority', 'regulator',
 'https://www.cma.gov.kw', 'unknown', '{}'::jsonb,
 array['www.cma.gov.kw','cma.gov.kw'], 1, null, false, 'pending_verification',
 'اللوائح التنفيذية لقانون هيئة أسواق المال.'),

('KW', 'بنك الكويت المركزي', 'Central Bank of Kuwait', 'regulator',
 'https://www.cbk.gov.kw', 'unknown', '{}'::jsonb,
 array['www.cbk.gov.kw','cbk.gov.kw'], 1, null, false, 'pending_verification',
 'التعليمات الرقابية للبنوك وشركات التمويل.'),

-- ═══════════════════════════ UNITED ARAB EMIRATES ═══════════════════════════
('AE', 'منصة التشريعات — الجريدة الرسمية', 'UAE Legislation Platform', 'official_gazette',
 'https://uaelegislation.gov.ae', 'unknown', '{}'::jsonb,
 array['uaelegislation.gov.ae','www.uaelegislation.gov.ae'], 1, null, false, 'pending_verification',
 'المنصة الموحدة للتشريعات الاتحادية، تديرها الأمانة العامة لمجلس الوزراء. Bilingual AR/EN; the authoritative federal source.'),

('AE', 'وزارة العدل', 'Ministry of Justice', 'government',
 'https://www.moj.gov.ae', 'unknown', '{}'::jsonb,
 array['www.moj.gov.ae','moj.gov.ae'], 2, null, false, 'pending_verification',
 'القرارات الوزارية والتعاميم القضائية.'),

('AE', 'وزارة الاقتصاد', 'Ministry of Economy', 'government',
 'https://www.moec.gov.ae', 'unknown', '{}'::jsonb,
 array['www.moec.gov.ae','moec.gov.ae'], 2, null, false, 'pending_verification',
 'أنظمة الشركات والوكالات التجارية والملكية الفكرية.'),

('AE', 'مجلس الوزراء', 'UAE Cabinet', 'government',
 'https://uaecabinet.ae', 'unknown', '{}'::jsonb,
 array['uaecabinet.ae','www.uaecabinet.ae'], 2, null, false, 'pending_verification',
 'قرارات مجلس الوزراء الاتحادي.'),

('AE', 'هيئة الأوراق المالية والسلع', 'Securities and Commodities Authority (SCA)', 'regulator',
 'https://www.sca.gov.ae', 'unknown', '{}'::jsonb,
 array['www.sca.gov.ae','sca.gov.ae'], 1, null, false, 'pending_verification',
 'أنظمة الأوراق المالية والقرارات التنظيمية.'),

('AE', 'مصرف الإمارات العربية المتحدة المركزي', 'Central Bank of the UAE', 'regulator',
 'https://www.centralbank.ae', 'unknown', '{}'::jsonb,
 array['www.centralbank.ae','centralbank.ae'], 1, null, false, 'pending_verification',
 'الأنظمة والتعاميم المصرفية ومكافحة غسل الأموال. Note the .ae domain without .gov.'),

('AE', 'الهيئة الاتحادية للضرائب', 'Federal Tax Authority', 'regulator',
 'https://tax.gov.ae', 'unknown', '{}'::jsonb,
 array['tax.gov.ae','www.tax.gov.ae'], 1, null, false, 'pending_verification',
 'ضريبة القيمة المضافة والضريبة الانتقائية وضريبة الشركات. Public clarifications and guides are PDF.'),

('AE', 'سلطة دبي للخدمات المالية', 'Dubai Financial Services Authority (DFSA)', 'regulator',
 'https://www.dfsa.ae', 'unknown', '{}'::jsonb,
 array['www.dfsa.ae','dfsa.ae'], 2, null, false, 'pending_verification',
 'الجهة التنظيمية لمركز دبي المالي العالمي (DIFC) — اختصاص قضائي مستقل. Rulebook modules are PDF.'),

('AE', 'سوق أبوظبي العالمي', 'Abu Dhabi Global Market (ADGM)', 'regulator',
 'https://www.adgm.com', 'unknown', '{}'::jsonb,
 array['www.adgm.com','adgm.com'], 2, null, false, 'pending_verification',
 'اختصاص قضائي مستقل يطبق القانون العام. Commercial .com domain — confirm authenticity at verification.'),

('AE', 'مجلس الأمن السيبراني', 'UAE Cybersecurity Council', 'government',
 'https://csc.gov.ae', 'unknown', '{}'::jsonb,
 array['csc.gov.ae','www.csc.gov.ae'], 3, null, false, 'pending_verification',
 'السياسات والأطر الوطنية للأمن السيبراني. Domain needs confirmation at verification.'),

-- ═══════════════════════════ QATAR ══════════════════════════════════════════
('QA', 'الميزان — البوابة القانونية القطرية', 'Al Meezan Qatari Legal Portal', 'official_gazette',
 'https://www.almeezan.qa', 'unknown', '{}'::jsonb,
 array['www.almeezan.qa','almeezan.qa'], 1, null, false, 'pending_verification',
 'البوابة القانونية الرسمية وتشمل الجريدة الرسمية وأحكام التمييز. Legacy ASP.NET site (.aspx); an OfficialJournalPage view exists. Likely HTML parsing with query-string pagination — verify before configuring.'),

('QA', 'وزارة العدل', 'Ministry of Justice', 'government',
 'https://www.moj.gov.qa', 'unknown', '{}'::jsonb,
 array['www.moj.gov.qa','moj.gov.qa'], 2, null, false, 'pending_verification',
 'القرارات الوزارية والتوثيق والتسجيل العقاري.'),

('QA', 'الأمانة العامة لمجلس الوزراء', 'General Secretariat of the Council of Ministers', 'government',
 'https://www.gco.gov.qa', 'unknown', '{}'::jsonb,
 array['www.gco.gov.qa','gco.gov.qa'], 2, null, false, 'pending_verification',
 'قرارات مجلس الوزراء.'),

('QA', 'مصرف قطر المركزي', 'Qatar Central Bank', 'regulator',
 'https://www.qcb.gov.qa', 'unknown', '{}'::jsonb,
 array['www.qcb.gov.qa','qcb.gov.qa'], 1, null, false, 'pending_verification',
 'التعليمات الرقابية للبنوك وشركات التأمين.'),

('QA', 'هيئة قطر للأسواق المالية', 'Qatar Financial Markets Authority (QFMA)', 'regulator',
 'https://www.qfma.org.qa', 'unknown', '{}'::jsonb,
 array['www.qfma.org.qa','qfma.org.qa'], 1, null, false, 'pending_verification',
 'أنظمة ولوائح الأسواق المالية. Note the .org.qa domain.'),

('QA', 'هيئة تنظيم مركز قطر للمال', 'QFC Regulatory Authority', 'regulator',
 'https://www.qfcra.com', 'unknown', '{}'::jsonb,
 array['www.qfcra.com','qfcra.com'], 2, null, false, 'pending_verification',
 'الجهة التنظيمية لمركز قطر للمال — اختصاص مستقل. Commercial .com domain — confirm at verification.'),

('QA', 'الهيئة العامة للضرائب', 'General Tax Authority', 'regulator',
 'https://www.gta.gov.qa', 'unknown', '{}'::jsonb,
 array['www.gta.gov.qa','gta.gov.qa'], 2, null, false, 'pending_verification',
 'الضريبة على الدخل والقرارات الضريبية.'),

-- ═══════════════════════════ OMAN ═══════════════════════════════════════════
('OM', 'وزارة العدل والشؤون القانونية — الجريدة الرسمية', 'Ministry of Justice and Legal Affairs', 'official_gazette',
 'https://mjla.gov.om', 'unknown', '{}'::jsonb,
 array['mjla.gov.om','www.mjla.gov.om'], 1, null, false, 'pending_verification',
 'الجهة المسؤولة عن إصدار الجريدة الرسمية والمراسيم السلطانية. A /eng/publications/ section exists. GAZETTE ISSUES ARE PDF — the PDF stage will carry the substance.'),

('OM', 'البنك المركزي العماني', 'Central Bank of Oman', 'regulator',
 'https://cbo.gov.om', 'unknown', '{}'::jsonb,
 array['cbo.gov.om','www.cbo.gov.om'], 1, null, false, 'pending_verification',
 'التعاميم واللوائح المصرفية.'),

('OM', 'الهيئة العامة لسوق المال', 'Financial Services Authority', 'regulator',
 'https://fsa.gov.om', 'unknown', '{}'::jsonb,
 array['fsa.gov.om','www.fsa.gov.om'], 1, null, false, 'pending_verification',
 'تنظيم سوق رأس المال والتأمين. Renamed from the Capital Market Authority — confirm the current domain at verification.'),

('OM', 'جهاز الضرائب', 'Oman Tax Authority', 'regulator',
 'https://taxoman.gov.om', 'unknown', '{}'::jsonb,
 array['taxoman.gov.om','www.taxoman.gov.om','tms.taxoman.gov.om'], 2, null, false, 'pending_verification',
 'ضريبة الدخل والقيمة المضافة والانتقائية. A tms. subdomain hosts the tax management system; allow-listed for attachment fetches.'),

('OM', 'وزارة العمل', 'Ministry of Labour', 'government',
 'https://www.mol.gov.om', 'unknown', '{}'::jsonb,
 array['www.mol.gov.om','mol.gov.om'], 3, null, false, 'pending_verification',
 'قانون العمل والقرارات الوزارية المتعلقة بالتعمين.'),

('OM', 'وزارة التجارة والصناعة وترويج الاستثمار', 'Ministry of Commerce, Industry and Investment Promotion', 'government',
 'https://www.moci.gov.om', 'unknown', '{}'::jsonb,
 array['www.moci.gov.om','moci.gov.om'], 3, null, false, 'pending_verification',
 'أنظمة الشركات والسجل التجاري.'),

-- ═══════════════════════════ BAHRAIN ════════════════════════════════════════
('BH', 'هيئة التشريع والرأي القانوني — الجريدة الرسمية', 'Legislation and Legal Opinion Commission', 'official_gazette',
 'https://www.legalaffairs.gov.bh', 'unknown', '{}'::jsonb,
 array['www.legalaffairs.gov.bh','legalaffairs.gov.bh'], 1, null, false, 'pending_verification',
 'الجهة المسؤولة عن الجريدة الرسمية والصياغة التشريعية. Note this commission also operates lloc.gov.bh, registered separately below — confirm at verification whether both need monitoring or one is a mirror.'),

('BH', 'بوابة التشريعات', 'LLOC Legislation Portal', 'government',
 'https://www.lloc.gov.bh', 'unknown', '{}'::jsonb,
 array['www.lloc.gov.bh','lloc.gov.bh'], 1, null, false, 'pending_verification',
 'قاعدة التشريعات والمراسيم والاتفاقيات، مصنفة حسب الموضوع. Possible mirror of legalaffairs.gov.bh — de-duplicate at verification to avoid double-ingesting the same instrument.'),

('BH', 'وزارة العدل والشؤون الإسلامية والأوقاف', 'Ministry of Justice, Islamic Affairs and Endowments', 'government',
 'https://www.moj.gov.bh', 'unknown', '{}'::jsonb,
 array['www.moj.gov.bh','moj.gov.bh'], 2, null, false, 'pending_verification',
 'القرارات الوزارية والأحكام القضائية.'),

('BH', 'مصرف البحرين المركزي', 'Central Bank of Bahrain', 'regulator',
 'https://www.cbb.gov.bh', 'unknown', '{}'::jsonb,
 array['www.cbb.gov.bh','cbb.gov.bh'], 1, null, false, 'pending_verification',
 'كتاب القواعد ‏(Rulebook) والتعاميم الرقابية. Rulebook volumes are PDF.'),

('BH', 'هيئة تنظيم سوق العمل', 'Labour Market Regulatory Authority (LMRA)', 'regulator',
 'https://lmra.gov.bh', 'unknown', '{}'::jsonb,
 array['lmra.gov.bh','www.lmra.gov.bh'], 3, null, false, 'pending_verification',
 'تصاريح العمل وتنظيم سوق العمل.'),

('BH', 'الجهاز الوطني للإيرادات', 'National Bureau for Revenue (NBR)', 'regulator',
 'https://www.nbr.gov.bh', 'unknown', '{}'::jsonb,
 array['www.nbr.gov.bh','nbr.gov.bh'], 2, null, false, 'pending_verification',
 'ضريبة القيمة المضافة والانتقائية. Guides are PDF.'),

-- ═══════════════════════════ GCC-WIDE ═══════════════════════════════════════
('GCC', 'الأمانة العامة لمجلس التعاون لدول الخليج العربية', 'GCC Secretariat General', 'gcc',
 'https://www.gcc-sg.org', 'unknown', '{}'::jsonb,
 array['www.gcc-sg.org','gcc-sg.org'], 3, null, false, 'pending_verification',
 'الأنظمة الموحدة والقرارات الصادرة عن المجلس الأعلى والمجلس الوزاري. Unified GCC instruments that member states then enact locally.'),

('GCC', 'هيئة التقييس لدول مجلس التعاون', 'GCC Standardization Organization (GSO)', 'gcc',
 'https://www.gso.org.sa', 'unknown', '{}'::jsonb,
 array['www.gso.org.sa','gso.org.sa'], 4, null, false, 'pending_verification',
 'اللوائح الفنية الخليجية الملزمة. Hosted on a .org.sa domain despite being a GCC body — confirm at verification.')

on conflict (country, authority_en) do nothing;
