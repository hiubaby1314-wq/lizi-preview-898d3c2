#!/usr/bin/env node
/**
 * reapply-watermark.js - Reapply watermark from backup originals to COS
 * Uses the original (unwatermarked) images from watermark_backup/
 */
const path = require('path');
const fs = require('fs');
const { applyWatermark } = require('./watermark');

require('dotenv').config();
const COS = require('cos-nodejs-sdk-v5');

const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_REGION = process.env.COS_REGION || 'ap-hongkong';
const BACKUP_DIR = path.join(__dirname, 'watermark_backup');

const cosClient = new COS({
  SecretId: process.env.R2_ACCESS_KEY_ID,
  SecretKey: process.env.R2_SECRET_ACCESS_KEY
});

function uploadToCOS(key, buffer, contentType) {
  return new Promise((resolve, reject) => {
    cosClient.putObject({
      Bucket: R2_BUCKET,
      Region: R2_REGION,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

const CompatDB = require('./lib/sqlite-compat');
const DB_PATH = path.join(__dirname, 'data', 'lizi.db');
const db = new CompatDB(null, DB_PATH);
db.pragma('journal_mode = WAL');

function getImageFiles() {
  const files = db.prepare(`
    SELECT mf.id, mf.material_id, mf.name, mf.path, mf.ext, mf.mime, m.name as material_name
    FROM material_files mf
    JOIN materials m ON mf.material_id = m.id
    WHERE mf.mime LIKE 'image/%'
    AND mf.ext NOT IN ('.gif', '.svg', '.fla', '.swf')
    ORDER BY mf.id DESC
  `).all();
  return files;
}

function getMimeFromExt(ext) {
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  return map[ext.toLowerCase()] || null;
}

async function run() {
  console.log('=== Reapply Watermark from Backup ===');
  console.log('Using original images from watermark_backup/\n');

  const files = getImageFiles();
  console.log(`Found ${files.length} image files to process.\n`);

  let success = 0, failed = 0, skipped = 0;
  for (const file of files) {
    const key = file.path.replace(/^https?:\/\/[^/]+\//, '');
    const safeName = `${file.material_id}_${file.id}${file.ext}`;
    const backupPath = path.join(BACKUP_DIR, safeName);

    try {
      console.log(`[${success + failed + skipped + 1}/${files.length}] Processing: ${file.name}`);
      
      if (!fs.existsSync(backupPath)) {
        console.log(`  Skipped: backup not found (${safeName})\n`);
        skipped++;
        continue;
      }

      const buffer = fs.readFileSync(backupPath);
      const mime = file.mime || getMimeFromExt(file.ext);
      if (!mime) {
        console.log(`  Skipped (unknown mime)\n`);
        skipped++;
        continue;
      }

      const watermarked = await applyWatermark(buffer, mime);
      await uploadToCOS(key, watermarked, mime);
      console.log(`  OK: ${buffer.length} -> ${watermarked.length} bytes\n`);
      success++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n=== Complete: ${success} success, ${failed} failed, ${skipped} skipped ===`);
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    db.close();
  }
})();
