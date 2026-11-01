const $ = id => document.getElementById(id);
const fmtPct = x => (x * 100).toFixed(1) + '%';
const todayTashkent = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());

function factorial(n) { let x = 1; for (let i = 2; i <= n; i++) x *= i; return x; }
function poisson(k, lambda) { return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k); }
function dixonColes(lh, la, rho = -0.08) {
  let home = 0, draw = 0, away = 0;
  for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) {
    let tau = 1;
    if (x === 0 && y === 0) tau = 1 - lh * la * rho;
    else if (x === 0 && y === 1) tau = 1 + lh * rho;
    else if (x === 1 && y === 0) tau = 1 + la * rho;
    else if (x === 1 && y === 1) tau = 1 - rho;
    const probability = poisson(x, lh) * poisson(y, la) * Math.max(0, tau);
    if (x > y) home += probability; else if (x === y) draw += probability; else away += probability;
  }
  const total = home + draw + away;
  return [home / total, draw / total, away / total];
}

function renderMatches(matches) {
  const list = $('matchList'); list.replaceChildren();
  let withOdds = 0;
  for (const m of matches) {
    if (m.odds && [m.odds.home, m.odds.draw, m.odds.away].some(v => v != null)) withOdds++;
    const date = m.date ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(m.date)) : 'Время неизвестно';
    const status = m.statusShort === 'NS' ? 'Не начался' : m.status;
    const odds = m.odds;
    const oddsHtml = odds && [odds.home, odds.draw, odds.away].some(v => v != null)
      ? [ ['П1', odds.home], ['X', odds.draw], ['П2', odds.away] ].map(([label, value]) => `<div class="odd"><small>${label}</small><b>${value == null ? '—' : Number(value).toFixed(2)}</b></div>`).join('')
      : '<div class="noOdds">Коэффициенты на этот матч не найдены в ответе API.</div>';
    const card = document.createElement('article'); card.className = 'match';
    card.innerHTML = `<div class="matchTop"><span>${escapeHtml([m.country, m.league].filter(Boolean).join(' · '))}</span><span>${escapeHtml(date)}</span></div><div class="teams"><span>${escapeHtml(m.home)}</span><span class="vs">VS</span><span>${escapeHtml(m.away)}</span></div><div class="matchTop statusLine"><span>${escapeHtml(status)}</span><span>${m.homeGoals == null ? '' : `${m.homeGoals} : ${m.awayGoals}`}</span></div><div class="odds">${oddsHtml}</div><div class="edge">ID матча: ${m.id} · Вероятности модели ещё не рассчитаны</div>`;
    list.appendChild(card);
  }
  $('matchCount').textContent = matches.length;
  $('oddsCount').textContent = withOdds;
  $('modeBadge').textContent = 'API';
  $('dataNotice').textContent = 'Матчи получены из API-Football. Коэффициенты могут отсутствовать для отдельных лиг и игр. Вероятности модели пока не рассчитываются автоматически.';
  if (!matches.length) list.innerHTML = '<p class="muted">На выбранную дату API не вернул матчей.</p>';
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function loadMatches() {
  const date = $('matchDate').value || todayTashkent();
  $('loadStatus').textContent = 'Загружаем матчи и коэффициенты…';
  $('loadMatches').disabled = true;
  try {
    const response = await fetch(`/.netlify/functions/fixtures?date=${encodeURIComponent(date)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Ошибка сервера: ${response.status}`);
    renderMatches(data.matches || []);
    $('loadStatus').textContent = `Дата: ${date}. Получено матчей: ${data.count}. ${data.oddsNote || ''}`;
  } catch (error) {
    $('loadStatus').textContent = error.message;
    $('dataNotice').textContent = 'Не удалось загрузить реальные данные. Проверьте переменную API и настройки публикации Netlify.';
    $('matchList').innerHTML = '<p class="muted">Реальные матчи пока недоступны. Проверьте настройки и попробуйте ещё раз.</p>';
  } finally { $('loadMatches').disabled = false; }
}

function calcValue() {
  const p = Number($('prob').value) / 100, o = Number($('odds').value), b = Number($('bankroll').value), s = Number($('stakePct').value);
  if (!(p > 0 && p < 1 && o > 1 && b > 0 && s > 0)) return;
  const value = p * o - 1;
  $('value').textContent = `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
  $('stake').textContent = '$' + (b * s / 100).toFixed(2);
  $('fair').textContent = (1 / p).toFixed(2);
  $('bankrollTop').textContent = '$' + b.toFixed(0);
  $('verdict').textContent = value >= .05 ? 'Положительное Value по введённым данным. Это не гарантия выигрыша.' : value > 0 ? 'Преимущество меньше 5% — слабый сигнал.' : 'Положительного Value нет. Разумнее пропустить.';
}
['prob','odds','bankroll','stakePct'].forEach(id => $(id).addEventListener('input', calcValue));
calcValue();
$('matchDate').value = todayTashkent();
$('loadMatches').addEventListener('click', loadMatches);
loadMatches();
function runModel() {
  const lh = Number($('lh').value), la = Number($('la').value);
  if (!(lh > 0 && la > 0)) return;
  const p = dixonColes(lh, la);
  $('output').innerHTML = [['Победа хозяев',p[0]],['Ничья',p[1]],['Победа гостей',p[2]]].map(([name,value]) => `<div class="prob"><small>${name}</small><b>${fmtPct(value)}</b></div>`).join('');
}
$('run').addEventListener('click', runModel); runModel();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
