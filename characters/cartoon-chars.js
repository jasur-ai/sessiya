/**
 * QuizBlitz — Cartoon Characters Registry
 * ----------------------------------------
 * animation: 'always'  — doim harakatda
 * animation: 'hover'   — faqat ustiga bossada
 * animation: null      — hech qachon harakatsiz
 */

export const CARTOON_CHARS = [
  {
    id: 'baby-boss',
    name: 'Baby Boss',
    image: 'characters/baby-boss.svg',
    from: 'The Boss Baby (2017)',
    animation: 'always',
    animationStyle: 'sway 3s ease-in-out infinite'
  },
  {
    id: 'puss-in-boots',
    name: 'Puss in Boots',
    image: 'characters/puss-in-boots.svg',
    from: 'Shrek / DreamWorks',
    animation: 'hover',
    animationStyle: 'float 2.8s ease-in-out infinite'
  },
  {
    id: 'baby-boss-girl',
    name: 'Baby Boss Girl',
    image: 'characters/baby-boss-girl.svg',
    from: 'Family Business (2021)',
    animation: 'always',
    animationStyle: 'sway 3.4s ease-in-out infinite'
  },
  {
    id: 'puss-in-boots-nailles',
    name: 'Puss in Boots Nailles',
    image: 'characters/puss-in-boots-nailles.svg',
    from: 'Shrek / DreamWorks',
    animation: 'hover',
    animationStyle: 'float 3.1s ease-in-out infinite'
  },
  {
    id: 'kitty-softpaws',
    name: 'Kitty Softpaws',
    image: 'characters/kitty-softpaws.png',
    from: 'Puss in Boots (2011)',
    animation: 'hover',
    animationStyle: 'sway 2.6s ease-in-out infinite'
  },
  {
    id: 'tigress',
    name: 'Tigress',
    image: 'characters/tigress.png',
    from: 'Kung Fu Panda',
    animation: 'hover',
    animationStyle: 'sway 2.8s ease-in-out infinite'
  },
  {
    id: 'tai-lung',
    name: 'Tai Lung',
    image: 'characters/tai-lung.png',
    from: 'Kung Fu Panda',
    animation: null,
    animationStyle: null
  },
];
