require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
});

const SRC_DIR = '/workspace/素材解压/素材打包';

async function main() {
  const files = fs.readdirSync(SRC_DIR);
  console.log(`Found ${files.length} files to upload`);

  let uploaded = 0;
  let failed = 0;
  const results = {};

  for (const file of files) {
    const filePath = path.join(SRC_DIR, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const ext = path.extname(file).toLowerCase();
    let mime = 'application/octet-stream';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      mime = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
    } else if (ext === '.fla') {
      mime = 'application/octet-stream';
    }

    const key = file; // use filename directly as key

    try {
      const buffer = fs.readFileSync(filePath);
      await client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mime
      }));
      const url = `${R2_PUBLIC_URL}/${key}`;
      results[file] = url;
      uploaded++;
      if (uploaded % 10 === 0) console.log(`Progress: ${uploaded} uploaded...`);
    } catch (e) {
      console.error(`Failed: ${file} - ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${uploaded} uploaded, ${failed} failed`);
  fs.writeFileSync('/workspace/upload_results.json', JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
