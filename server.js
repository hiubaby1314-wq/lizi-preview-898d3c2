
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { router: aiRouter, initTables: initAITables } = require('./ai-system');
const cors = require('cors');
const COS = require("cos-nodejs-sdk-v5");
const { applyWatermark } = require('./watermark');

// Traditional → Simplified Chinese converter
const OpenCC = require('opencc-js');
const t2sConverter = OpenCC.Converter({ from: 'tw', to: 'cn' });
function toSimplified(text) {
  if (!text || typeof text !== 'string') return text;
  return t2sConverter(text);
}

const helmet = require('helmet');
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
// Advanced Hardening: Logging
app.use(morgan('combined'));

// Advanced Hardening: Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { ok: false, error: '请求過於頻繁，請稍後再試' }
});
app.use('/api/', limiter); // Apply rate limit to all API routes
 // Disable CSP to avoid breaking existing frontend inline scripts
const PORT = process.env.PORT || 3000;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-2d81719a7aaf43a19e0ac4120399b44f.r2.dev';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const USE_R2 = !!(R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
const DB_KEY = 'lizi.db';
const DB_PATH = path.join(__dirname, 'data', 'lizi.db');
let db;
let dbReady = true; // false during db close/reopen windows

// === Database ===
async function initDB() {
  const CompatDB = require('./lib/sqlite-compat');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new CompatDB(null, DB_PATH);
  db.pragma('journal_mode = WAL');

  // Materials table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      force_pwd_change INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cat TEXT NOT NULL DEFAULT '表情包',
      badges TEXT DEFAULT '["版权","new"]',
      gradient INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      downloads INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS material_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      mime TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT DEFAULT '匿名',
      content TEXT NOT NULL,
      contact TEXT DEFAULT '',
      images TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_account TEXT NOT NULL,
      bind_time DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      from_user TEXT DEFAULT '系统',
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      time DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS device_lock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      device_id TEXT NOT NULL,
      is_mobile INTEGER DEFAULT 0,
      locked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Site settings table (key-value store)
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Default: AI maintenance OFF (open)
  const aiMaintRow = db.prepare("SELECT key FROM site_settings WHERE key = ?").get("ai_maintenance");
  if (!aiMaintRow) {
    db.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?)").run("ai_maintenance", "false");
  }

  // Add missing columns if needed
  try { db.exec('ALTER TABLE materials ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN downloads INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN gradient INTEGER DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE materials ADD COLUMN badges TEXT DEFAULT \'["版权","new"]\''); } catch(e) {}

  // Create admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, ?)')
      .run('admin', crypto.createHash('md5').update(process.env.ADMIN_PWD || 'admin123').digest('hex'), 'admin', 0);
  }
}

// === R2 Storage ===
let s3Client = null;
let cosClient = null;

async function initR2() {
  if (!USE_R2) { console.log('R2 not configured. Using local disk.'); return; }
  const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  s3Client = {
    client: new S3Client({
      region: process.env.COS_REGION || 'auto',
      endpoint: process.env.COS_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      forcePathStyle: true,
    }),
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand
  };
  console.log('R2 storage configured.');
  console.log("COS init - SecretId:", process.env.R2_ACCESS_KEY_ID ? "set" : "missing", "SecretKey:", process.env.R2_SECRET_ACCESS_KEY ? "set (" + process.env.R2_SECRET_ACCESS_KEY.length + " chars)" : "missing");
  cosClient = new COS({ SecretId: process.env.R2_ACCESS_KEY_ID, SecretKey: process.env.R2_SECRET_ACCESS_KEY });
}

// === Snapshot: manual save/restore ===
const SNAPSHOT_PATH = path.join(__dirname, 'data', 'materials-snapshot.json');

// Save current materials to snapshot (manual trigger only)
async function saveSnapshot() {
  try {
    const materials = db.prepare('SELECT * FROM materials ORDER BY sort_order, id DESC').all();
    const snapshot = materials.map(m => {
      const files = db.prepare('SELECT name, path, ext, size, mime FROM material_files WHERE material_id = ? ORDER BY id').all(m.id);
      return {
        name: m.name,
        cat: m.cat,
        badges: JSON.parse(m.badges || '["版权","new"]'),
        gradient: m.gradient,
        sort_order: m.sort_order,
        downloads: m.downloads,
        files: files.map(f => ({ name: f.name, path: f.path, ext: f.ext, size: f.size, mime: f.mime }))
      };
    });

    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

    // Sync snapshot to R2
    if (USE_R2 && cosClient) {
      const buffer = fs.readFileSync(SNAPSHOT_PATH);
      await new Promise((resolve, reject) => {
        cosClient.putObject({
          Bucket: R2_BUCKET,
          Region: process.env.COS_REGION || 'ap-hongkong',
          Key: 'materials-snapshot.json',
          Body: buffer
        }, (err) => { if (err) reject(err); else resolve(); });
      });
    }
    console.log(`Snapshot saved: ${snapshot.length} materials`);
    return snapshot.length;
  } catch (e) {
    console.error('Snapshot save failed:', e.message);
    throw e;
  }
}

// Restore materials from snapshot (manual trigger only)
async function restoreSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error('No snapshot found');
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  
  // Collect all file paths from snapshot to identify orphans
  const snapshotPaths = new Set();
  for (const item of snapshot) {
    for (const f of (item.files || [])) {
      if (f.path) snapshotPaths.add(f.path);
    }
  }
  
  // Get all current file paths from DB
  const currentFiles = db.prepare('SELECT path FROM material_files').all();
  const currentPaths = currentFiles.map(f => f.path);
  
  // Delete R2 files that are not in the snapshot (orphans)
  const orphans = currentPaths.filter(p => p && !snapshotPaths.has(p));
  if (orphans.length > 0) {
    console.log(`Cleaning up ${orphans.length} orphaned files from R2...`);
    await Promise.all(orphans.map(p => deleteFromR2(p)));
  }
  
  // Clear all materials
  db.exec('DELETE FROM material_files');
  db.exec('DELETE FROM materials');
  
  const insertMat = db.prepare(`
    INSERT INTO materials (name, cat, badges, gradient, sort_order, downloads)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFile = db.prepare(`
    INSERT INTO material_files (material_id, name, path, ext, size, mime)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const item of snapshot) {
    const result = insertMat.run(
      item.name, item.cat,
      JSON.stringify(item.badges || ['版权', 'new']),
      item.gradient ?? 0,
      item.sort_order ?? 0,
      item.downloads ?? 0
    );
    const matId = result.lastInsertRowid;
    for (const f of (item.files || [])) {
      insertFile.run(matId, f.name, f.path, f.ext, f.size || 0, f.mime || '');
    }
  }
  console.log(`Snapshot restored: ${snapshot.length} materials`);
  return snapshot.length;
}

async function downloadFromR2(key) {
  try {
    // Use COS SDK for all downloads
    if (!cosClient) return null;
    return await new Promise((resolve, reject) => {
      cosClient.getObject({
        Bucket: R2_BUCKET,
        Region: process.env.COS_REGION || 'ap-hongkong',
        Key: key
      }, (err, data) => {
        if (err) {
          console.log('COS download error:', err.message);
          resolve(null);
        } else {
          resolve(data.Body);
        }
      });
    });
  } catch (e) {
    console.log('R2 download error:', e.message);
    return null;
  }
}

async function uploadToR2(key, buffer, contentType = 'application/octet-stream') {
  try {
    // Use COS SDK for all uploads
    if (!cosClient) throw new Error('COS client not configured');
    return await new Promise((resolve, reject) => {
      cosClient.putObject({
        Bucket: R2_BUCKET,
        Region: process.env.COS_REGION || 'ap-hongkong',
        Key: key,
        Body: buffer,
        ContentType: contentType
      }, (err, data) => {
        if (err) {
          console.log('COS upload error:', err.message);
          reject(err);
        } else {
          const url = `https://${R2_BUCKET}.cos.${process.env.COS_REGION || 'ap-hongkong'}.myqcloud.com/${key}`; resolve(url);
        }
      });
    });
  } catch (e) {
    console.log('R2 upload error:', e.message);
    throw e;
  }
}

async function deleteFromR2(url) {
  if (!cosClient) return;
  let key = url;
  if (url.startsWith('http')) {
    const prefix = R2_PUBLIC_URL + '/';
    if (!url.startsWith(prefix)) {
      console.warn('deleteFromR2: URL not from our bucket, skipping:', url);
      return;
    }
    key = url.slice(prefix.length);
  }
  try {
    await new Promise((resolve, reject) => {
      cosClient.deleteObject({
        Bucket: R2_BUCKET,
        Region: process.env.COS_REGION || 'ap-hongkong',
        Key: key
      }, (err, data) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch(e) {
    console.error('R2 delete error:', e.message, 'key:', key);
  }
}

// === SEO Config ===
function getSiteURL(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (req) return `${req.protocol}://${req.get('host')}`;
  return 'https://lizisucaiwang.online';
}


// === CORS ===
const ALLOWED_ORIGINS = [
  'https://herng9d2.mule.page',
  'https://lizisucaiwang.online',
  'http://43.161.253.21',
  'https://43.161.253.21',
  'http://localhost',
  'http://127.0.0.1'
];
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (server-side, curl, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    // Also allow any IP-based origin (for direct IP access)
    if (/^https?:\/\/\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true
}));

// === Middleware ===
app.use((req, res, next) => {
  if (!dbReady) return res.status(503).json({ ok: false, error: '服务正在维护，请稍后再试' });
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Cache headers for static assets
// Cache headers for static assets
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath) || filePath.endsWith('manifest.json') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Category pages - serve index.html for client-side routing
app.get("/cat/:name", function(req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// AI image page - only accessible via iframe inside main site
// Direct /ai URL access is disabled, redirects to homepage
app.get("/ai", function(req, res) {
  res.redirect('/');
});


const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

function hashPwd(p) { return crypto.createHash('md5').update(p).digest('hex'); }

// Rewrite old R2 bucket URLs to the current R2_PUBLIC_URL
function rewriteR2Url(url) {
  if (!url || typeof url !== 'string') return url;
  // Match any pub-xxxxxxxx.r2.dev URL and replace with current R2_PUBLIC_URL
  if (R2_PUBLIC_URL && url.includes('.r2.dev/')) {
    return url.replace(/^https?:\/\/pub-[a-f0-9]+\.r2\.dev/, R2_PUBLIC_URL);
  }
  return url;
}

// === DB Sync Helper ===
async function syncDB() {
  if (!USE_R2) return;
  try {
    if (!cosClient || !db) {
      console.error('DB sync: cosClient or db not initialized');
      return;
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    const buffer = fs.readFileSync(DB_PATH);
    await new Promise((resolve, reject) => {
      cosClient.putObject({
        Bucket: R2_BUCKET,
        Region: process.env.COS_REGION || 'ap-hongkong',
        Key: DB_KEY,
        Body: buffer
      }, (err, data) => {
        if (err) {
          console.error('DB sync failed:', err.message);
          reject(err);
        } else {
          console.log('DB synced to R2 (' + buffer.length + ' bytes)');
          resolve();
        }
      });
    });
  } catch(e) {
    console.error('DB sync failed:', e.message);
  }
}

// === Helper: get material with files ===
function getMaterialWithFiles(id) {
  const mat = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!mat) return null;
  const files = db.prepare('SELECT * FROM material_files WHERE material_id = ? ORDER BY id').all(id);
  return {
    ...mat,
    badges: JSON.parse(mat.badges || '["版权","new"]'),
    uploadedFiles: files.map(f => ({ name: f.name, path: rewriteR2Url(f.path), ext: f.ext, size: f.size, mime: f.mime }))
  };
}

function getAllMaterials() {
  const materials = db.prepare('SELECT * FROM materials ORDER BY id DESC').all();
  return materials.map(m => {
    const files = db.prepare('SELECT * FROM material_files WHERE material_id = ? ORDER BY id').all(m.id);
    return {
      ...m,
      badges: JSON.parse(m.badges || '["版权","new"]'),
      uploadedFiles: files.map(f => ({ name: f.name, path: rewriteR2Url(f.path), ext: f.ext, size: f.size, mime: f.mime }))
    };
  });
}

// === API Routes ===

// Login
app.post('/api/login', async (req, res) => {
  const { username, password, deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  if (!username || !password) return res.json({ ok: false, error: '请输入用户名和密码' });
  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
    return res.json({ ok: false, error: '设备标识无效' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(password)) return res.json({ ok: false, error: '用户名或密码错误' });

  // Device lock check (admin: enforce on ALL devices including mobile)
  const isAdminLogin = user.role === 'admin';
  if (!isMobile || isAdminLogin) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock) {
      if (lock.device_id !== deviceId) {
        return res.json({ ok: false, error: isAdminLogin ? '管理员账号已锁定到指定设备，无法在此设备登录' : '该账号已在其他设备登录，无法在此设备使用' });
      }
      if (!isAdminLogin && lock.is_mobile !== (isMobile ? 1 : 0)) {
        db.prepare('UPDATE device_lock SET is_mobile = ? WHERE username = ?').run(isMobile ? 1 : 0, username);
        await syncDB();
      }
    } else {
      db.prepare('INSERT INTO device_lock (username, device_id, is_mobile) VALUES (?, ?, ?)')
        .run(username, deviceId, isMobile ? 1 : 0);
      await syncDB();
    }
  }

  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

// Change password
app.post('/api/changePwd', async (req, res) => {
  const { username, oldPwd, newPwd } = req.body;
  if (!oldPwd || !newPwd || newPwd.length < 4) return res.json({ ok: false, error: '新密码至少4位' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPwd(oldPwd)) return res.json({ ok: false, error: '当前密码错误' });
  db.prepare('UPDATE users SET password = ?, force_pwd_change = 0 WHERE username = ?').run(hashPwd(newPwd), username);
  await syncDB();
  res.json({ ok: true });
});

// === Users ===
app.get('/api/users', (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(req.query.username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  res.json({ ok: true, users: db.prepare('SELECT username, role FROM users ORDER BY created_at DESC').all() });
});

app.post('/api/users', async (req, res) => {
  const { adminUsername, username, role } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (!username || username.length < 2) return res.json({ ok: false, error: '用户名至少2个字符' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.json({ ok: false, error: '用户名已存在' });
  db.prepare('INSERT INTO users (username, password, role, force_pwd_change) VALUES (?, ?, ?, 1)').run(username, hashPwd('123456'), role || 'user');
  await syncDB();
  res.json({ ok: true });
});

app.delete('/api/users/:username', async (req, res) => {
  const { adminUsername } = req.body;
  const targetUsername = req.params.username;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(adminUsername, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  if (targetUsername === 'admin') return res.json({ ok: false, error: '不能删除管理员' });
  db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
  await syncDB();
  res.json({ ok: true });
});

// === Materials ===
app.get('/api/materials', (req, res) => {
  res.json({ ok: true, materials: getAllMaterials() });
});

// Add material with file uploads
app.post('/api/materials', upload.array('files', 20), async (req, res) => {
  const { username, cat, badges, gradient } = req.body;
  const name = toSimplified(req.body.name);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  if (!name) return res.json({ ok: false, error: '请输入名称' });

  // Auto-overwrite if same name exists
  const existing = db.prepare('SELECT * FROM materials WHERE name = ?').get(name);
  if (existing) {
    const oldFiles = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(existing.id);
    await Promise.all(oldFiles.map(f => f.path && f.path.startsWith('http') ? deleteFromR2(f.path) : Promise.resolve()));
    db.prepare('DELETE FROM material_files WHERE material_id = ?').run(existing.id);
    db.prepare('DELETE FROM materials WHERE id = ?').run(existing.id);
    console.log(`Auto-overwrote existing material: ${name}`);
  }

  const matBadges = badges ? badges.split(',').map(s => s.trim()) : ['版权', 'new'];
  const grad = gradient !== undefined ? parseInt(gradient) : Math.floor(Math.random() * 25);

  const result = db.prepare('INSERT INTO materials (name, cat, badges, gradient) VALUES (?, ?, ?, ?)')
    .run(name, cat || '表情包', JSON.stringify(matBadges), grad);
  const materialId = result.lastInsertRowid;

  // Upload files
  const files = req.files || [];
  console.log(`[Upload] Material "${name}" (id pending): received ${files.length} files from multer`);
  if (files.length > 0) {
    files.forEach((f, i) => console.log(`  file[${i}]: ${f.originalname} (${f.size} bytes, ${f.mimetype})`));
  }

  // Reject if no files were received
  if (files.length === 0) {
    console.warn(`[Upload] WARNING: No files received for material "${name}". Deleting record.`);
    try { db.prepare('DELETE FROM materials WHERE id = ?').run(materialId); } catch(e) {}
    await syncDB();
    return res.json({ ok: false, error: '未收到任何文件，请重新选择文件后上传' });
  }

  let uploadedCount = 0;
  let uploadErrors = [];
  for (const f of files) {
    try {
      const ext = path.extname(f.originalname);
      const key = `uploads/${crypto.randomUUID()}${ext}`;
      // Apply watermark to image files
      let fileBuffer = f.buffer;
      if (f.mimetype && f.mimetype.startsWith('image/') && !['.gif', '.svg', '.fla', '.swf'].includes(ext.toLowerCase())) {
        try {
          fileBuffer = await applyWatermark(f.buffer, f.mimetype);
          console.log(`  Watermark applied: ${f.originalname} (${f.buffer.length} -> ${fileBuffer.length} bytes)`);
        } catch (wmErr) {
          console.error(`  Watermark failed for ${f.originalname}: ${wmErr.message}`);
        }
      }
      const url = await uploadToR2(key, fileBuffer, f.mimetype);
      db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
        .run(materialId, f.originalname, url, ext, f.size, f.mimetype);
      uploadedCount++;
      console.log(`  Uploaded: ${f.originalname} -> ${url}`);
    } catch (uploadErr) {
      console.error(`[Upload] FAILED: ${f.originalname} - ${uploadErr.message}`);
      uploadErrors.push(`${f.originalname}: ${uploadErr.message}`);
    }
  }

  // If ALL files failed, delete the material record
  if (uploadedCount === 0) {
    console.error(`[Upload] All files failed for "${name}". Deleting material record.`);
    db.prepare('DELETE FROM materials WHERE id = ?').run(materialId);
    await syncDB();
    return res.json({ ok: false, error: '文件上传失败：' + uploadErrors.join('; ') });
  }

  // Check if only one file uploaded (should be FLA + PNG/GIF)
  const fileCount = uploadedCount;
  const hasFla = files.some(f => path.extname(f.originalname).toLowerCase() === '.fla');
  const hasImage = files.some(f => ['.png', '.gif', '.jpg', '.jpeg'].includes(path.extname(f.originalname).toLowerCase()));
  let warning = '';
  if (fileCount === 1) {
    warning = hasFla ? '只上传了 FLA 文件，缺少 PNG/GIF 图片' : '只上传了图片文件，缺少 FLA 源文件';
  } else if (fileCount >= 2 && (!hasFla || !hasImage)) {
    warning = !hasFla ? '缺少 FLA 源文件' : '缺少 PNG/GIF 图片文件';
  }
  if (uploadErrors.length > 0) {
    warning += (warning ? '\n' : '') + '部分文件上传失败：' + uploadErrors.join('; ');
  }

  await syncDB();
  res.json({ ok: true, materials: getAllMaterials(), warning });
});

// Upload files to existing material
app.post('/api/materials/:id/upload', upload.array('files', 20), async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = parseInt(req.params.id, 10);
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  const files = req.files || [];
  for (const f of files) {
    const ext = path.extname(f.originalname);
    const key = `uploads/${crypto.randomUUID()}${ext}`;
    // Apply watermark to image files
    let fileBuffer = f.buffer;
    if (f.mimetype && f.mimetype.startsWith('image/') && !['.gif', '.svg', '.fla', '.swf'].includes(ext.toLowerCase())) {
      try {
        fileBuffer = await applyWatermark(f.buffer, f.mimetype);
        console.log(`  Watermark applied: ${f.originalname} (${f.buffer.length} -> ${fileBuffer.length} bytes)`);
      } catch (wmErr) {
        console.error(`  Watermark failed for ${f.originalname}: ${wmErr.message}`);
      }
    }
    const url = await uploadToR2(key, fileBuffer, f.mimetype);
    db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
      .run(materialId, f.originalname, url, ext, f.size, f.mimetype);
  }

  await syncDB();
  res.json({ ok: true, material: getMaterialWithFiles(materialId) });
});

// Update material
app.put('/api/materials/:id', async (req, res) => {
  const { username, cat, badges, gradient } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = parseInt(req.params.id, 10);
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  const updates = {};
  if (req.body.name) updates.name = toSimplified(req.body.name);
  if (cat) updates.cat = cat;
  if (badges) updates.badges = JSON.stringify(Array.isArray(badges) ? badges : badges.split(',').map(s => s.trim()));
  if (gradient !== undefined) updates.gradient = parseInt(gradient);

  if (Object.keys(updates).length > 0) {
    const sets = Object.entries(updates).map(([k, v]) => `${k} = ?`).join(', ');
    const vals = [...Object.values(updates), materialId];
    db.prepare(`UPDATE materials SET ${sets} WHERE id = ?`).run(...vals);
  }

  await syncDB();
  res.json({ ok: true, materials: getAllMaterials() });
});

// Delete material
app.delete('/api/materials/:id', async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const materialId = parseInt(req.params.id, 10);

  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  if (material) {
    const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(materialId);
    // Wait for all R2 deletions to complete
    await Promise.all(files.map(f => {
      if (f.path && f.path.startsWith('http')) return deleteFromR2(f.path);
    }));
    db.prepare('DELETE FROM material_files WHERE material_id = ?').run(materialId);
    db.prepare('DELETE FROM materials WHERE id = ?').run(materialId);
    // Real-time backup
    await syncDB();
  }

  res.json({ ok: true, materials: getAllMaterials() });
});

// Reorder materials
app.post('/api/materials/reorder', async (req, res) => {
  const { username, order } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.role !== 'admin') return res.json({ ok: false, error: '权限不足' });
  const stmt = db.prepare('UPDATE materials SET sort_order = ? WHERE id = ?');
  const materials = getAllMaterials();
  order.forEach((idx, i) => {
    if (materials[idx]) stmt.run(i, materials[idx].id);
  });
  await syncDB();
  res.json({ ok: true, materials: getAllMaterials() });
});

// === Download ===
app.post('/api/download', async (req, res) => {
  const { username, materialIndex, deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '请先登录' });

  // Check device lock (skip for mobile)
  if (!isMobile) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock) {
      if (lock.device_id !== deviceId) {
        return res.json({ ok: false, error: '设备不匹配，无法下载' });
      }
      if (lock.is_mobile) {
        return res.json({ ok: false, error: '手机设备仅支持预览，无法下载' });
      }
    }
  }

  const materials = getAllMaterials();
  const material = materials[materialIndex];
  if (!material) return res.json({ ok: false, error: '素材不存在' });

  const role = user.role;
  const canDl = role === 'admin' || role === 'vip' ||
    (role === 'user' && material.cat === '表情包') ||
    (role === 'promo' && material.cat === '限时优惠');

  if (!canDl) return res.json({ ok: false, error: '权限不足，无法下载此素材' });

  // Increment download count
  db.prepare('UPDATE materials SET downloads = downloads + 1 WHERE id = ?').run(material.id);
  await syncDB();
  res.json({ ok: true, material: getMaterialWithFiles(material.id) });
});

// Track download (lightweight, no file data returned)
app.post('/api/download/track', async (req, res) => {
  const { username, materialId } = req.body;
  if (!username || !materialId) return res.json({ ok: false });
  db.prepare('UPDATE materials SET downloads = downloads + 1 WHERE id = ?').run(materialId);
  await syncDB();
  res.json({ ok: true });
});


// Download all materials as zip
app.post('/api/download-all', async (req, res) => {
  const { username, deviceId } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '请先登录' });

  // Check device lock (skip for mobile)
  if (!isMobile) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock) {
      if (lock.device_id !== deviceId) {
        return res.json({ ok: false, error: '设备不匹配，无法下载' });
      }
      if (lock.is_mobile) {
        return res.json({ ok: false, error: '手机设备仅支持预览，无法下载' });
      }
    }
  }

  const role = user.role;
  const canDl = role === 'admin' || role === 'vip';
  if (!canDl) return res.json({ ok: false, error: '权限不足，仅管理员或VIP可下载全部素材' });

  try {
    const { ZipArchive } = await import('archiver');
    const archive = new ZipArchive();
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=lizi-materials-all.zip');
    
    archive.pipe(res);
    
    const materials = db.prepare('SELECT * FROM materials ORDER BY id DESC').all();
    
    for (const mat of materials) {
      const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(mat.id);
      
      for (const file of files) {
        try {
          const r2Key = file.path.replace(/^https?:\/\/[^/]+\//, '');
          const fileBuffer = await downloadFromR2(r2Key);
          
          if (fileBuffer) {
            const folder = mat.cat || '未分类';
            const fileName = file.name || `file_${file.id}${file.ext}`;
            archive.append(fileBuffer, { name: `${folder}/${mat.name}/${fileName}` });
          }
        } catch (e) {
          console.error(`Failed to add file ${file.name}:`, e.message);
        }
      }
    }
    
    await archive.finalize();
  } catch (e) {
    console.error('Download all error:', e);
    if (!res.headersSent) {
      res.json({ ok: false, error: '打包失败: ' + e.message });
    }
  }
});
// === Download Category ===
app.post('/api/download-category', async (req, res) => {
  const { username, deviceId, category } = req.body;
  const isMobile = req.body.isMobile === true || req.body.isMobile === 'true' || req.body.isMobile === 1;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '请先登录' });

  // Check device lock (skip for mobile)
  if (!isMobile) {
    const lock = db.prepare('SELECT * FROM device_lock WHERE username = ?').get(username);
    if (lock) {
      if (lock.device_id !== deviceId) {
        return res.json({ ok: false, error: '设备不匹配，无法下载' });
      }
      if (lock.is_mobile) {
        return res.json({ ok: false, error: '手机设备仅支持预览，无法下载' });
      }
    }
  }

  const role = user.role;
  const canDl = role === 'admin' || role === 'vip';
  if (!canDl) return res.json({ ok: false, error: '权限不足，仅管理员或VIP可下载素材' });

  if (!category) return res.json({ ok: false, error: '请指定分类' });

  try {
    const { ZipArchive } = await import('archiver');
    const archive = new ZipArchive();
    
    res.setHeader('Content-Type', 'application/zip');
    
    res.setHeader('Content-Disposition', 'attachment; filename=lizi-materials.zip');
    archive.pipe(res);
    
    const materials = db.prepare('SELECT * FROM materials WHERE cat = ? ORDER BY id DESC').all(category);
    
    for (const mat of materials) {
      const files = db.prepare('SELECT * FROM material_files WHERE material_id = ?').all(mat.id);
      
      for (const file of files) {
        try {
          const r2Key = file.path.replace(/^https?:\/\/[^/]+\//, '');
          const fileBuffer = await downloadFromR2(r2Key);
          
          if (fileBuffer) {
            const fileName = file.name || `file_${file.id}${file.ext}`;
            archive.append(fileBuffer, { name: `${mat.name}/${fileName}` });
          }
        } catch (e) {
          console.error(`Failed to add file ${file.name}:`, e.message);
        }
      }
    }
    
    await archive.finalize();
  } catch (e) {
    console.error('Download category error:', e);
    if (!res.headersSent) {
      res.json({ ok: false, error: '打包失败: ' + e.message });
    }
  }
});

// === Requests ===
app.post('/api/requests', upload.array('images', 5), async (req, res) => {
  const { username, content, contact } = req.body;
  if (!content) return res.json({ ok: false, error: '请填写需求描述' });

  const imgPaths = [];
  const files = req.files || [];
  for (const f of files) {
    const ext = path.extname(f.originalname);
    const key = `uploads/${crypto.randomUUID()}${ext}`;
    imgPaths.push(await uploadToR2(key, f.buffer, f.mimetype));
  }

  db.prepare('INSERT INTO requests (user, content, contact, images) VALUES (?, ?, ?, ?)')
    .run(username || '匿名', content, contact || '', JSON.stringify(imgPaths));

  // Notify admin
  const admins = db.prepare('SELECT username FROM users WHERE role = ?').all('admin');
  for (const admin of admins) {
    db.prepare('INSERT INTO notifications (user, from_user, message) VALUES (?, ?, ?)')
      .run(admin.username, username || '匿名', `收到新的素材需求: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
  }

  await syncDB();
  res.json({ ok: true });
});

app.get('/api/requests', (req, res) => {
  const requests = db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  res.json({ ok: true, requests: requests.map(r => ({
    ...r,
    images: JSON.parse(r.images || '[]')
  }))});
});

app.delete('/api/requests/:id', async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');
  if (!user) return res.json({ ok: false, error: '权限不足' });
  db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
  await syncDB();
  res.json({ ok: true });
});

// === Notifications ===
app.get('/api/notifications', (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications WHERE user = ? ORDER BY time DESC').all(req.query.username);
  const unread = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user = ? AND is_read = 0').get(req.query.username).cnt;
  res.json({ ok: true, notifications: notifs, unread });
});

app.post('/api/notifications/read', async (req, res) => {
  const { username } = req.body;
  // Verify user exists
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.json({ ok: false, error: '用户不存在' });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user = ?').run(username);
  await syncDB();
  res.json({ ok: true });
});

// === Bindings ===
app.post('/api/bindings', async (req, res) => {
  const { username, platform, platformAccount } = req.body;
  if (!platform || !platformAccount) return res.json({ ok: false, error: '请填写完整信息' });
  const existing = db.prepare('SELECT id FROM bindings WHERE username = ? AND platform = ?').get(username, platform);
  if (existing) {
    db.prepare('UPDATE bindings SET platform_account = ? WHERE username = ? AND platform = ?').run(platformAccount, username, platform);
  } else {
    db.prepare('INSERT INTO bindings (username, platform, platform_account) VALUES (?, ?, ?)').run(username, platform, platformAccount);
  }
  await syncDB();
  res.json({ ok: true });
});

app.get('/api/bindings', (req, res) => {
  const bindings = db.prepare('SELECT * FROM bindings WHERE username = ? ORDER BY bind_time DESC').all(req.query.username);
  res.json({ ok: true, bindings });
});

app.delete('/api/bindings/:platform', async (req, res) => {
  const { username } = req.body;
  db.prepare('DELETE FROM bindings WHERE username = ? AND platform = ?').run(username, req.params.platform);
  await syncDB();
  res.json({ ok: true });
});

app.get('/api/bindings/all', (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(req.query.username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足' });
  const users = db.prepare('SELECT username, role FROM users ORDER BY created_at DESC').all();
  const usersWithBindings = users.map(u => {
    const bindings = db.prepare('SELECT * FROM bindings WHERE username = ?').all(u.username);
    return { ...u, bindings };
  });
  res.json({ ok: true, users: usersWithBindings });
});

// === Revert to Stable ===
app.post('/api/revert-stable', async (req, res) => {
  const { username } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足，仅管理员可操作' });
  
  if (!USE_R2 || !cosClient) {
    return res.json({ ok: false, error: 'R2 未配置，无法恢复' });
  }
  
  try {
    console.log('Reverting to stable DB from R2...');
    const backupBuffer = await downloadFromR2('lizi_backup.db');
    if (!backupBuffer) {
      return res.json({ ok: false, error: 'R2 中找不到备份数据库 lizi_backup.db' });
    }
    
    // Block other requests during DB swap
    dbReady = false;
    
    // === 备份当前帐号资料（密码、设备锁定、绑定、会话） ===
    const currentUsers = db.prepare('SELECT * FROM users').all();
    const currentDeviceLocks = db.prepare('SELECT * FROM device_lock').all();
    const currentBindings = db.prepare('SELECT * FROM bindings').all();
    const currentSessions = db.prepare('SELECT * FROM sessions').all();
    console.log(`Preserving ${currentUsers.length} users, ${currentDeviceLocks.length} device locks, ${currentBindings.length} bindings`);
    
    // Close current DB
    db.close();
    
    // Write backup to DB path
    fs.writeFileSync(DB_PATH, backupBuffer);
    console.log('DB file restored from backup (' + backupBuffer.length + ' bytes)');
    
    // Re-init DB
    const CompatDB = require('./lib/sqlite-compat');
    db = new CompatDB(null, DB_PATH);
    db.pragma('journal_mode = WAL');
    
    // === 恢复当前帐号资料（不影响密码） ===
    // 清空备份中的帐号表，用当前数据覆盖
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM device_lock');
    db.exec('DELETE FROM bindings');
    db.exec('DELETE FROM users');
    
    const insertUser = db.prepare('INSERT INTO users (id, username, password, role, force_pwd_change, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const u of currentUsers) {
      insertUser.run(u.id, u.username, u.password, u.role, u.force_pwd_change, u.created_at);
    }
    console.log(`Restored ${currentUsers.length} users (passwords preserved)`);
    
    const insertLock = db.prepare('INSERT INTO device_lock (id, username, device_id, is_mobile, locked_at) VALUES (?, ?, ?, ?, ?)');
    for (const l of currentDeviceLocks) {
      try { insertLock.run(l.id, l.username, l.device_id, l.is_mobile, l.locked_at); } catch(e) {}
    }
    
    const insertBinding = db.prepare('INSERT INTO bindings (id, username, platform, platform_account, bind_time) VALUES (?, ?, ?, ?, ?)');
    for (const b of currentBindings) {
      try { insertBinding.run(b.id, b.username, b.platform, b.platform_account, b.bind_time); } catch(e) {}
    }
    
    const insertSession = db.prepare('INSERT INTO sessions (id, username, device_id, token, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const s of currentSessions) {
      try { insertSession.run(s.id, s.username, s.device_id, s.token, s.created_at); } catch(e) {}
    }
    
    const count = db.prepare('SELECT COUNT(*) as c FROM materials').get().c;
    console.log('DB restored with ' + count + ' materials (accounts preserved)');
    
    // Sync back to R2
    await syncDB();
    
    // Unblock requests
    dbReady = true;
    
    res.json({ ok: true, message: '恢复成功（帐号密码已保留）', materialCount: count, userCount: currentUsers.length });
  } catch (e) {
    console.error('Revert failed:', e);
    dbReady = true; // Always unblock even on error
    res.json({ ok: false, error: '恢复失败: ' + e.message });
  }
});

// === Snapshot Save/Restore (manual only) ===
app.post('/api/snapshot/save', async (req, res) => {
  const { username } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足，仅管理员可操作' });
  
  try {
    const count = await saveSnapshot();
    res.json({ ok: true, message: `已保存 ${count} 个素材到快照`, materialCount: count });
  } catch (e) {
    res.json({ ok: false, error: '保存快照失败: ' + e.message });
  }
});

app.post('/api/snapshot/restore', async (req, res) => {
  const { username } = req.body;
  const admin = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, 'admin');
  if (!admin) return res.json({ ok: false, error: '权限不足，仅管理员可操作' });
  
  try {
    const count = await restoreSnapshot();
    await syncDB();
    res.json({ ok: true, message: `已从快照恢复 ${count} 个素材`, materialCount: count, materials: getAllMaterials() });
  } catch (e) {
    res.json({ ok: false, error: '恢复快照失败: ' + e.message });
  }
});

// === Audio Transcription (local whisper.cpp) ===
const { execFile } = require('child_process');
const os = require('os');

const WHISPER_BIN = '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = '/opt/whisper.cpp/models/ggml-tiny.bin';

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, error: 'No audio file provided' });

  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inputFile = path.join(tmpDir, `audio_${id}.webm`);
  const wavFile = path.join(tmpDir, `audio_${id}.wav`);

  try {
    // Save uploaded audio to temp file
    fs.writeFileSync(inputFile, req.file.buffer);

    // Convert to 16kHz mono WAV using ffmpeg
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-y', '-i', inputFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavFile],
        { timeout: 30000 }, (err) => err ? reject(err) : resolve());
    });

    // Run whisper.cpp
    const output = await new Promise((resolve, reject) => {
      execFile(WHISPER_BIN, [
        '-m', WHISPER_MODEL,
        '-f', wavFile,
        '-l', 'zh',
        '-oj',  // output JSON with segments
        '-of', path.join(tmpDir, `whisper_${id}`)
      ], { timeout: 120000 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Read whisper JSON output
    const jsonFile = path.join(tmpDir, `whisper_${id}.json`);
    let data;
    if (fs.existsSync(jsonFile)) {
      data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    } else {
      // Fallback: run again with text output
      const textOutput = await new Promise((resolve, reject) => {
        execFile(WHISPER_BIN, [
          '-m', WHISPER_MODEL, '-f', wavFile, '-l', 'zh', '--no-timestamps'
        ], { timeout: 120000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
      });
      data = { text: textOutput, segments: [] };
    }

    // Parse segments
    const segments = (data.transcription || data.segments || []).map(seg => ({
      time: seg.offsets ? seg.offsets.from / 1000 : (seg.start || 0),
      text: (seg.text || '').trim()
    })).filter(s => s.text);

    const fullText = data.text || segments.map(s => s.text).join('');

    // Cleanup temp files
    [inputFile, wavFile, jsonFile].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    res.json({ ok: true, text: fullText, segments });
  } catch (e) {
    console.error('[Transcribe] Error:', e.message);
    // Cleanup
    [inputFile, wavFile].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.json({ ok: false, error: e.message });
  }
});

// === SEO: sitemap & robots.txt ===

app.get('/robots.txt', (req, res) => {
  const baseUrl = getSiteURL(req);
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${baseUrl}/sitemap.xml`
  ].join('\n'));
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = getSiteURL(req);
  let materials = [];
  try {
    materials = db.prepare('SELECT id, cat, name, created_at FROM materials ORDER BY sort_order DESC, id DESC').all();
  } catch (e) {}

  const now = new Date().toISOString().split('T')[0];
  const urls = [
    { loc: baseUrl + '/', changefreq: 'daily', priority: '1.0', lastmod: now },
    { loc: baseUrl + '/cat/%E4%BA%BA%E7%89%A9', changefreq: 'daily', priority: '0.9', lastmod: now },
    { loc: baseUrl + '/cat/%E8%A1%A8%E6%83%85%E5%8C%85', changefreq: 'daily', priority: '0.8', lastmod: now },
    { loc: baseUrl + '/cat/%E7%94%BB%E5%B8%88%E5%AF%84%E5%94%AE', changefreq: 'weekly', priority: '0.7', lastmod: now },
    { loc: baseUrl + '/cat/%E8%83%8C%E6%99%AF%E5%9B%BE', changefreq: 'weekly', priority: '0.7', lastmod: now },
    { loc: baseUrl + '/cat/%E9%81%93%E5%85%B7%E6%A0%8F', changefreq: 'weekly', priority: '0.7', lastmod: now },
    { loc: baseUrl + '/cat/%E7%89%B9%E6%95%88', changefreq: 'weekly', priority: '0.7', lastmod: now },
    { loc: baseUrl + '/cat/%E9%99%90%E6%97%B6%E4%BC%98%E6%83%A0', changefreq: 'weekly', priority: '0.6', lastmod: now },
  ];

  materials.forEach(m => {
    urls.push({
      loc: `${baseUrl}/cat/${encodeURIComponent(m.cat)}?id=${m.id}`,
      changefreq: 'monthly',
      priority: '0.5',
      lastmod: (m.created_at || now).split(' ')[0]
    });
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`),
    '</urlset>'
  ].join('\n');

  res.type('application/xml');
  res.send(xml);
});

// === Diagnostic Endpoint (test R2 upload/download) ===
app.get('/api/debug/r2-test', async (req, res) => {
  const results = { timestamp: new Date().toISOString() };
  
  // Check config
  results.config = {
    USE_R2,
    R2_BUCKET: R2_BUCKET ? R2_BUCKET.substring(0, 10) + '...' : '(empty)',
    R2_ACCOUNT_ID: R2_ACCOUNT_ID ? R2_ACCOUNT_ID.substring(0, 8) + '...' : '(empty)',
    R2_ACCESS_KEY_ID: R2_ACCESS_KEY_ID ? 'set (' + R2_ACCESS_KEY_ID.substring(0, 8) + '...)' : '(empty)',
    R2_SECRET_ACCESS_KEY: R2_SECRET_ACCESS_KEY ? 'set (' + R2_SECRET_ACCESS_KEY.length + ' chars)' : '(empty)',
    R2_PUBLIC_URL,
    s3ClientInitialized: !!s3Client,
  };
  
  if (!USE_R2 || !cosClient) {
    results.error = 'R2 not configured';
    return res.json(results);
  }

  // Test 1: Upload a tiny test file
  const testKey = 'uploads/_diag_test_' + Date.now() + '.txt';
  const testContent = Buffer.from('R2 diagnostic test - ' + new Date().toISOString());
  try {
    const url = await uploadToR2(testKey, testContent, 'text/plain');
    results.upload = { ok: true, url };
  } catch(e) {
    results.upload = { ok: false, error: e.message, name: e.name, code: e.Code, statusCode: e.$metadata?.httpStatusCode };
    return res.json(results);
  }

  // Test 2: Download it back
  try {
    const buf = await downloadFromR2(testKey);
    results.download = { ok: !!buf, size: buf ? buf.length : 0, content: buf ? buf.toString() : null };
  } catch(e) {
    results.download = { ok: false, error: e.message };
  }

  // Test 3: Verify public URL is accessible
  try {
    const publicUrl = `${R2_PUBLIC_URL}/${testKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const fetchRes = await fetch(publicUrl, { signal: controller.signal });
    clearTimeout(timeout);
    results.publicAccess = { ok: fetchRes.ok, status: fetchRes.status, url: publicUrl };
  } catch(e) {
    results.publicAccess = { ok: false, error: e.message };
  }

  // Test 4: Cleanup
  try {
    await deleteFromR2(`${R2_PUBLIC_URL}/${testKey}`);
    results.cleanup = { ok: true };
  } catch(e) {
    results.cleanup = { ok: false, error: e.message };
  }

  // Test 5: Check multer config
  results.multer = {
    storage: 'memoryStorage',
    fileSizeLimit: '100MB',
    maxFiles: 20
  };

  res.json(results);
});

// === Multer Error Handler (must be after all routes) ===
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error(`[Multer Error] code=${err.code} message="${err.message}" field=${err.field || 'N/A'}`);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: `文件过大（最大允许 100MB）` });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({ ok: false, error: `文件数量过多（最多 20 个）` });
    }
    return res.status(400).json({ ok: false, error: `文件上传错误：${err.message}` });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

// === Start ===
async function setupDBSync() {
  if (USE_R2) {
    console.log('Checking for DB in R2...');
    // Only restore from R2 if local DB doesn't exist
    if (!fs.existsSync(DB_PATH)) {
      const dbBuffer = await downloadFromR2(DB_KEY);
      if (dbBuffer) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        fs.writeFileSync(DB_PATH, dbBuffer);
        console.log('DB restored from R2 (' + dbBuffer.length + ' bytes)');
      } else {
        console.log('No DB found in R2, will create new');
      }
    } else {
      console.log('Local DB exists, skipping R2 restore');
    }
  }
  await initDB();
  
  // Migration: fix category names
  const migrations = [
    { from: '背景', to: '背景图' },
    { from: '道具', to: '道具栏' }
  ];

  // Clean up stale is_snapshot column from old DB versions
  try {
    db.prepare('UPDATE materials SET is_snapshot = 0 WHERE is_snapshot = 1').run();
  } catch (e) {}

  for (const m of migrations) {
    const result = db.prepare('UPDATE materials SET cat = ? WHERE cat = ?').run(m.to, m.from);
    if (result.changes > 0) {
      console.log(`Migration: ${result.changes} materials updated from "${m.from}" to "${m.to}"`);
    }
  }

  // Migration: fix non-ASCII file paths in R2 (Chinese filenames cause 403 errors)
  if (USE_R2) {
    const filesWithBadPaths = db.prepare(
      "SELECT id, name, path, ext, mime FROM material_files WHERE path NOT LIKE '%/uploads/%' AND path NOT LIKE '%/files/%'"
    ).all();

    if (filesWithBadPaths.length > 0) {
      console.log(`Migration: Found ${filesWithBadPaths.length} files with non-ASCII paths, renaming...`);
      for (const f of filesWithBadPaths) {
        try {
          let key = f.path;
          const prefix = R2_PUBLIC_URL + '/';
          if (key.startsWith(prefix)) key = key.slice(prefix.length);

          // Check if key has non-ASCII chars
          let hasNonAscii = false;
          for (let i = 0; i < key.length; i++) {
            if (key.charCodeAt(i) > 127) { hasNonAscii = true; break; }
          }
          if (!hasNonAscii) continue;

          // Download from R2
          const fileBuffer = await downloadFromR2(key);
          if (!fileBuffer) {
            console.log(`  SKIP: Cannot download ${key}`);
            continue;
          }

          // Generate ASCII-safe key
          const hash = crypto.createHash('md5').update(f.name).digest('hex').slice(0, 12);
          const newKey = `files/${hash}${f.ext}`;

          // Upload to new key
          await new Promise((resolve, reject) => {
            cosClient.putObject({
              Bucket: R2_BUCKET,
              Region: process.env.COS_REGION || 'ap-hongkong',
              Key: newKey,
              Body: fileBuffer,
              ContentType: f.mime || 'application/octet-stream'
            }, (err) => { if (err) reject(err); else resolve(); });
          });

          // Delete old key
          await new Promise((resolve, reject) => {
            cosClient.deleteObject({
              Bucket: R2_BUCKET,
              Region: process.env.COS_REGION || 'ap-hongkong',
              Key: key
            }, (err) => { if (err) reject(err); else resolve(); });
          });

          // Update database
          const newUrl = `${R2_PUBLIC_URL}/${newKey}`;
          db.prepare('UPDATE material_files SET path = ? WHERE id = ?').run(newUrl, f.id);
          console.log(`  Renamed: ${key} → ${newKey}`);
        } catch(e) {
          console.error(`  Error renaming ${f.name}: ${e.message}`);
        }
      }
    }
  }

  // Check if database is incomplete and restore from backup if needed
  const materialCount = db.prepare('SELECT COUNT(*) as count FROM materials').get().count;
  console.log(`Current material count: ${materialCount}`);
  
  if (USE_R2 && materialCount < 55) {
    console.log('Material count is too low, restoring from backup...');
    const backupBuffer = await downloadFromR2('lizi_backup.db');
    if (backupBuffer) {
      // Close current connection
      db.close();
      // Restore from backup
      fs.writeFileSync(DB_PATH, backupBuffer);
      // Reopen database
      const CompatDB = require('./lib/sqlite-compat');
      db = new CompatDB(null, DB_PATH);
      db.pragma('journal_mode = WAL');
      
      // Re-run migrations on restored database
      for (const m of migrations) {
        const result = db.prepare('UPDATE materials SET cat = ? WHERE cat = ?').run(m.to, m.from);
        if (result.changes > 0) {
          console.log(`Migration on backup: ${result.changes} materials updated from "${m.from}" to "${m.to}"`);
        }
      }
      
      const newCount = db.prepare('SELECT COUNT(*) as count FROM materials').get().count;
      console.log(`Restored database with ${newCount} materials`);
    } else {
      console.log('Warning: lizi_backup.db not found in R2');
    }
  }
  
  // Migration: fix orphaned materials (materials with no files due to lastInsertRowid bug)
  if (USE_R2) {
    try {
      const orphanedMaterials = db.prepare(
        'SELECT m.id, m.name, m.created_at FROM materials m LEFT JOIN material_files mf ON m.id = mf.material_id WHERE mf.id IS NULL ORDER BY m.id'
      ).all();
      
      if (orphanedMaterials.length > 0) {
        console.log(`Migration: Found ${orphanedMaterials.length} orphaned materials, attempting to recover files from R2...`);
        const r2Files = await new Promise((resolve, reject) => {
          cosClient.getBucket({
            Bucket: R2_BUCKET,
            Region: process.env.COS_REGION || 'ap-hongkong',
            Prefix: 'uploads/',
            MaxKeys: 1000
          }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        
        const r2FileMap = {};
        for (const obj of (r2Files.Contents || [])) {
          r2FileMap[obj.Key] = { size: obj.Size, modified: new Date(obj.LastModified) };
        }
        
        for (const mat of orphanedMaterials) {
          const matTime = new Date(mat.created_at).getTime();
          const matches = [];
          
          for (const [key, info] of Object.entries(r2FileMap)) {
            const fileTime = info.modified.getTime();
            if (Math.abs(fileTime - matTime) < 60000) {
              const ext = path.extname(key).toLowerCase();
              if (['.png', '.gif', '.jpg', '.jpeg', '.fla'].includes(ext)) {
                matches.push({ key, ext, size: info.size, mime: ext === '.fla' ? 'application/octet-stream' : (ext === '.gif' ? 'image/gif' : ext === '.jpg' ? 'image/jpeg' : 'image/' + ext.slice(1)) });
              }
            }
          }
          
          if (matches.length > 0) {
            console.log(`  Material "${mat.name}" (id=${mat.id}): found ${matches.length} matching files`);
            for (const m of matches) {
              const url = `${R2_PUBLIC_URL}/${m.key}`;
              db.prepare('INSERT INTO material_files (material_id, name, path, ext, size, mime) VALUES (?, ?, ?, ?, ?, ?)')
                .run(mat.id, mat.name + m.ext, url, m.ext, m.size, m.mime);
            }
          } else {
            console.log(`  Material "${mat.name}" (id=${mat.id}): no matching files found, deleting...`);
            db.prepare('DELETE FROM materials WHERE id = ?').run(mat.id);
          }
        }
      }
    } catch (e) {
      console.error('Migration (orphaned materials) failed:', e.message);
    }
  }
  
  // Upload DB immediately on startup so R2 always has latest
  if (USE_R2) {
    await syncDB();
  }
}

// === AI Maintenance Settings API ===
app.get("/api/settings/ai-maintenance", (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM site_settings WHERE key = ?").get("ai_maintenance");
    res.json({ maintenance: row ? row.value === "true" : false });
  } catch (err) {
    console.error("Get AI maintenance setting error:", err);
    res.status(500).json({ error: "获取设置失败" });
  }
});

app.put("/api/settings/ai-maintenance", (req, res) => {
  try {
    const { username, enabled } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND role = ?").get(username, "admin");
    if (!user) return res.status(403).json({ error: "权限不足" });
    const val = enabled ? "true" : "false";
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run("ai_maintenance", val);
    console.log("[Settings] AI maintenance set to:", val, "by", username);
    res.json({ success: true, maintenance: enabled });
  } catch (err) {
    console.error("Set AI maintenance error:", err);
    res.status(500).json({ error: "设置失败" });
  }
});

// === Sora 2 Video API Proxy ===
const APIYI_VIDEO_KEY = process.env.APIYI_VIDEO_KEY;
const APIYI_VIDEO_URL = process.env.APIYI_VIDEO_URL || "https://api.zhizengzeng.com";

app.post('/api/video/generate', async (req, res) => {
  try {
    const { model, prompt, seconds, size, image_url } = req.body;
    if (!model || !prompt) return res.status(400).json({ error: '缺少必要参数' });
    
    // Build request body - include image_url for i2v (image-to-video)
    const requestBody = { model, prompt, seconds: String(seconds), size };
    if (image_url) {
      requestBody.image_url = image_url;
    }
    
    const resp = await fetch(`${APIYI_VIDEO_URL}/v1/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${APIYI_VIDEO_KEY}` },
      body: JSON.stringify(requestBody)
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.error?.message || '提交失败' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/video/status/:id', async (req, res) => {
  try {
    const resp = await fetch(`${APIYI_VIDEO_URL}/v1/videos/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${APIYI_VIDEO_KEY}` }
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.error?.message || '查询失败' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/video/download/:id', async (req, res) => {
  try {
    const resp = await fetch(`${APIYI_VIDEO_URL}/v1/videos/${req.params.id}/content`, {
      headers: { 'Authorization': `Bearer ${APIYI_VIDEO_KEY}` }
    });
    if (!resp.ok) return res.status(resp.status).json({ error: '下载失败' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="sora2-${req.params.id}.mp4"`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === SPA Catch-all: serve index.html for any unmatched GET routes ===
// This fixes "NOT FOUND" when users bookmark or directly visit sub-page URLs on mobile/desktop
app.get('/:path*', (req, res, next) => {
  // Skip API routes, static files, and non-GET requests
  if (req.path.startsWith('/api/') || req.path.startsWith('/assets/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function main() {
  await initR2();
  await setupDBSync();
  
  // Initialize AI system
  initAITables(db);
  app.locals.db = db; // Make db accessible to AI system
  app.locals.uploadToR2 = uploadToR2; // Make R2 upload accessible to AI video system
  app.use('/api/ai', aiRouter);
  console.log('AI image generation system initialized');
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`栗子素材网 running on http://0.0.0.0:${PORT} | R2: ${USE_R2 ? 'enabled' : 'disabled'}`);
  });
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
