// api/data.js — Vercel Serverless Function (Blob対応)
// GET  /api/data  → カタログデータ取得（認証不要）
// POST /api/data  → カタログデータ保存（管理者認証必須）

const { put, head, getDownloadUrl } = require('@vercel/blob');
const fs = require('fs');
const path = require('path');

const ADMIN_ID  = process.env.ADMIN_ID  || 'fusionia';
const ADMIN_PW  = process.env.ADMIN_PW  || 'zZ8$ePmy#ZYO';
const BLOB_NAME = 'catalog/data.json';
const DATA_FILE = path.join(process.cwd(), 'data.json');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// data.jsonを読み込む（初期データ・ローカル用）
function readDataJson() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('data.json read error:', e);
  }
  return {
    cats: [], prods: [], colorMaster: [],
    nextCatId: 1, nextProdId: 1, nextColorId: 1
  };
}

function verifyAuth(authHeader) {
  if (!authHeader) return false;
  const expected = `Basic ${Buffer.from(`${ADMIN_ID}:${ADMIN_PW}`).toString('base64')}`;
  return authHeader === expected;
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  // ===== GET =====
  if (req.method === 'GET') {
    try {
      // ローカル開発環境
      if (process.env.VERCEL !== '1') {
        return res.status(200).json(readDataJson());
      }

      // 本番: Blobからデータを取得
      try {
        const blobInfo = await head(BLOB_NAME);
        if (blobInfo && blobInfo.url) {
          const response = await fetch(blobInfo.url);
          const data = await response.json();
          return res.status(200).json(data);
        }
      } catch (e) {
        // Blobが存在しない場合 → data.jsonを自動移行
        console.log('Blob not found. Migrating from data.json...');
      }

      // 初回: data.jsonをBlobに自動アップロード
      const initialData = readDataJson();
      await put(BLOB_NAME, JSON.stringify(initialData), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
      console.log('Migration complete.');
      return res.status(200).json(initialData);

    } catch (e) {
      console.error('GET error:', e);
      return res.status(200).json(readDataJson());
    }
  }

  // ===== POST =====
  if (req.method === 'POST') {
    if (!verifyAuth(req.headers['authorization'])) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      // ローカル開発環境
      if (process.env.VERCEL !== '1') {
        fs.writeFileSync(DATA_FILE, JSON.stringify(body, null, 2));
        return res.status(200).json({ ok: true });
      }

      // 本番: Blobに上書き保存
      await put(BLOB_NAME, JSON.stringify(body), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
      return res.status(200).json({ ok: true });

    } catch (e) {
      console.error('POST error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};

const fs = require('fs');
const path = require('path');

const ADMIN_ID  = process.env.ADMIN_ID  || 'fusionia';
const ADMIN_PW  = process.env.ADMIN_PW  || 'zZ8$ePmy#ZYO';
const KV_KEY    = 'catalog';
const DATA_FILE = path.join(process.cwd(), 'data.json');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// data.jsonの内容を読み込む（移行用初期データとして使用）
function readDataJson() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('data.json read error:', e);
  }
  return {
    cats: [], prods: [], colorMaster: [],
    nextCatId: 1, nextProdId: 1, nextColorId: 1
  };
}

function verifyAuth(authHeader) {
  if (!authHeader) return false;
  const expected = `Basic ${Buffer.from(`${ADMIN_ID}:${ADMIN_PW}`).toString('base64')}`;
  return authHeader === expected;
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  // ===== GET =====
  if (req.method === 'GET') {
    try {
      // ローカル開発環境: data.jsonから直接読み込む
      if (process.env.VERCEL !== '1') {
        return res.status(200).json(readDataJson());
      }

      // 本番(Vercel): KVからデータを取得
      let data = await kv.get(KV_KEY);

      // KVが空の場合 → data.jsonの内容を自動移行して保存
      if (!data) {
        console.log('KV is empty. Migrating from data.json...');
        data = readDataJson();
        await kv.set(KV_KEY, data);
        console.log('Migration complete.');
      }

      return res.status(200).json(data);
    } catch (e) {
      console.error('GET error:', e);
      // KV接続失敗時もdata.jsonで fallback
      return res.status(200).json(readDataJson());
    }
  }

  // ===== POST =====
  if (req.method === 'POST') {
    if (!verifyAuth(req.headers['authorization'])) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      // ローカル開発環境: data.jsonに書き込む
      if (process.env.VERCEL !== '1') {
        fs.writeFileSync(DATA_FILE, JSON.stringify(body, null, 2));
        return res.status(200).json({ ok: true });
      }

      // 本番: Vercel KVに保存
      await kv.set(KV_KEY, body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('POST error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};

