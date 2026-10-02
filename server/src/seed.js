// Sample footprint: a realistic, messy digital life with recovery chains,
// SSO hubs, password reuse, old breaches and over-permissioned apps.
// It also replays a few fixes in the past so "improvement over time" has history.

import {
  createAccount,
  createGroup,
  createLink,
  createBreach,
  applyMutationDb,
  recordSnapshot,
  logAction,
  insertNotification,
  wipeFootprint,
  loadFootprint,
} from './repo.js';
import { computeRisk } from './engine/risk.js';
import { BREACH_CATALOG } from './breachCatalog.js';

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const tsAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

export function seedSampleFootprint(db, userId) {
  wipeFootprint(db, userId);

  const oldPw = createGroup(db, userId, 'Old 2014-era password').id;
  const mainPw = createGroup(db, userId, 'Main everyday password').id;
  const shopPw = createGroup(db, userId, 'Shopping password').id;

  const A = {};
  const add = (key, data) => {
    A[key] = createAccount(db, userId, { kind: 'account', signInMethods: ['password'], lastActive: daysAgo(2), ...data }).id;
  };

  // --- Phone numbers ---
  add('phone', { kind: 'phone', name: 'Mobile ••• 4821', serviceType: 'carrier', importance: 5, signInMethods: [], dataShared: ['phone'], carrierPin: false, lastActive: daysAgo(0) });

  // --- Email & identity hubs ---
  add('gmail', { name: 'Gmail', serviceType: 'email', domain: 'gmail.com', identifier: 'alex.morgan@gmail.com', importance: 5, twofa: 'sms', dataShared: ['email', 'phone', 'name', 'contacts', 'photos', 'location_history', 'documents', 'messages'], lastActive: daysAgo(0), memberSince: '2009-04-12' });
  add('yahoo', { name: 'Yahoo Mail (old)', serviceType: 'email', domain: 'yahoo.com', identifier: 'alexm_88@yahoo.com', importance: 3, twofa: 'none', passwordGroupId: oldPw, dataShared: ['email', 'name', 'dob', 'contacts', 'messages'], lastActive: daysAgo(1100), memberSince: '2006-02-01' });
  add('outlook', { name: 'Outlook / Microsoft', serviceType: 'email', domain: 'outlook.com', identifier: 'alex.morgan@outlook.com', importance: 4, twofa: 'none', dataShared: ['email', 'name', 'documents'], lastActive: daysAgo(20), memberSince: '2015-06-01' });
  add('apple', { name: 'Apple ID', serviceType: 'identity', domain: 'apple.com', importance: 5, twofa: 'push', dataShared: ['email', 'phone', 'payment', 'photos', 'location_history', 'contacts', 'health'], lastActive: daysAgo(0) });
  add('verizon', { name: 'Verizon account', serviceType: 'carrier', domain: 'verizon.com', importance: 4, twofa: 'none', passwordGroupId: mainPw, dataShared: ['name', 'address', 'payment', 'phone'], lastActive: daysAgo(30) });
  add('bitwarden', { name: 'Bitwarden', serviceType: 'identity', domain: 'bitwarden.com', importance: 5, twofa: 'totp', dataShared: ['passwords', 'email'], lastActive: daysAgo(1) });

  // --- Finance ---
  add('chase', { name: 'Chase Bank', serviceType: 'finance', domain: 'chase.com', importance: 5, twofa: 'sms', dataShared: ['name', 'address', 'financial', 'payment', 'dob', 'government_id'], lastActive: daysAgo(3) });
  add('paypal', { name: 'PayPal', serviceType: 'finance', domain: 'paypal.com', importance: 5, twofa: 'none', passwordGroupId: mainPw, dataShared: ['payment', 'address', 'name', 'financial'], lastActive: daysAgo(12) });
  add('venmo', { name: 'Venmo', serviceType: 'finance', domain: 'venmo.com', importance: 4, twofa: 'sms', passwordGroupId: mainPw, dataShared: ['payment', 'contacts', 'financial'], permissions: ['contacts'], lastActive: daysAgo(6) });
  add('coinbase', { name: 'Coinbase', serviceType: 'finance', domain: 'coinbase.com', importance: 5, twofa: 'totp', dataShared: ['government_id', 'financial', 'address'], lastActive: daysAgo(45) });

  // --- Social & messaging ---
  add('facebook', { name: 'Facebook', serviceType: 'social', domain: 'facebook.com', importance: 3, twofa: 'none', passwordGroupId: mainPw, dataShared: ['photos', 'messages', 'location_history', 'contacts', 'dob', 'employer'], permissions: ['location', 'contacts', 'camera', 'microphone'], lastActive: daysAgo(5), memberSince: '2008-09-01' });
  add('instagram', { name: 'Instagram', serviceType: 'social', domain: 'instagram.com', importance: 3, twofa: 'sms', passwordGroupId: mainPw, dataShared: ['photos', 'messages', 'location_history'], permissions: ['camera', 'photos', 'location', 'microphone'], lastActive: daysAgo(1) });
  add('linkedin', { name: 'LinkedIn', serviceType: 'social', domain: 'linkedin.com', importance: 3, twofa: 'none', passwordGroupId: oldPw, dataShared: ['employer', 'name', 'email', 'phone'], lastActive: daysAgo(60), memberSince: '2010-01-15' });
  add('twitter', { name: 'X (Twitter)', serviceType: 'social', domain: 'x.com', importance: 2, twofa: 'none', passwordGroupId: mainPw, dataShared: ['email', 'phone', 'messages'], lastActive: daysAgo(90), memberSince: '2011-03-01' });
  add('whatsapp', { name: 'WhatsApp', serviceType: 'communication', domain: 'whatsapp.com', importance: 4, twofa: 'none', signInMethods: ['sms_otp'], dataShared: ['messages', 'contacts', 'photos', 'phone'], permissions: ['contacts', 'camera', 'microphone', 'location', 'photos'], lastActive: daysAgo(0) });

  // --- Cloud / dev / work ---
  add('dropbox', { name: 'Dropbox', serviceType: 'cloud', domain: 'dropbox.com', importance: 4, twofa: 'none', passwordGroupId: oldPw, dataShared: ['documents', 'photos', 'government_id'], lastActive: daysAgo(400), memberSince: '2011-05-01' });
  add('github', { name: 'GitHub', serviceType: 'dev', domain: 'github.com', importance: 4, twofa: 'none', dataShared: ['email', 'employer'], lastActive: daysAgo(1) });
  add('slack', { name: 'Slack', serviceType: 'work', domain: 'slack.com', importance: 3, twofa: 'none', signInMethods: ['sso'], dataShared: ['messages', 'employer', 'documents'], lastActive: daysAgo(1) });
  add('notion', { name: 'Notion', serviceType: 'work', domain: 'notion.so', importance: 3, twofa: 'none', signInMethods: ['sso'], dataShared: ['documents'], lastActive: daysAgo(4) });

  // --- Shopping / entertainment / misc ---
  add('amazon', { name: 'Amazon', serviceType: 'shopping', domain: 'amazon.com', importance: 4, twofa: 'sms', passwordGroupId: shopPw, dataShared: ['payment', 'address', 'name', 'phone', 'browsing'], lastActive: daysAgo(7) });
  add('ebay', { name: 'eBay', serviceType: 'shopping', domain: 'ebay.com', importance: 2, twofa: 'none', passwordGroupId: oldPw, dataShared: ['address', 'payment', 'name'], lastActive: daysAgo(900) });
  add('target', { name: 'Target', serviceType: 'shopping', domain: 'target.com', importance: 2, twofa: 'none', passwordGroupId: shopPw, dataShared: ['address', 'payment'], lastActive: daysAgo(200) });
  add('netflix', { name: 'Netflix', serviceType: 'entertainment', domain: 'netflix.com', importance: 2, twofa: 'none', passwordGroupId: mainPw, dataShared: ['payment', 'browsing'], lastActive: daysAgo(3) });
  add('spotify', { name: 'Spotify', serviceType: 'entertainment', domain: 'spotify.com', importance: 2, twofa: 'none', signInMethods: ['sso'], dataShared: ['payment', 'browsing'], permissions: ['microphone', 'bluetooth'], lastActive: daysAgo(0) });
  add('steam', { name: 'Steam', serviceType: 'gaming', domain: 'steampowered.com', importance: 2, twofa: 'email', passwordGroupId: oldPw, dataShared: ['payment'], lastActive: daysAgo(150) });
  add('mfp', { name: 'MyFitnessPal', serviceType: 'health', domain: 'myfitnesspal.com', importance: 2, twofa: 'none', passwordGroupId: oldPw, dataShared: ['health', 'dob', 'name', 'email'], lastActive: daysAgo(800), memberSince: '2014-01-10' });
  add('airbnb', { name: 'Airbnb', serviceType: 'travel', domain: 'airbnb.com', importance: 3, twofa: 'none', signInMethods: ['sso'], dataShared: ['government_id', 'payment', 'address', 'messages'], lastActive: daysAgo(120) });
  add('canva', { name: 'Canva', serviceType: 'work', domain: 'canva.com', importance: 2, twofa: 'none', signInMethods: ['sso'], dataShared: ['documents', 'photos'], lastActive: daysAgo(30), memberSince: '2020-02-01' });

  // --- Third-party apps ---
  add('mailmerge', { kind: 'app', name: 'MailMerge Pro (Gmail add-on)', serviceType: 'utility', importance: 2, signInMethods: ['sso'], permissions: ['email_read', 'email_send', 'contacts', 'offline_access'], lastActive: daysAgo(420) });
  add('calsync', { kind: 'app', name: 'Calendar Sync Lite', serviceType: 'utility', importance: 1, signInMethods: ['sso'], permissions: ['calendar', 'offline_access'], lastActive: daysAgo(10) });
  add('quiz', { kind: 'app', name: 'Which Celebrity Are You? (FB quiz)', serviceType: 'entertainment', importance: 1, signInMethods: ['sso'], permissions: ['profile', 'contacts', 'photos', 'social_post'], lastActive: daysAgo(1400) });
  add('fittrack', { kind: 'app', name: 'FitTrack mobile', serviceType: 'health', importance: 2, permissions: ['location', 'health', 'contacts', 'bluetooth', 'camera'], dataShared: ['health', 'location_history'], lastActive: daysAgo(260) });
  add('flashlight', { kind: 'app', name: 'Flashlight Plus', serviceType: 'utility', importance: 1, signInMethods: [], permissions: ['location', 'contacts', 'camera', 'microphone', 'call_logs'], lastActive: daysAgo(700) });
  add('scanner', { kind: 'app', name: 'DocScanner', serviceType: 'utility', importance: 2, permissions: ['camera', 'files', 'photos'], dataShared: ['documents'], lastActive: daysAgo(15) });

  // --- Links: source can take over target ---
  const L = (s, t, type) => createLink(db, userId, { sourceId: A[s], targetId: A[t], type });
  L('phone', 'gmail', 'recovery_phone');
  L('phone', 'chase', 'recovery_phone');
  L('phone', 'venmo', 'recovery_phone');
  L('phone', 'whatsapp', 'recovery_phone');
  L('phone', 'apple', 'recovery_phone');
  L('phone', 'amazon', 'recovery_phone');
  L('phone', 'instagram', 'recovery_phone');
  L('verizon', 'phone', 'controls');
  L('gmail', 'verizon', 'recovery_email');
  for (const t of ['chase', 'paypal', 'venmo', 'coinbase', 'github', 'amazon', 'netflix', 'twitter', 'instagram', 'outlook', 'bitwarden', 'target', 'steam'])
    L('gmail', t, 'recovery_email');
  for (const t of ['slack', 'notion', 'spotify', 'airbnb', 'canva', 'mailmerge', 'calsync']) L('gmail', t, 'sso');
  for (const t of ['facebook', 'linkedin', 'dropbox', 'ebay', 'mfp']) L('yahoo', t, 'recovery_email');
  L('gmail', 'yahoo', 'recovery_email');
  L('facebook', 'instagram', 'linked');
  L('facebook', 'quiz', 'sso');
  L('quiz', 'facebook', 'oauth');
  L('mailmerge', 'gmail', 'oauth');
  L('calsync', 'gmail', 'oauth');
  L('fittrack', 'mfp', 'oauth');
  L('bitwarden', 'chase', 'controls');
  L('bitwarden', 'coinbase', 'controls');
  L('outlook', 'github', 'linked');

  // --- Known breaches (from the public reference list) ---
  const cat = (title) => BREACH_CATALOG.find((b) => b.title === title);
  const breach = (key, title, status = 'open') => {
    const c = cat(title);
    return createBreach(db, userId, { accountId: A[key], title: c.title, breachDate: c.date, dataClasses: c.dataClasses, severity: c.severity, source: 'catalog', status });
  };
  breach('yahoo', 'Yahoo (2013)');
  const linkedinBreach = breach('linkedin', 'LinkedIn (2012)');
  breach('dropbox', 'Dropbox (2012)');
  breach('mfp', 'MyFitnessPal (2018)');
  breach('twitter', 'Twitter (2022)');
  breach('facebook', 'Facebook (2019 scrape)', 'resolved');

  // --- History: replay fixes made over the last three months ---
  const history = [
    { days: 90, reason: 'Started tracking' },
    { days: 62, fix: { key: `breach:${linkedinBreach.id}`, category: 'breach', title: 'Change your LinkedIn password after the "LinkedIn (2012)" breach', accountId: A.linkedin, mutation: { op: 'resolve_breach', breachId: linkedinBreach.id, accountId: A.linkedin } } },
    { days: 41, fix: { key: `2fa:${A.github}`, category: '2fa', title: 'Turn on two-factor authentication for GitHub', accountId: A.github, mutation: { op: 'set_twofa', accountId: A.github, value: 'totp' } } },
    { days: 20, fix: { key: `perm:${A.scanner}:location`, category: 'permission', title: 'Revoke location access from DocScanner', accountId: A.scanner, mutation: null } },
    { days: 9, fix: { key: `2fa:${A.outlook}`, category: '2fa', title: 'Turn on two-factor authentication for Outlook / Microsoft', accountId: A.outlook, mutation: { op: 'set_twofa', accountId: A.outlook, value: 'totp' } } },
  ];
  // GitHub/Outlook start without 2FA (set above), LinkedIn breach starts open.
  let prev = recordSnapshot(db, userId, history[0].reason, tsAgo(history[0].days));
  for (const h of history.slice(1)) {
    if (h.fix.mutation) applyMutationDb(db, userId, h.fix.mutation);
    const after = recordSnapshot(db, userId, h.fix.title, tsAgo(h.days));
    logAction(db, userId, { ...h.fix, scoreBefore: prev.score, scoreAfter: after.score }, tsAgo(h.days));
    prev = after;
  }
  recordSnapshot(db, userId, 'Current state', null);

  insertNotification(db, userId, {
    type: 'system',
    title: 'Welcome to ExposeX',
    body: 'We loaded a sample footprint so you can explore. Head to the Fix checklist to see what to tackle first, or open the Graph to see how your accounts unlock each other.',
    createdAt: tsAgo(0),
  });
  return { accounts: Object.keys(A).length, risk: computeRisk(loadFootprint(db, userId), { blast: false }).overall };
}
