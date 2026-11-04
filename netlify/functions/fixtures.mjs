const API_BASE = 'https://v3.football.api-sports.io';

export default async (request) => {
  const key = process.env.FOOTBALL_API_KEY;

  if (!key) {
    return Response.json({
      error: 'Не найдена переменная FOOTBALL_API_KEY в Netlify'
    }, { status: 500 });
  }

  const url = new URL(request.url);
  const date = url.searchParams.get('date') ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent'
    }).format(new Date());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({
      error: 'Неверный формат даты'
    }, { status: 400 });
  }

  const headers = { 'x-apisports-key': key };

  const fetchApi = async (path) => {
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
        .catch(error => ({ error }))
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
        return Number.isFinite(number) && number > 1
          ? number : null;
      };

      oddsMap.set(Number(item.fixture?.id), {
        bookmaker: bookmaker?.name || 'Букмекер',
        home: getOdd('home', '1'),
        draw: getOdd('draw', 'x'),
        away: getOdd('away', '2')
      });
    }

    const matches = (fixtures.response || []).map(item => ({
      id: item.fixture?.id,
      league: item.league?.name || 'Турнир',
      country: item.league?.country || '',
      date: item.fixture?.date || null,
      status: item.fixture?.status?.long || 'Неизвестно',
      statusShort: item.fixture?.status?.short || '',
      home: item.teams?.home?.name || 'Хозяева',
      away: item.teams?.away?.name || 'Гости',
      homeGoals: item.goals?.home,
      awayGoals: item.goals?.away,
      odds: oddsMap.get(Number(item.fixture?.id)) || null
    }));

    return Response.json({
      date,
      count: matches.length,
      matches,
      oddsNote: oddsResult.error
        ? 'Коэффициенты временно недоступны'
        : 'Коэффициенты доступны не для всех матчей'
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300'
      }
    });

  } catch (error) {
    return Response.json({
      error: `Ошибка API-Football: ${error.message}`
    }, { status: 502 });
  }
};
