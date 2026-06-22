# QuizBlitz — Cast Test Bot (mock-up)

Real odamlar yoki ko'plab qurilmalarsiz, cast (jonli o'yin) funksiyasini
to'liq sinash uchun ikki xil vosita:

1. **`test-arena.html`** — interaktiv, brauzerda ochiladigan ekran (tavsiya etiladi)
2. **`mock-up.js`** — terminalda ishlaydigan Node.js bot skripti

---

## 1) test-arena.html — Interaktiv Test Arena (tavsiya etiladi)

Ekran ikkiga bo'lingan:
- **Chap tomon (kichikroq)** — caster/host ekrani (`host-game.html`), real holatdagidek.
- **O'ng tomon (katta)** — siz haqiqiy 21-ishtirokchi sifatida ism/emoji
  kiritib qo'shiladigan `enter-game.html` ekrani.

Yuqoridagi panel orqali bir tugma bilan 20 ta bot o'yinchi qo'shiladi,
ular har bir savolga (sozlanadigan % bilan) avtomatik javob beradi —
siz esa shu bilan bir vaqtda haqiqiy o'yinchidek qo'lda ishtirok etasiz.

### Qanday ishlatiladi

1. `mock-up` papkasini loyihangiz papkasi ichiga, masalan repo root bilan
   bir qatorga joylashtiring (yoki `test-arena.html` yuqori qismidagi
   **"Yo'l"** maydonini `host-game.html`/`enter-game.html` ga nisbatan
   to'g'rilang — standart qiymat `../`).
2. `test-arena.html` faylini brauzerda to'g'ridan-to'g'ri oching
   (yoki GitHub Pages'ga joylab, link orqali oching).
3. Avval odatdagidek `user-panel.html` dan **Cast** orqali o'yin yarating,
   5 xonali kodni oling.
4. Test Arena'dagi **"Kod"** maydoniga kodni kiriting, **"Yuklash"** bosing —
   chapda host, o'ngda o'yinchi kirish ekrani paydo bo'ladi.
5. **"🤖 Botlarni qo'shish"** tugmasini bosing — 20 ta bot lobby'ga qo'shiladi.
6. O'ng paneldagi `enter-game.html` ekranida o'zingiz ism va emoji tanlab
   **haqiqiy 21-o'yinchi** sifatida qo'shiling.
7. Chap paneldagi host ekranida **"O'yinni Boshlash"** ni bosing — botlar
   har bir savolga avtomatik javob beradi, siz esa o'ngdan qo'lda javob
   berasiz. Yuqoridagi **"📋 Log"** tugmasi orqali botlar jarayonini kuzating.
8. **"🗑️ Tozalash"** — botlarni lobbydan olib tashlaydi (keyingi testdan oldin).

Sozlamalar (yuqori panelda): bot soni, to'g'ri javob %, javob berish %
(qolgani "vaqt tugadi" holatini simulyatsiya qiladi).

---

## 2) mock-up.js — Node.js bot skripti (terminal orqali, ekransiz)

Agar faqat fon jarayonini tezda sinab ko'rmoqchi bo'lsangiz (interaktiv
ekran kerak bo'lmasa), terminal orqali ishlaydigan versiya:

### O'rnatish

```bash
cd mock-up
npm install
```

## Ishlatish

1. `user-panel.html` orqali odatdagidek **Cast** tugmasini bosib o'yin yarating,
   5 xonali kodni eslab qoling (masalan `48213`).
2. `host-game.html` lobby ekranida ochiq turing.
3. Terminalda:

```bash
node mock-up.js 48213
```

Bu standart 20 ta bot, 70% to'g'ri javob ehtimoli, 95% javob berish
ehtimoli bilan ishga tushadi. Sozlamoqchi bo'lsangiz:

```bash
node mock-up.js 48213 15 0.5 0.9
#                kod  soni togri% javob%
```

4. `host-game.html`'da **"O'yinni Boshlash"** tugmasini bosing — botlar
   avtomatik ravishda har bir savolga turli kechikish (va to'g'ri/xato
   nisbatda) javob beradi. Terminalda jarayonni jonli kuzatishingiz mumkin.
5. O'yin tugagach skript o'zi to'xtaydi va yakuniy shoxsupani konsolga chiqaradi.

## Tozalash

Agar bot o'yinchilarni lobbydan olib tashlamoqchi bo'lsangiz (masalan testni
qayta boshlashdan oldin):

```bash
node mock-up.js cleanup 48213
```

## Eslatma

- Skript faqat Firebase Realtime Database bilan ishlaydi — brauzer yoki
  qurilma kerak emas.
- `time_ms` va javob to'g'riligi tasodifiy generatsiya qilinadi, shuning
  uchun ball hisoblash (`host-game.html`dagi `computeScores`) ham real
  sharoitdagidek turlicha natija beradi.
- Bir nechta marta ketma-ket sinash uchun har safar yangi cast kodi bilan
  ishlatish tavsiya etiladi (eski kodda botlar balli saqlanib qoladi).
