/**
 * Kural Motoru — Her tenant için anlık sensör verilerini kontrol eder.
 * Eşikler notification_settings tablosundan gelir (kişiselleştirilebilir).
 */

const RULES = [
  // ── BATARYA ──────────────────────────────────────────────────────────
  {
    id: 'low_battery_critical',
    severity: 'critical',
    check: (data, s) =>
      data.battery !== null && data.battery <= s.low_battery_critical,
    message: (data) =>
      `🔴 Batarya kritik seviyede: ${data.battery}V. Hemen şarj edin, cihaz kapanabilir!`,
  },
  {
    id: 'low_battery_warning',
    severity: 'warning',
    check: (data, s) =>
      data.battery !== null &&
      data.battery > s.low_battery_critical &&
      data.battery <= s.low_battery_warning,
    message: (data) =>
      `⚠️ Batarya düşük: ${data.battery}V. Şarj etmeyi planlayın.`,
  },

  // ── SICAKLIK ─────────────────────────────────────────────────────────
  {
    id: 'high_temp_critical',
    severity: 'critical',
    check: (data, s) =>
      data.temperature !== null && data.temperature >= s.high_temp_critical,
    message: (data) =>
      `🔴 Kabin sıcaklığı tehlikeli: ${data.temperature}°C. Havalandırmayı kontrol edin!`,
  },
  {
    id: 'high_temp_warning',
    severity: 'warning',
    check: (data, s) =>
      data.temperature !== null &&
      data.temperature < s.high_temp_critical &&
      data.temperature >= s.high_temp_warning,
    message: (data) =>
      `⚠️ Kabin sıcaklığı yüksek: ${data.temperature}°C.`,
  },

  // ── KİRLİ SU ─────────────────────────────────────────────────────────
  {
    id: 'high_grey_water_critical',
    severity: 'critical',
    check: (data, s) =>
      data.grey_water !== null && data.grey_water >= s.high_grey_water_critical,
    message: (data) =>
      `🔴 Kirli su tankı %${data.grey_water} dolu, taşıyor! Hemen boşaltın.`,
  },
  {
    id: 'high_grey_water_warning',
    severity: 'warning',
    check: (data, s) =>
      data.grey_water !== null &&
      data.grey_water < s.high_grey_water_critical &&
      data.grey_water >= s.high_grey_water_warning,
    message: (data) =>
      `⚠️ Kirli su tankı %${data.grey_water} dolu. Boşaltmayı planlayın.`,
  },

  // ── TEMİZ SU ─────────────────────────────────────────────────────────
  {
    id: 'low_clean_water_critical',
    severity: 'critical',
    check: (data, s) =>
      data.clean_water !== null && data.clean_water <= s.low_clean_water_critical,
    message: (data) =>
      `🔴 Temiz su tankı %${data.clean_water} kaldı. Hemen doldurun!`,
  },
  {
    id: 'low_clean_water_warning',
    severity: 'warning',
    check: (data, s) =>
      data.clean_water !== null &&
      data.clean_water > s.low_clean_water_critical &&
      data.clean_water <= s.low_clean_water_warning,
    message: (data) =>
      `⚠️ Temiz su tankı %${data.clean_water} kaldı. Doldurmayı planlayın.`,
  },

  // ── CİHAZ ÇEVRIMDIŞI ─────────────────────────────────────────────────
  {
    id: 'device_offline',
    severity: 'warning',
    check: (data) => data._minutesSinceLastData !== null && data._minutesSinceLastData > 10,
    message: (data) =>
      `⚠️ Cihazdan ${Math.round(data._minutesSinceLastData)} dakikadır veri gelmiyor. Bağlantıyı kontrol edin.`,
  },
];

/**
 * Tek bir tenant için tüm kuralları çalıştırır.
 * @param {object} data - Sensör verisi + _minutesSinceLastData
 * @param {object} settings - notification_settings satırı
 * @returns {Array} Tetiklenen alert listesi
 */
function runRules(data, settings) {
  const triggered = [];

  for (const rule of RULES) {
    try {
      if (rule.check(data, settings)) {
        triggered.push({
          type:     rule.id,
          severity: rule.severity,
          message:  rule.message(data),
        });
      }
    } catch (err) {
      console.error(`❌ Kural hatası (${rule.id}):`, err.message);
    }
  }

  return triggered;
}

module.exports = { runRules };
