/**
 * QuizBlitz — CAST TEST BOT (mock-up.js)
 * ----------------------------------------
 * Maqsad: host-game.html'da yaratilgan o'yin kodiga N ta soxta o'yinchini
 * Firebase orqali to'g'ridan-to'g'ri "qo'shib", har bir savolga avtomatik
 * (turli kechikish va to'g'ri/xato nisbat bilan) javob berdiradi.
 * Real qurilma yoki ko'p tab ochish shart emas — bittagina shu skript
 * kompyuteringizda ishlaydi va butun cast oqimini sinaydi:
 * lobby -> savol -> ball hisoblash -> shoxsupa -> o'yin tugashi.
 *
 * O'RNATISH (bir marta):
 *   cd mock-up
 *   npm install
 *
 * ISHLATISH:
 *   1) user-panel.html'dan "Cast" tugmasi bilan o'yin yarating, kodni oling (masalan 48213)
 *   2) host-game.html ochiq turgan holda, terminalda:
 *        node mock-up.js 48213
 *      yoki sozlamalar bilan:
 *        node mock-up.js 48213 20 0.7
 *        (48213 = kod, 20 = o'yinchilar soni, 0.7 = to'g'ri javob berish ehtimoli)
 *   3) host-game.html'da "O'yinni Boshlash" tugmasini bosing — bot avtomatik
 *      har bir savolga javob beradi, konsolda jarayonni ko'rasiz.
 *   4) O'yin tugagach skript o'zi to'xtaydi (Ctrl+C bilan ham to'xtatish mumkin).
 */

import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, set, get, remove, onValue
} from "firebase/database";

// ── Firebase config (loyihadagi bilan bir xil) ──
const FB = {
  apiKey: "AIzaSyA-2Uf7dZf1kqf7c32txyTFXSd2PCJbJLw",
  authDomain: "sessiya-11767.firebaseapp.com",
  databaseURL: "https://sessiya-11767-default-rtdb.firebaseio.com",
  projectId: "sessiya-11767",
  storageBucket: "sessiya-11767.firebasestorage.app",
  messagingSenderId: "883067400258",
  appId: "1:883067400258:web:941d591d38755c73247ddb"
};

// ── CLI argumentlar ──
const code = process.argv[2];
const PLAYER_COUNT = parseInt(process.argv[3] || "20", 10);
const CORRECT_RATE = parseFloat(process.argv[4] || "0.7"); // 0..1 — to'g'ri javob berish ehtimoli
const ANSWER_RATE = parseFloat(process.argv[5] || "0.95"); // 0..1 — umuman javob berish ehtimoli (qolgani "vaqt tugadi")
const MIN_DELAY_MS = 400;   // eng tez javob
const MAX_DELAY_BUFFER_MS = 600; // savol vaqti tugashidan oldin shuncha ms qoldirib javob beriladi

if (!code) {
  console.error("❌ Foydalanish: node mock-up.js <O'YIN_KODI> [o'yinchilar_soni] [togri_javob_ehtimoli] [javob_berish_ehtimoli]");
  console.error("   Masalan: node mock-up.js 48213 20 0.7 0.95");
  process.exit(1);
}

const EMOJIS = ['🦊','🐺','🦁','🐯','🦝','🐲','🦄','🦅','🐸','🦑','🤖','👾','🦸','🧙','🥷','🦈','🐙','🦉','🦩','🎭'];
const BOT_PREFIX = "Bot";

const app = initializeApp(FB);
const db = getDatabase(app);

function log(...args){ console.log(new Date().toLocaleTimeString('uz-UZ'), "|", ...args); }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

// ── O'yinchilarni yaratish ──
const players = Array.from({length: PLAYER_COUNT}, (_, i) => ({
  name: `${BOT_PREFIX}${i+1}`,
  emoji: EMOJIS[i % EMOJIS.length]
}));

async function joinAll(){
  log(`🎮 Kod: ${code} — ${players.length} ta bot qo'shilmoqda...`);
  const sessSnap = await get(ref(db, `game_sessions/${code}/state`));
  if(!sessSnap.exists()){
    console.error("❌ Bunday kod bilan o'yin topilmadi. Avval host-game.html'da cast yarating.");
    process.exit(1);
  }
  for(const p of players){
    try{
      await set(ref(db, `game_sessions/${code}/players/${p.name}`), {
        emoji: p.emoji, joined_at: Date.now(), score: 0
      });
    }catch(e){ console.error(`Xato (${p.name}):`, e.message); }
  }
  log(`✅ ${players.length} ta bot lobby'ga qo'shildi. Endi host-game.html'da "O'yinni Boshlash" tugmasini bosing.`);
}

// ── Savolga javob berish ──
let processedQIdx = -1;
const answeredForQ = new Set();

function pickOption(correctIdx, numOptions){
  const willBeCorrect = Math.random() < CORRECT_RATE;
  if(willBeCorrect) return correctIdx;
  if(numOptions <= 1) return correctIdx;
  let idx;
  do{ idx = randInt(0, numOptions-1); } while(idx === correctIdx);
  return idx;
}

function scheduleAnswersForQuestion(st){
  const qIndex = st.q_index;
  const qTimeMs = (st.q_time || 20) * 1000;
  const correctIdx = typeof st.q_correct === 'number' ? st.q_correct : 0;
  const numOptions = (st.q_options || []).length || 4;
  const startedAt = st.q_started_at || Date.now();
  const alreadyElapsed = Date.now() - startedAt;
  const maxDelay = Math.max(MIN_DELAY_MS, qTimeMs - MAX_DELAY_BUFFER_MS - alreadyElapsed);

  log(`📝 Savol ${qIndex+1} faollashdi — ${players.length} ta bot javob tayyorlamoqda (vaqt: ${Math.round(qTimeMs/1000)}s)`);

  players.forEach(p => {
    if(Math.random() > ANSWER_RATE){
      log(`⏱️ ${p.name} — vaqt tugashini kutadi (javob bermaydi)`);
      return;
    }
    const optionIdx = pickOption(correctIdx, numOptions);
    const delay = randInt(MIN_DELAY_MS, Math.max(MIN_DELAY_MS, maxDelay));
    setTimeout(async () => {
      try{
        await set(ref(db, `game_sessions/${code}/answers/${qIndex}/${p.name}`), {
          option: optionIdx, time_ms: delay
        });
        const mark = optionIdx === correctIdx ? "✅" : "❌";
        log(`${mark} ${p.name} -> variant ${optionIdx} (${delay}ms)`);
      }catch(e){
        log(`⚠️ Xato (${p.name}):`, e.message);
      }
    }, delay);
  });
}

function watchGame(){
  log("👀 O'yin holatini kuzatish boshlandi... (Ctrl+C bilan to'xtatish mumkin)");
  const stateRef = ref(db, `game_sessions/${code}/state`);
  onValue(stateRef, snap => {
    const st = snap.val();
    if(!st) return;

    if(st.status === 'question_active' && st.q_index !== processedQIdx){
      processedQIdx = st.q_index;
      scheduleAnswersForQuestion(st);
    }
    else if(st.status === 'leaderboard'){
      log(`🏆 Shoxsupa ko'rsatilmoqda (savol ${(st.q_index ?? 0)+1} dan keyin)`);
    }
    else if(st.status === 'ended'){
      const lb = st.leaderboard || [];
      log("🎉 O'YIN TUGADI! Yakuniy natijalar:");
      lb.forEach((p,i) => log(`   ${i+1}. ${p.emoji||''} ${p.name} — ${p.score} ball`));
      log("✅ Test muvaffaqiyatli yakunlandi. Skript to'xtaydi.");
      process.exit(0);
    }
  });
}

// ── Tozalash (ixtiyoriy, Ctrl+C bosilganda botlarni o'chirish) ──
process.on('SIGINT', async () => {
  log("\n🧹 To'xtatilmoqda... Bot o'yinchilarni lobbydan o'chirishni xohlaysizmi? (avtomatik o'chirilmaydi)");
  log("   Qo'lda tozalash uchun: node mock-up.js cleanup " + code);
  process.exit(0);
});

// ── Maxsus rejim: tozalash ──
if(code === 'cleanup'){
  const cleanupCode = process.argv[3];
  if(!cleanupCode){ console.error("Foydalanish: node mock-up.js cleanup <KOD>"); process.exit(1); }
  (async () => {
    for(const p of players){
      try{ await remove(ref(db, `game_sessions/${cleanupCode}/players/${p.name}`)); }catch(_){}
    }
    log(`🧹 ${cleanupCode} kodidagi bot o'yinchilar tozalandi.`);
    process.exit(0);
  })();
} else {
  (async () => {
    await joinAll();
    watchGame();
  })();
}
