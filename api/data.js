// api/data.js — Vercel Serverless Function (Blob対応)

const { put, list } = require('@vercel/blob');
const fs = require('fs');
const path = require('path');

const ADMIN_ID  = process.env.ADMIN_ID  || 'fusionia';
const ADMIN_PW  = process.env.ADMIN_PW  || 'zZ8$ePmy#ZYO';
const BLOB_NAME = 'catalog-data.json';
const DATA_FILE = path.join(process.cwd(), 'data.json');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function readDataJson() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) { console.error('data.json read error:', e); }
  return { cats:[], prods:[], colorMaster:[], nextCatId:1, nextProdId:1, nextColorId:1 };
}

function verifyAuth(authHeader) {
  if (!authHeader) return false;
  const expected = `Basic ${Buffer.from(`${ADMIN_ID}:${ADMIN_PW}`).toString('base64')}`;
  return authHeader === expected;
}

async function getBlobData() {
  const { blobs } = await list({ prefix: 'catalog-data' });
  if (!blobs || blobs.length === 0) return null;
  const blob = blobs[0];
  const response = await fetch(blob.url);
  if (!response.ok) return null;
  return await response.json();
}

async function saveBlobData(data) {
  await put(BLOB_NAME, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'GET') {
    try {
      if (process.env.VERCEL !== '1') return res.status(200).json(readDataJson());
      let data = await getBlobData();
      if (!data) { data = readDataJson(); await saveBlobData(data); }
      return res.status(200).json(data);
    } catch (e) {
      console.error('GET error:', e.message);
      return res.status(200).json(readDataJson());
    }
  }

  if (req.method === 'POST') {
    if (!verifyAuth(req.headers['authorization'])) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (process.env.VERCEL !== '1') {
        fs.writeFileSync(DATA_FILE, JSON.stringify(body, null, 2));
        return res.status(200).json({ ok: true });
      }
      await saveBlobData(body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('POST error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};
