const express = require("express");
const app = express();
app.use(express.json());

/* ===== ① 한글을 자음/모음으로 쪼개는 준비물 ===== */
const CHO  = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
// 각 자모의 획수
const CHO_S  = [2,4,2,3,6,5,4,4,8,2,4,1,3,6,4,3,4,4,3];
const JUNG_S = [2,3,3,4,2,3,3,4,2,4,5,3,3,2,4,5,3,3,1,2,1];
const JONG_S = [0,2,4,4,2,5,5,3,5,7,9,9,7,9,9,8,4,4,6,2,4,1,3,4,3,4,4,3];

// 오행(목화토금수) 분류
const ELEM = { 목:"ㄱㄲㅋ", 화:"ㄴㄷㄸㄹㅌ", 토:"ㅇㅎ", 금:"ㅅㅆㅈㅉㅊ", 수:"ㅁㅂㅃㅍ" };
const ORDER = ["목","화","토","금","수"];
const YANG = "ㅏㅐㅑㅒㅗㅘㅙㅚㅛ", YIN = "ㅓㅔㅕㅖㅜㅝㅞㅟㅠ";

/* ===== ② 글자 하나를 초성/중성/종성으로 분해 ===== */
function decompose(ch) {
  const c = ch.charCodeAt(0) - 0xAC00;
  return { cho: Math.floor(c / 588), jung: Math.floor((c % 588) / 28), jong: c % 28 };
}
const strokes = ch => { const d = decompose(ch); return CHO_S[d.cho] + JUNG_S[d.jung] + JONG_S[d.jong]; };
const elemOf = ch => {
  const c = CHO[decompose(ch).cho];
  return Object.keys(ELEM).find(k => ELEM[k].includes(c)) || "토";
};
const polarity = ch => {
  const j = JUNG[decompose(ch).jung];
  return YANG.includes(j) ? "양" : YIN.includes(j) ? "음" : "중";
};

/* ===== ③ 세 가지 점수 계산 ===== */
// (가) 획수 점수: 두 이름의 획수를 번갈아 늘어놓고 이웃끼리 더해 줄여간다
function strokeScore(a, b) {
  const sa = [...a].map(strokes), sb = [...b].map(strokes), seq = [];
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (i < sa.length) seq.push(sa[i]);
    if (i < sb.length) seq.push(sb[i]);
  }
  let cur = seq;
  while (cur.length > 2) cur = cur.slice(1).map((v, i) => (cur[i] + v) % 10);
  const s = cur[0] * 10 + cur[1];
  return s === 0 ? 100 : s;
}
// (나) 오행 점수: 상생이면 높게, 상극이면 낮게
function elemPair(x, y) {
  const d = (ORDER.indexOf(y) - ORDER.indexOf(x) + 5) % 5;
  return d === 0 ? 70 : (d === 1 || d === 4) ? 90 : 40;
}
// (다) 모음 점수: 양과 음이 만나면 높게
function vowelPair(x, y) {
  if (x === "중" || y === "중") return 75;
  return x !== y ? 90 : 65;
}
const crossAvg = (a, b, f, g) => {
  let sum = 0, n = 0;
  for (const p of a) for (const q of b) { sum += g(f(p), f(q)); n++; }
  return Math.round(sum / n);
};

/* ===== ④ 최종 합산 ===== */
function compat(n1, n2) {
  const [a, b] = [n1, n2].sort(); // 순서를 바꿔도 같은 결과가 나오게
  const st = strokeScore(a, b);
  const el = crossAvg([...a], [...b], elemOf, elemPair);
  const vw = crossAvg([...a], [...b], polarity, vowelPair);
  const score = Math.round(st * 0.5 + el * 0.3 + vw * 0.2);
  const tier = score >= 90 ? "S" : score >= 75 ? "A" : score >= 60 ? "B" : score >= 45 ? "C" : "D";
  return { names: [a, b], score, tier, stroke: st, element: el, vowel: vw };
}

/* ===== ⑤ 등급별 한 줄 평 ===== */
const MSG = {
  S: "말 안 해도 통하는 환상의 짝꿍!",
  A: "함께하면 즐거운 좋은 궁합이에요",
  B: "서로 맞춰가면 더 좋아지는 사이",
  C: "티격태격하다 정드는 사이",
  D: "다름이 매력인 반전 궁합!",
};
const validName = s => /^[가-힣]{1,5}$/.test(s || "");

/* ===== ⑥ 주소(엔드포인트) 만들기 ===== */
// 브라우저로 바로 확인해 볼 수 있는 주소
app.get("/v1/compat", (req, res) => {
  const { a, b } = req.query;
  if (!validName(a) || !validName(b))
    return res.status(400).json({ error: "INVALID_NAME", detail: "한글 1~5자만 입력할 수 있어요" });
  res.json(compat(a, b));
});

// 카카오 오픈빌더가 호출하는 주소
app.post("/skill/compat", (req, res) => {
  if (process.env.API_KEY && req.get("x-api-key") !== process.env.API_KEY)
    return res.sendStatus(401);

  const p = req.body?.action?.params || {};
  let a = p.a, b = p.b;
  if (!a || !b) { // 파라미터가 없으면 사용자가 친 문장에서 이름을 뽑는다
    const utt = (req.body?.userRequest?.utterance || "").replace(/궁합/g, "");
    [a, b] = utt.match(/[가-힣]{1,5}/g) || [];
  }

  const text = !validName(a) || !validName(b)
    ? "이름 두 개를 알려주세요!\n예) 철수 영희"
    : (() => {
        const r = compat(a, b);
        return `💘 ${a} ♥ ${b} 궁합 💘\n총점: ${r.score}점\n${MSG[r.tier]}\n\n` +
               `🔢 획수 궁합 ${r.stroke}%\n🔥 오행 케미 ${r.element}%\n🗣 모음 조화 ${r.vowel}%`;
      })();

  res.json({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });
});

// 서버가 살아있는지 확인하는 주소
app.get("/health", (req, res) => res.send("ok"));

app.listen(process.env.PORT || 3000, () => console.log("서버 시작!"));