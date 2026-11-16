
const $ = id => document.getElementById(id);
const fmtPct = x => (x * 100).toFixed(1) + '%';
const todayTashkent = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());

function factorial(n) {
  let x = 1;
  for (let i = 2; i <= n; i++) x *= i;
  return x;
}

function poisson(k, lambda) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function dixonColes(lh, la, rho = -0.08) {
  let home = 0, draw = 0, away = 0;
  for (let x = 0; x <= 10; x++) {
    for (let y = 0; y <= 10; y++) {
      let tau = 1;
      if (x === 0 && y === 0) tau = 1 - lh * la * rho;
      else if (x === 0 && y === 1) tau = 1 + lh * rho;
      else if (x === 1 && y === 0) tau = 1 + la * rho;
      else if (x === 1 && y === 1) tau = 1 - rho;

      const probability = poisson(x, lh) * poisson(y, la) * Math.max(0, tau);
      if (x > y) home += probability;
      else if (x === y) draw += probability;
      else away += probability;
    }
  }
  const total = home + draw + away;
  return [home / total, draw / total, away / total];
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  }[c]));
}

let allMatches = [];
let currentTab = 'upcoming';

const finishedStatuses = ['FT', 'AET', 'PEN', 'AWD', 'WO'];
const liveStatuses = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'];

function getMatchTab(m) {
  const status = String(m.statusShort || '').toUpperCase();
  if (finishedStatuses.includes(status)) return 'finished';
  if (status === 'NS' || liveStatuses.includes(status)) return 'upcoming';
  return 'other';
}

function matchTime(m) {
  return m.date ? new Date(m.date).getTime() : 0;
}

function renderTabs() {
  let tabs = $('matchTabs');

  if (!tabs) {
    tabs = document.createElement('div');
    tabs.id = 'matchTabs';
    tabs.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:14px 0;';

    const list = $('matchList');
    list.parentNode.insertBefore(tabs, list);
  }

  const upcoming = allMatches.filter(m => getMatchTab(m) === 'upcoming').length;
  const finished = allMatches.filter(m => getMatchTab(m) === 'finished').length;
  const all = allMatches.length;

  const items = [
    ['upcoming', `Предстоящие (${upcoming})`],
    ['finished', `Завершённые (${finished})`],
    ['all', `Все (${all})`]
  ];

  tabs.innerHTML = items.map(([id, label]) => `
    <button type="button" data-tab="${id}"
      style="padding:9px 13px;border-radius:8px;border:1px solid var(--border,#555);cursor:pointer;
      background:${currentTab === id ? 'var(--accent,#2878d0)' : 'transparent'};
      color:${currentTab === id ? '#fff' : 'inherit'};">
      ${label}
    </button>
  `).join('');

  tabs.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      currentTab = button.dataset.tab;
      renderTabs();
      renderMatchList();
    });
  });
}

function renderMatchList() {
  const list = $('matchList');
  list.replaceChildren();

  let matches = allMatches;

  if (currentTab === 'upcoming') {
    matches = allMatches.filter(m => getMatchTab(m) === 'upcoming');
  } else if (currentTab === 'finished') {
    matches = allMatches.filter(m => getMatchTab(m) === 'finished');
  }

  matches = [...matches].sort((a, b) => matchTime(a) - matchTime(b));

  let withOdds = 0;

  for (const m of matches) {
    if (m.odds && [m.odds.home, m.odds.draw, m.odds.away].some(v => v != null)) {
      withOdds++;
    }

    const date = m.date
      ? new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Asia/Tashkent',
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(m.date))
      : 'Время неизвестно';

    const status = m.statusShort === 'NS'
      ? 'Не начался'
      : (m.status || m.statusShort || 'Статус неизвестен');

    const odds = m.odds;

    const oddsHtml = odds && [odds.home, odds.draw, odds.away].some(v => v != null)
      ? [['П1', odds.home], ['X', odds.draw], ['П2', odds.away]]
          .map(([label, value]) =>
            `<div class="odd"><small>${label}</small><b>${value == null ? '—' : Number(value).toFixed(2)}</b></div>`
          ).join('')
      : '<div class="noOdds">Коэффициенты на этот матч не найдены в ответе API.</div>';

    const card = document.createElement('article');
    card.className = 'match';

    card.innerHTML = `
      <div class="matchTop">
        <span>${escapeHtml([m.country, m.league].filter(Boolean).join(' · '))}</span>
        <span>${escapeHtml(date)}</span>
      </div>
      <div class="teams">
        <span>${escapeHtml(m.home)}</span>
        <span class="vs">VS</span>
        <span>${escapeHtml(m.away)}</span>
      </div>
      <div class="matchTop statusLine">
        <span>${escapeHtml(status)}</span>
        <span>${m.homeGoals == null ? '' : `${m.homeGoals} : ${m.awayGoals}`}</span>
      </div>
      <div class="odds">${oddsHtml}</div>
      <div class="edge">ID матча: ${escapeHtml(m.id)} · Вероятности модели ещё не рассчитаны</div>
    `;

    list.appendChild(card);
  }

  $('matchCount').textContent = matches.length;
  $('oddsCount').textContent = withOdds;
  $('modeBadge').textContent = 'API';

  $('dataNotice').textContent =
    'Матчи получены из API-Football. Коэффициенты могут отсутствовать для отдельных лиг и игр. Вероятности модели пока не рассчитываются автоматически.';

  if (!matches.length) {
    const message = document.createElement('p');
    message.className = 'muted';
    message.textContent = currentTab === 'upcoming'
      ? 'Предстоящих матчей на выбранную дату не найдено.'
      : currentTab === 'finished'
        ? 'Завершённых матчей на выбранную дату не найдено.'
        : 'На выбранную дату API не вернул матчей.';
    list.appendChild(message);
  }
}

async function loadMatches() {
  const date = $('matchDate').value || todayTashkent();

  $('loadStatus').textContent = 'Загружаем матчи и коэффициенты…';
  $('loadMatches').disabled = true;

  try {
    const response = await fetch(
      `/.netlify/functions/fixtures?date=${encodeURIComponent(date)}`,
      { cache: 'no-store' }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Ошибка сервера: ${response.status}`);
    }

    allMatches = data.matches || [];
    currentTab = 'upcoming';

    renderTabs();
    renderMatchList();

    $('loadStatus').textContent =
      `Дата: ${date}. Получено матчей: ${data.count}. ${data.oddsNote || ''}`;

  } catch (error) {
    $('loadStatus').textContent = error.message;
    $('dataNotice').textContent =
      'Не удалось загрузить реальные данные. Проверьте настройки API и Netlify.';
    $('matchList').innerHTML =
      '<p class="muted">Реальные матчи пока недоступны. Попробуйте ещё раз.</p>';
  } finally {
    $('loadMatches').disabled = false;
  }
}

function calcValue() {
  const p = Number($('prob').value) / 100;
  const o = Number($('odds').value);
  const b = Number($('bankroll').value);
  const s = Number($('stakePct').value);

  if (!(p > 0 && p < 1 && o > 1 && b > 0 && s > 0)) return;

  const value = p * o - 1;

  $('value').textContent =
    `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;

  $('stake').textContent = '$' + (b * s / 100).toFixed(2);
  $('fair').textContent = (1 / p).toFixed(2);
  $('bankrollTop').textContent = '$' + b.toFixed(0);

  $('verdict').textContent = value >= .05
    ? 'Положительное Value по введённым данным. Это не гарантия выигрыша.'
    : value > 0
      ? 'Преимущество меньше 5% — слабый сигнал.'
      : 'Положительного Value нет. Разумнее пропустить.';
}

['prob', 'odds', 'bankroll', 'stakePct'].forEach(id => {
  $(id).addEventListener('input', calcValue);
});

calcValue();

$('matchDate').value = todayTashkent();
$('loadMatches').addEventListener('click', loadMatches);
$('matchDate').addEventListener('change', loadMatches);

function runModel() {
  const lh = Number($('lh').value);
  const la = Number($('la').value);

  if (!(lh > 0 && la > 0)) return;

  const p = dixonColes(lh, la);

  $('output').innerHTML = [
    ['Победа хозяев', p[0]],
    ['Ничья', p[1]],
    ['Победа гостей', p[2]]
  ].map(([name, value]) =>
    `<div class="prob"><small>${name}</small><b>${fmtPct(value)}</b></div>`
  ).join('');
}

$('run').addEventListener('click', runModel);
runModel();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

loadMatches();
