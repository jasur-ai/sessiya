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
  ,
  {
    id: 'baby-boss-girl',
    name: 'Baby Boss Girl',
    image: 'characters/baby-boss-girl.svg',
    from: 'The Boss Baby: Family Business (2021)'
  }
  ,
  {
    id: 'puss-in-boots-nailles',
    name: 'Puss in Boots Nailles',
    image: 'characters/puss-in-boots-nailles.svg',
    from: 'Shrek / DreamWorks'
  }
  ,
  {
    id: 'kitty-softpaws',
    name: 'Kitty Softpaws',
    image: 'characters/kitty-softpaws.svg',
    from: 'Puss in Boots (2011)'
  }
  // Keyingi personajlar shu yerga qo'shiladi:
  // { id: 'shrek', name: 'Shrek', image: 'characters/shrek.png', from: 'Shrek (2001)' },
];
