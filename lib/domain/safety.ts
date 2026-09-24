/**
 * Content policy, ported from ikanpp's isCleanChineseTitle with one change: Latin-script
 * blacklist entries match whole words only, so "The Prestige" or "Episode" are not
 * rejected because they contain "prestige"/"sod".
 */

const ADULT_WORDS_CJK = [
  "痴漢", "痴汉", "調教", "调教", "発情", "发情", "近親", "近亲", "乱倫", "乱伦",
  "性奴", "沙龙病院", "中出し", "潮吹き", "巨乳", "美乳", "爆乳", "素人",
  "熟女", "人妻", "淫乱", "淫", "絶頂", "绝顶", "強姦", "强奸", "輪姦", "轮奸", "肉便器",
  "無修正", "无修正", "エロ", "変態", "变态",
  "制服誘惑", "制服诱惑", "女教師", "看護婦", "看护妇", "盗撮", "覗き", "偷窥",
  "性交", "做爱", "自慰", "色情", "三级", "露点", "情色", "偷拍", "色誘", "色诱", "情欲", "欲女",
  "売春", "愛汁", "肉しびれ", "快辱", "乱交", "ポルノ", "半熟売春",
  "迷奸", "性爱", "野合", "春药", "偷欢", "肉欲", "性虐", "援交", "内射", "潮吹",
  "抽插", "颜射", "绿帽奴", "寝取", "中出", "口交", "乳交", "打炮", "手淫",
  "风俗娘", "精液", "射精", "催情", "开苞", "破处", "凌辱", "滴蜡",
  "本庄铃", "本庄鈴", "三上悠亚", "三上悠亞", "波多野结衣", "波多野結衣", "相泽南", "相澤南",
  "河北彩花", "河北彩伽", "深田咏美", "深田詠美", "桃乃木香奈", "小仓由菜", "小倉由菜",
  "一本道", "美神列传", "美神列伝", "脱衣麻将", "粉红电影", "日活粉红", "粉红肉体",
  "思春期诱惑", "赤裸三姐妹", "勃起", "性关系",
];

const ADULT_WORDS_LATIN = [
  "av", "jav", "fc2", "fc2-ppv", "sod", "idea pocket", "heyzo", "caribbeancom", "1pondo",
  "pacopacomama", "tokyo-hot", "ntr",
];

// Code-style titles (SSIS-123, IPX-456). Requires the hyphen/underscore so ordinary titles
// such as "FBI 2018" are not caught.
const ADULT_CODE = /\b[a-z]{2,6}[-_]\d{2,5}\b/i;

export const COMMENTARY_WORDS = [
  "解说", "说电影", "几分钟看", "一口气看", "速看", "看懂",
  "纯享版", "先导片", "幕后花絮", "独家花絮", "精彩看点", "正片片段",
  "影视剪辑", "混剪", "预告",
];

// Japanese shinjitai forms that do not occur in Chinese titles.
const JAPANESE_ONLY_KANJI = /[剣気駅図絵悪戦沢浜拠抜拝捜検栄様殻浄]/;
const KANA = /[぀-ゟ゠-ヿ]/;
const HANGUL = /[가-힯]/;
const HAN = /[一-龥]/;

// Well-known titles that trip a single-character rule.
const ALLOWLIST = ["星球大战", "野战排", "大雨将至", "辉煌的意外", "我的恐怖妻子"];

function hasLatinWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

export function hasAdultSignal(text: string): boolean {
  const t = text.normalize("NFKC");
  if (ALLOWLIST.some((ok) => t.includes(ok))) return false;
  if (ADULT_WORDS_CJK.some((w) => t.includes(w))) return true;
  if (ADULT_WORDS_LATIN.some((w) => hasLatinWord(t, w))) return true;
  return ADULT_CODE.test(t);
}

export function isCommentary(text: string): boolean {
  return COMMENTARY_WORDS.some((w) => text.includes(w));
}

/**
 * Display-name gate for anything published: must contain Chinese, must not contain kana,
 * hangul or Japanese-only kanji, and must pass the adult and commentary checks.
 */
export function isPublishableName(name: string): boolean {
  const t = name.normalize("NFKC").trim();
  if (!t) return false;
  if (!HAN.test(t)) return false;
  if (KANA.test(t) || HANGUL.test(t) || JAPANESE_ONLY_KANJI.test(t)) return false;
  if (hasAdultSignal(t) || isCommentary(t)) return false;
  return true;
}
