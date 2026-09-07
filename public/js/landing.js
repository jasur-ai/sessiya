
(function(){
  'use strict';
  /* ═══ I18N ═══ */
  var I18N={
  uz:{
    'hdr.kirish':'Kirish',
    'hm.kirish':'Kirish','hm.cast':'Cast','hm.documents':'Hujjatlar',
    'join.k':"Tayyor cast",
    'join.h3':"Castga <em>kirish</em>",
    'join.p':'Kodni kiriting.',
    'join.err':'Kod 5–6 belgidan iborat bo\'lishi kerak (cast: 6 harf/raqam).',
    'join.go':'Kirish',
    'join.load':'Ulanmoqda… <i></i>',
    'join.ok':"Siz castga ulandingiz. Savol kutilmoqda.",
    'nav.cast':'Cast','nav.kirish':'Kirish','nav.register':"Ro'yxatdan o'tish",
    'head.kicker':'Savolni sinf ekraniga uzatish',
    'head.h1':'Savol — <em>ekranda</em>. Javob — telefonda.',
    'head.p':"Bir tugma bilan savol sinf ekraniga uzatiladi. Javoblar real vaqtda yig'iladi.",
    'beam.tx':'uzatilmoqda…',
    'live.live':'jonli',
    'live.q':"SQL'da jadvaldan takroriy yozuvlarni olib tashlab, faqat unikallarini qaytaruvchi operator qaysi?",
    'live.cap':'Response mosaic · 42 javob',
    'live.dev':'Dominant xato: B · 43%',
    'live.f1':'Savol cast qilindi','live.f2':"javoblar yig'ilmoqda",
    'under':'Bu — <b>cast</b>: savol ekranda, javoblar telefonda. Har bir savol shu tarzda uzatiladi.',
    'auth.k':"Kirish va ro'yxatdan o'tish",'auth.h2':"Hisobingizga kiring",'auth.t1':'Kirish','auth.t2':"Ro'yxatdan o'tish",'auth.login':'Kirish','auth.register':"Ro'yxatdan o'tish",'auth.doneReg':"Ro'yxatdan o'tdingiz. Endi tizimga kira olasiz.",
    'auth.google':'Google bilan kirish',
    'auth.loginId':'Email yoki username',
    'auth.username':'Username',
    'auth.userFree':'✓ Bo\'sh — mos username',
    'auth.userTaken':'Bu username band — boshqasini tanlang',
    'auth.userReserved':'Bu nom tizim uchun ajratilgan',
    'auth.userInvalid':'2–50 belgi: lotin harflari, raqam, . _ -',
    'auth.passHint':'Kamida 8 belgi — harf va raqam',
    'auth.role':'Rolingiz','auth.roleStudent':'Talaba','auth.roleTeacher':"O'qituvchi",'auth.teacherLink':"O'qituvchi uchun to'liq ariza →",
    'err.net':'Tarmoq xatosi — qayta urinib ko\'ring',
    'err.wait':'Bir necha soniya kuting...','auth.or':'yoki email bilan',
    'auth.name':'Ism va familiya','auth.email':'Email','auth.pass':'Parol',
    'auth.doneLogin':'Kirish ruxsat tasdiqlangach ochiladi.',
    'admin.btn':'Admin','admin.k':'Admin panel','admin.h3':'Administrator <em>kirishi</em>','admin.p':'Faqat administratorlar uchun.',
    'admin.loginL':'Login','admin.passL':'Parol','admin.go':'Kirish','admin.err':'Login yoki parol xato.','admin.ok':'Kirish muvaffaqiyatli',
    'ftr.col1t':'Sahifalar','ftr.l1':'Bosh sahifa','ftr.l2':'Cast','ftr.l3':'Kirish','ftr.l4':"Ro'yxatdan o'tish",
'ftr.teachers':"O'qituvchilar",
    'ftr.col2t':'Hujjatlar','ftr.l5':'Maxfiylik siyosati','ftr.l6':'Foydalanish shartlari','ftr.l7':'Cookie siyosati','ftr.l8':'Qonuniy ma\'lumot',
    'ftr.col3t':'Aloqa','ftr.l9':'Status',
    'ftr.col4t':'Til',
    'prov.g.off':'Google kirish serverda sozlanmagan (GOOGLE_CLIENT_ID). Administratorga murojaat qiling — hozir email bilan kiring.',
    
    'ftr.legal':"© 2026 Deborah · O'qituvchilar uchun AI yordamchi",

    /* S33: namuna (index.html) boLimlari */
    "nav.feat":"Imkoniyatlar",
    "nav.qadam":"Qadamlar",
    "nav.signal":"Signal",
    "hero.kicker":"O'qituvchilar uchun · AI yordamchi bilan",
    "hero.h1":"O'qituvchi ishi — <em>yengil</em>.<br>Dars — samarali.",
    "hero.lede":"Savol tuzish, slaydlar, baholash, qog'oz tekshirish — AI yordamchi bularni soniyalarda bajaradi. Siz darsga va talabalarga vaqt ajratasiz.",
    "hero.cta1":"Bepul boshlash",
    "hero.cta2":"Imkoniyatlar",
    "hero.scroll":"Scroll · imkoniyatlar",
    "stats.s1":"Savol tayyorlash — AI bilan",
    "stats.s2":"AI yordamchi funksiyalar",
    "stats.s3":"Tushunish o'sishi",
    "feat.k":"Imkoniyatlar",
    "feat.h2":"O'qituvchi ishini <em>yengillashtiradigan</em> imkoniyatlar.",
    "feat.p":"AI yordamchi rutin ishlarni o'z zimmasiga oladi — siz o'qitishga e'tibor berasiz.",
    "feat.hint":"Imkoniyatni tanlang — tafsilot ochiladi",
    "feat.c1t":"AI savol generatsiyasi",
    "feat.c1s":"Mavzudan test savollari soniyalarda.",
    "feat.c1m":"50/30/20 taqsimot va validatorlar bilan; tayyor bankdan ham tanlash mumkin.",
    "feat.c2t":"AI slaydlar",
    "feat.c2s":"Dars taqdimoti avtomatik tayyorlanadi.",
    "feat.c2m":"Canva, Google Slides va Gamma'ga bir tugma bilan eksport qilinadi.",
    "feat.c3t":"AI baholash",
    "feat.c3s":"Erkin javoblar avtomatik baholanadi.",
    "feat.c3m":"Rubric va mezonlar asosida; natija serverda tasdiqlanadi.",
    "feat.c4t":"Maqola tavsiyalari",
    "feat.c4s":"Har bir mavzu uchun o'qish materiallari.",
    "feat.c4m":"Maqolalar va manbalar avtomatik tavsiya etiladi.",
    "feat.c5t":"Qog'oz + OCR",
    "feat.c5s":"Qog'oz javob varaqlari skanerlanadi.",
    "feat.c5m":"OMR belgilash, qo'lyozma va matn OCR — barchasi bitta joyda.",
    "feat.c6t":"Savollar banki",
    "feat.c6s":"QTI import/eksport va rubric.",
    "feat.c6m":"Savollar, rubric va competency — bitta bankda.",
    "feat.c7t":"Jonli viktorina",
    "feat.c7s":"Savol sinf ekraniga uzatiladi.",
    "feat.c7m":"Javoblar jonli yig'iladi; signal va mosaic ko'rsatiladi.",
    "feat.c8t":"Hisobot",
    "feat.c8s":"Dars yakunida avtomatik hisobot.",
    "feat.c8m":"Sinf darajasidagi tahlil va natijalar.",
    "feat.c9t":"Imtihon nazorati",
    "feat.c9s":"Kamera evidence bilan nazorat.",
    "feat.c9m":"Xavfsizlik profillari va proctor hodisalari.",
    "qadam.k":"Qanday ishlaydi",
    "qadam.h2":"Uch oddiy <em>qadam</em>.",
    "qadam.p":"Tayyorlang, uzating, tahlil qiling — qolganini tizim bajaradi.",
    "qadam.cite":"Yarat → Uzat → Tahlil",
    "qadam.l1":"01 · YARAT",
    "qadam.l2":"02 · UZAT",
    "qadam.l3":"03 · TAHLIL",
    "qadam.c1t":"Yarat",
    "qadam.c1p":"Savol AI yordamida yoki bankdan tanlanadi — bir necha soniya.",
    "qadam.c2t":"Uzat",
    "qadam.c2p":"Savol sinf ekraniga uzatiladi; javoblar telefonda ochiladi.",
    "qadam.c3t":"Tahlil",
    "qadam.c3p":"Signal va hisobot: sinf holati bir qarashda.",
    "signal.k":"Sinf signali",
    "signal.h2":"Tushunish — <em>dalil bilan</em> o'lchanadi.",
    "signal.p":"Bitta savol, bitta muhokama: tushunish 43% dan 82% ga — o'lchangan va tasdiqlangan.",
    "signal.col1":"Birinchi o'lchov",
    "signal.col2":"Muhokamadan keyin",
    "signal.mos1":"Response mosaic · 42 javob",
    "signal.mos2":"Muhokamadan keyin",
    "signal.foot":"Bitta savol · tushunish <b>43% → 82%</b>",
    "signal.note":"Server-confirmed · shaxsiy reyting maxfiy",
    "cred.c1":"Google bilan kirish",
    "cred.c2":"Server-confirmed",
    "cred.c3":"WCAG 2.2 AA",
    "cred.c4":"QTI import",
    "cta.h2":"Ishni <em>osonlashtiring</em>.",
    "cta.stamp":"AI · CAST · SIGNAL · HISOBOT",
    "cta.p":"Ruxsat OTM ma'muriyati tomonidan beriladi. Tasdiqlash kutilayotganda ham imkoniyatlarni ko'rib chiqing.",
    "cta.b1":"Kirish",
    "cta.b2":"Imkoniyatlar",
    "ftr.l2b":"Imkoniyatlar",
  },
  /* S14 (BUG-089c): /uz-cyrl landing — 60 ta data-i18n elementi klientda almashtiriladi,
     lekin I18Nda uz-cyrl yo'q edi → aralash skript (server kirill, data-i18n lotin) */
  'uz-cyrl':{
    'hdr.kirish':'Кириш',
    'hm.kirish':'Кириш','hm.cast':'Cast','hm.documents':'Ҳужжатлар',
    'join.k':'Тайёр cast',
    'join.h3':'Castга <em>кириш</em>',
    'join.p':'Кодни киритинг.',
    'join.err':'Код 5–6 белгидан иборат бўлиши керак (cast: 6 ҳарф/рақам).',
    'join.go':'Кириш',
    'join.load':'Уланмоқда… <i></i>',
    'join.ok':'Сиз castга уланингиз. Савол кутилмоқда.',
    'nav.cast':'Cast','nav.kirish':'Кириш','nav.register':'Рўйхатдан ўтиш',
    'head.kicker':'Саволни синф экранига узатиш',
    'head.h1':'Савол — <em>экранда</em>. Жавоб — телефонда.',
    'head.p':'Бир тугма билан савол синф экранига узатилади. Жавоблар реал вақтда йиғилади.',
    'beam.tx':'узатилмоқда…',
    'live.live':'жонли',
    'live.q':"SQL'да жадвалдан такрорий ёзувларни олиб ташлаб, фақат уникалларини қайтарувчи оператор қайси?",
    'live.cap':'Response mosaic · 42 жавоб',
    'live.dev':'Доминант хато: B · 43%',
    'live.f1':'Савол cast қилинди','live.f2':'жавоблар йиғилмоқда',
    'under':'Бу — <b>cast</b>: савол экранда, жавоблар телефонда. Ҳар бир савол шу тарзда узатилади.',
    'auth.k':"Deborah ҳисоби",'auth.h2':"Ҳисобингизга киринг",'auth.t1':'Кириш','auth.t2':'Рўйхатдан ўтиш','auth.login':'Кириш','auth.register':'Рўйхатдан ўтиш','auth.doneReg':'Рўйхатдан ўтдингиз. Энди тизимга кира оласиз.',
    'auth.google':'Google билан кириш',
    'auth.loginId':'Email ёки username',
    'auth.username':'Username',
    'auth.userFree':"✓ Бўш — мос username",
    'auth.userTaken':'Бу username банд — бошқасини танланг',
    'auth.userReserved':'Бу ном тизим учун ажратилган',
    'auth.userInvalid':'2–50 белги: лотин ҳарфлари, рақам, . _ -',
    'auth.passHint':'Камида 8 белги — ҳарф ва рақам',
    'auth.role':'Ролингиз','auth.roleStudent':'Талаба','auth.roleTeacher':'Ўқитувчи','auth.teacherLink':"Ўқитувчи учун тўлиқ ариза →",
    'err.net':'Тармоқ хатоси — қайта уриниб кўринг',
    'err.wait':'Бир неча сония кутинг...','auth.or':'ёки email билан',
    'auth.name':'Исм ва фамилия','auth.email':'Email','auth.pass':'Парол',
    'auth.doneLogin':'Кириш рўхсат тасдиқлангач очилади.',
    'admin.btn':'Admin','admin.k':'Admin panel','admin.h3':'Administrator <em>кириши</em>','admin.p':'Фақат администраторлар учун.',
    'admin.loginL':'Login','admin.passL':'Парол','admin.go':'Кириш','admin.err':'Логин ёки парол хато.','admin.ok':'Кириш муваффақиятли',
    'ftr.col1t':'Саҳифалар','ftr.l1':'Бош саҳифа','ftr.l2':'Cast','ftr.l3':'Кириш','ftr.l4':'Рўйхатдан ўтиш',
    'ftr.teachers':'Ўқитувчилар',
    'ftr.col2t':'Ҳужжатлар','ftr.l5':'Махфийлик сиёсати','ftr.l6':'Фойдаланиш шартлари','ftr.l7':'Cookie сиёсати','ftr.l8':"Қонуний маълумот",
    'ftr.col3t':'Алоқа','ftr.l9':'Status',
    'ftr.col4t':'Тил',
    'prov.g.off':'Google кириш серверда созланмаган (GOOGLE_CLIENT_ID). Администраторга мурожаат қилинг — ҳозир email билан киринг.',
    'ftr.legal':"© 2026 Deborah · Ўқитувчилар учун АИ ёрдамчи",

    /* S33: namuna (index.html) boLimlari */
    "nav.feat":"Имкониятлар",
    "nav.qadam":"Қадамлар",
    "nav.signal":"Сигнал",
    "hero.kicker":"Ўқитувчилар учун · АИ ёрдамчи билан",
    "hero.h1":"Ўқитувчи иши — <em>енгил</em>.<br>Дарс — самарали.",
    "hero.lede":"Савол тузиш, слайдлар, баҳолаш, қоғоз текшириш — АИ ёрдамчи буларни сонияларда бажаради. Сиз дарсга ва талабаларга вақт ажратасиз.",
    "hero.cta1":"Бепул бошлаш",
    "hero.cta2":"Имкониятлар",
    "hero.scroll":"Скролл · имкониятлар",
    "stats.s1":"Савол тайёрлаш — АИ билан",
    "stats.s2":"АИ ёрдамчи функциялар",
    "stats.s3":"Тушуниш ўсиши",
    "feat.k":"Имкониятлар",
    "feat.h2":"Ўқитувчи ишини <em>енгиллаштирувчи</em> имкониятлар.",
    "feat.p":"АИ ёрдамчи рутин ишларни ўз зиммасига олади — сиз ўқитишга эътибор берасиз.",
    "feat.hint":"Имкониятни танланг — тафсилот очилади",
    "feat.c1t":"АИ савол генерацияси",
    "feat.c1s":"Мавзудан тест саволлари сонияларда.",
    "feat.c1m":"50/30/20 тақсимот ва валидаторлар билан; тайёр банкдан ҳам танлаш мумкин.",
    "feat.c2t":"АИ слайдлар",
    "feat.c2s":"Дарс тақдимоти автоматик тайёрланади.",
    "feat.c2m":"Canva, Google Slides ва Gamma'га бир тугма билан экспорт қилинади.",
    "feat.c3t":"АИ баҳолаш",
    "feat.c3s":"Эркин жавоблар автоматик баҳоланади.",
    "feat.c3m":"Рубрик ва мезонлар асосида; натижа серверда тасдиқланади.",
    "feat.c4t":"Мақола тавсиялари",
    "feat.c4m":"Мақолалар ва манбалар автоматик тавсия этилади.",
    "feat.c5t":"Қоғоз + OCR",
    "feat.c5s":"Қоғоз жавоб варақлари сканерланади.",
    "feat.c5m":"OMR белгилаш, қўлёзма ва матн OCR — барчаси бир жойда.",
    "feat.c6t":"Саволлар банки",
    "feat.c6s":"QTI импорт/экспорт ва рубрик.",
    "feat.c6m":"Саволлар, рубрик ва компетенция — бирта банкда.",
    "feat.c7t":"Жонли викторина",
    "feat.c7s":"Савол синф экранига узатилади.",
    "feat.c7m":"Жавоблар жонли йиғилади; сигнал ва мозайк кўрсатилади.",
    "feat.c8t":"Ҳисобот",
    "feat.c8s":"Дарс якунида автоматик ҳисобот.",
    "feat.c8m":"Синф даражасидаги таҳлил ва натижалар.",
    "feat.c9t":"Имтиҳон назорати",
    "feat.c9s":"Камера далили билан назорат.",
    "feat.c9m":"Хавфсизлик профиллари ва проктор ҳодисалари.",
    "qadam.k":"Қандай ишлайди",
    "qadam.h2":"Учта оддий <em>қадам</em>.",
    "qadam.p":"Тайёрланг, узатинг, таҳлил қилинг — қолганини тизим бажаради.",
    "qadam.cite":"Ярат → Узат → Таҳлил",
    "qadam.l1":"01 · ЯРАТ",
    "qadam.l2":"02 · УЗАТ",
    "qadam.l3":"03 · ТАҲЛИЛ",
    "qadam.c1t":"Ярат",
    "qadam.c1p":"Савол АИ ёрдамида ёки банкдан танланади — бир неча сония.",
    "qadam.c2t":"Узат",
    "qadam.c2p":"Савол синф экранига узатилади; жавоблар телефонда очилади.",
    "qadam.c3t":"Таҳлил",
    "qadam.c3p":"Сигнал ва ҳисобот: синф ҳолати бир қарашда.",
    "signal.k":"Синф сигнали",
    "signal.h2":"Тушуниш — <em>далил билан</em> ўлчанади.",
    "signal.p":"Бирта савол, бирта муҳокама: тушуниш 43% дан 82% га — ўлчанган ва тасдиқланган.",
    "signal.col1":"Биринчи ўлчов",
    "signal.col2":"Муҳокамадан кейин",
    "signal.mos1":"Response mosaic · 42 жавоб",
    "signal.mos2":"Муҳокамадан кейин",
    "signal.foot":"Бирта савол · тушуниш <b>43% → 82%</b>",
    "signal.note":"Server-confirmed · шахсий рейтинг махфий",
    "cred.c1":"Google билан кириш",
    "cred.c2":"Server-confirmed",
    "cred.c3":"WCAG 2.2 AA",
    "cred.c4":"QTI импорт",
    "cta.h2":"Ишни <em>осонлаштиринг</em>.",
    "cta.stamp":"АИ · CAST · SIGNAL · ҲИСОБОТ",
    "cta.p":"Рухсат ОТМ маъмурияти томонидан берилади. Тасдиқлаш кутилаётганда ҳам имкониятларни кўриб чиқинг.",
    "cta.b1":"Кириш",
    "cta.b2":"Имкониятлар",
    "ftr.l2b":"Имкониятлар",
    "feat.c4s":"Ҳар бир мавзу учун ўқиш материаллари.",
  },
  ru:{
    'hdr.kirish':'Вход',
    'hm.kirish':'Вход','hm.cast':'Cast','hm.documents':'Документы',
    'join.k':'Готовый cast',
    'join.h3':'Вход в <em>cast</em>',
    'join.p':'Введите код.',
    'join.err':'Код должен быть из 5–6 символов (cast: 6 букв/цифр).',
    'join.go':'Войти',
    'join.load':'Подключение… <i></i>',
    'join.ok':'Вы вошли в cast. Ожидайте вопрос.',
    'nav.cast':'Cast','nav.kirish':'Вход','nav.register':'Регистрация',
    'head.kicker':'Трансляция вопроса на экран аудитории',
    'head.h1':'Вопрос — <em>на экране</em>. Ответ — в телефоне.',
    'head.p':'Одним действием вопрос выводится на экран аудитории. Ответы собираются в реальном времени.',
    'beam.tx':'передаётся…',
    'live.live':'в эфире',
    'live.q':'Какой оператор SQL удаляет повторяющиеся записи и возвращает только уникальные?',
    'live.cap':'Response mosaic · 42 ответа',
    'live.dev':'Доминирующая ошибка: B · 43%',
    'live.f1':'Вопрос транслирован','live.f2':'ответы собираются',
    'under':'Это — <b>cast</b>: вопрос на экране, ответы в телефоне. Так передаётся каждый вопрос.',
    'auth.k':"Аккаунт Deborah",'auth.h2':"Войдите в аккаунт",'auth.t1':'Вход','auth.t2':'Регистрация','auth.login':'Вход','auth.register':'Регистрация','auth.doneReg':'Вы зарегистрированы. Теперь можете войти.',
    'auth.google':'Войти через Google',
    'auth.loginId':'Email или имя пользователя',
    'auth.username':'Имя пользователя',
    'auth.userFree':'✓ Свободно — подходит',
    'auth.userTaken':'Это имя занято — выберите другое',
    'auth.userReserved':'Это имя зарезервировано системой',
    'auth.userInvalid':'2–50 символов: латиница, цифры, . _ -',
    'auth.passHint':'Минимум 8 символов — буквы и цифры',
    'auth.role':'Ваша роль','auth.roleStudent':'Студент','auth.roleTeacher':'Преподаватель','auth.teacherLink':'Полная заявка преподавателя →',
    'err.net':'Ошибка сети — попробуйте ещё раз',
    'err.wait':'Подождите несколько секунд...','auth.or':'или по email',
    'auth.name':'Имя и фамилия','auth.email':'Email','auth.pass':'Пароль',
    'auth.login':'Вход','auth.register':'Отправить запрос администратору',
    'auth.doneLogin':'Вход откроется после подтверждения доступа.',
    'admin.btn':'Admin','admin.k':'Панель админа','admin.h3':'Вход <em>администратора</em>','admin.p':'Только для администраторов.',
    'admin.loginL':'Логин','admin.passL':'Пароль','admin.go':'Войти','admin.err':'Неверный логин или пароль.','admin.ok':'Вход успешен',
    'ftr.col1t':'Страницы','ftr.l1':'Главная','ftr.l2':'Cast','ftr.l3':'Вход','ftr.l4':'Регистрация',
'ftr.teachers':'Преподавателям',
    'ftr.col2t':'Документы','ftr.l5':'Политика конфиденциальности','ftr.l6':'Условия использования','ftr.l7':'Политика cookies','ftr.l8':'Правовая информация',
    'ftr.col3t':'Контакты','ftr.l9':'Статус',
    'ftr.col4t':'Язык',
    'prov.g.off':'Вход через Google не настроен на сервере (GOOGLE_CLIENT_ID). Обратитесь к администратору — пока входите по email.',
    
    'ftr.legal':"© 2026 Deborah · Для преподавателей — ИИ-помощник",

    /* S33: namuna (index.html) boLimlari */
    "nav.feat":"Возможности",
    "nav.qadam":"Шаги",
    "nav.signal":"Сигнал",
    "hero.kicker":"Для преподавателей · С ИИ-помощником",
    "hero.h1":"Работа преподавателя — <em>легче</em>.<br>Занятие — эффективнее.",
    "hero.lede":"Составление вопросов, слайды, проверка, обработка бумажных бланков — ИИ-помощник делает это за секунды. Вы уделяете время занятию и студентам.",
    "hero.cta1":"Начать бесплатно",
    "hero.cta2":"Возможности",
    "hero.scroll":"Листайте · возможности",
    "stats.s1":"Вопрос за секунды — с ИИ",
    "stats.s2":"ИИ-функций",
    "stats.s3":"Рост понимания",
    "feat.k":"Возможности",
    "feat.h2":"Возможности, которые <em>облегчают работу преподавателя</em>.",
    "feat.p":"ИИ-помощник берёт на себя рутину — вы занимаетесь преподаванием.",
    "feat.hint":"Выберите возможность — откроются детали",
    "feat.c1t":"Генерация вопросов ИИ",
    "feat.c1s":"Тестовые вопросы по теме за секунды.",
    "feat.c1m":"Распределение 50/30/20 и валидаторы; можно брать из готового банка.",
    "feat.c2t":"Слайды ИИ",
    "feat.c2s":"Презентация занятия готовится автоматически.",
    "feat.c2m":"Экспорт в Canva, Google Slides и Gamma одним действием.",
    "feat.c3t":"Проверка ИИ",
    "feat.c3s":"Свободные ответы проверяются автоматически.",
    "feat.c3m":"По рубрике и критериям; результат подтверждается на сервере.",
    "feat.c4t":"Рекомендация материалов",
    "feat.c4s":"Чтение для каждой темы.",
    "feat.c4m":"Статьи и источники подбираются автоматически.",
    "feat.c5t":"Бумага + OCR",
    "feat.c5s":"Бумажные бланки сканируются.",
    "feat.c5m":"Разметка OMR, рукописный и печатный текст — всё в одном месте.",
    "feat.c6t":"Банк вопросов",
    "feat.c6s":"Импорт/экспорт QTI и рубрики.",
    "feat.c6m":"Вопросы, рубрики и компетенции — в одном банке.",
    "feat.c7t":"Живая викторина",
    "feat.c7s":"Вопрос выводится на экран.",
    "feat.c7m":"Ответы собираются в реальном времени; сигнал и mosaic.",
    "feat.c8t":"Отчёты",
    "feat.c8s":"Автоматический отчёт после занятия.",
    "feat.c8m":"Анализ и результаты на уровне аудитории.",
    "feat.c9t":"Надзор за экзаменом",
    "feat.c9s":"Контроль с видеосвидетельством.",
    "feat.c9m":"Профили безопасности и события проктора.",
    "qadam.k":"Как это работает",
    "qadam.h2":"Три простых <em>шага</em>.",
    "qadam.p":"Подготовьте, выведите на экран, проанализируйте — остальное система делает сама.",
    "qadam.cite":"Создать → Вывести → Проанализировать",
    "qadam.l1":"01 · СОЗДАТЬ",
    "qadam.l2":"02 · ВЫВЕСТИ",
    "qadam.l3":"03 · АНАЛИЗ",
    "qadam.c1t":"Создать",
    "qadam.c1p":"Вопрос готовится с ИИ или выбирается из банка — за секунды.",
    "qadam.c2t":"Вывести",
    "qadam.c2p":"Вопрос выводится на экран аудитории; ответы открываются на телефонах.",
    "qadam.c3t":"Анализ",
    "qadam.c3p":"Сигнал и отчёт: состояние аудитории с одного взгляда.",
    "signal.k":"Сигнал аудитории",
    "signal.h2":"Понимание измеряется <em>доказательством</em>.",
    "signal.p":"Один вопрос, одно обсуждение: понимание выросло с 43% до 82% — измерено и подтверждено.",
    "signal.col1":"Первый замер",
    "signal.col2":"После обсуждения",
    "signal.mos1":"Response mosaic · 42 ответа",
    "signal.mos2":"После обсуждения",
    "signal.foot":"Один вопрос · понимание <b>43% → 82%</b>",
    "signal.note":"Подтверждено сервером · личный рейтинг конфиденциален",
    "cred.c1":"Вход через Google",
    "cred.c2":"Подтверждение сервером",
    "cred.c3":"WCAG 2.2 AA",
    "cred.c4":"Импорт QTI",
    "cta.h2":"Сделайте работу <em>проще</em>.",
    "cta.stamp":"AI · CAST · SIGNAL · ОТЧЁТ",
    "cta.p":"Доступ назначается администрацией вуза. Пока идёт одобрение — изучите возможности.",
    "cta.b1":"Вход",
    "cta.b2":"Возможности",
    "ftr.l2b":"Возможности",
  },
  en:{
    'hdr.kirish':'Sign in',
    'hm.kirish':'Sign in','hm.cast':'Cast','hm.documents':'Documents',
    'join.k':'Ready cast',
    'join.h3':'Join the <em>cast</em>',
    'join.p':'Enter the code.',
    'join.err':'The code must be 5–6 characters (cast: 6 letters/digits).',
    'join.go':'Join',
    'join.load':'Connecting… <i></i>',
    'join.ok':'You joined the cast. Waiting for the question.',
    'nav.cast':'Cast','nav.kirish':'Sign in','nav.register':'Sign up',
    'head.kicker':'Cast a question to the class screen',
    'head.h1':'Question — <em>on screen</em>. Answer — on phone.',
    'head.p':'With one action the question appears on the class screen. Answers are collected in real time.',
    'beam.tx':'casting…',
    'live.live':'live',
    'live.q':'Which SQL operator removes duplicate rows and returns only unique ones?',
    'live.cap':'Response mosaic · 42 answers',
    'live.dev':'Dominant error: B · 43%',
    'live.f1':'Question cast','live.f2':'collecting answers',
    'under':'This is <b>cast</b>: question on screen, answers on phones. Every question is delivered this way.',
    'auth.k':"Deborah account",'auth.h2':"Sign in to your account",'auth.t1':'Sign in','auth.t2':'Register','auth.login':'Sign in','auth.register':'Register','auth.doneReg':'You are registered. You can now sign in.',
    'auth.google':'Sign in with Google',
    'auth.loginId':'Email or username',
    'auth.username':'Username',
    'auth.userFree':'✓ Available — good pick',
    'auth.userTaken':'This username is taken — try another',
    'auth.userReserved':'This name is reserved by the system',
    'auth.userInvalid':'2–50 chars: letters, digits, . _ -',
    'auth.passHint':'At least 8 characters — letters and digits',
    'auth.role':'Your role','auth.roleStudent':'Student','auth.roleTeacher':'Teacher','auth.teacherLink':'Full teacher application →',
    'err.net':'Network error — please retry',
    'err.wait':'Please wait a few seconds...','auth.or':'or with email',
    'auth.name':'Full name','auth.email':'Email','auth.pass':'Password',
    'auth.login':'Sign in','auth.register':'Send request to admin',
    'auth.doneLogin':'Sign-in opens after access approval.',
    'admin.btn':'Admin','admin.k':'Admin panel','admin.h3':'Administrator <em>sign-in</em>','admin.p':'Administrators only.',
    'admin.loginL':'Login','admin.passL':'Password','admin.go':'Sign in','admin.err':'Wrong login or password.','admin.ok':'Sign-in successful',
    'ftr.col1t':'Pages','ftr.l1':'Home','ftr.l2':'Cast','ftr.l3':'Sign in','ftr.l4':'Register',
'ftr.teachers':'For instructors',
    'ftr.col2t':'Documents','ftr.l5':'Privacy policy','ftr.l6':'Terms of use','ftr.l7':'Cookie policy','ftr.l8':'Legal notice',
    'ftr.col3t':'Contact','ftr.l9':'Status',
    'ftr.col4t':'Language',
    'prov.g.off':'Google sign-in is not configured on the server (GOOGLE_CLIENT_ID). Contact the administrator — use email for now.',
    
    'ftr.legal':"© 2026 Deborah · For instructors — AI assistant",

    /* S33: namuna (index.html) boLimlari */
    "nav.feat":"Capabilities",
    "nav.qadam":"Steps",
    "nav.signal":"Signal",
    "hero.kicker":"For instructors · With an AI assistant",
    "hero.h1":"Instructor work — <em>lighter</em>.<br>Lessons — more effective.",
    "hero.lede":"Writing questions, slides, grading, scanning paper — the AI assistant does these in seconds. You spend time on teaching and students.",
    "hero.cta1":"Start free",
    "hero.cta2":"Capabilities",
    "hero.scroll":"Scroll · capabilities",
    "stats.s1":"Question ready in seconds — with AI",
    "stats.s2":"AI-assisted features",
    "stats.s3":"Understanding growth",
    "feat.k":"Capabilities",
    "feat.h2":"Capabilities that <em>lighten the instructor's work</em>.",
    "feat.p":"The AI assistant handles the routine — you focus on teaching.",
    "feat.hint":"Select a capability to see the details",
    "feat.c1t":"AI question generation",
    "feat.c1s":"MCQs from a topic in seconds.",
    "feat.c1m":"50/30/20 split with validators; can also pick from the ready bank.",
    "feat.c2t":"AI slides",
    "feat.c2s":"Lesson decks generated automatically.",
    "feat.c2m":"Export to Canva, Google Slides and Gamma with one action.",
    "feat.c3t":"AI grading",
    "feat.c3s":"Free-form answers graded automatically.",
    "feat.c3m":"Based on a rubric and criteria; result is server-confirmed.",
    "feat.c4t":"Article suggestions",
    "feat.c4s":"Reading for every topic.",
    "feat.c4m":"Articles and sources are recommended automatically.",
    "feat.c5t":"Paper + OCR",
    "feat.c5s":"Paper answer sheets are scanned.",
    "feat.c5m":"OMR marking, handwriting and text OCR — all in one place.",
    "feat.c6t":"Question bank",
    "feat.c6s":"QTI import/export and rubrics.",
    "feat.c6m":"Questions, rubrics and competencies — in one bank.",
    "feat.c7t":"Live quiz",
    "feat.c7s":"Cast the question to the screen.",
    "feat.c7m":"Answers are collected live; signal and mosaic shown.",
    "feat.c8t":"Reports",
    "feat.c8s":"Automatic report after each session.",
    "feat.c8m":"Class-level analysis and results.",
    "feat.c9t":"Exam proctoring",
    "feat.c9s":"Proctoring with camera evidence.",
    "feat.c9m":"Security profiles and proctor events.",
    "qadam.k":"How it works",
    "qadam.h2":"Three simple <em>steps</em>.",
    "qadam.p":"Prepare, cast, analyze — the system does the rest.",
    "qadam.cite":"Create → Cast → Analyze",
    "qadam.l1":"01 · CREATE",
    "qadam.l2":"02 · CAST",
    "qadam.l3":"03 · ANALYZE",
    "qadam.c1t":"Create",
    "qadam.c1p":"A question is drafted with AI or picked from the bank — in seconds.",
    "qadam.c2t":"Cast",
    "qadam.c2p":"The question appears on the class screen; answers open on phones.",
    "qadam.c3t":"Analyze",
    "qadam.c3p":"Signal and report: read the room at a glance.",
    "signal.k":"Class signal",
    "signal.h2":"Understanding is measured with <em>evidence</em>.",
    "signal.p":"One question, one discussion: understanding rose from 43% to 82% — measured and confirmed.",
    "signal.col1":"First measurement",
    "signal.col2":"After discussion",
    "signal.mos1":"Response mosaic · 42 answers",
    "signal.mos2":"After discussion",
    "signal.foot":"One question · understanding <b>43% → 82%</b>",
    "signal.note":"Server-confirmed · private ratings stay confidential",
    "cred.c1":"Google sign-in",
    "cred.c2":"Server-confirmed",
    "cred.c3":"WCAG 2.2 AA",
    "cred.c4":"QTI import",
    "cta.h2":"Make work <em>easier</em>.",
    "cta.stamp":"AI · CAST · SIGNAL · REPORT",
    "cta.p":"Access is granted by the university administration. While approval is pending, explore the capabilities.",
    "cta.b1":"Sign in",
    "cta.b2":"Capabilities",
    "ftr.l2b":"Features",
  }};
  var TITLES={uz:'Deborah — savolni sinf ekraniga uzatish',ru:'Deborah — трансляция вопроса на экран',en:'Deborah — cast questions to the class screen'};
  function applyLang(lang){
    var d=I18N[lang]||I18N.uz;
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var k=el.getAttribute('data-i18n');
      if(d[k]!==undefined)el.innerHTML=d[k];
    });
    document.documentElement.setAttribute('lang', lang === 'uz-cyrl' ? 'uz-Cyrl' : lang); /* S14: BCP-47 canonical */
    document.title=TITLES[lang]||d.title;
    document.querySelectorAll('.lang button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-lang')===lang);});
    try{localStorage.setItem('deborah-lang',lang);}catch(e){}
    /* Real formalar: hidden lang sinxron */
    ['loginLang','regLang'].forEach(function(id){var i=document.getElementById(id);if(i)i.value=lang;});
  }
  function applyTheme(t){
    /* DeborahTheme engine (theme-core.js) — yagona haqiqat manbai (S07) */
    if(window.DeborahTheme&&window.DeborahTheme.setState){window.DeborahTheme.setState(t);}
    else{document.documentElement.setAttribute('data-theme',t);}
  }
  var savedLang='uz',savedTheme='dark';
  /* BUG-092 (S14): path-based sahifalar (/ru,/en,/uz-cyrl) — server tili USTUN.
     Oldin localStorage (default 'uz') har yuklanishda server renderini bosib o'tardi:
     /ru havolasi ochilsa ham kontent uz'ga qaytardi (SEO/ulashish havolalari buzilgan). */
  var _pl=location.pathname.split('/')[1];
  var pathLang=({'ru':'ru','en':'en','uz-cyrl':'uz-cyrl'})[_pl]||null;
  try{
    savedLang=pathLang||localStorage.getItem('deborah-lang')||'uz';
    /* I18Nga uz-cyrl qo'shildi (BUG-089c) — pathLang qoladi, server+klient bir xil til */
    // Engine kaliti (deborah-theme-state) birinchi — tanlangan tema saqlansin;
    // eski demo kaliti (deborah-theme) migratsiya; hamma yo'q = demo odati: birinchi tashrif dark.
    savedTheme=localStorage.getItem('deborah-theme-state')||localStorage.getItem('deborah-theme')||'dark';
  }catch(e){}
  applyTheme(savedTheme);
  if(savedLang) applyLang(savedLang); /* /uz-cyrl: server render (kirill) o'zgarmaydi */
  document.querySelectorAll('.lang button').forEach(function(b){
    b.addEventListener('click',function(){applyLang(b.getAttribute('data-lang'));});
  });
  document.querySelectorAll('[data-lang2]').forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();applyLang(a.getAttribute('data-lang2'));});
  });
  /* O'yinga kirish (kod) */
  
  /* ═══ REAL: Join (kod) → /play?code= ═══ */
  var joinOv=document.getElementById('joinOverlay');
  var joinCode=document.getElementById('jcode');
  var joinErr=document.getElementById('joinErr');
  var joinGo=document.getElementById('joinGo');
  var joinMsg=document.getElementById('joinMsg');
  function openJoin(){joinOv.classList.add('open');joinCode.value='';joinErr.classList.remove('show');joinMsg.classList.remove('show');joinGo.style.display='inline-block';setTimeout(function(){joinCode.focus();},80);}
  function closeJoin(){joinOv.classList.remove('open');}
  document.getElementById('joinClose').addEventListener('click',closeJoin);
  joinOv.addEventListener('click',function(e){if(e.target===joinOv)closeJoin();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&joinOv.classList.contains('open'))closeJoin();});
  joinCode.addEventListener('input',function(){
    /* BUG-049: cast kodlari A-Z2-9 (6 belgi) — faqat raqam emas */
    joinCode.value=joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7);
    joinErr.classList.remove('show');
  });
  joinGo.addEventListener('click',function(){
    var v=joinCode.value.trim().toUpperCase();
    if(!/^[A-Z0-9]{5,6}$/.test(v)){joinErr.classList.add('show');joinCode.focus();return;}
    joinErr.classList.remove('show');
    joinMsg.classList.add('show');
    joinMsg.querySelector('.ok').style.display='none';
    joinMsg.querySelector('.load').style.display='flex';
    /* REAL: cast sessiyasiga o'tish */
    window.location.href='/play?code='+encodeURIComponent(v);
  });
  document.querySelectorAll('a[href="#cast"]').forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();openJoin();});
  });
  /* Hamburger menyu */
  var hbtn=document.getElementById('hbtn'),hmenu=document.getElementById('hmenu');
  hbtn.addEventListener('click',function(e){e.stopPropagation();var open=hmenu.classList.toggle('open');hbtn.setAttribute('aria-expanded',open?'true':'false');});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){hmenu.classList.remove('open');hbtn.setAttribute('aria-expanded','false');}});
  document.addEventListener('click',function(e){
    if(!hmenu.contains(e.target)&&e.target!==hbtn)hmenu.classList.remove('open');
  });
  hmenu.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){hmenu.classList.remove('open');});});


  /* ═══ Tabs (Kirish / Ro'yxatdan o'tish) ═══ */
  var tabs=document.querySelectorAll('.tabs button');
  var fLogin=document.getElementById('fLogin'),fReg=document.getElementById('fReg');
  tabs.forEach(function(b){
    b.addEventListener('click',function(){
      var t=b.getAttribute('data-tab');
      tabs.forEach(function(x){x.classList.toggle('on',x===b);});
      fLogin.style.display=(t==='login')?'block':'none';
      fReg.style.display=(t==='reg')?'block':'none';
    });
  });

  /* ═══ REAL: Providerlar (Google) ═══ */
  var PROV=(window.__AUTH_PROVIDERS||{});
  document.querySelectorAll('.provider').forEach(function(b){
    b.addEventListener('click',function(){
      var d=I18N[document.documentElement.getAttribute('lang')]||I18N.uz;
      var prov=b.getAttribute('data-prov');
      var url='/auth/google';
      var on=PROV.google;
      if(on){window.location.href=url;return;}
      var msg=b.closest('form').querySelector('.auth-msg');
      if(msg){
        msg.textContent=d['prov.g.off'];
        msg.classList.add('show');
        setTimeout(function(){msg.classList.remove('show');},5200);
      }
    });
  });

  /* ═══ REAL: fReg — username LIVE tekshiruv (band/mavjud) ═══ */
  var doneReg=document.getElementById('doneReg');
  var rUser=document.getElementById('rUser');
  var rUserHint=document.getElementById('rUserHint');
  var userState={ok:false,checked:''};
  var userTimer=null;
  function L(){return I18N[document.documentElement.getAttribute('lang')]||I18N.uz;}
  rUser.addEventListener('input',function(){
    var v=rUser.value.trim();
    rUser.classList.remove('ok','err');rUserHint.className='fld-hint';rUserHint.textContent='';
    userState={ok:false,checked:v};
    clearTimeout(userTimer);
    if(!v){return;}
    if(v.length<2||v.length>50){rUser.classList.add('err');rUserHint.classList.add('err');rUserHint.textContent=L()['auth.userInvalid'];return;}
    userTimer=setTimeout(function(){
      fetch('/user/login/username-check?username='+encodeURIComponent(v),{credentials:'same-origin'})
        .then(function(r){return r.json();})
        .then(function(j){
          if(userState.checked!==v||j.reason==='rate'){return;}
          if(j.ok){rUser.classList.add('ok');rUserHint.classList.add('ok');rUserHint.textContent=L()['auth.userFree'];userState={ok:true,checked:v};}
          else{rUser.classList.add('err');rUserHint.classList.add('err');rUserHint.textContent=L()[j.reason==='taken'?'auth.userTaken':j.reason==='reserved'?'auth.userReserved':'auth.userInvalid'];userState={ok:false,checked:v};}
        }).catch(function(){});
    },450);
  });

  /* ═══ REAL: fetch submit (X-Landing JSON rejimi) — xato JOYIDA, 2-panel YO'Q ═══ */
  function submitAuth(formId,msgId,preCb){
    var form=document.getElementById(formId);
    var msg=document.getElementById(msgId);
    var btn=form.querySelector('.auth-submit');
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var d=L();
      if(preCb&&preCb(d)===false){return;}
      btn.disabled=true;var old=btn.innerHTML;btn.textContent=d['err.wait']||'...';
      msg.classList.remove('show');
      fetch(form.getAttribute('action'),{
        method:'POST',
        headers:{'content-type':'application/x-www-form-urlencoded','X-Landing':'1'},
        body:new URLSearchParams(new FormData(form)).toString(),
        credentials:'same-origin'
      }).then(function(r){return r.json().then(function(j){return {s:r.status,j:j};});})
        .then(function(r){
          if(r.j&&r.j.ok&&r.j.redirect){window.location.href=r.j.redirect;return;}
          msg.textContent=(r.j&&r.j.error)||d['err.net'];
          msg.classList.add('show');
        })
        .catch(function(){msg.textContent=d['err.net'];msg.classList.add('show');})
        .then(function(){btn.disabled=false;btn.innerHTML=old;});
    });
  }
  submitAuth('fLogin','doneLogin');
  submitAuth('fReg','doneReg',function(d){
    var v=rUser.value.trim();
    if(v&&rUser.classList.contains('err')){
      doneReg.textContent=rUserHint.textContent||d['auth.userInvalid'];
      doneReg.classList.add('show');
      return false;
    }
    /* BUG-035: O'qituvchi roli tanlanganda NATIV POST — server to'liq
       /user/register ariza sahifasini prefilled render qiladi (university/
       subject maydonlari u yerda). AJAX bu holatda HTML'ni o'qiy olmaydi. */
    var roleSel=document.querySelector('#fReg input[name="role"]:checked');
    if(roleSel&&roleSel.value==='teacher'){document.getElementById('fReg').submit();return false;}
    return true;
  });

  /* ═══ Tema — yumshoq o'tish (DeborahTheme engine) ═══ */
  var fx=document.getElementById('modeFx');
  document.getElementById('themeBtn').addEventListener('click',function(){
    var next=document.documentElement.getAttribute('data-resolved-theme')==='light'?'dark':'light';
    var oldBg=getComputedStyle(document.body).backgroundColor;
    fx.style.transition='none';
    fx.style.background=oldBg;
    fx.style.opacity='1';
    void fx.offsetWidth;
    applyTheme(next);
    fx.style.transition='opacity .5s ease';
    fx.style.opacity='0';
  });
/* ── Mosaic (mini) ── */
  var mini=document.getElementById('mini');
  var cells=[];
  (function(){
    var dist=[20,43,27,10],n=42,arr=[];
    dist.forEach(function(d,i){var c=Math.round(d*n/100);for(var k=0;k<c;k++)arr.push(i);});
    while(arr.length<n)arr.push(-1);
    for(var i=arr.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}
    var cls=['cr','gd','gr','bl'];
    arr.forEach(function(v){
      var d=document.createElement('div');
      d.className='cell'+(v<0?'':' '+cls[v]);
      d.style.opacity=0;
      mini.appendChild(d);cells.push(d);
    });
  })();
  /* ── Cast demo: avtomatik aylanish ── */
  var q=document.getElementById('q');
  var optEls=document.querySelectorAll('[data-opt]');
  var bars=document.querySelectorAll('.opt .track i');
  var cap=document.querySelector('.cap');
  var devnote=document.getElementById('devnote');
  var beam=document.getElementById('beam');
  var T={q:1300,opts:2100,bars:3000,mosaic:3200,note:4300,total:9000};
  var timers=[];
  function clearT(){timers.forEach(clearTimeout);timers=[];}
  function reset(){
    clearT();
    beam.style.opacity=0;
    q.classList.remove('in');
    optEls.forEach(function(o){o.classList.remove('in');});
    cap.classList.remove('in');
    devnote.style.opacity=0;
    bars.forEach(function(b){b.style.width='0';});
    cells.forEach(function(c){c.style.opacity=0;c.style.transitionDelay='0s';});
  }
  /* Demo doimiy jonli: cheksiz aylanish (har bir savol sikli 9s).
     To'xtab qolmasligi kerak — aks holda savol/vaqt 'yurmayapti' tuyuladi. */
  var runId=0;
  function run(){
    reset();
    runId++;
    timers.push(setTimeout(function(){beam.style.opacity=1;},120));
    timers.push(setTimeout(function(){beam.style.opacity=0;q.classList.add('in');},T.q));
    optEls.forEach(function(o,ix){
      timers.push(setTimeout(function(){o.classList.add('in');},T.opts+ix*140));
    });
    timers.push(setTimeout(function(){
      cap.classList.add('in');
      bars.forEach(function(b){b.style.width=b.getAttribute('data-w')+'%';});
    },T.bars));
    cells.forEach(function(c,ix){
      timers.push(setTimeout(function(){c.style.transitionDelay=(ix%10)*90+'ms';c.style.opacity=1;},T.mosaic));
    });
    timers.push(setTimeout(function(){devnote.style.opacity=1;},T.note));
    // Har bir savol sikli boshida vaqt 01:24 ga qaytadi — real cast'dagi
    // savol taymeri kabi; aks holda 00:00 da qotib 'yurmayapti' ko'rinadi.
    t=85;
    var st=document.getElementById('scTime');if(st){st.textContent='01:24';}
    timers.push(setTimeout(run,T.total));
  }
  var t=84;
  var tick=function(){
    t--;if(t<0)t=0;
    var m=('0'+Math.floor(t/60)).slice(-2),s=('0'+(t%60)).slice(-2);
    var st=document.getElementById('scTime');if(st)st.textContent=m+':'+s;
  };
  function freezeDemo(){
    /* PW/S33 determinizm: animatsiyasiz yakuniy holat — har run bir xil shot.
       (setTimeout/setInterval'lar visual testlarda o'chirilgan; boshlang'ich
       state hech qanday timer'ga bog'liq bo'lmasligi kerak.) */
    reset();
    q.classList.add('in');
    optEls.forEach(function(o){o.classList.add('in');});
    cap.classList.add('in');
    bars.forEach(function(b){b.style.width=b.getAttribute('data-w')+'%';});
    cells.forEach(function(c){c.style.opacity=1;c.style.transitionDelay='0s';});
    devnote.style.opacity=1;
    beam.style.opacity=0;
    var el=document.getElementById('scTime');if(el)el.textContent='01:24';
  }
  if (window.__PW_FREEZE__) { freezeDemo(); }
  else {
    setInterval(tick,1000);
    setTimeout(run,700);
  }

  /* ═══ S33 (uploads/index.html): Reveal ═══ */
  var rio = ('IntersectionObserver' in window) ? new IntersectionObserver(function(es){
    es.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); rio.unobserve(en.target); } });
  },{threshold:.15}) : null;
  if (rio) document.querySelectorAll('.reveal').forEach(function(el){ rio.observe(el); });
  else document.querySelectorAll('.reveal').forEach(function(el){ el.classList.add('in'); });

  /* ═══ S33: Stats counter ═══ */
  var stWrap = document.querySelector('.stats');
  if (stWrap) {
    var counted=false;
    var cio=new IntersectionObserver(function(es){es.forEach(function(en){
      if(en.isIntersecting&&!counted){counted=true;countStats();}
    })},{threshold:.4});
    cio.observe(stWrap);
    function countStats(){
      var a=0,b=0,c=0,d=0,ti=0;
      var iv=setInterval(function(){
        ti++;
        a=Math.min(30,Math.round(30*ti/50));
        b=Math.min(10,Math.round(10*ti/50));
        c=Math.min(43,Math.round(43*ti/50));
        d=Math.min(82,Math.round(82*ti/50));
        var e1=document.getElementById('st1'),e2=document.getElementById('st2'),e3=document.getElementById('st3');
        if(e1)e1.textContent=a+' s';
        if(e2)e2.textContent=b+'+';
        if(e3)e3.textContent=c+'% \u2192 '+d+'%';
        if(ti>=50)clearInterval(iv);
      },30);
    }
  }

  /* ═══ S33: Imkoniyatlar — f-card tanlash (blur focus) ═══ */
  var grid3=document.querySelector('.grid3');
  var activeCard=null;
  function closeCard(){
    if(!activeCard)return;
    var c=activeCard; activeCard=null;
    grid3.classList.remove('has-active');
    var first=c.getBoundingClientRect(); /* fixed markazdagi (katta) holat */
    c.classList.remove('active');        /* grid oqimiga qaytadi */
    var last=c.getBoundingClientRect();  /* o'z katakchasidagi (kichik) holat */
    var dx=first.left-last.left, dy=first.top-last.top;
    var sx=first.width/last.width, sy=first.height/last.height;
    /* FLIP: katta holatdan o'z katakchasiga qaytish.
       BUG fix: oxirgi transform 'translate(-50%,-50%) scale(1)' qolib ketardi —
       karta gridga qaytgach 50% chapga-yuqoriga surilgan ko'rinardi
       ("boshqa tepaga qaytyapti"). Endi animatsiya tugagach transform TOZALANADI. */
    c.style.transition='none';
    c.style.transform='translate('+dx+'px,'+dy+'px) scale('+sx+','+sy+')';
    void c.offsetWidth;
    c.style.transition='transform .4s cubic-bezier(.22,.61,.36,1)';
    c.style.transform='translate(0,0) scale(1,1)';
    setTimeout(function(){c.style.transition='';c.style.transform='';},420);
  }
  function openCard(c){
    if(activeCard){closeCard();if(activeCard===c)return;}
    c.classList.add('in'); /* BUG fix: reveal translateY(26px) keyinroq qaytmasin — karta 'ko'rilgan' hisoblanadi */
    grid3.classList.add('has-active');
    var first=c.getBoundingClientRect();
    c.classList.add('active');
    var last=c.getBoundingClientRect();
    var dx=first.left-last.left, dy=first.top-last.top;
    var sx=first.width/last.width, sy=first.height/last.height;
    c.style.transition='none';
    c.style.transform='translate(calc(-50% + '+dx+'px), calc(-50% + '+dy+'px)) scale('+sx+','+sy+')';
    void c.offsetWidth;
    c.style.transition='transform .45s cubic-bezier(.22,.61,.36,1)';
    c.style.transform='translate(-50%,-50%) scale(1)';
    activeCard=c;
  }
  if(grid3){
    grid3.querySelectorAll('.f-card').forEach(function(c){
      c.addEventListener('click',function(){
        if(c.classList.contains('active')){closeCard();}
        else{openCard(c);}
      });
    });
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeCard();});
    document.addEventListener('click',function(e){
      if(activeCard&&!activeCard.contains(e.target)&&e.target!==grid3)closeCard();
    });
  }

  /* ═══ S33: Qadamlar — route runner ═══ */
  var svg=document.querySelector('.route-svg');
  var route=document.getElementById('route');
  var gold=document.getElementById('routeGold');
  var runner=document.getElementById('runner');
  var checks=document.querySelectorAll('.j-check');
  var cards=document.querySelectorAll('.j-card');
  var totalLen=route?route.getTotalLength():0;
  if(totalLen){gold.style.strokeDasharray=totalLen;gold.style.strokeDashoffset=totalLen;}
  function onScroll(){
    if(!route||!svg)return;
    var r=svg.getBoundingClientRect(),vh=window.innerHeight;
    var p=Math.min(Math.max((vh*.6-r.top)/(r.height+vh*.3),0),1);
    var pt=route.getPointAtLength(totalLen*p);
    runner.setAttribute('transform','translate('+pt.x+','+pt.y+')');
    runner.style.opacity=(p>.02&&p<.98)?1:0;
    gold.style.strokeDashoffset=totalLen*(1-p);
    checks.forEach(function(c,i){
      c.classList.toggle('on',p>=(i+.5)/checks.length-.04);
      var card=cards[i];
      if(card){card.style.borderColor=(p>=(i+.5)/checks.length-.1&&p<=(i+.5)/checks.length+.14)?'var(--line2)':'';}
    });
  }
  if(svg){window.addEventListener('scroll',onScroll,{passive:true});onScroll();}

  /* ═══ S33: Signal panel — mosaic + countUp ═══ */
  function mosaic(el,dist){
    if(!el)return;
    var n=42,cells=[];
    dist.forEach(function(d,i){var c=Math.round(d*n/100);for(var k=0;k<c;k++)cells.push(i);});
    while(cells.length<n)cells.push(-1);
    for(var i=cells.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=cells[i];cells[i]=cells[j];cells[j]=t;}
    var cls=['cr','gd','gr','bl'];
    cells.forEach(function(v){
      var d=document.createElement('div');
      d.className='cell'+(v<0?'':' '+cls[v]);
      el.appendChild(d);
    });
  }
  mosaic(document.getElementById('mgrid1'),[20,43,27,10]);
  mosaic(document.getElementById('mgrid2'),[82,10,5,3]);
  var panel=document.querySelector('.panel');
  if(panel){
    var counted2=false;
    var pio=new IntersectionObserver(function(es){es.forEach(function(en){
      if(en.isIntersecting&&!counted2){counted2=true;countUp();}
    })},{threshold:.35});
    pio.observe(panel);
    function countUp(){
      var cr=document.querySelector('.bar i.crimson'),gr=document.querySelector('.bar i.green');
      if(cr)cr.style.width='43%';
      if(gr)gr.style.width='82%';
      var n1=document.getElementById('n1'),n2=document.getElementById('n2');
      var a=0,b=0,ti=0;
      var iv=setInterval(function(){
        ti++;
        a=Math.min(43,Math.round(43*ti/60));
        b=Math.min(82,Math.round(82*ti/60));
        if(n1)n1.textContent=a+'%';
        if(n2)n2.textContent=b+'%';
        if(ti>=60)clearInterval(iv);
      },24);
    }
  }
})();
