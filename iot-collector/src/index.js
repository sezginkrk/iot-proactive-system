require('dotenv').config();

const { fetchAllActiveTenants, supabase } = require('./supabase');
const TenantMQTTManager = require('./tenant-manager');

const manager = new TenantMQTTManager();

async function start() {
  console.log('🚀 IoT Collector başlatılıyor...');

  // Tüm aktif tenant'ları yükle ve bağlan
  const tenants = await fetchAllActiveTenants();
  console.log(`📋 ${tenants.length} aktif tenant bulundu`);

  for (const tenant of tenants) {
    await manager.connectTenant(tenant);
  }

  console.log(`✅ ${manager.getConnectedCount()} tenant bağlandı`);

  // Supabase Realtime: yeni tenant eklenince otomatik bağlan
  supabase
    .channel('mqtt_configs_changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mqtt_configs' },
      async (payload) => {
        console.log('🆕 Yeni tenant eklendi:', payload.new.user_id);
        const tenants = await fetchAllActiveTenants();
        const newTenant = tenants.find((t) => t.user_id === payload.new.user_id);
        if (newTenant) {
          await manager.connectTenant(newTenant);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'users' },
      async (payload) => {
        // Kullanıcı pasif yapıldıysa bağlantıyı kes
        if (payload.new.is_active === false) {
          console.log('🚫 Tenant pasif yapıldı:', payload.new.id);
          manager.disconnectTenant(payload.new.id);
        }
      }
    )
    .subscribe();

  // Durum logu: her 5 dakikada bir bağlı tenant sayısını yaz
  setInterval(() => {
    console.log(`📊 Bağlı tenant sayısı: ${manager.getConnectedCount()}`);
  }, 5 * 60 * 1000);

  console.log('👂 Supabase Realtime dinleniyor...');
}

// Beklenmedik hatalarda çökmesini önle
process.on('uncaughtException', (err) => {
  console.error('❌ Beklenmedik hata:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ İşlenmeyen promise reddi:', reason);
});

start();
