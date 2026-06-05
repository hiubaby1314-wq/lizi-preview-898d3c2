 
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { AlipaySdk, AlipayFormData } = require('alipay-sdk');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// AI模型定价（成本价，单位：人民币元）- zhizengzeng.com OpenAI + Gemini 代理
// USD/CNY ≈ 7.25
const MODEL_PRICING = {
  // GPT-Image-1: 按品质/分辨率定价（成本价 USD: Low/1K=$0.011 Low/2K=$0.016 Med/1K=$0.042 Med/2K=$0.063 High/1K=$0.167 High/2K=$0.25）
  'gpt-image-1': { 'low-1K': 0.08, 'low-2K': 0.12, 'medium-1K': 0.31, 'medium-2K': 0.46, 'high-1K': 1.22, 'high-2K': 1.82 },
  'gpt-image-1.5': { 'low-1K': 0.07, 'low-2K': 0.09, 'medium-1K': 0.25, 'medium-2K': 0.37, 'high-1K': 0.97, 'high-2K': 1.46 },
  // GPT-Image-1-Mini: 轻量版（USD: Low/1K=$0.005 Low/2K=$0.006 Med/1K=$0.011 Med/2K=$0.015）
  'gpt-image-1-mini': { 'low-1K': 0.04, 'low-2K': 0.05, 'medium-1K': 0.08, 'medium-2K': 0.11 },
  // GPT-Image-2: 按token计费，取典型生成场景估算（Output 30 USD/M tokens）
  'gpt-image-2': 1.00,
  // DALL-E 3（USD: Std/1K=$0.04 Std/2K=$0.08 HD/1K=$0.08 HD/2K=$0.12）
  // Gemini 2.5 Flash Image（$0.039/张）
  'gemini-2.5-flash-image': 0.29,
  // Imagen 4.0 系列（Google）
  'imagen-4.0-generate': 0.29,         // $0.04/张
  'imagen-4.0-ultra-generate': 0.44,   // $0.06/张
  'imagen-4.0-fast-generate': 0.15,    // $0.02/张
  // 图生图
  'gpt-image-1-edit': { 'low-1K': 0.08, 'low-2K': 0.12, 'medium-1K': 0.31, 'medium-2K': 0.46, 'high-1K': 1.22, 'high-2K': 1.82 },
  'pollinations-i2i': 0,
  // 免费模型（Pollinations）
  'pollinations': 0,
  'pollinations-realism': 0,
  'pollinations-anime': 0,
  'pollinations-3d': 0,
  'pollinations-turbo': 0,
  // === 视频生成模型 (API易) ===
  // Sora 2 标准版 (720p): $0.10/秒
  'sora-2': { '720p-4s': 2.90, '720p-8s': 5.80, '720p-12s': 8.70 },
  // Sora 2 Pro 专业版 (720p $0.30/秒, 1024p $0.50/秒, 1080p $0.70/秒)
  'sora-2-pro': {
    '720p-4s': 8.70, '720p-8s': 17.40, '720p-12s': 26.10,
    '1024p-4s': 14.50, '1024p-8s': 29.00, '1024p-12s': 43.50,
    '1080p-4s': 20.30, '1080p-8s': 40.60, '1080p-12s': 60.90
  },
  // === API易 图像模型 ===
  'apiyi-nano-banana-1': 0.15,
  'apiyi-nano-banana-pro': 0.65,
  'apiyi-nano-banana-2': 0.40,
  'apiyi-gpt-image-2-all': 0.22,
  'apiyi-gpt-image-2-vip': 0.22,
                  'gpt-image-1.5-edit': { 'low-1K': 0.07, 'low-2K': 0.09, 'medium-1K': 0.25, 'medium-2K': 0.37, 'high-1K': 0.97, 'high-2K': 1.46 },
  'gpt-image-2-edit': 1.00,
  'apiyi-nano-banana-pro-edit': 0.65,
  'apiyi-nano-banana-2-edit': 0.40,
          'apiyi-seedream-5': 0.25,
  'apiyi-seedream-4-5': 0.29,
  'apiyi-seedream-4': 0.22,
    // === 豆包 Seedance 视频模型 (双价格：预扣最高价，生成后退差价) ===
  // zhizengzeng.com 官方价格: ¥28-46/百万tokens (含3%后: ¥28.84-47.38/百万tokens)
  // 预估 ~37,400 tokens/秒 (基于11秒=411,300 tokens实测)
  'seedance-2-0': {
    dualPrice: true,
    minRate: 28.84,  // ¥/百万tokens (成本+3%)
    maxRate: 47.38,  // ¥/百万tokens (成本+3%)
    tokensPerSecond: 37400,
    tiers: {
      '5s':  { minCost: 5.39, maxCost: 8.86 },   // 187K tokens
      '8s':  { minCost: 8.62, maxCost: 14.17 },  // 299K tokens
      '10s': { minCost: 10.78, maxCost: 17.71 }, // 374K tokens
      '11s': { minCost: 11.86, maxCost: 19.48 }  // 411K tokens
    }
  },
  'seedance-2-0-fast': {
    dualPrice: true,
    minRate: 22.66,  // ¥22/百万tokens +3%
    maxRate: 38.11,  // ¥37/百万tokens +3%
    tokensPerSecond: 37400,
    tiers: {
      '5s':  { minCost: 4.23, maxCost: 7.11 },
      '8s':  { minCost: 6.78, maxCost: 11.39 },
      '10s': { minCost: 8.47, maxCost: 14.25 },
      '11s': { minCost: 9.32, maxCost: 15.67 }
    }
  },
  'kling-v1-5': {
    tiers: {
      '5s':  { minCost: 6.50, maxCost: 6.50 },
      '10s': { minCost: 12.00, maxCost: 12.00 }
    }
  },
  'minimax-m2-5': {
    tiers: {
      '5s':  { minCost: 5.80, maxCost: 5.80 },
      '10s': { minCost: 10.50, maxCost: 10.50 }
    }
  },
  // === WAN 万相 多视角图片生成 (智增增阿里千问) ===
  'wan2.7-image': 0.50,
  'wan2.7-image-pro': 0.80,
};

// 根据模型+品质+分辨率获取成本价
function getModelCost(model, quality, resolution) {
  const pricing = MODEL_PRICING[model];
  // 处理双价格模型 (Seedance)
  if (pricing && pricing.dualPrice) {
    const duration = (quality || resolution || '5s').toLowerCase();
    const tier = pricing.tiers[duration];
    if (tier) return tier.maxCost; // 返回最高价作为预扣价
    return pricing.tiers[Object.keys(pricing.tiers)[0]].maxCost;
  }
  if (typeof pricing === 'number') return pricing;
  if (typeof pricing === 'object' && pricing !== null) {
    const q = (quality || 'medium').toLowerCase().replace('auto', 'medium');
    const r = resolution || '1K';
    const key = `${q}-${r}`;
    if (pricing[key] !== undefined) return pricing[key];
    // 回退：取第一个可用价格
    const firstKey = Object.keys(pricing)[0];
    return pricing[firstKey] || 0;
  }
  return 0;
}

// 根据模型类型获取加价率（视频模型15%，图像模型30%，双价格模型已在价格中包含）
function getMarkupRate(model) {
  const pricing = MODEL_PRICING[model];
  if (pricing && pricing.dualPrice) return 1; // 双价格模型已在价格中包含加价
  return model && model.startsWith('sora-2') ? 1.15 : 1.3;
}

// 判断模型是否允许使用免费次数（视频模型不允许，价格>¥0.20不允许）
function isFreeEligible(model) {
  if (!model) return true;
  if (model.startsWith('sora-2')) return false;
  if (model.startsWith('seedance')) return false;
  // 获取模型成本价（取最低档）
  const pricing = MODEL_PRICING[model];
  if (!pricing) return true; // 免费模型或未知
  let cost = 0;
  if (typeof pricing === 'number') {
    cost = pricing;
  } else if (typeof pricing === 'object' && pricing !== null && !pricing.dualPrice) {
    // 取最低档价格
    const values = Object.values(pricing).filter(v => typeof v === 'number');
    cost = values.length > 0 ? Math.min(...values) : 0;
  }
  const markupRate = model.startsWith('sora-2') ? 1.15 : 1.3;
  const sellPrice = cost * markupRate;
  return sellPrice <= 0.20;
}

// 每日免费次数：每天重置为1次
const DAILY_FREE_LIMIT = 1;

function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// 检查并重置每日免费次数
function ensureDailyFreeReset(db, userId) {
  const today = getTodayKey();
  const user = db.prepare('SELECT free_credits, last_free_reset FROM ai_users WHERE id = ?').get(userId);
  if (!user) return 0;
  if (user.last_free_reset !== today) {
    db.prepare('UPDATE ai_users SET free_credits = ?, last_free_reset = ? WHERE id = ?')
      .run(DAILY_FREE_LIMIT, today, userId);
    return DAILY_FREE_LIMIT;
  }
  return user.free_credits;
}

// 售价（成本价 + 加价利润）
function getSellPrice(model, quality, resolution) {
  const cost = getModelCost(model, quality, resolution);
  const markup = getMarkupRate(model);
  return Math.ceil(cost * markup * 100) / 100;
}

// 获取模型的所有价格档位（用于前端展示）
function getModelPriceTiers(model) {
  const pricing = MODEL_PRICING[model];
  // 双价格模型 (Seedance)
  if (pricing && pricing.dualPrice) {
    const tiers = {};
    for (const [key, tier] of Object.entries(pricing.tiers)) {
      tiers[key] = { minCost: tier.minCost, maxCost: tier.maxCost, minPrice: tier.minCost, maxPrice: tier.maxCost };
    }
    const allMin = Object.values(pricing.tiers).map(t => t.minCost);
    const allMax = Object.values(pricing.tiers).map(t => t.maxCost);
    return {
      tiers,
      minPrice: Math.min(...allMin),
      maxPrice: Math.max(...allMax),
      dualPrice: true,
      free: false
    };
  }
  if (typeof pricing === 'number') {
    return { price: getSellPrice(model), cost: pricing, free: pricing === 0 };
  }
  if (typeof pricing === 'object' && pricing !== null) {
    const tiers = {};
    const markup = getMarkupRate(model);
    for (const [key, cost] of Object.entries(pricing)) {
      tiers[key] = { cost, price: Math.ceil(cost * markup * 100) / 100 };
    }
    const prices = Object.values(pricing);
    return { tiers, minPrice: Math.ceil(Math.min(...prices) * markup * 100) / 100, maxPrice: Math.ceil(Math.max(...prices) * markup * 100) / 100, free: false };
  }
  return { price: 0, free: true };
}

// JWT密钥（从环境变量读取）
const JWT_SECRET = process.env.JWT_SECRET;

// 初始化数据库表
function initTables(db) {
  // AI用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      balance REAL DEFAULT 0,
      free_credits INTEGER DEFAULT 3,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // AI交易记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL, -- recharge, generate, free
      amount REAL,
      model TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES ai_users(id)
    )
  `);

  // AI支付订单表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_no TEXT UNIQUE NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending', -- pending, paid, failed
      alipay_trade_no TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES ai_users(id)
    )
  `);

  // Add device_id column to existing databases
  try { db.exec('ALTER TABLE ai_users ADD COLUMN device_id TEXT'); } catch(e) {}

  // Add last_free_reset column for daily free credit reset
  try { db.exec('ALTER TABLE ai_users ADD COLUMN last_free_reset TEXT DEFAULT ""'); } catch(e) {}

  // AI生成记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      image_url TEXT,
      cost REAL,
      is_free INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES ai_users(id)
    )
  `);
}

// JWT中间件
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期' });
  }
}

// 注册
router.post('/register', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码不能为空' });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }
    if (!/[a-z]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含小写字母' });
    }
    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含大写字母' });
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含特殊符号' });
    }

    const deviceId = req.body.deviceId;
    if (!deviceId) {
      return res.status(400).json({ error: '设备标识无效' });
    }

    const db = req.app.locals.db;
    const existing = db.prepare('SELECT id FROM ai_users WHERE phone = ?').get(phone);
    if (existing) {
      return res.status(400).json({ error: '该手机号已注册' });
    }

    // Check if device already has an account
    const existingDevice = db.prepare('SELECT id FROM ai_users WHERE device_id = ?').get(deviceId);
    if (existingDevice) {
      return res.status(400).json({ error: '每台设备仅允许注册一个账号' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const today = getTodayKey();
    const result = db.prepare(
      'INSERT INTO ai_users (phone, password, balance, free_credits, device_id, last_free_reset) VALUES (?, ?, 0, ?, ?, ?)'
    ).run(phone, hashedPassword, DAILY_FREE_LIMIT, deviceId, today);

    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      token,
      user: {
        id: result.lastInsertRowid,
        phone,
        balance: 0,
        freeCredits: DAILY_FREE_LIMIT
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '注册失败' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码不能为空' });
    }

    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE phone = ?').get(phone);
    if (!user) {
      return res.status(400).json({ error: '用户不存在' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: '密码错误' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    // Reset daily free credits
    const freeCredits = ensureDailyFreeReset(req.app.locals.db, user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        balance: user.balance,
        freeCredits: freeCredits
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// 获取用户信息
router.get('/user/info', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const freeCredits = ensureDailyFreeReset(db, req.userId);
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      id: user.id,
      phone: user.phone,
      balance: user.balance,
      freeCredits: freeCredits
    });
  } catch (err) {
    console.error('Get user info error:', err);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// 获取模型价格列表
router.get('/pricing', (req, res) => {
  const pricing = {};
  for (const model of Object.keys(MODEL_PRICING)) {
    const tiers = getModelPriceTiers(model);
    pricing[model] = tiers;
  }
  res.json(pricing);
});

// 创建支付宝充值订单
router.post('/payment/create', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 1) {
      return res.status(400).json({ error: '充值金额至少1元' });
    }
    if (amount > 50) {
      return res.status(400).json({ error: '单笔充值最高¥50' });
    }

    const db = req.app.locals.db;

    // 全站每日收款限额检查（全站每天最多收款¥1000）
    const today = new Date().toISOString().slice(0, 10);
    const todayTotal = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM ai_payments
       WHERE status = 'paid'
         AND DATE(paid_at) = ?`
    ).get(today);

    if ((todayTotal?.total || 0) + amount > 1000) {
      const remaining = Math.max(0, 1000 - (todayTotal?.total || 0));
      return res.status(400).json({ error: `今日全站充值限额已达（每日¥1000），剩余可充¥${remaining.toFixed(2)}` });
    }

    const orderNo = 'AI' + Date.now() + Math.random().toString(36).substr(2, 6);

    // 创建订单记录
    db.prepare(
      'INSERT INTO ai_payments (user_id, order_no, amount, status) VALUES (?, ?, ?, ?)'
    ).run(req.userId, orderNo, amount, 'pending');

    // 初始化支付宝SDK
    // Format keys with proper PEM headers and 64-char line wrapping
    function wrapPemKey(key, header, footer) {
      if (key.startsWith("-----")) return key;
      const lines = [];
      for (let i = 0; i < key.length; i += 64) lines.push(key.substring(i, i + 64));
      return header + "\n" + lines.join("\n") + "\n" + footer;
    }
    const isSandbox = process.env.ALIPAY_SANDBOX === "true";
    const privateKey = wrapPemKey(process.env.ALIPAY_PRIVATE_KEY, "-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----");
    const publicKey = wrapPemKey(process.env.ALIPAY_PUBLIC_KEY, "-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----");

    
    // Sandbox mode support
    const sdkAppId = isSandbox ? process.env.ALIPAY_SANDBOX_APP_ID : process.env.ALIPAY_APP_ID;
    const sdkPublicKey = isSandbox
      ? wrapPemKey(process.env.ALIPAY_SANDBOX_PUBLIC_KEY, "-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----")
      : publicKey;
    const sdkEndpoint = isSandbox ? process.env.ALIPAY_SANDBOX_ENDPOINT : undefined;

const alipaySdk = new AlipaySdk({
      appId: sdkAppId,
      privateKey: privateKey,
      alipayPublicKey: sdkPublicKey,
      signType: 'RSA2',
      keyType: 'PKCS8',
      ...(sdkEndpoint ? { endpoint: sdkEndpoint } : {})
    });
    console.log('[Alipay] Mode:', isSandbox ? 'SANDBOX' : 'PRODUCTION');

    const bizContent = {
      out_trade_no: orderNo,
      total_amount: amount.toFixed(2),
      subject: `栗子AI生图充值 ${amount}元`,
      product_code: 'FAST_INSTANT_TRADE_PAY'
    };

    const result = alipaySdk.pageExecute('alipay.trade.page.pay', 'GET', {
      bizContent,
      notifyUrl: 'https://lizisucaiwang.online/api/ai/payment/notify',
      returnUrl: 'https://lizisucaiwang.online/ai-image.html?payment=success'
    });
    // Replace gateway URL for sandbox mode
    const finalUrl = isSandbox ? result.replace('https://openapi.alipay.com/gateway.do', sdkEndpoint) : result;

    res.json({
      success: true,
      orderNo,
      payUrl: finalUrl
    });
  } catch (err) {
    console.error('Create payment error:', err);
    res.status(500).json({ error: '创建支付订单失败' });
  }
});

// 支付宝异步通知
router.post('/payment/notify', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { out_trade_no, trade_status, trade_no } = req.body;

    // 验证签名（简化版，生产环境需要完整验证）
    // TODO: 添加完整的签名验证

    if (trade_status === 'TRADE_SUCCESS' || trade_status === 'TRADE_FINISHED') {
      // 查找订单
      const payment = db.prepare('SELECT * FROM ai_payments WHERE order_no = ?').get(out_trade_no);
      if (payment && payment.status === 'pending') {
        // 更新订单状态
        db.prepare(
          'UPDATE ai_payments SET status = ?, alipay_trade_no = ?, paid_at = CURRENT_TIMESTAMP WHERE order_no = ?'
        ).run('paid', trade_no, out_trade_no);

        // 给用户加余额
        db.prepare(
          'UPDATE ai_users SET balance = balance + ? WHERE id = ?'
        ).run(payment.amount, payment.user_id);

        // 记录交易
        db.prepare(
          'INSERT INTO ai_transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)'
        ).run(payment.user_id, 'recharge', payment.amount, `支付宝充值 ${payment.amount}元`);

        console.log(`Payment success: order ${out_trade_no}, amount ${payment.amount}`);
      }
    }

    res.send('success');
  } catch (err) {
    console.error('Payment notify error:', err);
    res.send('fail');
  }
});

// 生成图片前检查余额并扣费
router.post('/generate/check', authMiddleware, (req, res) => {
  try {
    const { model, quality, resolution } = req.body;
    const price = getSellPrice(model, quality, resolution);
    const isFree = price === 0;

    const db = req.app.locals.db;
    const freeCredits = ensureDailyFreeReset(db, req.userId);
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);

    if (isFree) {
      return res.json({ allowed: true, cost: 0, free: true });
    }

    // 检查是否有免费次数（仅低价模型可用，视频模型除外）
    if (freeCredits > 0 && isFreeEligible(model)) {
      return res.json({
        allowed: true,
        cost: 0,
        free: true,
        freeCreditsLeft: freeCredits - 1,
        message: `今日免费次数（剩余${freeCredits - 1}次）`
      });
    }

    // 检查余额
    if (user.balance < price) {
      return res.json({
        allowed: false,
        cost: price,
        balance: user.balance,
        message: `余额不足，需要¥${price}，当前余额¥${user.balance.toFixed(2)}`
      });
    }

    res.json({
      allowed: true,
      cost: price,
      balance: user.balance - price
    });
  } catch (err) {
    console.error('Generate check error:', err);
    res.status(500).json({ error: '检查失败' });
  }
});

// 生成成功后扣费
router.post('/generate/deduct', authMiddleware, (req, res) => {
  try {
    const { model, prompt, imageUrl, isFree, quality, resolution } = req.body;
    const price = getSellPrice(model, quality, resolution);

    const db = req.app.locals.db;

    // 重置每日免费次数并检查
    const freeCredits = ensureDailyFreeReset(db, req.userId);
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    let actualCost = price;
    let usedFree = false;

    if (isFree || price === 0 || (freeCredits > 0 && isFreeEligible(model))) {
      actualCost = 0;
      usedFree = freeCredits > 0;
      if (usedFree) {
        db.prepare('UPDATE ai_users SET free_credits = free_credits - 1 WHERE id = ?').run(req.userId);
      }
    } else {
      // 扣余额
      db.prepare('UPDATE ai_users SET balance = balance - ? WHERE id = ?').run(price, req.userId);
    }

    // 记录生成
    db.prepare(
      'INSERT INTO ai_generations (user_id, model, prompt, image_url, cost, is_free) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, model, prompt, imageUrl, actualCost, usedFree || price === 0 ? 1 : 0);

    // 记录交易
    if (actualCost > 0) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'generate', -actualCost, model, `生成图片: ${model}`);
    } else if (usedFree) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'free', 0, model, `今日免费生成: ${model}`);
    }

    const updatedUser = db.prepare('SELECT balance, free_credits FROM ai_users WHERE id = ?').get(req.userId);

    res.json({
      success: true,
      balance: updatedUser.balance,
      freeCredits: updatedUser.free_credits,
      cost: actualCost
    });
  } catch (err) {
    console.error('Generate deduct error:', err);
    res.status(500).json({ error: '扣费失败' });
  }
});

// === 双价格模型：预扣最高价 ===
router.post('/generate/prededuct', authMiddleware, (req, res) => {
  try {
    const { model, duration } = req.body;
    const pricing = MODEL_PRICING[model];

    if (!pricing || !pricing.dualPrice) {
      return res.status(400).json({ error: '该模型不支持双价格' });
    }

    const tier = pricing.tiers[duration || '5s'];
    if (!tier) {
      return res.status(400).json({ error: '无效的时长选项' });
    }

    const maxPrice = tier.maxCost;
    const minPrice = tier.minCost;
    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);

    // 检查免费次数（视频模型不允许使用免费次数）
    if (user.free_credits > 0 && isFreeEligible(model)) {
      return res.json({
        allowed: true,
        preCharge: 0,
        minPrice,
        maxPrice,
        free: true,
        freeCreditsLeft: user.free_credits - 1
      });
    }

    if (user.balance < maxPrice) {
      return res.json({
        allowed: false,
        minPrice,
        maxPrice,
        balance: user.balance,
        message: `余额不足，需预扣¥${maxPrice}，当前余额¥${user.balance.toFixed(2)}`
      });
    }

    // 预扣最高价
    db.prepare('UPDATE ai_users SET balance = balance - ? WHERE id = ?').run(maxPrice, req.userId);

    const updatedUser = db.prepare('SELECT balance FROM ai_users WHERE id = ?').get(req.userId);
    res.json({
      allowed: true,
      preCharge: maxPrice,
      minPrice,
      maxPrice,
      balance: updatedUser.balance,
      message: `已预扣¥${maxPrice}，生成后按实际费用退还差价`
    });
  } catch (err) {
    console.error('Pre-deduct error:', err);
    res.status(500).json({ error: '预扣失败' });
  }
});

// === 双价格模型：退还差价 ===
router.post('/generate/refund', authMiddleware, (req, res) => {
  try {
    const { model, duration, actualTokens, preCharge, prompt, videoUrl, isFree } = req.body;
    const pricing = MODEL_PRICING[model];

    if (!pricing || !pricing.dualPrice) {
      return res.status(400).json({ error: '该模型不支持双价格' });
    }

    const db = req.app.locals.db;
    const user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);

    // 计算实际费用（按实际tokens × 实际价格档位）
    const actualMinCost = Math.ceil((actualTokens / 1000000) * pricing.minRate * 100) / 100;
    const actualMaxCost = Math.ceil((actualTokens / 1000000) * pricing.maxRate * 100) / 100;
    // 实际费用取中间值（更公平）
    const actualCost = Math.ceil((actualMinCost + actualMaxCost) / 2 * 100) / 100;

    let refundAmount = 0;
    let finalCost = 0;
    let usedFree = false;

    if (isFree || (user.free_credits > 0 && isFreeEligible(model))) {
      // 免费生成，全额退款
      refundAmount = preCharge;
      finalCost = 0;
      usedFree = user.free_credits > 0;
      if (usedFree) {
        db.prepare('UPDATE ai_users SET free_credits = free_credits - 1 WHERE id = ?').run(req.userId);
      }
    } else {
      // 计算退款金额
      refundAmount = Math.max(0, preCharge - actualCost);
      finalCost = actualCost;
    }

    // 退还差价
    if (refundAmount > 0) {
      db.prepare('UPDATE ai_users SET balance = balance + ? WHERE id = ?').run(refundAmount, req.userId);
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'refund', refundAmount, model, `退还差价: ${model} ${duration}秒`);
    }

    // 记录生成
    db.prepare(
      'INSERT INTO ai_generations (user_id, model, prompt, image_url, cost, is_free) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, model, prompt, videoUrl, finalCost, usedFree || isFree ? 1 : 0);

    // 记录交易
    if (finalCost > 0) {
      db.prepare(
        'INSERT INTO ai_transactions (user_id, type, amount, model, description) VALUES (?, ?, ?, ?, ?)'
      ).run(req.userId, 'generate', -finalCost, model, `生成视频: ${model} ${duration}秒 (实际${actualTokens}tokens)`);
    }

    const updatedUser = db.prepare('SELECT balance, free_credits FROM ai_users WHERE id = ?').get(req.userId);

    res.json({
      success: true,
      preCharge,
      actualCost,
      actualTokens,
      refundAmount,
      balance: updatedUser.balance,
      freeCredits: updatedUser.free_credits
    });
  } catch (err) {
    console.error('Refund error:', err);
    res.status(500).json({ error: '退款失败' });
  }
});

// === 豆包 Seedance 视频代理 ===
const ZHIZENGZENG_API_KEY = 'sk-zk213c532912552ad699d8575d28e0d0f286a1f8fa7e0a28';
const ZHIZENGZENG_BASE_URL = 'https://api.zhizengzeng.com';

// 提交视频生成任务
router.post('/seedance/generate', authMiddleware, async (req, res) => {
  try {
    const { model, prompt, duration, ratio, image_url } = req.body;
    if (!model || !prompt) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 映射模型ID
    const modelMap = {
      'seedance-2-0': 'doubao-seedance-2-0-260128',
      'seedance-2-0-fast': 'doubao-seedance-2-0-fast-260128',
      'kling-v1-5': 'kling-v1-5',
      'minimax-m2-5': 'minimax-m2.5'
    };
    const apiModel = modelMap[model] || model;

    const contentArr = [{ type: 'text', text: prompt }];
    if (image_url) {
      contentArr.push({ type: 'image_url', image_url: { url: image_url } });
    }
    const body = {
      model: apiModel,
      content: contentArr,
      duration: parseInt(duration) || 5,
      ratio: ratio || '16:9',
      generate_audio: true
    };

    const resp = await fetch(`${ZHIZENGZENG_BASE_URL}/bytedance/api/v3/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZHIZENGZENG_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('Seedance generate error:', data);
      return res.status(resp.status).json({ error: data.message || data.error || '提交失败' });
    }
    res.json(data);
  } catch (err) {
    console.error('Seedance proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 查询视频生成状态
router.get('/seedance/status/:taskId', authMiddleware, async (req, res) => {
  try {
    const resp = await fetch(`${ZHIZENGZENG_BASE_URL}/bytedance/api/v3/contents/generations/tasks/${req.params.taskId}`, {
      headers: { 'Authorization': `Bearer ${ZHIZENGZENG_API_KEY}` }
    });
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: data.message || '查询失败' });
    }
    res.json(data);
  } catch (err) {
    console.error('Seedance status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 下载视频内容
router.get('/seedance/download', authMiddleware, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: '缺少视频URL' });
    }

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${ZHIZENGZENG_API_KEY}` }
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: '下载失败' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Seedance download error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取交易记录
router.get('/transactions', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const limit = parseInt(req.query.limit) || 50;
    const transactions = db.prepare(
      'SELECT * FROM ai_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(req.userId, limit);

    res.json(transactions);
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ error: '获取交易记录失败' });
  }
});

// 管理员测试账号（自动创建或获取）
router.post('/admin/test-account', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const testPhone = '17121734984'; // 管理员测试专用手机号
    
    let user = db.prepare('SELECT * FROM ai_users WHERE phone = ?').get(testPhone);
    
    if (!user) {
      // Create test account
      const hashedPassword = await bcrypt.hash('bbshan12', 10);
      const result = db.prepare(
        'INSERT INTO ai_users (phone, password, balance, free_credits, device_id) VALUES (?, ?, 0, 99, ?)'
      ).run(testPhone, hashedPassword, 'admin_test_device');
      
      user = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(result.lastInsertRowid);
      console.log('Created admin test account:', testPhone);
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        balance: user.balance,
        freeCredits: user.free_credits
      }
    });
  } catch (err) {
    console.error('Admin test account error:', err);
    res.status(500).json({ error: '创建测试账号失败' });
  }
});


// Admin: manually add balance to user (after QR code payment confirmation)
router.post('/admin/add-balance', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;

    // Check if requester is admin (phone: 13800000000)
    const admin = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!admin || admin.phone !== '17121734984') {
      return res.status(403).json({ error: '权限不足' });
    }

    const { userId, amount } = req.body;
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: '参数错误' });
    }

    // Add balance
    db.prepare('UPDATE ai_users SET balance = balance + ? WHERE id = ?').run(amount, userId);

    // Record transaction
    db.prepare(
      'INSERT INTO ai_transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)'
    ).run(userId, 'recharge', amount, '管理员手动充值 ¥' + amount);

    const user = db.prepare('SELECT phone, balance FROM ai_users WHERE id = ?').get(userId);

    res.json({
      success: true,
      message: '已为用户 ' + user.phone + ' 充值 ¥' + amount,
      newBalance: user.balance
    });
  } catch (err) {
    console.error('Admin add balance error:', err);
    res.status(500).json({ error: '充值失败' });
  }
});

// Admin: list all users
router.get('/admin/users', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;

    const admin = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!admin || admin.phone !== '17121734984') {
      return res.status(403).json({ error: '权限不足' });
    }

    const users = db.prepare(
      'SELECT id, phone, balance, free_credits, created_at FROM ai_users ORDER BY created_at DESC'
    ).all();

    res.json(users);
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ error: '获取用户列表失败' });
  }
});


// ===== Admin Image Moderation =====

// List all AI generations with user info
router.get('/admin/generations', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const admin = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!admin || admin.phone !== '17121734984') {
      return res.status(403).json({ error: '权限不足' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const generations = db.prepare(`
      SELECT g.id, g.model, g.prompt, g.image_url, g.cost, g.is_free, g.created_at,
             u.phone as user_phone, u.id as user_id
      FROM ai_generations g
      LEFT JOIN ai_users u ON g.user_id = u.id
      ORDER BY g.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM ai_generations').get();

    res.json({
      generations,
      total: total.count,
      page,
      limit,
      totalPages: Math.ceil(total.count / limit)
    });
  } catch (err) {
    console.error('Admin list generations error:', err);
    res.status(500).json({ error: '获取生成记录失败' });
  }
});

// Delete a specific generation
router.delete('/admin/generations/:id', authMiddleware, (req, res) => {
  try {
    const db = req.app.locals.db;
    const admin = db.prepare('SELECT * FROM ai_users WHERE id = ?').get(req.userId);
    if (!admin || admin.phone !== '17121734984') {
      return res.status(403).json({ error: '权限不足' });
    }

    const generationId = parseInt(req.params.id);
    const result = db.prepare('DELETE FROM ai_generations WHERE id = ?').run(generationId);

    if (result.changes === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }

    res.json({ success: true, message: '已删除' });
  } catch (err) {
    console.error('Admin delete generation error:', err);
    res.status(500).json({ error: '删除失败' });
  }
});


// APIYI 已移除，余额监控统一使用智增增(/zhizengzeng/balance)


// === Zhizengzeng Balance Monitoring ===
const ZHIZENGZENG_BALANCE_URL = 'https://api.zhizengzeng.com/v1/dashboard/billing/credit_grants';
const ZZ_LOW_BALANCE_THRESHOLD_CNY = 20;

let zhizengzengBalanceCache = { amount: null, lastCheck: null, error: null };

async function checkZhizengzengBalance() {
  try {
    const resp = await fetch(ZHIZENGZENG_BALANCE_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ZHIZENGZENG_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.code !== 0) throw new Error(data.msg || 'API error');

    zhizengzengBalanceCache = {
      amount: parseFloat(data.grants.available_amount),
      lastCheck: new Date().toISOString(),
      error: null
    };

    if (zhizengzengBalanceCache.amount < ZZ_LOW_BALANCE_THRESHOLD_CNY) {
      console.log('[ZZ WARNING] Balance low: ¥' + zhizengzengBalanceCache.amount + ' CNY (threshold: ¥' + ZZ_LOW_BALANCE_THRESHOLD_CNY + ')');
    }

    return zhizengzengBalanceCache;
  } catch (e) {
    console.error('[ZZ] Balance check error:', e.message);
    zhizengzengBalanceCache.error = e.message;
    zhizengzengBalanceCache.lastCheck = new Date().toISOString();
    return zhizengzengBalanceCache;
  }
}

// Check every hour
setInterval(checkZhizengzengBalance, 60 * 60 * 1000);
setTimeout(checkZhizengzengBalance, 12000);

router.get('/zhizengzeng/balance', async (req, res) => {
  const cacheAge = zhizengzengBalanceCache.lastCheck ? (Date.now() - new Date(zhizengzengBalanceCache.lastCheck).getTime()) : Infinity;
  if (!zhizengzengBalanceCache.lastCheck || cacheAge > 5 * 60 * 1000) {
    await checkZhizengzengBalance();
  }
  res.json({
    ...zhizengzengBalanceCache,
    lowBalance: zhizengzengBalanceCache.amount !== null && zhizengzengBalanceCache.amount < ZZ_LOW_BALANCE_THRESHOLD_CNY,
    threshold: ZZ_LOW_BALANCE_THRESHOLD_CNY
  });
});


// === API Proxy (hide keys from frontend) ===
// Reuses ZHIZENGZENG_API_KEY and ZHIZENGZENG_BASE_URL defined above for Seedance
// 通道已切换到智增增(ZHIZENGZENG)，不再使用APIYI

async function _proxyFetch(targetUrl, reqBody, extraHeaders) {
  const fetchOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody)
  };
  const resp = await fetch(targetUrl, fetchOpts);
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { status: resp.status, body: await resp.json() };
  }
  return { status: resp.status, body: await resp.text() };
}

// Proxy: Zhizengzeng OpenAI images
router.post('/proxy/zz/openai', async (req, res) => {
  try {
    const path = req.query.path || '/v1/images/generations';
    const result = await _proxyFetch(ZHIZENGZENG_BASE_URL + path, req.body, {
      'Authorization': 'Bearer ' + ZHIZENGZENG_API_KEY
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    console.error('[Proxy ZZ OpenAI]', e.message);
    res.status(500).json({ error: 'Proxy error' });
  }
});

// Proxy: Zhizengzeng Gemini
router.post('/proxy/zz/gemini', async (req, res) => {
  try {
    const model = req.query.model;
    const action = req.query.action || 'generateContent';
    const url = ZHIZENGZENG_BASE_URL + '/google/v1beta/models/' + model + ':' + action;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': ZHIZENGZENG_API_KEY },
      body: JSON.stringify(req.body)
    });
    res.status(resp.status).json(await resp.json());
  } catch (e) {
    console.error('[Proxy ZZ Gemini]', e.message);
    res.status(500).json({ error: 'Proxy error' });
  }
});

// Proxy: APIYI images/generations
router.post('/proxy/apiyi/images', async (req, res) => {
  try {
    const result = await _proxyFetch(ZHIZENGZENG_BASE_URL + '/v1/images/generations', req.body, {
      'Authorization': 'Bearer ' + ZHIZENGZENG_API_KEY
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    console.error('[Proxy APIYI Images]', e.message);
    res.status(500).json({ error: 'Proxy error' });
  }
});

// Proxy: APIYI images/edits (converts JSON image URLs to multipart/form-data)
router.post('/proxy/apiyi/edits', async (req, res) => {
  try {
    const body = req.body;
    // If body has images array with image_url objects, convert to multipart
    if (body.images && Array.isArray(body.images) && body.images[0] && body.images[0].image_url) {
      // Build multipart/form-data manually for reliability
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const parts = [];
      const addField = (name, value) => {
        parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n'));
      };
      addField('model', body.model || 'gpt-image-2');
      addField('prompt', body.prompt || '');
      if (body.n) addField('n', String(body.n));
      if (body.size) addField('size', body.size);
      if (body.quality) addField('quality', body.quality);
      // Download each image and append as file part
      for (let i = 0; i < body.images.length; i++) {
        const imgUrl = body.images[i].image_url;
        const imgResp = await fetch(imgUrl);
        if (!imgResp.ok) throw new Error('Failed to download image: ' + imgUrl);
        const imgBuf = Buffer.from(await imgResp.arrayBuffer());
        const ct = imgResp.headers.get('content-type') || 'image/png';
        parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="image' + i + '.png"\r\nContent-Type: ' + ct + '\r\n\r\n'));
        parts.push(imgBuf);
        parts.push(Buffer.from('\r\n'));
      }
      parts.push(Buffer.from('--' + boundary + '--\r\n'));
      const formBuffer = Buffer.concat(parts);
      // Use https module for reliable multipart upload
      const https = require('https');
      const urlObj = new URL(ZHIZENGZENG_BASE_URL + '/v1/images/edits');
      const httpsResult = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: urlObj.hostname,
          port: urlObj.port || 443,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + ZHIZENGZENG_API_KEY,
            'Content-Type': 'multipart/form-data; boundary=' + boundary,
            'Content-Length': formBuffer.length
          }
        }, (resp) => {
          const chunks = [];
          resp.on('data', c => chunks.push(c));
          resp.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            let parsed;
            try { parsed = JSON.parse(raw); } catch(e) { parsed = { error: raw }; }
            resolve({ status: resp.statusCode, body: parsed });
          });
        });
        req.on('error', reject);
        req.write(formBuffer);
        req.end();
      });
      res.status(httpsResult.status).json(httpsResult.body);
    } else {
      // Fallback: pass through as JSON
      const result = await _proxyFetch(ZHIZENGZENG_BASE_URL + '/v1/images/edits', body, {
        'Authorization': 'Bearer ' + ZHIZENGZENG_API_KEY
      });
      res.status(result.status).json(result.body);
    }
  } catch (e) {
    console.error('[Proxy APIYI Edits]', e.message);
    res.status(500).json({ error: 'Proxy error: ' + e.message });
  }
});

// APIYI Gemini route removed - use /proxy/zz/gemini instead

// Proxy: APIYI chat/completions (supports streaming)
router.post('/proxy/apiyi/chat', async (req, res) => {
  try {
    const isStream = req.body.stream === true;

    if (isStream) {
      // Streaming: pipe response directly to client
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const upstream = await fetch(ZHIZENGZENG_BASE_URL + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + ZHIZENGZENG_API_KEY
        },
        body: JSON.stringify(req.body)
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        console.error('[Proxy APIYI Chat Stream] Error:', upstream.status, errText);
        res.status(upstream.status).end(errText);
        return;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      };
      await pump();
    } else {
      // Non-streaming: use normal proxy
      const result = await _proxyFetch(ZHIZENGZENG_BASE_URL + '/v1/chat/completions', req.body, {
        'Authorization': 'Bearer ' + ZHIZENGZENG_API_KEY
      });
      res.status(result.status).json(result.body);
    }
  } catch (e) {
    console.error('[Proxy APIYI Chat]', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Proxy error' });
    } else {
      res.end();
    }
  }
});


// === Image Hosting for i2i reference images ===
router.post('/host-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file' });
    const COS = require('cos-nodejs-sdk-v5');
    const bucket = process.env.R2_BUCKET || '';
    const region = process.env.COS_REGION || 'ap-hongkong';
    if (!bucket || !process.env.R2_ACCESS_KEY_ID) {
      return res.status(500).json({ error: 'Storage not configured' });
    }
    const cosClient = new COS({
      SecretId: process.env.R2_ACCESS_KEY_ID,
      SecretKey: process.env.R2_SECRET_ACCESS_KEY
    });
    const key = 'ai-temp/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
    cosClient.putObject({
      Bucket: bucket,
      Region: region,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'image/png'
    }, (err) => {
      if (err) {
        console.error('[Host Image] COS upload error:', err.message);
        return res.status(500).json({ error: 'Upload failed' });
      }
      const url = `https://${bucket}.cos.${region}.myqcloud.com/${key}`;
      console.log('[Host Image] Uploaded:', url);
      res.json({ url });
    });
  } catch (e) {
    console.error('[Host Image] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});




// === WAN 万相 多视角：使用次数追踪（每帳號8次免費，每次1張） ===
const WAN_FREE_LIMIT = 8;
const WAN_USAGE_FILE = __dirname + '/data/wan_usage.json';
const fs = require('fs');

function loadWanUsage() {
  try {
    if (fs.existsSync(WAN_USAGE_FILE)) {
      return JSON.parse(fs.readFileSync(WAN_USAGE_FILE, 'utf8'));
    }
  } catch(e) { console.error('[WAN] Load usage error:', e.message); }
  return {};
}

function saveWanUsage(usage) {
  try {
    fs.writeFileSync(WAN_USAGE_FILE, JSON.stringify(usage, null, 2));
  } catch(e) { console.error('[WAN] Save usage error:', e.message); }
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getUserWanUsage(username) {
  const usage = loadWanUsage();
  const user = usage[username];
  if (!user || user.date !== getTodayKey()) return 0;
  return user.count || 0;
}

function incrementUserWanUsage(username) {
  const usage = loadWanUsage();
  const today = getTodayKey();
  if (!usage[username] || usage[username].date !== today) {
    usage[username] = { date: today, count: 1 };
  } else {
    usage[username].count += 1;
  }
  saveWanUsage(usage);
  return usage[username].count;
}

// === WAN 万相 多视角图片生成 (via 智增增 阿里千问接口) ===
const WAN_BASE_URL = 'https://api.zhizengzeng.com/alibaba/api/v1';

// Simple username auth middleware for WAN (uses main site auth)
function wanAuthMiddleware(req, res, next) {
  const username = req.headers['x-username'] || req.query.user;
  if (!username) {
    return res.status(401).json({ error: '请先登录' });
  }
  req.wanUser = username;
  next();
}


// 查询 WAN 使用次数
router.get('/wan/usage', wanAuthMiddleware, (req, res) => {
  const usedCount = getUserWanUsage(req.wanUser);
  res.json({ used: usedCount, limit: WAN_FREE_LIMIT, remaining: Math.max(0, WAN_FREE_LIMIT - usedCount) });
});

// Generate WAN multi-view images (synchronous - returns results directly)
router.post('/wan/generate', wanAuthMiddleware, async (req, res) => {
  try {
    const { prompt, image_url, model, n, size, enable_sequential, seed } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: '缺少提示词' });
    }

    // 检查免费次数（每帳號8次，每次1張）
    const username = req.wanUser;
    const usedCount = getUserWanUsage(username);
    if (usedCount >= WAN_FREE_LIMIT) {
      return res.status(403).json({ error: '免费次数已用完（共' + WAN_FREE_LIMIT + '次），如需继续使用请联系客服' });
    }

    const apiModel = model || 'wan2.7-image';
    const contentArr = [];

    // Add reference image if provided
    if (image_url) {
      contentArr.push({ image: image_url });
    }
    contentArr.push({ text: prompt });

    const body = {
      model: apiModel,
      input: {
        messages: [
          {
            role: 'user',
            content: contentArr
          }
        ]
      },
      parameters: {
        size: size || '1K',
        n: 1, // 固定1張
        watermark: false,
        enable_sequential: false
      }
    };

    if (seed) {
      body.parameters.seed = parseInt(seed);
    }

    console.log('[WAN] Generate, model:', apiModel, 'n:', body.parameters.n, 'user:', req.wanUser);

    const resp = await fetch(WAN_BASE_URL + '/services/aigc/multimodal-generation/generation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ZHIZENGZENG_API_KEY
      },
      body: JSON.stringify(body),
      timeout: 180000
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('[WAN] Generate error:', data);
      return res.status(resp.status).json({ error: data.message || data.error?.message || '生成失败' });
    }

    // Extract image URLs from response
    const images = [];
    const choices = data.output?.choices || [];
    choices.forEach(choice => {
      const content = choice.message?.content || [];
      content.forEach(item => {
        if (item.image) images.push(item.image);
      });
    });

    // 记录使用次数
    const newCount = incrementUserWanUsage(username);
    console.log('[WAN] Success, 1 image for user:', username, '(used', newCount + '/' + WAN_FREE_LIMIT + ')');
    res.json({ success: true, images, usage: data.usage, wanUsage: { used: newCount, limit: WAN_FREE_LIMIT, remaining: WAN_FREE_LIMIT - newCount } });
  } catch (err) {
    console.error('[WAN] Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


module.exports = { router, initTables };

