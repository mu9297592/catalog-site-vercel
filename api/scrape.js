// api/scrape.js — 外部サイトスクレイピング（サーバーサイド）

const crypto = require('crypto');

const ADMIN_ID = process.env.ADMIN_ID || 'fusionia';
const ADMIN_PW = process.env.ADMIN_PW || 'zZ8$ePmy#ZYO';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Token',
};

function getSessionToken() {
  return crypto
    .createHmac('sha256', ADMIN_PW)
    .update(ADMIN_ID + (process.env.VERCEL_DEPLOYMENT_ID || 'local'))
    .digest('hex');
}

function verifyToken(req) {
  const token = req.headers['x-token'];
  return token && token === getSessionToken();
}

// HTMLから特定セレクターのテキストを抽出するシンプルなパーサー
function extractText(html, selector) {
  // タグを除去してテキストのみ返す
  const stripTags = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#[0-9]+;/g,'').trim();

  if (selector === 'h1') {
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    return m ? stripTags(m[1]) : null;
  }
  if (selector === 'h2') {
    const m = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    return m ? stripTags(m[1]) : null;
  }
  if (selector === 'p.lead') {
    const m = html.match(/<p[^>]*class="lead"[^>]*>([\s\S]*?)<\/p>/i);
    return m ? stripTags(m[1]) : null;
  }
  if (selector === 'p.text') {
    const m = html.match(/<p[^>]*class="text"[^>]*>([\s\S]*?)<\/p>/i);
    return m ? stripTags(m[1]) : null;
  }
  if (selector === 'dd.price') {
    const m = html.match(/<dd[^>]*class="price"[^>]*>([\s\S]*?)<\/dd>/i);
    return m ? stripTags(m[1]).replace(/\s+/g,' ') : null;
  }
  return null;
}

// dl要素群を抽出（素材・商品情報・注意事項）
function extractDlSections(html) {
  const results = [];
  const dlRegex = /<dl[^>]*style="[^"]*"[^>]*>([\s\S]*?)<\/dl>/gi;
  let dlMatch;

  while ((dlMatch = dlRegex.exec(html)) !== null) {
    const dlContent = dlMatch[1];
    const dtMatch = dlContent.match(/<dt[^>]*>([\s\S]*?)<\/dt>/i);
    const ddMatch = dlContent.match(/<dd[^>]*>([\s\S]*?)<\/dd>/i);
    if (!dtMatch || !ddMatch) continue;

    const title = dtMatch[1].replace(/<[^>]+>/g, '').trim();
    if (title === '生産国' || title.includes('生産国')) continue; // 生産国単独はスキップ

    let content = ddMatch[1];

    // 素材の場合：生産国の行を除去
    if (title === '素材・生産国') {
      content = content.replace(/<p[^>]*>●生産国[\s\S]*?<\/p>/gi, '');
    }

    // <br>を改行に、<p>を段落に変換してからタグ除去
    const text = content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text) results.push({ title, text });
  }
  return results;
}

// サイズ表を抽出
function extractSizeTable(html) {
  const tableMatch = html.match(/<table[^>]*class="tb_size"[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;

  const tableHtml = tableMatch[1];

  // ヘッダー行
  const thMatches = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  const cols = thMatches.map(m => m[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim()).filter(Boolean);

  // データ行
  const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const rows = [];
  for (const rowMatch of rowMatches) {
    const tdMatches = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (!tdMatches.length) continue;
    const cells = tdMatches.map(m => m[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
    const label = cells[0];
    const rest = cells.slice(1);
    if (label) rows.push({ label, cells: rest });
  }

  return cols.length ? { cols: cols.slice(1), rows } : null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!verifyToken(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { url } = body || {};
    if (!url) return res.status(400).json({ error: 'URLが必要です' });

    // 外部サイトのHTMLを取得
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CatalogBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      }
    });

    if (!response.ok) {
      return res.status(400).json({ error: `サイト取得失敗: HTTP ${response.status}` });
    }

    const html = await response.text();

    // 各フィールドを抽出
    const name     = extractText(html, 'h1');
    const headline = extractText(html, 'h2');
    const desc     = extractText(html, 'p.lead');
    const priceRaw = extractText(html, 'dd.price');
    const bodyText = extractText(html, 'p.text');
    const dlSections = extractDlSections(html);
    const sizeTable  = extractSizeTable(html);

    // 価格をパース（例: "¥ 2,200（税込）" → 2200）
    let price = null;
    if (priceRaw) {
      const priceNum = priceRaw.replace(/[^0-9]/g, '');
      price = priceNum ? parseInt(priceNum) : null;
    }

    // 概要ブロックを構築
    const overview = [];
    if (bodyText) overview.push({ type: 'text', value: bodyText });
    for (const section of dlSections) {
      overview.push({ type: 'text', value: `【${section.title}】\n${section.text}` });
    }

    return res.status(200).json({
      ok: true,
      data: {
        name:      name || '',
        headline:  headline || '',
        desc:      desc || '',
        price,
        overview,
        sizeTable,
      }
    });

  } catch (e) {
    console.error('Scrape error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
