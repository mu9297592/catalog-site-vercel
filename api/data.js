// api/data.js — Vercel Serverless Function
// GET  /api/data  → カタログデータ取得（認証不要）
// POST /api/data  → カタログデータ保存（管理者認証必須）

const { kv } = require('@vercel/kv');
const fs = require('fs');
const path = require('path');

const ADMIN_ID = process.env.ADMIN_ID || 'fusionia';
const ADMIN_PW = process.env.ADMIN_PW || 'zZ8$ePmy#ZYO';
const KV_KEY   = 'catalog';
const DATA_FILE = path.join(process.cwd(), 'data.json');

const DEFAULT_DATA = {
  cats: [], prods: [], colorMaster: [],
  nextCatId: 1, nextProdId: 1, nextColorId: 1
};

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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
      // ローカル開発環境: data.jsonから読み込む
      if (process.env.VERCEL !== '1' && fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return res.status(200).json(JSON.parse(data));
      }
      // 本番: Vercel KVから読み込む
      const data = await kv.get(KV_KEY);
      return res.status(200).json(data || DEFAULT_DATA);
    } catch (e) {
      console.error('GET error:', e);
      return res.status(200).json(DEFAULT_DATA);
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
        fs.writeFileSync(DATA_FILE, JSON.stringify(body));
        return res.status(200).json({ ok: true });
      }
      // 本番: Vercel KVに書き込む
      await kv.set(KV_KEY, body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('POST error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};
