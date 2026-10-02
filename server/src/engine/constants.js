// Domain catalogs and tunable weights for the risk engine.
// Every weight lives here so the model can be calibrated in one place.

export const NODE_KINDS = ['account', 'phone', 'app'];

export const SERVICE_TYPES = {
  email: { label: 'Email', defaultImportance: 5 },
  identity: { label: 'Identity / SSO', defaultImportance: 5 },
  finance: { label: 'Finance & Banking', defaultImportance: 5 },
  government: { label: 'Government', defaultImportance: 5 },
  cloud: { label: 'Cloud Storage', defaultImportance: 4 },
  work: { label: 'Work & Productivity', defaultImportance: 4 },
  health: { label: 'Health', defaultImportance: 4 },
  dev: { label: 'Developer', defaultImportance: 4 },
  social: { label: 'Social Media', defaultImportance: 3 },
  communication: { label: 'Messaging', defaultImportance: 3 },
  shopping: { label: 'Shopping', defaultImportance: 3 },
  travel: { label: 'Travel', defaultImportance: 2 },
  entertainment: { label: 'Entertainment', defaultImportance: 2 },
  gaming: { label: 'Gaming', defaultImportance: 2 },
  carrier: { label: 'Mobile Carrier', defaultImportance: 5 },
  utility: { label: 'Utility App', defaultImportance: 2 },
  other: { label: 'Other', defaultImportance: 2 },
};

// Multiplier applied to an account's takeover likelihood.
export const TWOFA = {
  none: { label: 'None', factor: 1.0, block: 0.0 },
  email: { label: 'Email code', factor: 0.75, block: 0.2 },
  sms: { label: 'SMS code', factor: 0.55, block: 0.35 },
  push: { label: 'Push approval', factor: 0.35, block: 0.6 },
  totp: { label: 'Authenticator app', factor: 0.3, block: 0.7 },
  hardware: { label: 'Security key', factor: 0.12, block: 0.9 },
  passkey: { label: 'Passkey', factor: 0.1, block: 0.9 },
};
export const STRONG_2FA = ['push', 'totp', 'hardware', 'passkey'];

export const SIGN_IN_METHODS = {
  password: 'Password',
  passkey: 'Passkey',
  sso: 'Single sign-on',
  magic_link: 'Email magic link',
  sms_otp: 'SMS one-time code',
};

// Link semantics: compromise of SOURCE grants (some) control over TARGET.
export const LINK_TYPES = {
  recovery_email: { label: 'Recovery email', base: 0.85, desc: 'can reset the password of' },
  recovery_phone: { label: 'Recovery phone', base: 0.75, desc: 'can receive reset codes for' },
  sso: { label: 'Single sign-on', base: 0.95, desc: 'signs you in to' },
  oauth: { label: 'App access (OAuth)', base: 0.7, desc: 'holds access tokens to' },
  controls: { label: 'Controls', base: 0.8, desc: 'directly controls' },
  linked: { label: 'Linked / connected', base: 0.3, desc: 'is connected to' },
};

// Permissions that accounts and apps can hold. weight = privacy sensitivity (0..1),
// takeover = how much an OAuth app holding it can act as the account (0..1).
export const PERMISSIONS = {
  location: { label: 'Location', weight: 0.85, takeover: 0 },
  contacts: { label: 'Contacts', weight: 0.7, takeover: 0.1 },
  camera: { label: 'Camera', weight: 0.6, takeover: 0 },
  microphone: { label: 'Microphone', weight: 0.7, takeover: 0 },
  photos: { label: 'Photos & media', weight: 0.6, takeover: 0.05 },
  calendar: { label: 'Calendar', weight: 0.4, takeover: 0.05 },
  sms: { label: 'SMS messages', weight: 0.85, takeover: 0.6 },
  call_logs: { label: 'Call logs', weight: 0.7, takeover: 0 },
  health: { label: 'Health data', weight: 0.9, takeover: 0 },
  email_read: { label: 'Read email', weight: 0.9, takeover: 0.8 },
  email_send: { label: 'Send email', weight: 0.7, takeover: 0.5 },
  files: { label: 'Files & drive', weight: 0.6, takeover: 0.3 },
  payments: { label: 'Payments', weight: 0.85, takeover: 0.3 },
  social_post: { label: 'Post on your behalf', weight: 0.45, takeover: 0.35 },
  profile: { label: 'Basic profile', weight: 0.1, takeover: 0.02 },
  offline_access: { label: 'Offline access', weight: 0.3, takeover: 0.15 },
  bluetooth: { label: 'Bluetooth / nearby', weight: 0.25, takeover: 0 },
  notifications: { label: 'Notifications', weight: 0.05, takeover: 0 },
};

// Data a service holds about you. weight = sensitivity if leaked.
export const DATA_CLASSES = {
  email: { label: 'Email address', weight: 0.2 },
  phone: { label: 'Phone number', weight: 0.3 },
  name: { label: 'Full name', weight: 0.1 },
  dob: { label: 'Date of birth', weight: 0.4 },
  address: { label: 'Home address', weight: 0.5 },
  payment: { label: 'Payment cards', weight: 0.9 },
  financial: { label: 'Financial records', weight: 0.9 },
  government_id: { label: 'Government ID', weight: 1.0 },
  health: { label: 'Health records', weight: 0.9 },
  location_history: { label: 'Location history', weight: 0.7 },
  photos: { label: 'Photos', weight: 0.5 },
  contacts: { label: 'Contacts', weight: 0.5 },
  messages: { label: 'Private messages', weight: 0.8 },
  documents: { label: 'Documents', weight: 0.7 },
  biometrics: { label: 'Biometrics', weight: 1.0 },
  browsing: { label: 'Browsing / activity', weight: 0.4 },
  employer: { label: 'Employer info', weight: 0.2 },
  passwords: { label: 'Passwords', weight: 0.9 },
};

export const BREACH_SEVERITY = {
  low: 0.07,
  medium: 0.15,
  high: 0.25,
  critical: 0.35,
};

export const WEIGHTS = {
  base: 0.06,
  phoneBase: 0.14, // SIM-swap / port-out risk
  phoneWithPin: 0.05,
  appBase: 0.08,
  appUnused: 0.1,
  appPermEach: 0.04,
  reuseBase: 0.1,
  reusePerExtra: 0.04,
  reuseMaxExtra: 8,
  reuseBreached: 0.3, // a sibling in the reuse group has an open credential breach
  resolvedBreach: 0.03,
  dormant1y: 0.06,
  dormant2y: 0.1,
  passwordlessDiscount: 0.4, // passwordless sign-in removes most credential risk
  minP: 0.01,
  maxP: 0.97,
  unusedDays: 180,
  dormantDays: 365,
  structuralThreshold: 0.4, // conditional takeover prob counted as "reachable"
  spofMinDependents: 3,
};

export const RISK_LEVELS = [
  { level: 'critical', min: 60 },
  { level: 'high', min: 40 },
  { level: 'medium', min: 20 },
  { level: 'low', min: 0 },
];

export function riskLevel(score) {
  return RISK_LEVELS.find((r) => score >= r.min).level;
}
