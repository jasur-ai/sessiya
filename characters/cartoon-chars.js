/**
 * QuizBlitz — Cartoon Characters Registry
 * ----------------------------------------
 * Yangi personaj qo'shish uchun: rasmni characters/ ga qo'ying,
 * quyidagi massivga bir object qo'shing — user-panel.html avtomatik ko'rsatadi.
 */

export const CARTOON_CHARS = [
  {
    id: 'baby-boss',
    name: 'Baby Boss',
    image: 'characters/baby-boss.svg',
    from: 'The Boss Baby (2017)',
    border: 'rgba(56,189,248,.25)',
    borderHover: 'var(--gold)',
    bgHover: 'rgba(56,189,248,.08)',
    w: 80, h: 80
  },
  {
    id: 'puss-in-boots',
    name: 'Puss in Boots',
    image: 'characters/puss-in-boots.svg',
    from: 'Shrek / DreamWorks',
    border: 'rgba(255,140,0,.25)',
    borderHover: '#f5c430',
    bgHover: 'rgba(245,196,48,.08)',
    w: 80, h: 112
  },
  {
    id: 'baby-boss-girl',
    name: 'Baby Boss Girl',
    image: 'characters/baby-boss-girl.svg',
    from: 'Family Business (2021)',
    border: 'rgba(255,182,193,.25)',
    borderHover: '#ffb6c1',
    bgHover: 'rgba(255,182,193,.08)',
    w: 80, h: 112
  },
  {
    id: 'puss-in-boots-nailles',
    name: 'Puss in Boots Nailles',
    image: 'characters/puss-in-boots-nailles.svg',
    from: 'Shrek / DreamWorks',
    border: 'rgba(100,116,139,.25)',
    borderHover: 'var(--text)',
    bgHover: 'rgba(100,116,139,.08)',
    w: 80, h: 112
  },
  {
    id: 'kitty-softpaws',
    name: 'Kitty Softpaws',
    image: 'characters/kitty-softpaws.svg',
    from: 'Puss in Boots (2011)',
    border: 'rgba(80,80,120,.4)',
    borderHover: '#c0c0c0',
    bgHover: 'rgba(192,192,192,.08)',
    w: 80, h: 80
  },
  // Yangi personaj: { id, name, image, from, border, borderHover, bgHover, w, h }
];
