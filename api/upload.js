// api/upload.js — Vercel Serverless Function（画像アップロード専用）

const { put } = require('@vercel/blob');

const ADMIN_ID = process.env.ADMIN_ID || 'fusionia';
const ADMIN_PW = process.env.ADMIN_PW || 'zZ8$ePmy#ZYO';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Filename',
};

function verifyAuth(authHeader) {
  if (!authHeader) return false;
  const expected = `Basic ${Buffer.from(`${ADMIN_ID}:${ADMIN_PW}`).toString('base64')}`;
  return authHeader === expected;
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

  if (!verifyAuth(req.headers['authorization'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ファイル名はヘッダーから取得（例: "prod-140601-ホワイト.jpg"）
    const filename = req.headers['x-filename'] || `upload-${Date.now()}.jpg`;

    // リクエストボディをそのままBlobにストリームアップロード
    const { url } = await put(`images/${filename}`, req, {
      access: 'public',
      contentType: req.headers['content-type'] || 'image/jpeg',
    });

    return res.status(200).json({ url });
  } catch (e) {
    console.error('Upload error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: false, // ストリームで受け取るために必須
  },
};

