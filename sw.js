// Service Worker — TRANSCOL Notificações
const CACHE = 'transcol-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Receber mensagem do app para agendar alarme
self.addEventListener('message', async e => {
  if (e.data?.type === 'AGENDAR_ALARME') {
    const { pontoId, linhaId, horarioAlvo, label } = e.data;
    await agendarVerificacao(pontoId, linhaId, horarioAlvo, label);
  }
});

// Verificar estimativas e notificar
async function verificarENotificar(pontoId, linhaId, label) {
  try {
    const res = await fetch('/api/estimativas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pontoDeOrigemId: pontoId, linhaId })
    });
    const data = await res.json();
    const agora = data.horarioDoServidor || Date.now();

    const prox = (data.estimativas || [])
      .filter(e => e.horarioNaOrigem > agora)
      .sort((a, b) => a.horarioNaOrigem - b.horarioNaOrigem)[0];

    if (!prox) return;

    const diffMin = Math.round((prox.horarioNaOrigem - agora) / 60000);

    if (diffMin <= 12) {
      const extras = [];
      if (prox.arCondicionado) extras.push('❄️');
      if (prox.wifi) extras.push('📶');
      if (prox.accessibility) extras.push('♿');

      self.registration.showNotification('🚌 TRANSCOL — Linha 523', {
        body: `${label}: próximo ônibus em ${diffMin} min\nVeículo ${prox.veiculo} ${extras.join(' ')}`,
        icon: '/icon-192.png',
        badge: '/icon-96.png',
        tag: 'transcol-alerta',
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200],
        data: { url: self.location.origin }
      });
    }
  } catch(e) {
    console.error('SW verificação falhou:', e.message);
  }
}

// Agendar via setTimeout dentro do SW
async function agendarVerificacao(pontoId, linhaId, horarioAlvo, label) {
  const agora = new Date();
  const [h, m] = horarioAlvo.split(':').map(Number);
  const alvo = new Date(agora);
  alvo.setHours(h, m, 0, 0);

  // Se já passou hoje, agendar para amanhã
  if (alvo <= agora) alvo.setDate(alvo.getDate() + 1);

  const delay = alvo.getTime() - agora.getTime();
  console.log(`[SW] Alarme "${label}" agendado para ${alvo.toLocaleTimeString('pt-BR')} (${Math.round(delay/60000)}min)`);

  setTimeout(async () => {
    // Verificar se é feriado antes de notificar
    const ehFeriado = await verificarFeriado();
    if (!ehFeriado) {
      await verificarENotificar(pontoId, linhaId, label);
    } else {
      console.log('[SW] Hoje é feriado — notificação suprimida');
    }
    // Re-agendar para o próximo dia útil
    agendarVerificacao(pontoId, linhaId, horarioAlvo, label);
  }, delay);
}

async function verificarFeriado() {
  try {
    const hoje = new Date();
    const dow = hoje.getDay();

    // Sábado (6) ou Domingo (0) → não é dia útil
    if (dow === 0 || dow === 6) return true;

    const ano = hoje.getFullYear();
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    const feriados = await res.json();

    const dataHoje = hoje.toISOString().split('T')[0]; // YYYY-MM-DD
    return feriados.some(f => f.date === dataHoje);
  } catch(e) {
    console.warn('[SW] Erro ao verificar feriado:', e.message);
    return false; // em caso de erro, notifica normalmente
  }
}

// Click na notificação → abre o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow(e.notification.data?.url || '/');
    })
  );
});
