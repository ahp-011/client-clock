// ---------------------------------------------------------------------------
// Turn a scrap of profile text ("United States", "Austin, TX", "Berlin, Germany")
// into an actual time zone. Most specific wins: city → state/province → country.
// ---------------------------------------------------------------------------
(function (root) {

  // Country names people write that don't match our ZONES country field.
  const COUNTRY_ALIASES = {
    'United States': ['usa', 'u.s.a', 'u.s', 'us', 'america', 'united states of america', 'the united states'],
    'United Kingdom': ['uk', 'u.k', 'england', 'scotland', 'wales', 'northern ireland', 'great britain', 'britain'],
    'UAE': ['united arab emirates', 'emirates'],
    'South Korea': ['korea', 'republic of korea'],
    'Czechia': ['czech republic'],
    'Netherlands': ['holland', 'the netherlands'],
    'Turkey': ['turkiye', 'türkiye'],
    'Vietnam': ['viet nam'],
    'Russia': ['russian federation'],
    'Ivory Coast': ["cote d'ivoire", 'côte d’ivoire', 'cote divoire'],
    'Georgia (country)': ['georgia country', 'sakartvelo'],
    'Trinidad and Tobago': ['trinidad'],
    'Hong Kong': ['hongkong', 'hong kong sar'],
    'Myanmar': ['burma']
  };

  // Sub-national regions. These are what make "United States" accurate instead
  // of a guess — a profile that says "Austin, TX" is Central, not Eastern.
  const US = {
    'America/New_York': ['connecticut','ct','delaware','de','district of columbia','washington dc','washington d.c','dc','florida','fl','georgia','ga','maine','me','maryland','md','massachusetts','ma','michigan','mi','new hampshire','nh','new jersey','nj','new york','ny','north carolina','nc','ohio','oh','pennsylvania','pa','rhode island','ri','south carolina','sc','vermont','vt','virginia','va','west virginia','wv','indiana','in','kentucky','ky'],
    'America/Chicago': ['alabama','al','arkansas','ar','illinois','il','iowa','ia','kansas','ks','louisiana','la','minnesota','mn','mississippi','ms','missouri','mo','nebraska','ne','north dakota','nd','oklahoma','ok','south dakota','sd','texas','tx','wisconsin','wi','tennessee','tn'],
    'America/Denver': ['colorado','co','idaho','id','montana','mt','new mexico','nm','utah','ut','wyoming','wy'],
    'America/Phoenix': ['arizona','az'],
    'America/Los_Angeles': ['california','ca','nevada','nv','oregon','or','washington','wa','washington state'],
    'America/Anchorage': ['alaska','ak'],
    'Pacific/Honolulu': ['hawaii','hi']
  };
  const CA = {
    'America/Toronto': ['ontario','on','quebec','québec','qc'],
    'America/Winnipeg': ['manitoba','mb'],
    'America/Regina': ['saskatchewan','sk'],
    'America/Edmonton': ['alberta','ab'],
    'America/Vancouver': ['british columbia','bc'],
    'America/Halifax': ['nova scotia','ns','new brunswick','nb','prince edward island','pei','pe'],
    'America/St_Johns': ['newfoundland','nl','labrador']
  };
  const AU = {
    'Australia/Sydney': ['new south wales','nsw','victoria','vic','australian capital territory','act','tasmania','tas'],
    'Australia/Brisbane': ['queensland','qld'],
    'Australia/Adelaide': ['south australia','sa','northern territory','nt'],
    'Australia/Perth': ['western australia','wa']
  };

  // Cities worth knowing beyond the ones already in the picker list.
  const CITIES = {
    'America/New_York': ['new york city','nyc','brooklyn','manhattan','queens','bronx','boston','miami','atlanta','philadelphia','philly','charlotte','raleigh','durham','orlando','tampa','jacksonville','pittsburgh','cincinnati','columbus','cleveland','detroit','baltimore','richmond','buffalo','rochester','hartford','providence','newark','jersey city','tallahassee','savannah','asheville','indianapolis','louisville','lexington'],
    'America/Chicago': ['austin','dallas','fort worth','houston','san antonio','el paso','nashville','memphis','new orleans','minneapolis','saint paul','st paul','milwaukee','kansas city','st louis','saint louis','oklahoma city','tulsa','omaha','des moines','little rock','madison','birmingham','baton rouge'],
    'America/Denver': ['denver','boulder','colorado springs','salt lake city','albuquerque','santa fe','boise','billings','cheyenne'],
    'America/Phoenix': ['phoenix','scottsdale','tucson','tempe','mesa'],
    'America/Los_Angeles': ['los angeles','la','san francisco','sf','bay area','silicon valley','san jose','oakland','berkeley','palo alto','san diego','sacramento','fresno','long beach','santa monica','seattle','bellevue','tacoma','spokane','portland','eugene','las vegas','reno','irvine','anaheim','pasadena'],
    'America/Toronto': ['toronto','ottawa','montreal','québec city','quebec city','hamilton','mississauga','kitchener','london ontario'],
    'America/Vancouver': ['vancouver','victoria bc','surrey','burnaby','kelowna'],
    'America/Edmonton': ['calgary','edmonton','banff'],
    'Europe/London': ['london','manchester','birmingham uk','leeds','liverpool','bristol','glasgow','edinburgh','cardiff','belfast','brighton','sheffield','newcastle','nottingham','oxford','cambridge'],
    'Europe/Berlin': ['berlin','munich','münchen','hamburg','frankfurt','cologne','köln','stuttgart','dusseldorf','düsseldorf','leipzig'],
    'Europe/Paris': ['paris','lyon','marseille','toulouse','bordeaux','nice','nantes','lille'],
    'Europe/Madrid': ['madrid','barcelona','valencia','seville','sevilla','bilbao','malaga'],
    'Europe/Amsterdam': ['amsterdam','rotterdam','utrecht','the hague','den haag','eindhoven'],
    'Europe/Rome': ['rome','roma','milan','milano','turin','naples','florence','firenze','bologna'],
    'Europe/Warsaw': ['warsaw','warszawa','krakow','kraków','wroclaw','gdansk','poznan'],
    'Europe/Lisbon': ['lisbon','lisboa','porto','braga'],
    'Europe/Dublin': ['dublin','cork','galway'],
    'Europe/Zurich': ['zurich','zürich','geneva','genève','basel','bern','lausanne'],
    'Europe/Stockholm': ['stockholm','gothenburg','göteborg','malmo','malmö'],
    'Europe/Istanbul': ['istanbul','ankara','izmir','antalya'],
    'Asia/Dubai': ['dubai','abu dhabi','sharjah','ajman'],
    'Asia/Kolkata': ['mumbai','bombay','delhi','new delhi','bangalore','bengaluru','hyderabad','chennai','kolkata','pune','ahmedabad','jaipur','noida','gurgaon','gurugram','kochi','indore','chandigarh'],
    'Asia/Karachi': ['karachi','lahore','islamabad','rawalpindi','faisalabad'],
    'Asia/Dhaka': ['dhaka','chittagong','chattogram','sylhet','khulna'],
    'Asia/Singapore': ['singapore'],
    'Asia/Tokyo': ['tokyo','osaka','kyoto','yokohama','nagoya','fukuoka'],
    'Asia/Shanghai': ['shanghai','beijing','shenzhen','guangzhou','hangzhou','chengdu'],
    'Asia/Manila': ['manila','makati','cebu','quezon city','davao'],
    'Asia/Jakarta': ['jakarta','bandung','surabaya','bali','denpasar','yogyakarta'],
    'Australia/Sydney': ['sydney','melbourne','canberra','hobart','newcastle australia','wollongong'],
    'Australia/Brisbane': ['brisbane','gold coast','cairns','townsville','sunshine coast'],
    'Australia/Perth': ['perth','fremantle'],
    'Australia/Adelaide': ['adelaide','darwin'],
    'Pacific/Auckland': ['auckland','wellington','christchurch','queenstown'],
    'America/Sao_Paulo': ['sao paulo','são paulo','rio de janeiro','rio','brasilia','belo horizonte','curitiba','porto alegre'],
    'America/Mexico_City': ['mexico city','ciudad de mexico','cdmx','guadalajara','monterrey','puebla','merida','queretaro'],
    'America/Bogota': ['bogota','bogotá','medellin','medellín','cali','cartagena'],
    'America/Argentina/Buenos_Aires': ['buenos aires','cordoba argentina','rosario'],
    'Africa/Johannesburg': ['johannesburg','joburg','cape town','durban','pretoria'],
    'Africa/Lagos': ['lagos','abuja','ibadan','port harcourt'],
    'Africa/Nairobi': ['nairobi','mombasa'],
    'Africa/Cairo': ['cairo','alexandria','giza'],
    'Asia/Jerusalem': ['tel aviv','jerusalem','haifa'],
    'Asia/Riyadh': ['riyadh','jeddah','dammam','mecca','medina'],
    'Europe/Kyiv': ['kyiv','kiev','lviv','odesa','odessa','kharkiv'],
    'Europe/Moscow': ['moscow','saint petersburg','st petersburg'],
    'Asia/Ho_Chi_Minh': ['ho chi minh','saigon','hanoi','da nang'],
    'Asia/Bangkok': ['bangkok','chiang mai','phuket'],
    'Asia/Kuala_Lumpur': ['kuala lumpur','penang','johor bahru'],
    'Asia/Hong_Kong': ['hong kong','kowloon'],
    'Asia/Seoul': ['seoul','busan','incheon']
  };

  // Names that mean a country when they stand alone, but a US state inside an
  // address ("Georgia" vs "Atlanta, Georgia").
  const SOLO_COUNTRY = { 'georgia': 'Georgia (country)' };

  // Country names that are also ordinary place words elsewhere. These only
  // count as a country when they are the whole location string, so
  // "Jersey City, NJ" stays in New Jersey instead of flying to the Channel
  // Islands.
  const SOLO_ONLY = ['Jersey', 'Guernsey', 'Isle of Man', 'Saint Helena'];

  const STATE_SETS = [
    { country: 'United States', map: US },
    { country: 'Canada',        map: CA },
    { country: 'Australia',     map: AU }
  ];

  // "Saint-Étienne" → "saint etienne"; punctuation and accents must never decide a match.
  function norm(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()\[\]"'’|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Whole-word containment, so "indiana" never matches inside "indianapolis"
  // and the bare state code "in" never matches the word "in".
  function hasPhrase(haystack, phrase) {
    const h = ' ' + haystack + ' ';
    return h.indexOf(' ' + phrase + ' ') !== -1;
  }

  function zoneEntry(zones, zoneId) {
    return zones.find(z => z.zone === zoneId) || null;
  }

  // Everything we know about a country, default zone first.
  function countryZones(zones, country) {
    return zones.filter(z => z.country === country);
  }

  function offsetMinutes(zone, date) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = {};
    for (const { type, value } of f.formatToParts(date)) p[type] = value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  }

  /**
   * One row per distinct clock within a country. The US has 29 IANA zones but
   * only a handful of actual times, and nobody wants to choose between
   * America/Detroit and America/New_York when both read 1:30.
   *
   * Two zones count as the same clock only if they agree in BOTH January and
   * July. Testing today's offset alone would collapse Phoenix into Los Angeles
   * every summer and then show the wrong time all winter, since Arizona skips
   * daylight saving.
   */
  function primary(list) {
    const y = new Date().getFullYear();
    const jan = new Date(Date.UTC(y, 0, 15));
    const jul = new Date(Date.UTC(y, 6, 15));
    const seen = new Set();
    const out = [];
    for (const z of list) {
      const key = (z.cc || z.country) + '|' +
                  offsetMinutes(z.zone, jan) + '|' + offsetMinutes(z.zone, jul);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(z);
    }
    return out;
  }

  function countryMatch(text, zones) {
    const names = [...new Set(zones.map(z => z.country))];
    let best = null;
    for (const c of names) {
      const soloOnly = SOLO_ONLY.indexOf(c) !== -1;
      const candidates = [c, ...(COUNTRY_ALIASES[c] || [])].map(norm);
      for (const cand of candidates) {
        if (soloOnly) {
          if (text === cand && (!best || cand.length > best.len)) best = { country: c, len: cand.length };
          continue;
        }
        // Bare "us" / "uk" are only trusted as a standalone location string,
        // never as a word floating inside a longer sentence.
        const risky = cand.length <= 2;
        const hit = risky ? text === cand : hasPhrase(text, cand);
        if (hit && (!best || cand.length > best.len)) best = { country: c, len: cand.length };
      }
    }
    return best ? best.country : null;
  }

  /**
   * resolve(text, ZONES) → null, or
   * { zone, city, region, country, flag, precision, alternatives[] }
   * precision: 'city' | 'region' | 'country'
   */
  function resolve(text, zones, opts) {
    const t = norm(text);
    if (!t || t.length > 80) return null;

    // A person's own name is never their location — "Jordan Smith" is a man,
    // not Amman. The caller passes the name it detected alongside the text.
    const exclude = ((opts && opts.exclude) || []).map(norm).filter(Boolean);
    for (const ex of exclude) {
      if (ex && (ex === t || ex.indexOf(t) !== -1)) return null;
    }

    if (SOLO_COUNTRY[t]) {
      const list = countryZones(zones, SOLO_COUNTRY[t]);
      if (list.length) return pack(zones, list[0].zone, 'country', SOLO_COUNTRY[t]);
    }

    const country = countryMatch(t, zones);

    // 1. A city we know by name — the strongest signal there is.
    let cityZone = null, cityName = null;
    for (const [zone, list] of Object.entries(CITIES)) {
      for (const city of list) {
        const risky = city.length <= 2;                   // 'la', 'sf'
        const hit = risky ? t === city : hasPhrase(t, city);
        if (hit && (!cityName || city.length > cityName.length)) { cityZone = zone; cityName = city; }
      }
    }
    // Cities in the picker list itself (Prague, Doha, …).
    for (const z of zones) {
      const c = norm(z.city);
      if (c.length > 2 && hasPhrase(t, c) && (!cityName || c.length > cityName.length)) {
        cityZone = z.zone; cityName = c;
      }
    }
    if (cityZone) {
      // A named city only wins if it doesn't contradict a named country
      // ("Georgia" the country must not become Atlanta).
      const e = zoneEntry(zones, cityZone);
      if (!country || !e || e.country === country) {
        // Show the city the profile actually named (Osaka), not the city that
        // happens to label that zone (Tokyo).
        return pack(zones, cityZone, 'city', country || (e && e.country), title(cityName));
      }
    }

    // 2. A state / province / territory.
    for (const set of STATE_SETS) {
      if (country && country !== set.country) continue;
      for (const [zone, list] of Object.entries(set.map)) {
        for (const region of list) {
          const risky = region.length <= 2;               // 'ny', 'ca', 'tx'
          // A two-letter code is only trusted next to its country, or in the
          // classic "City, ST" shape — never on its own.
          const hit = risky
            ? (country === set.country || /,\s*[a-z]{2}\b/i.test(text)) && hasPhrase(t, region)
            : hasPhrase(t, region);
          if (hit) return pack(zones, zone, 'region', set.country);
        }
      }
    }

    // 3. Country only — may be ambiguous, and we say so.
    if (country) {
      const list = countryZones(zones, country);
      if (list.length) return pack(zones, list[0].zone, 'country', country);
    }
    return null;
  }

  function title(s) {
    return String(s || '').replace(/\b[a-z]/g, m => m.toUpperCase());
  }

  function pack(zones, zoneId, precision, country, matched) {
    const e = zoneEntry(zones, zoneId);
    const c = country || (e && e.country);
    const siblings = c ? countryZones(zones, c) : [];
    return {
      zone: zoneId,
      city: matched || (e ? e.city : zoneId.split('/').pop().replace(/_/g, ' ')),
      region: matched && e && title(e.city) !== matched ? '' : (e ? e.region : ''),
      country: c || '',
      flag: e ? e.flag : '🌍',
      precision,
      // Only a country-level guess is ambiguous; a city or state is settled.
      alternatives: precision === 'country' && siblings.length > 1 ? primary(siblings) : []
    };
  }

  const api = { resolve, norm, primary, offsetMinutes, COUNTRY_ALIASES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Places = api;
})(typeof window !== 'undefined' ? window : globalThis);
