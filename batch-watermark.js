/**
 * batch-watermark.js - Batch apply watermark to existing material images
 * 
 * Usage:
 *   node batch-watermark.js preview    -- Download images from COS, apply watermark, save to preview/ folder
 *   node batch-watermark.js apply      -- Apply watermark and re-upload to COS (BACKUPS first)
 */
const path = require('path');
const fs = require('fs');
const { applyWatermark } = require('./watermark');

// Load env
require('dotenv').config();
const COS = require('cos-nodejs-sdk-v5');

const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_REGION = process.env.COS_REGION || 'ap-hongkong';
const PREVIEW_DIR = path.join(__dirname, 'watermark_preview');
const BACKUP_DIR = path.join(__dirname, 'watermark_backup');

// Init COS
const cosClient = new COS({
  SecretId: process.env.R2_ACCESS_KEY_ID,
  SecretKey: process.env.R2_SECRET_ACCESS_KEY
});

// Init DB
const CompatDB = require('./lib/sqlite-compat');
const DB_PATH = path.join(__dirname, 'data', 'lizi.db');
const db = new CompatDB(null, DB_PATH);
db.pragma('journal_mode = WAL');

function downloadFromCOS(key) {
  return new Promise((resolve, reject) => {
    cosClient.getObject({
      Bucket: R2_BUCKET,
      Region: R2_REGION,
      Key: key
    }, (err, data) => {
      if (err) reject(err);
      else resolve(data.Body);
    });
  });
}

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

// Get all image files from DB
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

async function runPreview(limit = 10) {
  console.log('=== Watermark PREVIEW Mode ===');
  console.log(`Will process up to ${limit} images\n`);

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  const files = getImageFiles();
  const toProcess = files.slice(0, limit);
  console.log(`Found ${files.length} image files in DB, processing ${toProcess.length}...\n`);

  let success = 0, failed = 0;
  for (const file of toProcess) {
    const key = file.path.replace(/^https?:\/\/[^/]+\//, '');
    const safeName = `${file.material_id}_${file.id}${file.ext}`;
    const previewPath = path.join(PREVIEW_DIR, safeName);

    try {
      console.log(`[${success + failed + 1}/${toProcess.length}] Downloading: ${file.name}...`);
      const buffer = await downloadFromCOS(key);
      
      const mime = file.mime || getMimeFromExt(file.ext);
      if (!mime) {
        console.log(`  Skipped (unknown mime): ${file.ext}`);
        continue;
      }

      console.log(`  Applying watermark (${buffer.length} bytes)...`);
      const watermarked = await applyWatermark(buffer, mime);

      fs.writeFileSync(previewPath, watermarked);
      console.log(`  Saved preview: ${safeName} (${watermarked.length} bytes)\n`);
      success++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n=== Preview complete: ${success} success, ${failed} failed ===`);
  console.log(`Preview files saved to: ${PREVIEW_DIR}`);
}

async function runApply() {
  console.log('=== Watermark APPLY Mode ===');
  console.log('This will:\n  1. Download each image from COS\n  2. Backup original to local backup/\n  3. Apply watermark\n  4. Re-upload watermarked version\n');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const files = getImageFiles();
  console.log(`Found ${files.length} image files to process.\n`);

  let success = 0, failed = 0, skipped = 0;
  for (const file of files) {
    const key = file.path.replace(/^https?:\/\/[^/]+\//, '');
    const safeName = `${file.material_id}_${file.id}${file.ext}`;
    const backupPath = path.join(BACKUP_DIR, safeName);

    try {
      console.log(`[${success + failed + skipped + 1}/${files.length}] Processing: ${file.name} (${key})`);
      
      // Download original
      const buffer = await downloadFromCOS(key);
      
      // Save backup
      fs.writeFileSync(backupPath, buffer);

      const mime = file.mime || getMimeFromExt(file.ext);
      if (!mime) {
        console.log(`  Skipped (unknown mime)\n`);
        skipped++;
        continue;
      }

      // Apply watermark
      const watermarked = await applyWatermark(buffer, mime);
      
      // Re-upload
      await uploadToCOS(key, watermarked, mime);
      console.log(`  OK: watermarked and re-uploaded (${buffer.length} -> ${watermarked.length} bytes)\n`);
      success++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n=== Apply complete: ${success} success, ${failed} failed, ${skipped} skipped ===`);
  console.log(`Backups saved to: ${BACKUP_DIR}`);
}

// Main
(async () => {
  const mode = process.argv[2] || 'preview';
  const limit = parseInt(process.argv[3]) || 10;

  try {
    if (mode === 'preview') {
      await runPreview(limit);
    } else if (mode === 'apply') {
      await runApply();
    } else {
      console.log('Usage: node batch-watermark.js [preview|apply] [limit]');
    }
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    db.close();
  }
})();
