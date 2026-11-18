const API_BASE = 'https://v3.football.api-sports.io';
const CACHE_SECONDS = 300;
const MAX_MODEL_MATCHES = 8;

const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`
    }
  });

function poisson(k, lambda) {
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial;
}

function dixonColes(lambdaHome, lambdaAway, rho = -0.08) {
  let home = 0;
  let draw = 0;
  let away = 0;

  for (let x = 0; x <= 10; x++) {
    for (let y = 0; y <= 10; y++) {
      let tau = 1;

      if (x === 0 && y === 0) tau = 1 - lambdaHome * lambdaAway * rho;
      else if (x === 0 && y === 1) tau = 1 + lambdaHome * rho;
      else if (x === 1 && y === 0) tau = 1 + lambdaAway * rho;
      else if (x === 1 && y === 1) tau = 1 - rho;

      const probability =
        poisson(x, lambdaHome) *
        poisson(y, lambdaAway) *
        Math.max(0, tau);

      if (x > y) home += probability;
      else if (x === y) draw += probability;
      else away += probability;
    }
  }

  const total = home + draw + away;

  return {
    home: home / total,
    draw: draw / total,
    away: away / total
  };
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function teamStats(fixtures, teamId) {
  const scored = [];
  const conceded = [];

  for (const item of fixtures || []) {
    const homeId = Number(item.teams?.home?.id);
    const awayId = Number(item.teams?.away?.id);
    const homeGoals = item.goals?.home;
    const awayGoals = item.goals?.away;

    if (homeGoals == null || awayGoals == null) continue;

    if (homeId === teamId) {
      scored.push(Number(homeGoals));
      conceded.push(Number(awayGoals));
    } else if (awayId === teamId) {
      scored.push(Number(awayGoals));
      conceded.push(Number(homeGoals));
    }
  }

  return {
    scored: average(scored),
    conceded: average(conceded),
    games: scored.length
  };
}

function clamp(value, min = 0.2, max = 3.5) {
  return Math.max(min, Math.min(max, value));
}

export default async (request) => {
  const key = process.env.FOOTBALL_API_KEY;

  if (!key) {
    return json({
      error: 'Не найдена переменная FOOTBALL_API_KEY в Netlify'
    }, 500);
  }

  const url = new URL(request.url);
  const date = url.searchParams.get('date') ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent'
    }).format(new Date());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'Неверный формат даты' }, 400);
  }

  const headers = { 'x-apisports-key': key };

  const fetchApi = async path => {
    const response = await fetch(`${API_BASE}${path}`, { headers });
    const body = await response.json();

    if (!response.ok || Object.keys(body.errors || {}).length) {
      throw new Error(JSON.stringify(body.errors || body.message));
    }

    return body;
  };

  try {
    const [fixtures, oddsResult] = await Promise.all([
      fetchApi(`/fixtures?date=${date}&timezone=Asia%2FTashkent`),
      fetchApi(`/odds?date=${date}&page=1`)
        .then(data => ({ data }))
        .catch(error => ({ error: error.message }))
    ]);

    const oddsMap = new Map();

    for (const item of (oddsResult.data?.response || [])) {
      const bookmaker = item.bookmakers?.[0];
      const bets = bookmaker?.bets || [];
      const bet = bets.find(b =>
        /match winner|1x2|fulltime result/i.test(b.name || '')
      );

      if (!bet) continue;

      const values = bet.values || [];

      const getOdd = (...labels) => {
        const found = values.find(v =>
          labels.includes((v.value || '').toLowerCase())
        );
        const number = Number(found?.odd);
        return Number.isFinite(number) && number > 1 ? number : null;
      };

      oddsMap.set(Number(item.fixture?.id), {
        bookmaker: bookmaker?.name || 'Букмекер',
        home: getOdd('home', '1'),
        draw: getOdd('draw', 'x'),
        away: getOdd('away', '2')
      });
    }

    const rawMatches = fixtures.response || [];

    const matches = rawMatches.map(item => ({
      id: item.fixture?.id,
      league: item.league?.name || 'Турнир',
      leagueId: item.league?.id || null,
      season: item.league?.season || null,
      country: item.league?.country || '',
      date: item.fixture?.date || null,
      status: item.fixture?.status?.long || 'Неизвестно',
      statusShort: item.fixture?.status?.short || '',
      home: item.teams?.home?.name || 'Хозяева',
      away: item.teams?.away?.name || 'Гости',
      homeId: item.teams?.home?.id || null,
      awayId: item.teams?.away?.id || null,
      homeGoals: item.goals?.home,
      awayGoals: item.goals?.away,
      odds: oddsMap.get(Number(item.fixture?.id)) || null,
      prediction: null
    }));

    const upcoming = matches
      .filter(m =>
        m.statusShort === 'NS' &&
        m.homeId &&
        m.awayId
      )
      .slice(0, MAX_MODEL_MATCHES);

    const teamIds = [
      ...new Set(
        upcoming.flatMap(m => [Number(m.homeId), Number(m.awayId)])
      )
    ];

    const historyMap = new Map();
    let nextIndex = 0;

    const workers = Array.from(
      { length: Math.min(4, teamIds.length) },
      async () => {
        while (nextIndex < teamIds.length) {
          const index = nextIndex++;
          const teamId = teamIds[index];

          try {
            const result = await fetchApi(
              `/fixtures?team=${teamId}&last=5`
            );

            historyMap.set(
              teamId,
              teamStats(result.response, teamId)
            );
          } catch {
            historyMap.set(teamId, null);
          }
        }
      }
    );

    await Promise.all(workers);

    for (const match of upcoming) {
      const homeStats = historyMap.get(Number(match.homeId));
      const awayStats = historyMap.get(Number(match.awayId));

      if (
        !homeStats ||
        !awayStats ||
        homeStats.games < 3 ||
        awayStats.games < 3 ||
        homeStats.scored == null ||
        awayStats.scored == null ||
        homeStats.conceded == null ||
        awayStats.conceded == null
      ) {
        continue;
      }

      const lambdaHome = clamp(
        ((homeStats.scored + awayStats.conceded) / 2) * 1.08
      );

      const lambdaAway = clamp(
        ((awayStats.scored + homeStats.conceded) / 2) * 0.92
      );

      const probabilities = dixonColes(lambdaHome, lambdaAway);

      match.prediction = {
        lambdaHome: Number(lambdaHome.toFixed(2)),
        lambdaAway: Number(lambdaAway.toFixed(2)),
        home: Number((probabilities.home * 100).toFixed(1)),
        draw: Number((probabilities.draw * 100).toFixed(1)),
        away: Number((probabilities.away * 100).toFixed(1)),
        homeSample: homeStats.games,
        awaySample: awayStats.games,
        method: 'Dixon-Coles preliminary'
      };
    }

    return json({
      date,
      count: matches.length,
      modelCount: matches.filter(m => m.prediction).length,
      upcomingForModel: upcoming.length,
  teamsRequested: teamIds.length,
  historyRequestsOk,
  historyRequestsFailed,
  teamsWithEnoughHistory: [...historyMap.values()].filter(s =>
    s && s.games >= 3 &&
    s.scored != null && s.conceded != null
  ).length,
  historyErrors: historyErrors.slice(0, 5),
      
      matches,
      oddsNote: oddsResult.error
        ? 'Коэффициенты временно недоступны'
        : 'Коэффициенты доступны не для всех матчей',
      modelNote: 'Предварительная модель на основе последних пяти матчей команд. Не является проверенной ставочной стратегией.'
    });

  } catch (error) {
    return json({
      error: `Ошибка API-Football: ${error.message}`
    }, 502);
  }
};
            
