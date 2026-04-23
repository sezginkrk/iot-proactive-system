require('dotenv').config();

const cron                = require('node-cron');
const { analyzeAllTenants } = require('./analyzer');
const { deepAnalysis }    = require('./llm');
const db                  = require('./db');

console.log('🚀 IoT Analyzer başlatılıyor...');

// ── Her 5 dakikada bir: Kural motoru ──────────────────────────────────
cron.schedule('*/5 * * * *', async () => {
  try {
    await analyzeAllTenants();
  } catch (err) {
    console.error('❌ Analiz hatası:', err.message);
  }
});

// ── Her gün 08:00'de: LLM derin analiz ───────────────────────────────
cron.schedule('0 8 * * *', async () => {
  console.log('🤖 Günlük LLM analizi başlıyor...');

  try {
    const { rows: tenants } = await db.query(
      `SELECT user_id FROM tenants WHERE is_active = true`
    );

    for (const tenant of tenants) {
      const { rows: hourlyData } = await db.query(
        `SELECT * FROM sensor_hourly
         WHERE user_id = $1
           AND bucket > NOW() - INTERVAL '24 hours'
         ORDER BY bucket ASC`,
        [tenant.user_id]
      );

      const suggestion = await deepAnalysis(tenant.user_id, hourlyData);

      if (suggestion) {
        // LLM önerisini info alert olarak kaydet
        await db.query(
          `INSERT INTO alert_logs (user_id, alert_type, severity, message)
           VALUES ($1, 'daily_ai_report', 'info', $2)`,
          [tenant.user_id, suggestion]
        );
        console.log(`✅ LLM raporu kaydedildi: ${tenant.user_id}`);
      }
    }
  } catch (err) {
    console.error('❌ LLM analiz hatası:', err.message);
  }
});

// ── Başlangıçta bir kez çalıştır ─────────────────────────────────────
(async () => {
  try {
    await analyzeAllTenants();
  } catch (err) {
    console.error('❌ İlk analiz hatası:', err.message);
  }
})();

process.on('uncaughtException', (err) => {
  console.error('❌ Beklenmedik hata:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ İşlenmeyen promise reddi:', reason);
});
