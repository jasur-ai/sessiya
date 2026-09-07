/**
 * Deborah — Practice (Yakka mashq / Sinov sahifasi) i18n — uz/uz-cyrl/ru/en
 * Sahifa oldin faqat UZ va eski uslubda edi; endi premium token uslubida va
 * 4 tilda (routes/user.js /practice → copy beradi).
 */

export const PRACTICE_COPY = {
  uz: {
    pageTitle: '{title} — Deborah',
    topBadge: 'Yakka mashq',
    back: '← Panel',
    meta: "Javob kaliti serverda saqlanadi — yakunda baho va tushuntirishlar ko'rasiz.",
    prev: '← Oldingi',
    next: 'Keyingi →',
    finish: '✅ Yakunlash',
    dotAria: 'Savol {n}',
    finishAsk: '{n} ta savol javobsiz qoldi. Yakunlaymizmi?',
    netErr: 'Tarmoq xatosi',
    errPrefix: 'Xato: ',
    resSub: '{correct} / {total} to\'g\'ri javob',
    print: '🖨️ Chop etish',
    backPanel: '← Panelga qaytish',
    yourAnswer: '← sizning javobingiz',
    unanswered: 'javobsiz qoldi',
  },
  ru: {
    pageTitle: '{title} — Deborah',
    topBadge: 'Пробный тест',
    back: '← Панель',
    meta: 'Ключ ответов хранится на сервере — в конце вы увидите оценку и пояснения.',
    prev: '← Назад',
    next: 'Далее →',
    finish: '✅ Завершить',
    dotAria: 'Вопрос {n}',
    finishAsk: '{n} вопросов осталось без ответа. Завершить?',
    netErr: 'Ошибка сети',
    errPrefix: 'Ошибка: ',
    resSub: '{correct} из {total} правильных',
    print: '🖨️ Печать',
    backPanel: '← Вернуться на панель',
    yourAnswer: '← ваш ответ',
    unanswered: 'без ответа',
  },
  en: {
    pageTitle: '{title} — Deborah',
    topBadge: 'Practice',
    back: '← Panel',
    meta: 'The answer key stays on the server — you will see your score and explanations at the end.',
    prev: '← Previous',
    next: 'Next →',
    finish: '✅ Finish',
    dotAria: 'Question {n}',
    finishAsk: '{n} questions were left unanswered. Finish anyway?',
    netErr: 'Network error',
    errPrefix: 'Error: ',
    resSub: '{correct} / {total} correct',
    print: '🖨️ Print',
    backPanel: '← Back to panel',
    yourAnswer: '← your answer',
    unanswered: 'unanswered',
  },
  'uz-cyrl': {
    pageTitle: '{title} — Deborah',
    topBadge: 'Якка машқ',
    back: '← Панель',
    meta: 'Жавоб калити серверда сақланади — якунда баҳо ва тушунтиришлар кўрасиз.',
    prev: '← Олдинги',
    next: 'Кейинги →',
    finish: '✅ Якунлаш',
    dotAria: 'Савол {n}',
    finishAsk: '{n} та савол жавобсиз қолди. Якунлаймизми?',
    netErr: 'Тармоқ хатоси',
    errPrefix: 'Хато: ',
    resSub: '{correct} / {total} тўғри жавоб',
    print: '🖨️ Чоп этиш',
    backPanel: '← Панелга қайтиш',
    yourAnswer: '← сизнинг жавобингиз',
    unanswered: 'жавобсиз қолди',
  },
};

export function practiceCopyFor(lang) {
  const k = String(lang || '').toLowerCase();
  if (k.startsWith('ru')) return PRACTICE_COPY.ru;
  if (k.startsWith('en')) return PRACTICE_COPY.en;
  if (k.includes('cyrl')) return PRACTICE_COPY['uz-cyrl'];
  return PRACTICE_COPY.uz;
}
