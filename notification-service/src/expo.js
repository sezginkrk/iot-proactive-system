const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * Expo Push Token ile bildirim gönderir.
 * @param {string} expoPushToken - ExponentPushToken[xxx] formatında
 * @param {object} alert - { alertId, alertType, severity, message }
 * @returns {Promise<boolean>}
 */
async function sendExpoNotification(expoPushToken, alert) {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    console.warn(`⚠️  Geçersiz Expo token: ${expoPushToken}`);
    return false;
  }

  const isCritical = alert.severity === 'critical';

  const message = {
    to:    expoPushToken,
    sound: isCritical ? 'default' : 'default',
    title: getTitleBySeverity(alert.severity),
    body:  alert.message,
    data:  {
      alertId:   alert.alertId,
      alertType: alert.alertType,
      severity:  alert.severity,
    },
    priority:           isCritical ? 'high' : 'normal',
    channelId:          isCritical ? 'critical-alerts' : 'default',
    _displayInForeground: true,
  };

  try {
    const chunks   = expo.chunkPushNotifications([message]);
    const receipts = await expo.sendPushNotificationsAsync(chunks[0]);

    const receipt = receipts[0];
    if (receipt.status === 'ok') {
      console.log(`✅ Expo bildirim gönderildi (${alert.severity}): ${expoPushToken.slice(0, 30)}...`);
      return true;
    } else {
      console.error(`❌ Expo bildirim hatası: ${receipt.message}`);
      return false;
    }
  } catch (err) {
    console.error('❌ Expo push gönderilemedi:', err.message);
    return false;
  }
}

function getTitleBySeverity(severity) {
  switch (severity) {
    case 'critical': return '🚨 Kritik Uyarı';
    case 'warning':  return '⚠️ Uyarı';
    case 'info':     return 'ℹ️ Bilgi';
    default:         return '📢 Bildirim';
  }
}

module.exports = { sendExpoNotification };
