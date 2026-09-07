/**
 * Deborah — Portfolio UI strings (AUTH A-12 §16)
 * --------------------------------------------
 * Lightweight server-side catalog for the portfolio page.
 * Locales: uz-Latn (default), uz-Cyrl, ru, en.
 * Usage: `t(locale, key)` or `catalogFor(locale)`.
 */

const CATALOGS = {
  'uz-Latn': {
    title: 'Mening Portfolio',
    navPanel: 'Panel',
    navPortfolio: 'Portfolio',
    navSecurity: 'Xavfsizlik',
    navLogout: 'Chiqish',
    evidenceTitle: 'Evidence Portfolio',
    evidenceDesc:
      'Portfolio standart yopiq (private) — faqat siz ko\'rasiz. Dalillar va verifiable credentials (Open Badges / CLR / VC) shu yerda saqlanadi.',
    privacyChip: 'Yopiq (private)',
    publicChip: 'Ommaviy',
    addTitle: 'Yangi dalil qo\'shish',
    addPlaceholder: 'Dalil nomi',
    addBtn: 'Qo\'shish',
    importTitle: 'Transkript/diplom import (PDF · Excel)',
    importDesc:
      'HEMIS yoki OTM hisob tizimidan transkript, reyting daftarcha yoki diplom yuklang — fan/baho/kredit avtomatik portfolio item\'lariga aylanadi.',
    importConsent:
      'Ma\'lumotlaringiz O\'zbekistondagi serverlarda (UZ data residency) saqlanadi va standart yopiq — faqat siz ko\'rasiz.',
    importChoose: 'Fayl tanlash (.pdf, .xlsx, .csv)',
    importBtn: 'Import qilish',
    importStatus: '',
    exportBtn: 'Transkript PDF eksport',
    exportHint: 'Semestr, fan, baho va kredit jadvali',
    safeParse: 'PDF/Excel xavfsiz parse qilinadi (skript bajarilmaydi).',
    delAria: "O'chirish",

    // AUTH C-13: diplom.edu.uz tekshiruv (P3) — client-side, OneID bilan to'liq flow
    diplomaTitle: 'Diplomani tekshirish',
    diplomaDesc:
      'diplom.edu.uz orqali diplom haqiqiyligini tekshiring — natija O\'zbekistondan (UZ IP) ochiladi. Tekshiruv brauzeringizda amalga oshiriladi, server emas.',
    diplomaBtn: 'diplom.edu.uz da tekshirish',
    diplomaOpen: 'Yangi oynada ochiladi',
    itemsTitle: 'Mening dalillarim',
    itemsEmpty: 'Hozircha dalil yo\'q. Yuqoridan birinchi dalilni qo\'shing.',
    visPrivate: 'Yopiq',
    visShared: 'Havola',
    visPublic: 'Ommaviy',
    shareBtn: 'Share',
    sharePrompt: 'Havola (faqat ushbu havolaga ega kishi ko\'radi):',
    shareCopied: 'Havola nusxalandi',
    credentialsTitle: 'Credentials',
    credentialsLoading: 'Yuklanmoqda…',
    credentialsEmpty: 'Credential yo\'q',
    credentialsNote:
      'Credential faqat ratified evidence + teacher/admin sign-off bilan chiqadi (LLM hech qachon credential bermaydi).',
    aiLevel: 'AI daraja:',
    kindProposal: 'Loyiha (proposal)',
    kindOutline: 'Reja (outline)',
    kindSourceShortlist: 'Manba ro\'yxati',
    kindDraft: 'Qoralama (draft)',
    kindTeacherFeedback: 'O\'qituvchi fikri',
    kindReflection: 'Aks ettirish (reflection)',
    kindOralDefense: 'Og\'zaki himoya',
    kindCredential: 'Credential',
    kindResult: 'Natija (transkript)',
    kindCertificate: 'Sertifikat/diplom',
    aiA0: 'A0 — AI taqiqlangan',
    aiA1: 'A1 — imlo/tarjima',
    aiA2: 'A2 — g\'oya/tadqiqot',
    aiA3: 'A3 — qoralama/hamkorlik',
    aiA4: 'A4 — AI-native',
    errTitleRequired: 'Nomi kerak',
    addedOk: 'Qo\'shildi ✓',
    importOk: 'Import bajarildi: {created} ta item',
    importEmpty: 'Fayldan hech qanday ma\'lumot topilmadi — qo\'lda kiriting',
    importNoConsent: 'Ma\'lumotlaringiz saqlanishiga rozilik berishingiz kerak',
    importUnsupported: 'Qo\'llab-quvvatlanmaydigan fayl formati',
    importTooLarge: 'Fayl juda katta (maksimum 8 MB)',
  },
  'uz-Cyrl': {
    title: 'Менинг Портфолио',
    navPanel: 'Панел',
    navPortfolio: 'Портфолио',
    navSecurity: 'Хавфсизлик',
    navLogout: 'Чиқиш',
    evidenceTitle: 'Evidence Портфолио',
    evidenceDesc:
      'Портфолио стандарт ёпиқ (private) — фақат сиз кўрасиз. Далиллар ва verifiable credentials (Open Badges / CLR / VC) шу ерда сақланади.',
    privacyChip: 'Ёпиқ (private)',
    publicChip: 'Оммавий',
    addTitle: 'Янги далил қўшиш',
    addPlaceholder: 'Далил номи',
    addBtn: 'Қўшиш',
    importTitle: 'Транскрипт/диплом импорт (PDF · Excel)',
    importDesc:
      'HEMIS ёки ОТМ ҳисоб тизимидан транскрипт, рейтинг дафтарча ёки диплом юкланг — фан/баҳо/кредит автоматик портфолио item\'ларига айланади.',
    importConsent:
      'Маълумотларингиз Ўзбекистондаги серверларда (UZ data residency) сақланади ва стандарт ёпиқ — фақат сиз кўрасиз.',
    importChoose: 'Файл танлаш (.pdf, .xlsx, .csv)',
    importBtn: 'Импорт қилиш',
    importStatus: '',
    exportBtn: 'Транскрипт PDF экспорт',
    exportHint: 'Семестр, фан, баҳо ва кредит жадвали',
    safeParse: 'PDF/Excel хавфсиз таҳлил қилинади (скрипт бажарилмайди).',
    delAria: 'Ўчириш',

    // AUTH C-13: diplom.edu.uz tekshiruv (P3)
    diplomaTitle: 'Дипломни текшириш',
    diplomaDesc:
      'diplom.edu.uz орқали диплом ҳақиқийлигини текширинг — натижа Ўзбекистондан (UZ IP) очилади. Текширув браузерингизда амалга оширилади, сервер эмас.',
    diplomaBtn: 'diplom.edu.uz да текшириш',
    diplomaOpen: 'Янги ойнада очилади',
    itemsTitle: 'Менинг далилларим',
    itemsEmpty: 'Ҳозирча далил йўқ. Юқоридан биринчи далилни қўшинг.',
    visPrivate: 'Ёпиқ',
    visShared: 'Ҳавола',
    visPublic: 'Оммавий',
    shareBtn: 'Share',
    sharePrompt: 'Ҳавола (фақат ушбу ҳаволага эга киши кўради):',
    shareCopied: 'Ҳавола нусхаланди',
    credentialsTitle: 'Credentials',
    credentialsLoading: 'Юкланмоқда…',
    credentialsEmpty: 'Credential йўқ',
    credentialsNote:
      'Credential фақат ratified evidence + teacher/admin sign-off билан чиқади (LLM ҳеч қачон credential бермайди).',
    aiLevel: 'AI даража:',
    kindProposal: 'Лойиҳа (proposal)',
    kindOutline: 'Режа (outline)',
    kindSourceShortlist: 'Манба рўйхати',
    kindDraft: 'Қоралама (draft)',
    kindTeacherFeedback: 'Ўқитувчи фикри',
    kindReflection: 'Акс эттириш (reflection)',
    kindOralDefense: 'Оғзаки ҳимоя',
    kindCredential: 'Credential',
    kindResult: 'Натижа (транскрипт)',
    kindCertificate: 'Сертификат/диплом',
    aiA0: 'A0 — AI тақиқланган',
    aiA1: 'A1 — имло/таржима',
    aiA2: 'A2 — ғоя/тадқиқот',
    aiA3: 'A3 — қоралама/ҳамкорлик',
    aiA4: 'A4 — AI-native',
    errTitleRequired: 'Номи керак',
    addedOk: 'Қўшилди ✓',
    importOk: 'Импорт бажарилди: {created} та item',
    importEmpty: 'Файлдан ҳеч қандай маълумот топилмади — қўлда киритинг',
    importNoConsent: 'Маълумотларингиз сақланишига розилик беришингиз керак',
    importUnsupported: 'Қўллаб-қувватланмайдиган файл формати',
    importTooLarge: 'Файл жуда катта (максимум 8 MB)',
  },
  ru: {
    title: 'Мое Портфолио',
    navPanel: 'Панель',
    navPortfolio: 'Портфолио',
    navSecurity: 'Безопасность',
    navLogout: 'Выход',
    evidenceTitle: 'Evidence Портфолио',
    evidenceDesc:
      'Портфолио по умолчанию закрыто (private) — видите только вы. Доказательства и verifiable credentials (Open Badges / CLR / VC) хранятся здесь.',
    privacyChip: 'Закрыто (private)',
    publicChip: 'Публично',
    addTitle: 'Добавить доказательство',
    addPlaceholder: 'Название доказательства',
    addBtn: 'Добавить',
    importTitle: 'Импорт транскрипта/диплома (PDF · Excel)',
    importDesc:
      'Загрузите транскрипт, зачётную книжку или диплом из HEMIS — предмет/оценка/кредит автоматически станут элементами портфолио.',
    importConsent:
      'Ваши данные хранятся на серверах в Узбекистане (UZ data residency) и по умолчанию закрыты — видите только вы.',
    importChoose: 'Выбрать файл (.pdf, .xlsx, .csv)',
    importBtn: 'Импортировать',
    importStatus: '',
    exportBtn: 'Экспорт транскрипта PDF',
    exportHint: 'Таблица: семестр, предмет, оценка, кредит',
    safeParse: 'PDF/Excel обрабатываются безопасно (скрипты не выполняются).',
    delAria: 'Удалить',

    // AUTH C-13: diplom.edu.uz tekshiruv (P3)
    diplomaTitle: 'Проверка диплома',
    diplomaDesc:
      'Проверьте подлинность диплома через diplom.edu.uz — результат открывается из Узбекистана (UZ IP). Проверка выполняется в вашем браузере, не на сервере.',
    diplomaBtn: 'Проверить на diplom.edu.uz',
    diplomaOpen: 'Откроется в новой вкладке',
    itemsTitle: 'Мои доказательства',
    itemsEmpty: 'Пока нет доказательств. Добавьте первое выше.',
    visPrivate: 'Закрыто',
    visShared: 'Ссылка',
    visPublic: 'Публично',
    shareBtn: 'Share',
    sharePrompt: 'Ссылка (виден только тем, у кого есть ссылка):',
    shareCopied: 'Ссылка скопирована',
    credentialsTitle: 'Credentials',
    credentialsLoading: 'Загрузка…',
    credentialsEmpty: 'Нет credentials',
    credentialsNote:
      'Credential выдаётся только по ratified evidence + teacher/admin sign-off (LLM никогда не выдаёт credentials).',
    aiLevel: 'Уровень AI:',
    kindProposal: 'Проект (proposal)',
    kindOutline: 'План (outline)',
    kindSourceShortlist: 'Список источников',
    kindDraft: 'Черновик (draft)',
    kindTeacherFeedback: 'Отзыв учителя',
    kindReflection: 'Рефлексия (reflection)',
    kindOralDefense: 'Устная защита',
    kindCredential: 'Credential',
    kindResult: 'Результат (транскрипт)',
    kindCertificate: 'Сертификат/диплом',
    aiA0: 'A0 — AI запрещён',
    aiA1: 'A1 — орфография/перевод',
    aiA2: 'A2 — идея/исследование',
    aiA3: 'A3 — черновик/сотрудничество',
    aiA4: 'A4 — AI-native',
    errTitleRequired: 'Нужно название',
    addedOk: 'Добавлено ✓',
    importOk: 'Импорт выполнен: {created} элементов',
    importEmpty: 'В файле не найдено данных — введите вручную',
    importNoConsent: 'Требуется согласие на хранение данных',
    importUnsupported: 'Неподдерживаемый формат файла',
    importTooLarge: 'Файл слишком большой (максимум 8 MB)',
  },
  en: {
    title: 'My Portfolio',
    navPanel: 'Panel',
    navPortfolio: 'Portfolio',
    navSecurity: 'Security',
    navLogout: 'Log out',
    evidenceTitle: 'Evidence Portfolio',
    evidenceDesc:
      'Your portfolio is private by default — only you can see it. Evidence and verifiable credentials (Open Badges / CLR / VC) live here.',
    privacyChip: 'Private',
    publicChip: 'Public',
    addTitle: 'Add evidence',
    addPlaceholder: 'Evidence title',
    addBtn: 'Add',
    importTitle: 'Transcript / diploma import (PDF · Excel)',
    importDesc:
      'Upload a transcript, grade book or diploma from HEMIS — subjects, grades and credits are converted into portfolio items automatically.',
    importConsent:
      'Your data is stored on servers in Uzbekistan (UZ data residency) and is private by default — only you can see it.',
    importChoose: 'Choose file (.pdf, .xlsx, .csv)',
    importBtn: 'Import',
    importStatus: '',
    exportBtn: 'Export transcript PDF',
    exportHint: 'Table of semesters, subjects, grades and credits',
    safeParse: 'PDF/Excel are parsed safely (no scripts run).',
    delAria: 'Delete',

    // AUTH C-13: diplom.edu.uz tekshiruv (P3)
    diplomaTitle: 'Verify diploma',
    diplomaDesc:
      'Check diploma authenticity via diplom.edu.uz — opens from Uzbekistan (UZ IP) only. Verification happens in your browser, not on the server.',
    diplomaBtn: 'Verify on diplom.edu.uz',
    diplomaOpen: 'Opens in a new tab',
    itemsTitle: 'My evidence',
    itemsEmpty: 'No evidence yet. Add your first item above.',
    visPrivate: 'Private',
    visShared: 'Link',
    visPublic: 'Public',
    shareBtn: 'Share',
    sharePrompt: 'Link (only people with this link can view):',
    shareCopied: 'Link copied',
    credentialsTitle: 'Credentials',
    credentialsLoading: 'Loading…',
    credentialsEmpty: 'No credentials',
    credentialsNote:
      'Credentials are issued only from ratified evidence with teacher/admin sign-off (LLMs never issue credentials).',
    aiLevel: 'AI level:',
    kindProposal: 'Proposal',
    kindOutline: 'Outline',
    kindSourceShortlist: 'Source shortlist',
    kindDraft: 'Draft',
    kindTeacherFeedback: 'Teacher feedback',
    kindReflection: 'Reflection',
    kindOralDefense: 'Oral defense',
    kindCredential: 'Credential',
    kindResult: 'Result (transcript)',
    kindCertificate: 'Certificate / diploma',
    aiA0: 'A0 — AI not allowed',
    aiA1: 'A1 — spelling/translation',
    aiA2: 'A2 — idea/research',
    aiA3: 'A3 — draft/collaboration',
    aiA4: 'A4 — AI-native',
    errTitleRequired: 'Title required',
    addedOk: 'Added ✓',
    importOk: 'Import done: {created} items',
    importEmpty: 'No data found in the file — enter it manually',
    importNoConsent: 'You must consent to storing your data',
    importUnsupported: 'Unsupported file format',
    importTooLarge: 'File too large (max 8 MB)',
  },
};

const SUPPORTED = Object.keys(CATALOGS);

/** Resolve a raw locale tag to a supported catalog key (fallback chain). */
export function resolveLocale(input) {
  if (!input) return 'uz-Latn';
  const s = String(input).trim().toLowerCase().replace(/_/g, '-');
  if (CATALOGS[s]) return s;
  if (s === 'uz' || s.startsWith('uz-lat')) return 'uz-Latn';
  if (s.startsWith('uz-c')) return 'uz-Cyrl';
  if (s.startsWith('ru')) return 'ru';
  if (s.startsWith('en')) return 'en';
  return 'uz-Latn';
}

/** Translate a key for a locale with simple {var} interpolation. */
export function t(locale, key, vars = {}) {
  const cat = CATALOGS[resolveLocale(locale)] || CATALOGS['uz-Latn'];
  let str = cat[key];
  if (str === undefined) str = CATALOGS['uz-Latn'][key];
  if (str === undefined) return key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.split(`{${k}}`).join(String(v));
  }
  return str;
}

/** Full catalog for a locale (used to render the page server-side). */
export function catalogFor(locale) {
  const base = CATALOGS['uz-Latn'];
  const loc = CATALOGS[resolveLocale(locale)] || base;
  return { ...base, ...loc };
}

export const PORTFOLIO_LOCALES = SUPPORTED;
