// api/scrape.js — 外部サイトスクレイピング（サーバーサイド）

const ADMIN_ID = process.env.ADMIN_ID || 'fusionia';
const ADMIN_PW = process.env.ADMIN_PW || 'zZ8$ePmy#ZYO';

const resHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function verifyAuth(authHeader) {
  if (!authHeader) return false;
  const expected = `Basic ${Buffer.from(`${ADMIN_ID}:${ADMIN_PW}`).toString('base64')}`;
  return authHeader === expected;
}

const stripTags = s => s
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<p[^>]*>/gi, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#[0-9]+;/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// ===== 商品名: <h1> =====
function extractName(html) {
  // <h1>直下のテキスト（<span>などがネストしている場合も考慮）
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]).replace(/\s+/g, ' ').trim() : null;
}

// ===== 見出し: <h2> =====
function extractHeadline(html) {
  const m = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  return m ? stripTags(m[1]).replace(/\s+/g, ' ').trim() : null;
}

// ===== 説明文: <p class="lead"> =====
function extractDesc(html) {
  const m = html.match(/<p[^>]*class=["']lead["'][^>]*>([\s\S]*?)<\/p>/i);
  return m ? stripTags(m[1]).trim() : null;
}

// ===== 本文: <p class="text"> =====
function extractBodyText(html) {
  const m = html.match(/<p[^>]*class=["']text["'][^>]*>([\s\S]*?)<\/p>/i);
  return m ? stripTags(m[1]).trim() : null;
}

// ===== 価格パース =====
// 価格行テキストをラベル/SIZE/金額に分解する
// 例: "ホワイト S ¥2,200（税込）" → {label:'ホワイト', size:'S', amount:2200}
// 例: "OPEN PRICE" → {label:'', size:'', amount:0, openPrice:true}
const SIZE_PATTERN = /\b(XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL|フリー|F)\b/i;
const COLOR_KEYWORDS = ['ホワイト','ブラック','ネイビー','グレー','レッド','ブルー','グリーン','イエロー','ピンク','ベージュ','ブラウン','オレンジ','パープル','ゴールド','シルバー','ナチュラル','アイボリー','カーキ','ターコイズ','ラベンダー','ミント','サックス','バーガンディ','インディゴ','スミ','アッシュ','オリーブ','キャメル','カナリア','メロン','コバルト'];

function parsePriceLine(text) {
  text = text.trim();
  if (!text) return null;

  // OPEN PRICEのみの行
  if (/OPEN\s*PRICE/i.test(text)) {
    return { label: '', size: '', amount: 0, openPrice: true };
  }

  // ¥ 表記から金額を抽出
  const priceMatch = text.match(/[¥￥]\s*([\d,]+)/);
  const amount = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;

  // SIZEを抽出
  const sizeMatch = text.match(SIZE_PATTERN);
  const size = sizeMatch ? sizeMatch[1].toUpperCase() : '';

  // カラー名を抽出（テキストからサイズ・価格・記号を除いた残り）
  let label = text
    .replace(/[¥￥][\d,]+[^\s]*/g, '')
    .replace(SIZE_PATTERN, '')
    .replace(/（税込）|（税抜）|\(税込\)|\(税抜\)/g, '')
    .replace(/OPEN\s*PRICE/gi, '')
    .replace(/[¥￥\s,、・]/g, ' ')
    .trim();

  // よく知られた色名が含まれているか確認
  const hasColor = COLOR_KEYWORDS.some(c => label.includes(c));
  if (!hasColor && !size && !amount) return null;

  return { label, size, amount };
}

// <dd class="price"> から複数価格行をパース
function extractPrices(html) {
  const m = html.match(/<dd[^>]*class=["']price["'][^>]*>([\s\S]*?)<\/dd>/i);
  if (!m) return [];

  const content = m[1];
  // <li>ごとに分割、なければ<br>で分割
  let lines = [];
  if (/<li/i.test(content)) {
    lines = [...content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(x => stripTags(x[1]));
  } else {
    lines = content.split(/<br\s*\/?>/i).map(l => stripTags(l));
  }

  const results = [];
  for (const line of lines) {
    const parsed = parsePriceLine(line);
    if (parsed) results.push(parsed);
  }

  // 価格行がなく、テキストにOPEN PRICEがあればそのまま
  if (!results.length) {
    const raw = stripTags(content).trim();
    if (raw) results.push({ label: raw, size: '', amount: 0 });
  }

  return results;
}

// ===== dl セクション抽出 =====
function extractDlSections(html) {
  const results = [];
  const dlRegex = /<dl[^>]*>([\s\S]*?)<\/dl>/gi;
  let dlMatch;
  while ((dlMatch = dlRegex.exec(html)) !== null) {
    const dlContent = dlMatch[1];
    const dtMatch = dlContent.match(/<dt[^>]*>([\s\S]*?)<\/dt>/i);
    const ddMatch = dlContent.match(/<dd[^>]*>([\s\S]*?)<\/dd>/i);
    if (!dtMatch || !ddMatch) continue;
    const title = stripTags(dtMatch[1]).trim();
    if (!title || title === '価格') continue;

    let content = ddMatch[1];
    // 素材・生産国の場合は生産国の<p>を除去
    if (title.includes('素材')) {
      content = content.replace(/<p[^>]*>●生産国[\s\S]*?<\/p>/gi, '');
    }
    const text = stripTags(content).replace(/\n{3,}/g, '\n\n').trim();
    if (text) results.push({ title, text });
  }
  return results;
}

// ===== サイズ表: class="tb_size" をそのまま保持しつつデータ化 =====
function extractSizeTable(html) {
  const tableMatch = html.match(/<table[^>]*class=["']tb_size["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;

  const tableHtml = tableMatch[1];

  // th からカラム名（1列目はラベル列なのでスキップ）
  const thMatches = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  const allCols = thMatches.map(m => stripTags(m[1]).trim()).filter(Boolean);
  // 1列目がサイズ項目名（"寸法"など）の場合スキップ
  const cols = allCols.length > 1 ? allCols.slice(1) : allCols;

  // tr → td でデータ行
  const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const rows = [];
  for (const rowMatch of rowMatches) {
    const tdMatches = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (!tdMatches.length) continue;
    const cells = tdMatches.map(m => stripTags(m[1]).trim());
    const label = cells[0];
    const rest = cells.slice(1);
    if (label) rows.push({ label, cells: rest });
  }

  // thのサイズ一覧（S,M,L... の列名）をカンマ区切りで返す
  const sizeList = cols.join(',');

  return cols.length ? { cols, rows, sizeList } : null;
}

// ===== メインハンドラー =====
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(resHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(resHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!verifyAuth(req.headers['authorization'])) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { url } = body || {};
    if (!url) return res.status(400).json({ error: 'URLが必要です' });

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      }
    });

    if (!response.ok) return res.status(400).json({ error: `サイト取得失敗: HTTP ${response.status}` });

    const html = await response.text();

    // h1周辺のデバッグ情報を常に含める
    const h1Raw = (html.match(/<h1[\s\S]{0,200}/i)||['not found'])[0].slice(0,200);
    const mainRaw = (html.match(/<main[\s\S]{0,300}/i)||['not found'])[0].slice(0,300);

    const name      = extractName(html);
    const headline  = extractHeadline(html);
    const desc      = extractDesc(html);
    const bodyText  = extractBodyText(html);
    const prices    = extractPrices(html);
    const dlSections = extractDlSections(html);
    const sizeTable = extractSizeTable(html);

    // 概要ブロック
    const overview = [];
    if (bodyText) overview.push({ type: 'text', value: bodyText });
    for (const section of dlSections) {
      overview.push({ type: 'text', value: `【${section.title}】\n${section.text}` });
    }

    // サイズ一覧（tb_sizeのth列名）
    const sizeList = sizeTable ? sizeTable.sizeList : '';

    return res.status(200).json({
      ok: true,
      data: {
        name:     name || '',
        headline: headline || '',
        desc:     desc || '',
        prices,
        sizeList,
        overview,
        sizeTable: sizeTable ? { cols: sizeTable.cols, rows: sizeTable.rows } : null,
        _h1Raw: h1Raw,
        _mainRaw: mainRaw,
      }
    });

  } catch (e) {
    console.error('Scrape error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
