require('dotenv').config();

const express  = require('express');
const { Pool } = require('pg');
const { sendExpoNotification } = require('./expo');
const { shouldSend }           = require('./filter');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// TimescaleDB bağlantısı
const db = new Pool({
  connectionString: process.env.TIMESCALE_URL,
  ssl: process.env.TIMESCALE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

console.log('🚀 Notification Service başlatılıyor...');

/**
 * POST /register-token
 * React Native uygulamasından Expo Push Token kaydeder.
 */
app.post('/register-token', async (req, res) => {
  const { userId, token, platform } = req.body;

  if (!userId || !token || !platform) {
    return res.status(400).json({ error: 'userId, token ve platform zorunlu' });
  }

  try {
    await db.query(
      `INSERT INTO notification_settings (user_id, expo_push_token, platform, token_updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET expo_push_token = $2, platform = $3, token_updated_at = NOW()`,
      [userId, token, platform]
    );

    console.log(`✅ Token kaydedildi: ${userId} (${platform})`);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Token kayıt hatası:', err.message);
    return res.status(500).json({ error: 'Token kaydedilemedi' });
  }
});

/**
 * POST /update-settings
 * React Native uygulamasından bildirim ayarlarını günceller.
 */
app.post('/update-settings', async (req, res) => {
  const { userId, settings } = req.body;

  if (!userId || !settings) {
    return res.status(400).json({ error: 'userId ve settings zorunlu' });
  }

  try {
    await db.query(
      `UPDATE notification_settings SET
        notifications_enabled      = $2,
        notify_warning             = $3,
        notify_info                = $4,
        quiet_hours_start          = $5,
        quiet_hours_end            = $6,
        alert_cooldown_minutes     = $7,
        low_battery_critical       = $8,
        low_battery_warning        = $9,
        high_temp_warning          = $10,
        high_temp_critical         = $11,
        low_clean_water_warning    = $12,
        low_clean_water_critical   = $13,
        high_grey_water_warning    = $14,
        high_grey_water_critical   = $15,
        updated_at                 = NOW()
       WHERE user_id = $1`,
      [
        userId,
        settings.notificationsEnabled ?? true,
        settings.notifyWarning        ?? true,
        settings.notifyInfo           ?? false,
        settings.quietHoursEnabled ? settings.quietHoursStart : null,
        settings.quietHoursEnabled ? settings.quietHoursEnd   : null,
        settings.alertCooldownMinutes  ?? 30,
        settings.lowBatteryCritical    ?? 10.5,
        settings.lowBatteryWarning     ?? 11.5,
        settings.highTempWarning       ?? 40,
        settings.highTempCritical      ?? 50,
        settings.lowCleanWaterWarning  ?? 20,
        settings.lowCleanWaterCritical ?? 10,
        settings.highGreyWaterWarning  ?? 80,
        settings.highGreyWaterCritical ?? 90,
      ]
    );

    console.log(`✅ Ayarlar güncellendi: ${userId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Ayar güncelleme hatası:', err.message);
    return res.status(500).json({ error: 'Ayarlar güncellenemedi' });
  }
});

/**
 * POST /send
 * iot-analyzer'dan gelen alert'i alır, filtreler ve Expo üzerinden gönderir.
 */
app.post('/send', async (req, res) => {
  const {
    alertId,
    userId,
    alertType,
    severity,
    message,
    expoPushToken,
    filters,
  } = req.body;

  if (!severity || !message) {
    return res.status(400).json({ error: 'severity ve message zorunlu' });
  }

  const { send, reason } = shouldSend(severity, filters || {}, alertType);

  if (!send) {
    console.log(`⏭️  Bildirim atlandı (${userId}) — sebep: ${reason}`);
    return res.json({ sent: false, reason });
  }

  if (!expoPushToken) {
    console.warn(`⚠️  Token yok (${userId}), bildirim gönderilemedi`);
    return res.json({ sent: false, reason: 'no_token' });
  }

  const alert = { alertId, alertType, severity, message };
  const sent  = await sendExpoNotification(expoPushToken, alert);

  return res.json({ sent, alertId });
});

/**
 * GET /daily-reports?userId=&limit=
 * Günlük LLM özetleri (alert_logs.daily_ai_report). Uygulama içi okuma; cihazda saklanmaz.
 */
app.get('/daily-reports', async (req, res) => {
  const userId = req.query.userId;
  const rawLimit = parseInt(String(req.query.limit || '30'), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 90) : 30;

  if (!userId) {
    return res.status(400).json({ error: 'userId gerekli' });
  }

  try {
    const { rows } = await db.query(
      `SELECT id, message, created_at
       FROM alert_logs
       WHERE user_id = $1::uuid AND alert_type = 'daily_ai_report'
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return res.json({
      reports: rows.map((r) => ({
        id:         r.id,
        message:    r.message,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error('❌ daily-reports okuma hatası:', err.message);
    return res.status(500).json({ error: 'Raporlar okunamadı' });
  }
});

// Sağlık kontrolü
app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

app.listen(PORT, () => {
  console.log(`🚀 Notification Service çalışıyor: http://0.0.0.0:${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Beklenmedik hata:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ İşlenmeyen promise reddi:', reason);
});
