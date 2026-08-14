/**
 * Bildirim Filtresi
 * Gelen alert'in gönderilip gönderilmeyeceğine karar verir.
 *
 * Kural (critical ve warning tamamen simetrik):
 *   critical  → notify_critical + quiet_hours kontrolü
 *   warning   → notify_warning + quiet_hours kontrolü
 * Sessiz saat ikisi için de geçerli — kullanıcı isterse kritik uyarıları da
 * susturabilir, bu bilinçli bir tercih.
 */

function shouldSend(severity, filters, alertType) {
  // Günlük LLM özeti yalnızca uygulama içinde; push edilmez
  if (alertType === 'daily_ai_report') {
    return { send: false, reason: 'daily_report_in_app_only' };
  }

  // Severity bazlı filtre
  if (severity === 'critical' && !filters.notifyCritical) {
    return { send: false, reason: 'notify_critical_disabled' };
  }
  if (severity === 'warning' && !filters.notifyWarning) {
    return { send: false, reason: 'notify_warning_disabled' };
  }

  // Sessiz saat kontrolü (critical dahil)
  if (filters.quietHoursStart && filters.quietHoursEnd) {
    if (isQuietHour(filters.quietHoursStart, filters.quietHoursEnd)) {
      return { send: false, reason: 'quiet_hours' };
    }
  }

  return { send: true, reason: null };
}

// Sunucu UTC'de çalışıyor; kullanıcı saatleri Türkiye saatiyle (UTC+3, DST yok) giriyor.
const TR_OFFSET_MINUTES = 180;

function isQuietHour(startStr, endStr) {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const currentMinutes = (utcMinutes + TR_OFFSET_MINUTES) % 1440;

  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM]     = endStr.split(':').map(Number);

  const startMinutes = (startH * 60 + startM) % 1440;
  const endMinutes   = (endH   * 60 + endM) % 1440;

  // Gece yarısını geçen aralık (örn: 23:00 - 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // Normal aralık (örn: 14:00 - 16:00)
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

module.exports = { shouldSend };
