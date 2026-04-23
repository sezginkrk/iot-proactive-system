const mqtt = require('mqtt');
const db = require('./db');
const { parsePayload } = require('./parser');

class TenantMQTTManager {
  constructor() {
    // user_id → { client, config }
    this.clients = new Map();
  }

  async connectTenant(tenant) {
    const userId = tenant.user_id;

    if (this.clients.has(userId)) {
      console.log(`⚠️  Tenant zaten bağlı: ${tenant.users?.username || userId}`);
      return;
    }

    const protocol = tenant.use_ssl ? 'wss' : 'ws';
    const wsPort   = tenant.use_ssl ? 8084 : 8083;
    const brokerUrl = `${protocol}://${tenant.host}:${wsPort}/mqtt`;

    const clientId = `collector_${userId.replace(/-/g, '').slice(0, 12)}_${Date.now()}`;

    const client = mqtt.connect(brokerUrl, {
      clientId,
      username:      tenant.mqtt_username,
      password:      tenant.mqtt_password,
      keepalive:     tenant.keep_alive || 60,
      clean:         true,
      reconnectPeriod: 5000,
      connectTimeout:  15000,
      protocolId:      'MQTT',
      protocolVersion: 4,
    });

    client.on('connect', () => {
      console.log(`✅ Tenant bağlandı: ${tenant.users?.username || userId}`);

      // Bu tenant'ın tüm sensör topic'lerine abone ol
      const topics = (tenant.sensor_configs || []).map((s) => s.topic_subscribe);
      if (topics.length > 0) {
        client.subscribe(topics, { qos: 0 }, (err) => {
          if (err) {
            console.error(`❌ Subscribe hatası (${userId}):`, err.message);
          } else {
            console.log(`📥 Topic'lere abone olundu (${tenant.users?.username}):`, topics);
          }
        });
      }

      // TimescaleDB'de tenant kaydı yoksa oluştur
      this._ensureTenantRecord(userId, tenant.users?.username);
    });

    client.on('message', async (topic, message) => {
      const payloadStr = message.toString();
      const parsed = parsePayload(topic, payloadStr, tenant.sensor_configs);

      await this._saveReading(userId, topic, payloadStr, parsed);
    });

    client.on('offline', () => {
      console.log(`⚠️  Tenant offline (yeniden bağlanılıyor): ${tenant.users?.username || userId}`);
    });

    client.on('error', (err) => {
      console.error(`❌ MQTT hatası (${tenant.users?.username || userId}):`, err.message);
    });

    client.on('close', () => {
      console.log(`🔌 Bağlantı kapandı: ${tenant.users?.username || userId}`);
    });

    this.clients.set(userId, { client, config: tenant });
  }

  disconnectTenant(userId) {
    const entry = this.clients.get(userId);
    if (!entry) return;

    entry.client.end(true);
    this.clients.delete(userId);
    console.log(`🔌 Tenant bağlantısı kesildi: ${userId}`);
  }

  getConnectedCount() {
    return this.clients.size;
  }

  async _ensureTenantRecord(userId, username) {
    try {
      await db.query(
        `INSERT INTO tenants (user_id, username)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, username || userId]
      );
    } catch (err) {
      console.error(`❌ Tenant kaydı oluşturulamadı (${userId}):`, err.message);
    }
  }

  async _saveReading(userId, topic, rawPayload, parsed) {
    try {
      await db.query(
        `INSERT INTO sensor_logs
           (time, user_id, temperature, humidity, battery, clean_water, grey_water, raw_payload)
         VALUES
           (NOW(), $1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          parsed.temperature,
          parsed.humidity,
          parsed.battery,
          parsed.clean_water,
          parsed.grey_water,
          JSON.stringify({ topic, payload: rawPayload }),
        ]
      );
    } catch (err) {
      console.error(`❌ Veri kaydedilemedi (${userId}):`, err.message);
    }
  }
}

module.exports = TenantMQTTManager;
