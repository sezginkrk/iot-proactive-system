/**
 * Bildirim Filtresi
 * Gelen alert'in gönderilip gönderilmeyeceğine karar verir.
 *
 * Kural:
 *   critical  → her zaman gönderilir (sessiz saat, toggle görmezden gelinir)
 *   warning   → notifications_enabled + notify_warning + quiet_hours kontrolü
 *   info      → notifications_enabled + notify_info + quiet_hours kontrolü
 */

function shouldSend(severity, filters, alertType) {
  // Günlük LLM özeti yalnızca uygulama içinde; push edilmez
  if (alertType === 'daily_ai_report') {
    return { send: false, reason: 'daily_report_in_app_only' };
  }

  // Critical her zaman gönderilir
  if (severity === 'critical') return { send: true, reason: null };

  // Ana toggle kapalıysa
  if (!filters.notificationsEnabled) {
    return { send: false, reason: 'notifications_disabled' };
  }

  // Severity bazlı filtre
  if (severity === 'warning' && !filters.notifyWarning) {
    return { send: false, reason: 'notify_warning_disabled' };
  }
  if (severity === 'info' && !filters.notifyInfo) {
    return { send: false, reason: 'notify_info_disabled' };
  }

  // Sessiz saat kontrolü
  if (filters.quietHoursStart && filters.quietHoursEnd) {
    if (isQuietHour(filters.quietHoursStart, filters.quietHoursEnd)) {
      return { send: false, reason: 'quiet_hours' };
    }
  }

  return { send: true, reason: null };
}

function isQuietHour(startStr, endStr) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM]     = endStr.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes   = endH   * 60 + endM;

  // Gece yarısını geçen aralık (örn: 23:00 - 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // Normal aralık (örn: 14:00 - 16:00)
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

module.exports = { shouldSend };
