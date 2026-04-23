const fetch = require('node-fetch');

const ANYTHINGLLM_URL   = process.env.ANYTHINGLLM_URL;
const WORKSPACE_SLUG    = process.env.ANYTHINGLLM_WORKSPACE || 'karavantekne';
const API_KEY           = process.env.ANYTHINGLLM_API_KEY;

/**
 * Son 24 saatin saatlik özetini AnythingLLM'e gönderir,
 * proaktif bakım/uyarı önerisi alır.
 * @param {string} userId
 * @param {Array}  hourlyData - sensor_hourly tablosundan gelen satırlar
 * @returns {Promise<string|null>}
 */
async function deepAnalysis(userId, hourlyData) {
  if (!ANYTHINGLLM_URL || !API_KEY) {
    console.warn('⚠️ AnythingLLM config eksik, LLM analizi atlandı');
    return null;
  }

  if (!hourlyData || hourlyData.length === 0) {
    return null;
  }

  const summary = buildSummary(hourlyData);

  const prompt =
    `Sen bir karavan ve tekne teknik uzmanısın. ` +
    `Aşağıdaki sensör verilerini analiz et ve kullanıcıya Türkçe, kısa ve net önerilerde bulun.\n\n` +
    `Son 24 saatin saatlik özeti:\n${summary}\n\n` +
    `Lütfen şunları değerlendir:\n` +
    `1. Olası teknik sorunlar veya anormallikler\n` +
    `2. Yakın vadede yapılması gereken bakım işlemleri\n` +
    `3. Enerji veya su tüketiminde dikkat çeken bir durum var mı?\n\n` +
    `Yanıtını 3-4 cümleyi geçmeyecek şekilde ver.`;

  try {
    const response = await fetch(
      `${ANYTHINGLLM_URL}/api/v1/workspace/${WORKSPACE_SLUG}/chat`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          message:   prompt,
          mode:      'chat',
          sessionId: `proactive_daily_${userId}`,
        }),
        timeout: 30000,
      }
    );

    if (!response.ok) {
      console.error(`❌ LLM API hatası: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.textResponse || null;
  } catch (err) {
    console.error('❌ LLM bağlantı hatası:', err.message);
    return null;
  }
}

function buildSummary(hourlyData) {
  return hourlyData
    .map((row) => {
      const time = new Date(row.bucket).toLocaleTimeString('tr-TR', {
        hour: '2-digit', minute: '2-digit',
      });
      return (
        `[${time}] ` +
        `Sıcaklık: ${row.avg_temp ?? '-'}°C (max:${row.max_temp ?? '-'}) | ` +
        `Nem: ${row.avg_humidity ?? '-'}% | ` +
        `Batarya: ${row.avg_battery ?? '-'}V (min:${row.min_battery ?? '-'}) | ` +
        `Temiz su: ${row.avg_clean_water ?? '-'}% | ` +
        `Kirli su: ${row.max_grey_water ?? '-'}% | ` +
        `Okuma sayısı: ${row.reading_count}`
      );
    })
    .join('\n');
}

module.exports = { deepAnalysis };
