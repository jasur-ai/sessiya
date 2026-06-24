/**
 * QuizBlitz — Cartoon Characters Registry
 * ----------------------------------------
 * Har bir personaj:
 *   id       — unikal kalit (Firebase player key qo'shimchasi sifatida ishlatiladi)
 *   name     — ko'rsatiladigan ism
 *   image    — characters/ papkasidagi rasm fayli nomi
 *   from     — qaysi multfilm/film
 *
 * Integratsiya: enter-game.html → "Cartoons" bo'limi (emoji tanlash ekranida)
 * Qo'shish uchun: rasmni characters/ ga, quyidagi massivga yozuv qo'shing.
 */

export const CARTOON_CHARS = [
  {
    id: 'baby-boss',
    name: 'Baby Boss',
    image: 'characters/baby-boss.png',
    from: 'The Boss Baby (2017)'
  }
  // Keyingi personajlar shu yerga qo'shiladi:
  // { id: 'shrek', name: 'Shrek', image: 'characters/shrek.png', from: 'Shrek (2001)' },
];
