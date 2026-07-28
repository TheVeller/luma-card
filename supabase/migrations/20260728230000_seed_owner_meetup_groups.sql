-- Seed the owner's Peru Meetup catalog after the provider-neutral sync adapter
-- is deployed. The marker makes this safe to re-run without requeueing a full
-- historical import that has already been requested.
DO $$
DECLARE
  v_user_id uuid;
  v_source record;
  v_row_id uuid;
  v_already_seeded boolean;
  v_provider_source_id text;
  v_calendar_url text;
BEGIN
  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE lower(email) = 'ivelasquezfr@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Owner account ivelasquezfr@gmail.com was not found';
  END IF;

  FOR v_source IN
    SELECT *
    FROM (VALUES
      (1, 'AWS SBG at UNTELS', 'aws-sbg-at-universidad-nacional-tecnologica-de-lima-sur', 'scr-meetup-6mwmnw'),
      (2, 'AWS SBG at Universidad Tecnológica del Perú', 'aws-sbg-at-universidad-tecnologica-del-peru', 'scr-meetup-wc3n1s'),
      (3, 'AWS SBG at UPC', 'aws-sbg-at-upc', 'scr-meetup-8lbqt6'),
      (4, 'AWS SBG at Pontificia Universidad Católica del Perú', 'aws-sbg-at-pontificia-universidad-catolica-del-peru', 'scr-meetup-qg0jph'),
      (5, 'AWS SBG at University of Engineering & Technology Peru', 'aws-sbg-at-university-of-engineering-technology-peru', 'scr-meetup-5vetvk'),
      (6, 'AWS SBG at Universidad Nacional Mayor de San Marcos', 'aws-sbg-at-universidad-nacional-mayor-de-san-marcos', 'scr-meetup-q2c0cu'),
      (7, 'AWS User Group Peru', 'awsperu', 'scr-meetup-9150pi'),
      (8, 'AWS SBG at National University of Engineering', 'aws-sbg-at-national-university-of-engineering', 'scr-meetup-u7f7ld'),
      (9, 'AWS Girls Perú', 'aws-girls-peru', 'scr-meetup-pcxs9d'),
      (10, 'AWS UG Machine Learning Latam', 'aws-ug-machine-learning-latam', 'scr-meetup-vppa76'),
      (11, 'Red Hat User Group Perú', 'red-hat-user-group-peru', 'scr-meetup-wtw78d'),
      (12, 'Comunidad Power Platform Perú', 'power-platform-peru', 'scr-meetup-175gll'),
      (13, 'Cloud Experts Community', 'cloudexpertsc', 'scr-meetup-akzsno'),
      (14, 'Security Grid Lima', 'security-grid-lima', 'scr-meetup-7k3qqy'),
      (15, 'Perú .NET Development', 'perunetdevelopment', 'scr-meetup-o93ekr'),
      (16, 'Peru BI and Analytics Group', 'meetup-group-bgnfjlvh', 'scr-meetup-ib5tbr'),
      (17, 'Microsoft User Group Perú', 'msperu', 'scr-meetup-beu1kl'),
      (18, 'Lima Databricks User Group', 'lima-databricks-user-group', 'scr-meetup-83fj25'),
      (19, 'OWASP Lima Chapter', 'owasp-lima-meetup-group', 'scr-meetup-xb6b0g'),
      (20, 'Gestión-Calidad de SW-TI-TransformaciónDigital-Innovación-IA', 'gestion-calidad-de-sw-ti-transformaciondigital-innovacion-bp', 'scr-meetup-kibpep'),
      (21, 'Infinite Pathways', 'infinite-pathways', 'scr-meetup-nxcc8t'),
      (22, 'Hack The Box Meetup: Lima, PE', 'hack-the-box-meetup-lima-pe', 'scr-meetup-1ks6u1'),
      (23, 'Googleenloqueciendo', 'googleenloqueciendo', 'scr-meetup-t8abk9'),
      (24, 'BI Expert', 'bi-expert', 'scr-meetup-a1jao1'),
      (25, 'San Antonio Atlassian User Group', 'lima-ace', 'scr-meetup-5l5l2g'),
      (26, 'Ova Cognition', 'ovacognition', 'scr-meetup-li023j'),
      (27, 'Grupos de Usuarios de Python en Lima - Perú', 'grupos-de-usuarios-de-python-en-lima-peru', 'scr-meetup-oeinjf'),
      (28, 'ProductTank Lima', 'producttank-lima', 'scr-meetup-wiy7rm'),
      (29, 'My Agents LATAM', 'my-agents-latam', 'scr-meetup-psfji8'),
      (30, 'LFDT Perú', 'lfdt-peru', 'scr-meetup-kwlpz6'),
      (31, 'Perú Java User Group', 'peru-java-user-group', 'scr-meetup-8geslc'),
      (32, 'Agile Hunter - Perú', 'agile-lima', 'scr-meetup-lp45b3'),
      (33, 'Comunidad Python Lima', 'comunidad-python-lima', 'scr-meetup-n2sgv2'),
      (34, 'Python Peru', 'pythonperu', 'scr-meetup-crnkzx'),
      (35, 'Advanced AI Concepts-Lima', 'advanced-ai-concepts-lima', 'scr-meetup-tlmm88'),
      (36, 'Takernal Community', 'takernal-community-peru', 'scr-meetup-ep2m78'),
      (37, 'tech night! (lima edition)', 'tech-night-lima-edition', 'scr-meetup-a99125'),
      (38, 'AWS User Group: Chaclacayo', 'aws-user-group-chaclacayo', 'scr-meetup-983f57'),
      (39, 'AI Community LATAM', 'ai-community-latam', 'scr-meetup-bj8lrt'),
      (40, 'AWS Security Users Group LatAm', 'awssecuritylatam', 'scr-meetup-22z10f'),
      (41, 'IBM Developers Perú', 'ibm-developers-peru', 'scr-meetup-gfl3jq'),
      (42, 'Power BI User Group Lima', 'power-bi-user-group-lima', 'scr-meetup-l5xjg6'),
      (43, 'Lima Tech Connections', 'lima-tech-connections', 'scr-meetup-yz3kj1'),
      (44, 'Lima Apache Kafka® Meetup by Confluent', 'lima-kafka', 'scr-meetup-nipo4j'),
      (45, 'Perú Rust User Group', 'peru-rust-user-group', 'scr-meetup-mebf9o'),
      (46, 'LimaJS', 'limajs', 'scr-meetup-c99g0h'),
      (47, 'Flutter Lima', 'flutter-lima', 'scr-meetup-wepj51'),
      (48, 'AWS para todos', 'aws-para-todos', 'scr-meetup-4r83dr'),
      (49, 'DevOps Perú', 'devops-peru', 'scr-meetup-4gukp5'),
      (50, 'Barcamp Peru', 'barcamp-peru', 'scr-meetup-26yyem'),
      (51, 'Node.js Lima', 'nodejs-lima', 'scr-meetup-eotv9e'),
      (52, 'DataVerse LATAM', 'dataverse-latam', 'scr-meetup-a6gpx2'),
      (53, 'BrowserStack QA Meetup group Lima', 'browserstack-qa-meetup-group-lima', 'scr-meetup-5pt169'),
      (54, 'Lima WooCommerce Meetup', 'lima-woocommerce-meetup', 'scr-meetup-mfgqzo'),
      (55, 'Data Science Lima', 'data-science-lima', 'scr-meetup-liw50g'),
      (56, 'South America CI/CD CDF Meetup', 'cdf-south-america', 'scr-meetup-ikzfvf'),
      (57, 'Grupo Usuarios de R en Lima-Perú', 'grupo-usuarios-de-r-en-lima-peru', 'scr-meetup-y1r7da'),
      (58, 'Tech Meetup - Santex (Lima,Perú)', 'tech-meetup-santex-lima-peru', 'scr-meetup-qnz3d'),
      (59, 'Docker Lima', 'docker-lima', 'scr-meetup-ur642x'),
      (60, 'WiT Peru', 'witperu', 'scr-meetup-rc75k1'),
      (61, 'Hablemos de Testing', 'hablemos-de-testing', 'scr-meetup-841muz'),
      (62, 'Lima New Technology Meetup Group', 'meetup-group-rdmjuigx', 'scr-meetup-834qcw'),
      (63, 'Morning Tech Brew', 'morning-tech-brew', 'scr-meetup-dyddp3'),
      (64, 'Perú TECH', 'perutech', 'scr-meetup-r21d9t'),
      (65, 'Django Perú', 'django-peru', 'scr-meetup-5mlx79'),
      (66, 'Business Agility Institute Perú', 'business-agility-peru', 'scr-meetup-z1x3q4'),
      (67, 'Heart of Agile - Peru', 'heart-of-agile-peru', 'scr-meetup-qkfcar'),
      (68, '1956 AI', '1956ai', 'scr-meetup-jm0r2m'),
      (69, 'Women in Agile - Lima Peru', 'wia-lima-peru', 'scr-meetup-fi7w15'),
      (70, 'R-Ladies Lima', 'rladies-lima', 'scr-meetup-v2rr7'),
      (71, 'Women Techmakers Lima', 'women-techmakers-lima', 'scr-meetup-yt06h3'),
      (72, 'Hackathon Lima, Agricultura sostenible adaptada al clima', 'hackathon-lima-agricultura-sostenible-adaptada-al-clima', 'scr-meetup-w97xtb'),
      (73, 'Academia de Ciberseguridad Capitulo Peru', 'meetup-group-tjyqurfa', 'scr-meetup-8viiw4'),
      (74, 'Scrum & Agil Peru', 'scrum-agil-peru', 'scr-meetup-x8l9zg'),
      (75, 'Blockchain e Impacto Social - Peru', 'blockchain-e-impacto-social-peru', 'scr-meetup-yqp9uu'),
      (76, 'Sketch Perú', 'sketch-designlima', 'scr-meetup-703wqj'),
      (77, 'Cardano Blockchain Lima, Peru', 'cardano-blockchain-lima-peru', 'scr-meetup-m2n6uz'),
      (78, 'Figma Lima, Perú', 'figma-lima-peru', 'scr-meetup-n8jzm4'),
      (79, 'Lima Frontend Masters', 'lima-frontend', 'scr-meetup-6o6lbz')
    ) AS sources(sort_order, name, slug, calendar_id)
  LOOP
    v_provider_source_id := 'meetup:meetup.com/' || v_source.slug;
    v_calendar_url := 'https://www.meetup.com/' || v_source.slug;
    v_row_id := NULL;
    v_already_seeded := false;

    SELECT id,
           coalesce(source_metadata->>'ownerMeetupSeedVersion', '') = '2026-07-28-v1'
    INTO v_row_id, v_already_seeded
    FROM public.user_luma_calendars
    WHERE user_id = v_user_id
      AND merged_into_id IS NULL
      AND provider = 'meetup'
      AND (
        lower(provider_source_id) = v_provider_source_id
        OR lower(calendar_url) = v_calendar_url
      )
    ORDER BY created_at
    LIMIT 1;

    IF v_row_id IS NULL THEN
      INSERT INTO public.user_luma_calendars(
        user_id,
        calendar_id,
        calendar_name,
        curated_name,
        calendar_url,
        source,
        source_kind,
        provider,
        provider_source_id,
        ownership,
        sync_all_events,
        event_limit,
        sync_enabled,
        sync_status,
        is_default,
        sort_order,
        next_sync_at,
        source_metadata
      )
      VALUES (
        v_user_id,
        v_source.calendar_id,
        v_source.name,
        v_source.name,
        v_calendar_url,
        'scrape',
        'calendar',
        'meetup',
        v_provider_source_id,
        'external',
        true,
        2000,
        true,
        'queued',
        false,
        1000 + v_source.sort_order,
        now(),
        jsonb_build_object(
          'ownerMeetupSeedVersion', '2026-07-28-v1',
          'seedSource', 'meetup.csv'
        )
      )
      RETURNING id INTO v_row_id;
    ELSE
      UPDATE public.user_luma_calendars
      SET calendar_url = v_calendar_url,
          calendar_name = CASE
            WHEN organization_manual THEN calendar_name
            ELSE v_source.name
          END,
          curated_name = CASE
            WHEN organization_manual THEN curated_name
            ELSE v_source.name
          END,
          provider_source_id = v_provider_source_id,
          ownership = 'external',
          sync_all_events = true,
          event_limit = 2000,
          sync_enabled = true,
          source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object(
            'ownerMeetupSeedVersion', '2026-07-28-v1',
            'seedSource', 'meetup.csv'
          ),
          updated_at = now()
      WHERE id = v_row_id;
    END IF;

    IF NOT v_already_seeded THEN
      UPDATE public.user_luma_calendars
      SET sync_status = 'queued',
          sync_error = NULL,
          next_sync_at = now()
      WHERE id = v_row_id;

      INSERT INTO public.event_sync_jobs(
        user_id,
        source_id,
        trigger,
        status,
        sync_scope,
        scheduled_at
      )
      SELECT
        v_user_id,
        v_row_id,
        'initial',
        'queued',
        'full',
        now() + interval '2 minutes'
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.event_sync_jobs
        WHERE source_id = v_row_id
          AND status IN ('queued', 'running')
      );
    END IF;
  END LOOP;
END
$$;
