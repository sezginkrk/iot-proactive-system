const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function fetchAllActiveTenants() {
  // 1. Aktif kullanıcıları çek
  const { data: activeUsers, error: usersError } = await supabase
    .from('users')
    .select('id, username')
    .eq('is_active', true);

  if (usersError) {
    console.error('❌ Supabase kullanıcı listesi alınamadı:', usersError.message);
    return [];
  }

  if (!activeUsers || activeUsers.length === 0) return [];

  const userIds = activeUsers.map(u => u.id);

  // 2. MQTT config'leri çek
  const { data: mqttConfigs, error: mqttError } = await supabase
    .from('mqtt_configs')
    .select('user_id, host, port, use_ssl, mqtt_client_id, mqtt_username, mqtt_password, keep_alive')
    .in('user_id', userIds);

  if (mqttError) {
    console.error('❌ MQTT config alınamadı:', mqttError.message);
    return [];
  }

  // 3. Sensor config'leri çek
  const { data: sensorConfigs, error: sensorError } = await supabase
    .from('sensor_configs')
    .select('user_id, sensor_type, topic_subscribe, data_path')
    .in('user_id', userIds);

  if (sensorError) {
    console.error('❌ Sensor config alınamadı:', sensorError.message);
    return [];
  }

  // 4. Birleştir
  const usersMap = new Map(activeUsers.map(u => [u.id, u]));
  const sensorsMap = new Map();
  for (const s of (sensorConfigs || [])) {
    if (!sensorsMap.has(s.user_id)) sensorsMap.set(s.user_id, []);
    sensorsMap.get(s.user_id).push(s);
  }

  return (mqttConfigs || []).map(mqtt => ({
    ...mqtt,
    users: usersMap.get(mqtt.user_id),
    sensor_configs: sensorsMap.get(mqtt.user_id) || [],
  }));
}

module.exports = { supabase, fetchAllActiveTenants };
