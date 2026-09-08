/* ─────────────────────────────────────────────────────────────────────────────
   Icon Kit — emoji → inline SVG converter (runtime, no-emoji policy)
   - Emojilarni monoxrom stroke SVG ikonkalarga almashtiradi (rangli emoji YO'Q).
   - DOM text-node darajasida ishlaydi: static markup ham, JS orqali qo'shilgan
     kontent ham (MutationObserver) konvert qilinadi.
   - Ishlatish:  <script src="/js/icon-kit.js"></script>  (auto-init)
   - Ichki registry utils/icons.js bilan bir xil uslubda (24px, stroke, round).
   - EMOJI_MAP ichida bo'lmagan belgilar o'zgartirilmaydi (typografik belgilar:
     ✓ ✗ ⬅ → • ★ kabi emas — bular aslida emoji emas va shunday qoladi).
   ───────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const NS_ATTR = 'xmlns="http://www.w3.org/2000/svg"';
  const S = (inner, cls) =>
    '<span class="ikw' + (cls ? ' ' + cls : '') + '"><svg class="ik" ' + NS_ATTR +
    ' viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + inner + '</svg></span>';

  const G = (d, fill) => fill
    ? '<path fill="currentColor" stroke="none" d="' + d + '"/>'
    : '<path d="' + d + '"/>';

  /* Har bir yozuv: emoji → svg ichki markup (24x24, stroke=currentColor). */
  const P = {
    /* ── status ── */
    circleCheck: '<circle cx="12" cy="12" r="9.3"/><path d="M8.2 12.4l2.7 2.7 5-5.6"/>',
    circleX: '<circle cx="12" cy="12" r="9.3"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
    warn: '<path d="M10.3 3.9L2.9 17.6a2 2 0 0 0 1.75 3h14.7a2 2 0 0 0 1.75-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.4"/><circle cx="12" cy="16.8" r=".45" fill="currentColor" stroke="none"/>',
    zap: '<path d="M13 2.5L4.8 13.6H11L10.5 21.5l8.7-11.6h-6.4z"/>',
    bulb: '<path d="M9 17.5h6M10.2 21h3.6M12 3.2a6.6 6.6 0 0 1 4.4 11.6c-.75.6-1.3 1.5-1.4 2.5H9c-.1-1-.55-1.9-1.4-2.5A6.6 6.6 0 0 1 12 3.2z"/>',
    hourglass: '<path d="M6.2 3.5h11.6M6.2 20.5h11.6M7.4 3.5c1.3 3.6 1.3 13.4 0 17M16.6 3.5c-1.3 3.6-1.3 13.4 0 17"/>',
    timer: '<circle cx="12" cy="13.6" r="7.6"/><path d="M12 9.7v4.1l2.7 1.7M9.6 3h4.8M12 3v3"/>',
    target: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/>',
    sparkles: '<path d="M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="M18.8 15.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    party: '<path d="M4.8 21L12 8.4 19.2 21H4.8z"/><path d="M12 8.4V3.2M8.6 6l1.2 1.8M15.4 6l-1.2 1.8"/>',
    boom: '<path d="M12 2.6l2 5.3 5.6.5-4.2 3.7 1.3 5.5L12 14.7l-4.7 2.9 1.3-5.5-4.2-3.7 5.6-.5z"/>',
    /* ── media / objects ── */
    save: '<path d="M4.5 4.5h11.5l3.5 3.5v11.5h-15z"/><path d="M8 4.5v5h8v-5M8.5 19.5v-6.5h7v6.5"/>',
    film: '<rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.2"/><path d="M7.6 4.6v14.8M16.4 4.6v14.8M3.2 9.4h4.4M3.2 14.6h4.4M16.4 9.4h4.4M16.4 14.6h4.4"/>',
    clapper: '<rect x="3.2" y="8.4" width="17.6" height="11.4" rx="2"/><path d="M3.2 10.8h17.6M3.2 8.4L5.2 3.6h4.6L8.6 8.4M9.8 8.4l1.4-4.8M12.6 8.4l1.3-4.8M15.3 8.4l1.3-4.8"/>',
    pause: '<path d="M9.2 5.4v13.2M14.8 5.4v13.2"/>',
    stopBox: '<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.8"/>',
    playBox: '<path d="M8.4 5.6l9.6 6.4-9.6 6.4z"/>',
    refresh: '<path d="M20.4 10.2a8.6 8.6 0 1 0-2 5.8"/><path d="M20.4 4.6v5.6h-5.6"/>',
    repeat: '<path d="M16.8 3.4l3.4 3.4-3.4 3.4"/><path d="M4.4 10.6V9.8a4.4 4.4 0 0 1 4.4-4.4H20.2"/><path d="M7.2 20.6L3.8 17.2l3.4-3.4"/><path d="M19.6 13.4v.8a4.4 4.4 0 0 1-4.4 4.4H3.8"/>',
    skip: '<path d="M5.4 6.4l8.4 5.6-8.4 5.6z"/><path d="M16.4 6v12"/>',
    shuffle: '<path d="M15.8 3.6H20.4v4.6M20.4 3.6l-6.4 6.4M8.2 13.6L3.6 18.2"/><path d="M3.6 3.6h4.6a6.6 6.6 0 0 1 4.6 2M20.4 20.4v-4.6a6.6 6.6 0 0 0-2-4.7"/>',
    folder: '<path d="M3.2 6.6h6.2l1.8 2.2h9.6v10.6a1.6 1.6 0 0 1-1.6 1.6H4.8a1.6 1.6 0 0 1-1.6-1.6z"/>',
    fileText: '<path d="M6.2 3.4h8.2l4.2 4.2v13h-12.4z"/><path d="M14.2 3.6v4.2h4.2M8.8 11.4h6.4M8.8 14.8h6.4M8.8 18.2h4"/>',
    scroll: '<path d="M6.5 4h11a1.5 1.5 0 0 1 1.5 1.5v13.5H7a2.5 2.5 0 0 1 0-5h10.5M6.5 15.5a1.5 1.5 0 0 0 0 3"/>',
    archive: '<rect x="3.4" y="4.4" width="17.2" height="5" rx="1.4"/><path d="M5 9.4V19a1.6 1.6 0 0 0 1.6 1.6h10.8A1.6 1.6 0 0 0 19 19V9.4M9.8 13.2h4.4"/>',
    clipboard: '<rect x="5.6" y="4.6" width="12.8" height="16" rx="2"/><path d="M9.2 4.6a2.8 2.8 0 0 1 5.6 0"/><path d="M9 10.4h6M9 14h6M9 17.6h4"/>',
    note: '<path d="M16.8 3.2a2.2 2.2 0 0 1 3.1 3.1L8.3 17.9l-4.4 1.2 1.2-4.4z"/>',
    chart: '<path d="M5.4 20.4V12M12 20.4V5.6M18.6 20.4v-6.8"/><path d="M3.2 20.4h17.6"/>',
    chat: '<path d="M21 11.8a8.3 8.3 0 0 1-8.4 8.2 8.6 8.6 0 0 1-3.8-.9L3.4 20.6l1.6-4.6a8.1 8.1 0 0 1-1-4.2 8.3 8.3 0 0 1 8.6-8.2 8.3 8.3 0 0 1 8.4 8.2z"/>',
    thought: '<path d="M8.2 18.4a3.9 3.9 0 0 1-.4-7.8 5.2 5.2 0 0 1 10-1.2 3.6 3.6 0 0 1 .9 7.1"/><path d="M9.3 12.4h.01M13.3 12.4h.01M17.3 12.4h.01"/>',
    speech: '<path d="M3.8 9.6v5.6a1.8 1.8 0 0 0 1.8 1.8h2.2l3.2 3.4v-3.4h5.4a1.8 1.8 0 0 0 1.8-1.8V9.6"/><path d="M9.4 13.6h6.8M9.4 16.8h3.4"/>',
    robot: '<rect x="4.6" y="8.6" width="14.8" height="10.6" rx="3"/><circle cx="9.4" cy="13.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="13.8" r="1.1" fill="currentColor" stroke="none"/><path d="M12 8.6V5.8M9.6 5.8h4.8l1-2.6-2.4 1.3"/><circle cx="4.6" cy="13.4" r="1.1"/><circle cx="19.4" cy="13.4" r="1.1"/>',
    cpu: '<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2"/><rect x="10" y="10" width="4" height="4" rx=".8"/><path d="M9.6 2.6v4M14.4 2.6v4M9.6 17.4v4M14.4 17.4v4M2.6 9.6h4M2.6 14.4h4M17.4 9.6h4M17.4 14.4h4"/>',
    users: '<circle cx="9.2" cy="8.4" r="3.4"/><path d="M2.8 20.2c.7-3.4 3.3-5.2 6.4-5.2s5.7 1.8 6.4 5.2"/><path d="M15.4 5.4a3.4 3.4 0 0 1 0 6.2M17.4 15.4c2.3.5 3.6 2.2 3.8 4.8"/>',
    person: '<circle cx="12" cy="7.6" r="3.7"/><path d="M4.6 20.4c.8-4 3.5-6 7.4-6s6.6 2 7.4 6"/>',
    badge: '<rect x="3.4" y="5" width="17.2" height="14" rx="2.4"/><circle cx="8.6" cy="11.4" r="2.3"/><path d="M5.4 17.2c.4-2 1.8-3 3.4-3s3 1 3.4 3M14 9.8h4.6M14 13h4.6M14 16.2h2.6"/>',
    school: '<path d="M3.6 21h16.8M5.4 21V9.6l6.6-4.8 6.6 4.8V21"/><path d="M9.8 21v-5.4h4.4V21"/>',
    bank: '<path d="M3.6 21h16.8M4.8 10.2h14.4M5.8 21v-6.6M9.6 21v-6.6M14.4 21v-6.6M18.2 21v-6.6"/><path d="M4.4 10.2L12 3.6l7.6 6.6M12 3.6V2.4"/>',
    teacher: '<rect x="7.6" y="4" width="8.8" height="6.4" rx="1.2"/><path d="M12 10.4v2.6M9.2 19.8l2.8-3.4 2.8 3.4"/><path d="M15.2 17.2c1.6.3 2.6 1.5 3 3.4"/>',
    flag: '<path d="M5.4 21V3.8M5.4 3.8c2.6-1.6 5.2 1.4 7.8-.2v8.6c-2.6 1.6-5.2-1.4-7.8.2"/>',
    mic: '<rect x="9" y="3" width="6" height="11.4" rx="3"/><path d="M5 11.2a7 7 0 0 0 14 0M12 18.2v2.8M8.4 21h7.2"/>',
    camera: '<path d="M3.8 8.2h3.4l2-3h5.6l2 3h3.4v11.2H3.8z"/><circle cx="12" cy="13.4" r="3.6"/>',
    video: '<rect x="2.8" y="6.8" width="12.4" height="10.4" rx="2.2"/><path d="M15.2 10.8l5.8-3.4v9.2l-5.8-3.4"/>',
    projector: '<rect x="3.2" y="5.8" width="17.6" height="10.8" rx="2"/><path d="M8.2 20.8l3.8-4.2 3.8 4.2"/><circle cx="9.2" cy="11.2" r="2.1"/><path d="M14.8 9.6h4.4M14.8 12.8h3"/>',
    telescope: '<path d="M4.2 21l6.2-10.4M10.4 10.6l6.6-6.6"/><circle cx="18.6" cy="4.4" r="2.7"/><path d="M2.6 21h9.4"/>',
    image: '<rect x="3.4" y="4.8" width="17.2" height="14.4" rx="2.2"/><circle cx="9" cy="9.8" r="1.9"/><path d="M4.4 17.2l4.6-4.4 3.6 3.2 3-2.6 4 3.6"/>',
    printer: '<path d="M7.4 7.8V3.4h9.2v4.4"/><rect x="3.8" y="7.8" width="16.4" height="8" rx="1.8"/><path d="M7 14.6h10v6H7z"/>',
    flask: '<path d="M9.8 3.6v5.8L4.8 19a2 2 0 0 0 1.8 2.9h10.8a2 2 0 0 0 1.8-2.9L14.2 9.4V3.6"/><path d="M8.4 3.6h7.2M6.4 13.6h11.2"/>',
    idCard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.4" cy="11.4" r="2.2"/><path d="M5.4 16.8c.3-1.9 1.5-2.9 3-2.9s2.7 1 3 2.9M13.6 9.8h5M13.6 13.4h5"/>',
    key: '<circle cx="8" cy="16" r="4.4"/><path d="M11.2 12.8L20.4 3.6M16.4 7.6l3 3M13.8 10.2l2.4 2.4"/>',
    lock: '<rect x="4.8" y="10.6" width="14.4" height="9.8" rx="2"/><path d="M8 10.6V7.6a4 4 0 0 1 8 0v3"/>',
    mail: '<rect x="3" y="5.2" width="18" height="13.6" rx="2"/><path d="M3.6 7l8.4 6.2L20.4 7"/>',
    phone: '<path d="M7.4 3.6h3l1.4 4.4-2 1.6a11.4 11.4 0 0 0 5 5l1.6-2 4.4 1.4v2.8a1.8 1.8 0 0 1-2 1.8A15.6 15.6 0 0 1 5.6 5.6a1.8 1.8 0 0 1 1.8-2z"/>',
    smartphone: '<rect x="7.2" y="2.6" width="9.6" height="18.8" rx="2.4"/><path d="M11 18.6h2"/>',
    globe: '<circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4M12 2.8c2.9 2.8 2.9 15.6 0 18.4M12 2.8c-2.9 2.8-2.9 15.6 0 18.4"/>',
    link: '<path d="M9.6 14.4a4.8 4.8 0 0 0 7 .3l3.1-3.1a4.8 4.8 0 0 0-6.8-6.8l-1.6 1.6"/><path d="M14.4 9.6a4.8 4.8 0 0 0-7-.3l-3.1 3.1a4.8 4.8 0 0 0 6.8 6.8l1.6-1.6"/>',
    eye: '<path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.7"/>',
    eyeOff: '<path d="M2.8 2.8l18.4 18.4M10.6 10.9a2.7 2.7 0 0 0 3.8 3.8"/><path d="M6.9 6.9A17.2 17.2 0 0 0 2.6 12S6 18.2 12 18.2c1.7 0 3.2-.5 4.6-1.2M14.6 4.6A10.3 10.3 0 0 0 12 4.4C6 4.4 2.6 10.6 2.6 10.6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="M15.6 15.6L20.4 20.4"/>',
    ban: '<circle cx="12" cy="12" r="9.2"/><path d="M5.4 5.4l13.2 13.2"/>',
    home: '<path d="M4.6 10.4L12 3.8l7.4 6.6"/><path d="M6.2 9.2V20h11.6V9.2"/><path d="M10 20v-5.4h4V20"/>',
    wrench: '<path d="M14.6 6.4a4.4 4.4 0 0 0-5.9 5.5L3.4 17.2a2.1 2.1 0 0 0 3 3l5.3-5.3a4.4 4.4 0 0 0 5.5-5.9l-2.6 2.6-2.9-2.9z"/>',
    toolbox: '<rect x="3.2" y="9" width="17.6" height="11.2" rx="2"/><path d="M8 9V6.6A2.6 2.6 0 0 1 10.6 4h2.8A2.6 2.6 0 0 1 16 6.6V9M3.2 13.6h17.6M3.2 17.2h17.6"/>',
    grid: '<rect x="4" y="3.6" width="16" height="16.8" rx="2"/><path d="M8 7.4h8M8 11h8M8 14.6h8"/><circle cx="10.5" cy="17.4" r=".7" fill="currentColor" stroke="none"/><circle cx="13.5" cy="17.4" r=".7" fill="currentColor" stroke="none"/><circle cx="16.5" cy="17.4" r=".7" fill="currentColor" stroke="none"/><circle cx="7.5" cy="17.4" r=".7" fill="currentColor" stroke="none"/>',
    activity: '<path d="M3.4 12.4h3.2l2.2-5.4 4.4 10 2.2-4.6h5.2"/>',
    shield: '<path d="M12 3.4l7 2.7v5.4c0 4.3-2.9 7.8-7 9.4-4.1-1.6-7-5.1-7-9.4V6.1z"/>',
    trophy: '<path d="M8.2 4h7.6v4.8a3.8 3.8 0 0 1-7.6 0z"/><path d="M8.2 5H5.4a3 3 0 0 0 3.2 3.8M15.8 5h2.8a3 3 0 0 1-3.2 3.8M12 12.6v3M8.8 19.8h6.4M10.6 15.6h2.8v4.2h-2.8z"/>',
    award: '<circle cx="12" cy="9" r="5.4"/><path d="M9 13.4L7.2 21l4.8-2.8L16.8 21 15 13.4"/>',
    star: '<path d="M12 3.8l2.5 5.2 5.7.7-4.2 4 1.1 5.6L12 16.6l-5.1 2.7 1.1-5.6-4.2-4 5.7-.7z"/>',
    gift: '<rect x="3.4" y="8.2" width="17.2" height="12.4"/><path d="M3.4 12.4h17.2M12 8.2v12.4M12 8.2C9.2 8.2 6.8 7 7.6 4.6 8.4 2.4 11 3.6 12 8.2zM12 8.2c2.8 0 5.2-1.2 4.4-3.6-.8-2.2-3.4-1-4.4 3.6z"/>',
    tag: '<path d="M3.6 12V4.6H11l9.2 9.2a1.8 1.8 0 0 1 0 2.6l-4 4a1.8 1.8 0 0 1-2.6 0z"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/>',
    scale: '<path d="M12 3.6v16.8M6.4 20.4h11.2"/><path d="M4 7.4l8-3.2 8 3.2"/><path d="M7.6 7.4l-2.4 6a3.4 3.4 0 0 0 6 0zM16.4 7.4l2.4 6a3.4 3.4 0 0 1-6 0z"/>',
    palette: '<circle cx="12" cy="12" r="8.8"/><circle cx="8" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="7.6" r=".7" fill="currentColor" stroke="none"/><circle cx="16.2" cy="10.2" r=".7" fill="currentColor" stroke="none"/><circle cx="15.2" cy="15.6" r=".7" fill="currentColor" stroke="none"/><path d="M12 3.2c5.8 0 8.8 4.2 8.8 8.8 0 .8-.7 1.6-1.6 1.6h-3.6c-1.6 0-1.6 2.6 0 3 2 .9-.6 3.4-3.6 3.4A8.8 8.8 0 0 1 12 3.2z"/>',
    paperclip: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    trash: '<path d="M4.6 6.8h14.8M9.6 6.8V4.6h4.8v2.2M6.6 6.8l1 13.6h8.8l1-13.6"/><path d="M10 10.4v6.4M14 10.4v6.4"/>',
    paper: '<path d="M12 3.6l2.4 4.8 5.4.8-3.9 3.8.9 5.4L12 16l-4.8 2.4.9-5.4-3.9-3.8 5.4-.8z"/>',
    send: '<path d="M21 3.6L10.6 14M21 3.6l-6.8 17.2-3.6-7.2-7.2-3.6z"/>',
    plusSquare: '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2.6"/><path d="M12 8v8M8 12h8"/>',
    dice: '<rect x="5" y="5" width="14" height="14" rx="3.4"/><circle cx="9.2" cy="9.2" r=".9" fill="currentColor" stroke="none"/><circle cx="14.8" cy="14.8" r=".9" fill="currentColor" stroke="none"/><circle cx="9.2" cy="14.8" r=".9" fill="currentColor" stroke="none"/><circle cx="14.8" cy="9.2" r=".9" fill="currentColor" stroke="none"/>',
    rocket: '<path d="M12 3.4c2.6 1.4 5 3.9 5.6 8l1.6 2.4-3.6 3-1.4-2.4h-4l-1.4 2.4-3.6-3 1.6-2.4c.6-4.1 3-6.6 5.2-8z"/><circle cx="12" cy="10.4" r="1.8"/><path d="M9.2 14.4l-3.4 6 4.6-1.6M14.8 14.4l3.4 6-4.6-1.6M12 16.2v2.8"/>',
    smile: '<circle cx="12" cy="12" r="9.2"/><path d="M8.2 13.8c.9 1.5 2.2 2.3 3.8 2.3s2.9-.8 3.8-2.3"/><path d="M8.8 9.2h.01M15.2 9.2h.01"/>',
    neutral: '<circle cx="12" cy="12" r="9.2"/><path d="M8.2 13.2h7.6"/><path d="M8.8 9.2h.01M15.2 9.2h.01"/>',
    helpCircle: '<circle cx="12" cy="12" r="9.2"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2-2.5 3.6"/><circle cx="12" cy="16.6" r=".5" fill="currentColor" stroke="none"/>',
    sun: '<circle cx="12" cy="12" r="4.4"/><path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"/>',
    moon: '<path d="M20.6 14.2A8.6 8.6 0 1 1 9.8 3.4a7 7 0 0 0 10.8 10.8z"/>',
    book: '<path d="M4.4 18.8A2.4 2.4 0 0 1 6.8 16.4H20V3.6H6.8A2.4 2.4 0 0 0 4.4 6z"/><path d="M4.4 18.8A2.4 2.4 0 0 0 6.8 21.2H20v-4.8"/>',
    bookStack: '<path d="M4.4 5.6h8.4v12.4H6.4a2 2 0 0 1-2-2zM12.8 5.6h8.4v12.4h-6.4a2 2 0 0 1-2-2z"/><path d="M4.4 20.4h15.2"/>',
    sliders: '<path d="M4 6.6h8.6M16.6 6.6H20M4 12h3.4M11.4 12H20M4 17.4h12.6M20.6 17.4H20"/><circle cx="14.2" cy="6.6" r="2"/><circle cx="8.8" cy="12" r="2"/><circle cx="19.2" cy="17.4" r="2"/>',
    gem: '<path d="M7 4h10l4 5.6L12 21 3 9.6z"/><path d="M3.4 9.6h17.2M12 21L8.4 9.6 12 4l3.6 5.6z"/>',
    keyboard: '<rect x="2.8" y="6.6" width="18.4" height="10.8" rx="2"/><path d="M6.4 10.2h.01M9.9 10.2h.01M13.4 10.2h.01M16.9 10.2h.01M6.4 13.4h11.2"/>',
    scissors: '<circle cx="6.6" cy="6.6" r="2.7"/><circle cx="6.6" cy="17.4" r="2.7"/><path d="M8.9 8.6l11.6 7.4M8.9 15.4l11.6-7.4"/>',
  };

  /* EMOJI_MAP: rangli/piktografik emoji → icon kaliti. FE0F qo'shimchasi yutiladi. */
  const EMOJI_MAP = {
    '\u2705': 'circleCheck', '\u274C': 'circleX', '\u26A0\uFE0F': 'warn', '\u26A0': 'warn',
    '\u26A1': 'zap', '\u26A1\uFE0F': 'zap', '\u26D4': 'ban',
    '\u{1F4A1}': 'bulb', '\u23F3': 'hourglass', '\u23F1': 'timer', '\u23F2': 'timer',
    '\u{1F3AF}': 'target', '\u2728': 'sparkles', '\u{1F4BE}': 'save',
    '\u{1F3AC}': 'clapper', '\u{1F39E}': 'film', '\u{1F3AD}': 'film',
    '\u{1F501}': 'repeat', '\u{1F504}': 'refresh', '\u{1F500}': 'shuffle',
    '\u23F8': 'pause', '\u23F9': 'stopBox', '\u23ED': 'skip', '\u23EF': 'playBox',
    '\u{1F5C2}': 'folder', '\u{1F5C4}': 'archive', '\u{1F3C1}': 'flag',
    '\u{1F4DD}': 'note', '\u{1F4CA}': 'chart', '\u{1F4CB}': 'clipboard',
    '\u{1F4AC}': 'chat', '\u{1F4AD}': 'thought', '\u{1F5E3}': 'speech',
    '\u{1F52D}': 'telescope', '\u{1F389}': 'party', '\u{1F4A5}': 'boom',
    '\u{1F4C4}': 'fileText', '\u{1F4DC}': 'scroll', '\u{1F4D1}': 'fileText',
    '\u{1F465}': 'users', '\u{1F464}': 'person', '\u{1F9D1}': 'person', '\u{1F469}': 'person',
    '\u{1F469}\u200D\u{1F3EB}': 'teacher', '\u{1F9D1}\u200D\u{1F3EB}': 'teacher',
    '\u{1F64B}': 'person', '\u{1F916}': 'robot', '\u{1F9E0}': 'cpu',
    '\u{1F91D}': 'paper', '\u{1F3EB}': 'school', '\u{1F3DB}': 'bank',
    '\u{1F914}': 'helpCircle', '\u{1F610}': 'neutral', '\u{1F60E}': 'smile',
    '\u{1F50D}': 'search', '\u{1F5A8}': 'printer', '\u{1F4FD}': 'projector',
    '\u{1F3A5}': 'video', '\u{1F4F7}': 'camera', '\u{1F3A4}': 'mic', '\u{1F399}': 'mic',
    '\u{1F3E0}': 'home', '\u{1F527}': 'wrench', '\u{1F9F0}': 'toolbox',
    '\u{1F440}': 'eye', '\u{1F441}': 'eye', '\u{1F648}': 'eyeOff',
    '\u{1F4D8}': 'book', '\u{1F4DA}': 'bookStack', '\u{1F517}': 'link',
    '\u{1F6A6}': 'activity', '\u{1F6A7}': 'activity', '\u{1F7E2}': 'dotG', '\u{1F7E1}': 'dotY',
    '\u{1F534}': 'dotR', '\u{1F7E0}': 'dotO', '\u{1F535}': 'dotB', '\u{1F7E3}': 'dotP',
    '\u{1F5BC}': 'image', '\u{1F9EA}': 'flask', '\u{1F9EC}': 'flask',
    '\u{1F4F4}': 'ban', '\u{1F550}': 'timer', '\u{1F552}': 'timer', '\u{1F553}': 'timer',
    '\u{1F910}': 'neutral', '\u{1F912}': 'neutral', '\u{1F978}': 'neutral',
    '\u{1F310}': 'globe', '\u{1F30D}': 'globe', '\u{1F9EE}': 'grid',
    '\u{1F4E7}': 'mail', '\u{1F4E8}': 'mail', '\u{1F4EE}': 'mail', '\u{1F48C}': 'mail',
    '\u{1F194}': 'badge', '\u{1F195}': 'plusSquare', '\u{1F52E}': 'sparkles',
    '\u{1F9CA}': 'gem', '\u{1F9C9}': 'gem', '\u{1F422}': 'hourglass',
    '\u{1F6E1}': 'shield', '\u{1F3C6}': 'trophy', '\u{1F3C5}': 'award',
    '\u{1F44F}': 'star', '\u{2B50}': 'star', '\u{1F381}': 'gift', '\u{1F3F7}': 'tag',
    '\u2696': 'scale', '\u2696\uFE0F': 'scale',
    '\u{1F3A8}': 'palette', '\u{1F4CE}': 'paperclip', '\u{1F511}': 'key',
    '\u{1F512}': 'lock', '\u{1F513}': 'lock', '\u{1F5D1}': 'trash',
    '\u2753': 'helpCircle', '\u{1F4DE}': 'phone', '\u{1F4F1}': 'smartphone',
    '\u{1F4F2}': 'smartphone', '\u{1F680}': 'rocket', '\u{1F3B2}': 'dice',
    '\u{1F3B1}': 'dice', '\u{1F39A}': 'sliders', '\u{1F9F8}': 'sliders',
    '\u2600\uFE0F': 'sun', '\u2600': 'sun', '\u{1F319}': 'moon', '\u{1F311}': 'moon',
    '\u{1F4E9}': 'send', '\u{1F4E5}': 'send', '\u{1F9E9}': 'note',
    // C4-09 final review qo'shimchalari (VS16'li piktografik + keyboard/prohibited)
    '\u2328\uFE0F': 'keyboard', '\u2328': 'keyboard',
    '\u270F\uFE0F': 'note', '\u270F': 'note',
    '\u2702\uFE0F': 'scissors', '\u2702': 'scissors',
    '\u{1F6AB}': 'ban',
  };
  const EMOJI_MAP_KEYS = Object.keys(EMOJI_MAP).sort((a, b) => b.length - a.length);
  const RE = new RegExp('(?:' + EMOJI_MAP_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?:\\uFE0F)?', 'gu');

  const isPlain = (k) => {
    // Ahamiyatsiz text node'lar: bo'sh / faqat bo'shliq
    return /\S/.test(k);
  };
  const validParent = (el) => el && !/^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|CODE|NOSCRIPT|SVG)$/i.test(el.nodeName);

  let busy = false;
  let pendingScan = null;

  const DOT_TONE = { dotG: 'ikd-g', dotY: 'ikd-y', dotR: 'ikd-r', dotO: 'ikd-o', dotB: 'ikd-b', dotP: 'ikd-p' };
  function iconSpan(key) {
    const tone = DOT_TONE[key];
    if (tone) {
      return S('<circle cx="12" cy="12" r="5.8" fill="currentColor" stroke="none"/>', tone);
    }
    const body = P[key];
    if (!body) return null;
    return S(body, null);
  }

  function scan(root) {
    root = root || document.body;
    if (!root) return;
    busy = true;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!isPlain(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          const p = node.parentNode;
          return p && validParent(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        const v = node.nodeValue;
        if (!RE.test(v)) return;
        RE.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m;
        while ((m = RE.exec(v)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(v.slice(last, m.index)));
          const span = iconSpan(EMOJI_MAP[m[0]] || EMOJI_MAP[m[0].replace(/\uFE0F$/, '')]);
          if (span) {
            const tmp = document.createElement('span');
            tmp.innerHTML = span;
            frag.appendChild(tmp.firstChild);
          } else {
            frag.appendChild(document.createTextNode(m[0]));
          }
          last = m.index + m[0].length;
        }
        if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
        if (frag.childNodes.length) node.parentNode.replaceChild(frag, node);
      });
    } finally {
      busy = false;
      if (pendingScan) {
        const t = pendingScan;
        pendingScan = null;
        requestAnimationFrame(() => scan(t));
      }
    }
  }

  let observer = null;
  function ensureObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver((records) => {
      if (busy) { pendingScan = document.body; return; }
      const roots = [];
      records.forEach((rec) => {
        if (rec.type === 'characterData') {
          // textContent orqali kechikkan yozuvlar (i18n/socket) — parent'ni skanlaymiz
          const tn = rec.target;
          if (tn && tn.nodeType === 3 && tn.parentNode && validParent(tn.parentNode)) {
            roots.push(tn.parentNode);
          }
          return;
        }
        if (rec.type !== 'childList') return;
        for (let i = 0; i < rec.addedNodes.length; i++) {
          const tn = rec.addedNodes[i];
          if (tn && tn.nodeType === 3 && tn.parentNode && validParent(tn.parentNode)) {
            // textContent almashtirish: yangi text node qo'shiladi — parent'ni skanlaymiz
            roots.push(tn.parentNode);
          }
        }
        rec.addedNodes.forEach((n) => {
          if (n.nodeType === 1 && n.parentNode && !n.querySelector && !/^SCRIPT|STYLE$/i.test(n.nodeName)) {
            // tekis element
          }
        });
        for (let i = 0; i < rec.addedNodes.length; i++) {
          const n = rec.addedNodes[i];
          if (n.nodeType === 1 && !n.classList || (n.nodeType === 1 && !n.classList.contains('ikw') && !n.classList.contains('ik'))) {
            if (n.nodeType === 1 && n.querySelector && !n.querySelector('.ik') && !/^(SCRIPT|STYLE|TEXTAREA|INPUT)$/i.test(n.nodeName)) roots.push(n);
          }
        }
      });
      if (!roots.length) return;
      const uniq = [];
      roots.forEach((r) => {
        if (!uniq.some((u) => u.contains(r) || r.contains(u))) uniq.push(r);
      });
      uniq.forEach((r) => scan(r));
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    // Yengil qo'shimcha: barcha tashqi resurslar (shrift/i18n) tugagach to'liq reskan
    window.addEventListener('load', () => requestAnimationFrame(() => scan(document.body)));
  }

  const CSS =
    'svg.ik{width:1.14em;height:1.14em;display:inline-block;vertical-align:-0.2em;fill:none;' +
    'stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
    '.ikw{display:inline-block;line-height:0;vertical-align:-0.18em;white-space:nowrap}' +
    '.ikw.ikd svg.ik{fill:currentColor;stroke:none}' +
    '.ikw.ikd-g{color:#23b26d}.ikw.ikd-y{color:#e0b33e}.ikw.ikd-r{color:#e2574d}' +
    '.ikw.ikd-o{color:#e0832f}.ikw.ikd-b{color:#3e8de0}.ikw.ikd-p{color:#a05fd0}' +
    '@media (prefers-reduced-motion:reduce){.ikw *{transition:none!important;animation:none!important}}';
  let styleInjected = false;
  function injectStyle() {
    if (styleInjected || typeof document === 'undefined') return;
    styleInjected = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    st.setAttribute('data-icon-kit', '');
    (document.head || document.documentElement).appendChild(st);
  }

  function boot() {
    injectStyle();
    if (document.body) {
      scan(document.body);
      ensureObserver();
    } else {
      document.addEventListener('DOMContentLoaded', boot);
    }
  }

  const API = {
    scan,
    boot,
    /* Eksport: berilgan text'dagi emojilarni icon svg'ga almashtirgan HTML */
    iconifyHtml(text) {
      return String(text).replace(RE, (m) => {
        const key = EMOJI_MAP[m] || EMOJI_MAP[m.replace(/\uFE0F$/, '')];
        const body = key && P[key];
        return body ? S(body, key.indexOf('dot') === 0) : m;
      });
    },
    isEmojiFree() {
      return !RE.test(document.body.innerText || '');
    },
    /* C4-09: berilgan belgi (yoki kichik ketma-ketlik) icon-kit registrida bormi */
    mappedGlyph(g) {
      if (!g) return false;
      return g in EMOJI_MAP || g.replace(/\uFE0F$/, '') in EMOJI_MAP;
    },
    glyphRegexSource() {
      return RE.source;
    },
  };

  if (typeof window !== 'undefined') {
    window.IconKit = API;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})();
