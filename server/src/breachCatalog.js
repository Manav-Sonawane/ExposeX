// Offline reference list of well-known public breaches, used for the
// "check my accounts against known breaches" feature. It is intentionally
// small and offline; a production deployment would query a breach-intelligence
// API such as Have I Been Pwned instead.

export const BREACH_CATALOG = [
  { domains: ['yahoo.com'], title: 'Yahoo (2013)', date: '2013-08-01', severity: 'critical', dataClasses: ['email', 'passwords', 'dob', 'phone', 'name'] },
  { domains: ['linkedin.com'], title: 'LinkedIn (2012)', date: '2012-05-05', severity: 'high', dataClasses: ['email', 'passwords'] },
  { domains: ['dropbox.com'], title: 'Dropbox (2012)', date: '2012-07-01', severity: 'high', dataClasses: ['email', 'passwords'] },
  { domains: ['adobe.com'], title: 'Adobe (2013)', date: '2013-10-04', severity: 'high', dataClasses: ['email', 'passwords'] },
  { domains: ['myfitnesspal.com'], title: 'MyFitnessPal (2018)', date: '2018-02-01', severity: 'high', dataClasses: ['email', 'passwords', 'name'] },
  { domains: ['twitter.com', 'x.com'], title: 'Twitter (2022)', date: '2022-01-01', severity: 'medium', dataClasses: ['email', 'phone', 'name'] },
  { domains: ['facebook.com'], title: 'Facebook (2019 scrape)', date: '2019-08-01', severity: 'medium', dataClasses: ['phone', 'name', 'dob', 'employer'] },
  { domains: ['canva.com'], title: 'Canva (2019)', date: '2019-05-24', severity: 'high', dataClasses: ['email', 'name', 'passwords'] },
  { domains: ['marriott.com'], title: 'Marriott (2018)', date: '2018-09-10', severity: 'critical', dataClasses: ['email', 'name', 'address', 'phone', 'dob', 'government_id', 'payment'] },
  { domains: ['myspace.com'], title: 'MySpace (2008)', date: '2008-07-01', severity: 'medium', dataClasses: ['email', 'passwords'] },
  { domains: ['tumblr.com'], title: 'Tumblr (2013)', date: '2013-02-28', severity: 'medium', dataClasses: ['email', 'passwords'] },
  { domains: ['zynga.com'], title: 'Zynga (2019)', date: '2019-09-01', severity: 'high', dataClasses: ['email', 'passwords', 'phone'] },
  { domains: ['t-mobile.com'], title: 'T-Mobile (2021)', date: '2021-08-01', severity: 'critical', dataClasses: ['name', 'dob', 'government_id', 'phone', 'address'] },
  { domains: ['last.fm'], title: 'Last.fm (2012)', date: '2012-03-22', severity: 'medium', dataClasses: ['email', 'passwords'] },
  { domains: ['dailymotion.com'], title: 'Dailymotion (2016)', date: '2016-10-20', severity: 'medium', dataClasses: ['email', 'passwords'] },
  { domains: ['wattpad.com'], title: 'Wattpad (2020)', date: '2020-06-29', severity: 'high', dataClasses: ['email', 'passwords', 'name', 'dob'] },
  { domains: ['23andme.com'], title: '23andMe (2023)', date: '2023-10-01', severity: 'high', dataClasses: ['name', 'dob', 'health', 'address'] },
];

export function normalizeDomain(d) {
  return (d || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim();
}

export function matchBreaches(account) {
  const domain = normalizeDomain(account.domain);
  if (!domain) return [];
  return BREACH_CATALOG.filter((b) => {
    const hit = b.domains.some((d) => domain === d || domain.endsWith(`.${d}`));
    if (!hit) return false;
    // If we know when the account was created, skip breaches that predate it.
    if (account.memberSince && new Date(account.memberSince) > new Date(b.date)) return false;
    return true;
  });
}

const SIM_TITLES = [
  'credential dump posted on a hacking forum',
  'misconfigured cloud database exposed',
  'third-party vendor compromise',
  'customer support system breach',
  'API scraping incident',
  'ransomware gang data leak',
];

/** Build a realistic-looking but clearly SIMULATED breach for an account. */
export function simulatedBreachFor(account, rand = Math.random) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const classes = new Set(['email']);
  for (const d of account.dataShared || []) if (rand() < 0.6) classes.add(d);
  if (account.kind !== 'phone' && rand() < 0.55) classes.add('passwords');
  const severity = classes.has('passwords') || classes.has('payment') || classes.has('government_id')
    ? pick(['high', 'critical'])
    : pick(['low', 'medium']);
  return {
    accountId: account.id,
    title: `${account.name}: ${pick(SIM_TITLES)} (simulated)`,
    breachDate: new Date().toISOString().slice(0, 10),
    dataClasses: [...classes],
    severity,
    source: 'simulated',
    status: 'open',
  };
}
