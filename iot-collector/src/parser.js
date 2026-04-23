/**
 * MQTT payload'ını parse eder.
 * Mevcut iot-kontrol-paneli'ndeki topic yapısına göre düzenlenmiştir.
 * sensor_configs.data_path alanı kullanılarak JSON path'ten değer çekilir.
 */

function parsePayload(topic, payloadStr, sensorConfigs) {
  const result = {
    temperature: null,
    humidity: null,
    battery: null,
    clean_water: null,
    grey_water: null,
  };

  let parsed = null;

  // JSON parse dene
  try {
    parsed = JSON.parse(payloadStr);
  } catch {
    // JSON değil, düz sayı olabilir (örn: "23.5")
    const num = parseFloat(payloadStr);
    if (!isNaN(num)) {
      parsed = num;
    }
  }

  if (parsed === null) return result;

  // sensor_configs'den bu topic'e ait sensör tipini bul
  const matchedSensor = sensorConfigs?.find(
    (s) => s.topic_subscribe === topic
  );

  if (matchedSensor) {
    const value = extractValue(parsed, matchedSensor.data_path);
    if (value !== null) {
      switch (matchedSensor.sensor_type) {
        case 'temperature': result.temperature = value; break;
        case 'humidity':    result.humidity    = value; break;
        case 'battery':     result.battery     = value; break;
        case 'clean_water': result.clean_water = value; break;
        case 'grey_water':  result.grey_water  = value; break;
      }
      return result;
    }
    // data_path boş/yanlışsa veya JSON nesnesi geldiyse aşağıdaki topic tahminine düş
  }

  // sensor_configs eşleşmesi yoksa (veya değer çıkarılamadıysa) topic adından tahmin et
  const topicLower = topic.toLowerCase();
  const numVal = typeof parsed === 'number' ? parsed : null;

  if (topicLower.includes('temp') || topicLower.includes('sicaklik')) {
    result.temperature = numVal ?? parsed?.temperature ?? parsed?.temp ?? null;
  } else if (topicLower.includes('hum') || topicLower.includes('nem')) {
    result.humidity = numVal ?? parsed?.humidity ?? parsed?.nem ?? null;
  } else if (topicLower.includes('bat') || topicLower.includes('volt')) {
    result.battery = numVal ?? parsed?.battery ?? parsed?.voltage ?? null;
  } else if (topicLower.includes('clean') || topicLower.includes('temiz')) {
    result.clean_water = numVal ?? parsed?.clean_water ?? parsed?.temiz ?? null;
  } else if (topicLower.includes('grey') || topicLower.includes('kirli') || topicLower.includes('gray')) {
    result.grey_water = numVal ?? parsed?.grey_water ?? parsed?.kirli ?? null;
  }

  return result;
}

function extractValue(data, dataPath) {
  if (!dataPath) {
    return typeof data === 'number' ? data : null;
  }
  // "data.temperature" gibi path'leri destekle
  const keys = dataPath.split('.');
  let current = data;
  for (const key of keys) {
    if (current === null || current === undefined) return null;
    current = current[key];
  }
  return typeof current === 'number' ? current : parseFloat(current) || null;
}

module.exports = { parsePayload };
