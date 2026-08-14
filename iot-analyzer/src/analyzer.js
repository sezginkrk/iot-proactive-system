const db      = require('./db');
const { runRules } = require('./rules');
const fetch   = require('node-fetch');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3001';

/**
 * Tüm aktif tenant'ları analiz eder.
 * Her 5 dakikada bir cron ile çağrılır.
 */
async function analyzeAllTenants() {
  console.log('🔍 Analiz başladı...');

  // Her tenant için her sensör alanının en son DOLU (NULL olmayan) değerini ayrı ayrı al.
  // Her MQTT mesajı sensor_logs'a ayrı bir satır olarak yazılıyor (diğer alanlar o satırda NULL) —
  // tek bir "en son satırı" almak, o an hangi topic'ten mesaj geldiyse sadece onu görürdü.
  const { rows: latestReadings } = await db.query(`
    SELECT
      t.user_id,
      latest.time,
      temp.temperature,
      hum.humidity,
      bat.battery,
      cw.clean_water,
      gw.grey_water,
      EXTRACT(EPOCH FROM (NOW() - latest.time)) / 60 AS minutes_since
    FROM tenants t
    JOIN LATERAL (
      SELECT time FROM sensor_logs sl
      WHERE sl.user_id = t.user_id AND sl.time > NOW() - INTERVAL '30 minutes'
      ORDER BY sl.time DESC LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT temperature FROM sensor_logs sl
      WHERE sl.user_id = t.user_id AND sl.temperature IS NOT NULL AND sl.time > NOW() - INTERVAL '30 minutes'
      ORDER BY sl.time DESC LIMIT 1
    ) temp ON true
    LEFT JOIN LATERAL (
      SELECT humidity FROM sensor_logs sl
      WHERE sl.user_id = t.user_id AND sl.humidity IS NOT NULL AND sl.time > NOW() - INTERVAL '30 minutes'
      ORDER BY sl.time DESC LIMIT 1
    ) hum ON true
    LEFT JOIN LATERAL (
      SELECT battery FROM sensor_logs sl
      WHERE sl.user_id = t.user_id AND sl.battery IS NOT NULL AND sl.time > NOW() - INTERVAL '30 minutes'
      ORDER BY sl.time DESC LIMIT 1
    ) bat ON true
    LEFT JOIN LATERAL (
      SELECT clean_water FROM sensor_logs sl
      WHERE sl.user_id = t.user_id AND sl.clean_water IS NOT NULL AND sl.time > NOW() - INTERVAL '30 minutes'
      ORDER BY sl.time DESC LIMIT 1
    ) cw ON true
    LEFT JOIN LATERAL (
      SELECT grey_water FROM sensor_logs sl
      WHERE sl.user_id = t.user_id AND sl.grey_water IS NOT NULL AND sl.time > NOW() - INTERVAL '30 minutes'
      ORDER BY sl.time DESC LIMIT 1
    ) gw ON true
    WHERE t.is_active = true
  `);

  // Tüm aktif tenant'ların bildirim ayarlarını çek
  // (gönderilip gönderilmeyeceği notify_critical/notify_warning + sessiz saatle
  // notification-service'teki filter.js'de belirleniyor, burada önceden eleme yapmıyoruz)
  const { rows: allSettings } = await db.query(`
    SELECT ns.*, t.username
    FROM notification_settings ns
    JOIN tenants t ON t.user_id = ns.user_id
    WHERE t.is_active = true
  `);

  const settingsMap = new Map(allSettings.map((s) => [s.user_id, s]));

  // Son 30 dakikada hiç veri gelmemiş ama aktif tenant'ları da kontrol et
  const activeUserIds = new Set(allSettings.map((s) => s.user_id));
  const readingUserIds = new Set(latestReadings.map((r) => r.user_id));

  // Offline tenant'lar için sahte veri oluştur
  for (const userId of activeUserIds) {
    if (!readingUserIds.has(userId)) {
      latestReadings.push({
        user_id: userId,
        time: null,
        temperature: null,
        humidity: null,
        battery: null,
        clean_water: null,
        grey_water: null,
        minutes_since: 999,
      });
    }
  }

  let alertCount = 0;

  for (const reading of latestReadings) {
    const settings = settingsMap.get(reading.user_id);
    if (!settings) continue;

    const data = {
      ...reading,
      _minutesSinceLastData: parseFloat(reading.minutes_since) || null,
    };

    const alerts = runRules(data, settings);

    for (const alert of alerts) {
      const sent = await processAlert(reading.user_id, alert, data, settings);
      if (sent) alertCount++;
    }
  }

  console.log(`✅ Analiz tamamlandı. ${latestReadings.length} tenant, ${alertCount} alert gönderildi.`);
}

/**
 * Tek bir alert'i işler: cooldown kontrolü → kaydet → bildirim gönder
 */
async function processAlert(userId, alert, sensorData, settings) {
  // Cooldown kontrolü
  const canSend = await checkCooldown(userId, alert.type, settings.alert_cooldown_minutes);
  if (!canSend) return false;

  // alert_logs'a kaydet
  const { rows } = await db.query(
    `INSERT INTO alert_logs
       (user_id, alert_type, severity, message, sensor_data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      userId,
      alert.type,
      alert.severity,
      alert.message,
      JSON.stringify({
        temperature: sensorData.temperature,
        humidity:    sensorData.humidity,
        battery:     sensorData.battery,
        clean_water: sensorData.clean_water,
        grey_water:  sensorData.grey_water,
        recorded_at: sensorData.time,
      }),
    ]
  );

  const alertId = rows[0].id;

  // Bildirim filtresi kontrolü notification-service'e bırakılıyor
  // (notify_critical, notify_warning, quiet_hours kontrolleri orada)
  const notificationPayload = {
    alertId,
    userId,
    alertType:     alert.type,
    severity:      alert.severity,
    message:       alert.message,
    expoPushToken: settings.expo_push_token,
    platform:      settings.platform,
    filters: {
      notifyCritical:  settings.notify_critical,
      notifyWarning:   settings.notify_warning,
      quietHoursStart: settings.quiet_hours_start,
      quietHoursEnd:   settings.quiet_hours_end,
    },
  };

  try {
    const res = await fetch(`${NOTIFICATION_SERVICE_URL}/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(notificationPayload),
      timeout: 10000,
    });

    if (res.ok) {
      // Cooldown güncelle
      await updateCooldown(userId, alert.type);

      // alert_logs'u güncelle
      await db.query(
        `UPDATE alert_logs SET is_sent = true, sent_at = NOW() WHERE id = $1`,
        [alertId]
      );
      return true;
    }
  } catch (err) {
    console.error(`❌ Bildirim gönderilemedi (${userId}):`, err.message);
  }

  return false;
}

async function checkCooldown(userId, alertType, cooldownMinutes) {
  const { rows } = await db.query(
    `SELECT last_sent FROM alert_cooldowns
     WHERE user_id = $1 AND alert_type = $2`,
    [userId, alertType]
  );

  if (rows.length === 0) return true;

  const minutesSince = (Date.now() - new Date(rows[0].last_sent)) / 60000;
  return minutesSince >= cooldownMinutes;
}

async function updateCooldown(userId, alertType) {
  await db.query(
    `INSERT INTO alert_cooldowns (user_id, alert_type, last_sent)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, alert_type)
     DO UPDATE SET last_sent = NOW()`,
    [userId, alertType]
  );
}

module.exports = { analyzeAllTenants };
