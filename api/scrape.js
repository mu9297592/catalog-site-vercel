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

// ===== 商品名: <main> 内の <h1> =====
function extractName(html) {
  // まず <main> を探してその中の <h1> を取得
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const scope = mainMatch ? mainMatch[1] : html;
  const m = scope.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]).replace(/\s+/g, ' ').trim() : null;
}

// ===== 見出し: <main> 内の <h2> =====
function extractHeadline(html) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const scope = mainMatch ? mainMatch[1] : html;
  const m = scope.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
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

// ===== 価格パース: <dd class="price"> 内のテーブル行を解析 =====
// 例: <tr><td>S ～ XL</td><td>¥ 4,970</td></tr>
//  → {label:'S ～ XL', size:'', amount:4970}
function extractPrices(html) {
  const ddMatch = html.match(/<dd[^>]*class=["']price["'][^>]*>([\s\S]*?)<\/dd>/i);
  if (!ddMatch) return [];

  const content = ddMatch[1];
  const results = [];

  // テーブル構造の場合：<tr>ごとに処理
  if (/<table/i.test(content)) {
    const trMatches = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const trMatch of trMatches) {
      const tdMatches = [...trMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (tdMatches.length < 2) continue;

      const labelRaw = stripTags(tdMatches[0][1]).replace(/\s+/g,' ').trim();
      const amountRaw = stripTags(tdMatches[1][1]).replace(/[^0-9]/g,'');
      const amount = amountRaw ? parseInt(amountRaw) : 0;

      if (!labelRaw && !amount) continue;
      results.push({ label: labelRaw, size: '', amount });
    }
    return results;
  }

  // テーブルなし：<li> or <br> で分割
  let lines = [];
  if (/<li/i.test(content)) {
    lines = [...content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(x => stripTags(x[1]));
  } else {
    lines = content.split(/<br\s*\/?>/i).map(l => stripTags(l));
  }

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    const priceMatch = text.match(/[¥￥]\s*([\d,]+)/);
    const amount = priceMatch ? parseInt(priceMatch[1].replace(/,/g,'')) : 0;
    const label = text.replace(/[¥￥][\d,\s]+/g,'').replace(/（税込）|\(税込\)/g,'').trim();
    if (label || amount) results.push({ label, size: '', amount });
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

// ===== サイズ表: class="tb_size" =====
// 構造: 1行目の<th>がサイズ列名（S,M,L...）、各データ行の最初の<th>がラベル（着丈,身幅...）
function extractSizeTable(html) {
  const tableMatch = html.match(/<table[^>]*class=["']tb_size["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;

  const tableHtml = tableMatch[1];
  const trMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (!trMatches.length) return null;

  // 1行目: <th>が並ぶヘッダー行 → 1列目（空）を除いてサイズ列名
  const headerRow = trMatches[0][1];
  const headerThs = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  const cols = headerThs.slice(1).map(m => stripTags(m[1]).trim()).filter(Boolean);

  // サイズ一覧（S,M,L,XL,XXL）
  const sizeList = cols.join(',');

  // 2行目以降: 最初の<th>がラベル、<td>がデータ
  const rows = [];
  for (let i = 1; i < trMatches.length; i++) {
    const rowHtml = trMatches[i][1];
    const thMatch = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    const tdMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (!thMatch) continue;
    const label = stripTags(thMatch[1]).trim();
    const cells = tdMatches.map(m => stripTags(m[1]).trim());
    if (label) rows.push({ label, cells });
  }

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

    // サイズ表のRAW HTMLをデバッグ用に取得
    const sizeTableRaw = (html.match(/<table[^>]*class=["']tb_size["'][^>]*>([\s\S]*?)<\/table>/i)||[''])[0].slice(0,1000);

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
        _sizeTableRaw: sizeTableRaw,
      }
    });

  } catch (e) {
    console.error('Scrape error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
