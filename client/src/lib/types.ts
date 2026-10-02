export type Level = 'critical' | 'high' | 'medium' | 'low';
export type Kind = 'account' | 'phone' | 'app';

export interface User {
  id: number;
  email: string;
  name: string;
  reviewIntervalDays: number;
  breachSimMinutes: number;
  lastReviewAt: string | null;
  createdAt: string;
}

export interface Account {
  id: number;
  kind: Kind;
  name: string;
  serviceType: string;
  domain: string | null;
  identifier: string | null;
  importance: number;
  twofa: string;
  signInMethods: string[];
  passwordGroupId: number | null;
  permissions: string[];
  dataShared: string[];
  carrierPin: boolean;
  lastActive: string | null;
  memberSince: string | null;
  notes: string | null;
  status: 'active' | 'deleted';
}

export interface EnrichedAccount extends Account {
  risk: number;
  level: Level;
  P: number;
  p: number;
  inherited: number;
  impact: number;
  spof: boolean;
  blastCount: number;
  inactiveDays: number | null;
  activity: 'active30' | 'active90' | 'stale' | 'dormant' | 'unknown';
  passwordGroup: { id: number; label: string; size: number } | null;
  reused: boolean;
}

export interface Factor {
  key: string;
  label: string;
  value: number;
}

export interface PathStep {
  from: number;
  to: number;
  type: string;
  fromName?: string;
  toName?: string;
}

export interface Dependent {
  id: number;
  prob: number;
  path: PathStep[];
  name?: string;
}

export interface RiskNode {
  id: number;
  name: string;
  kind: Kind;
  serviceType: string;
  importance: number;
  twofa: string;
  p: number;
  P: number;
  inherited: number;
  impact: number;
  risk: number;
  level: Level;
  factors: Factor[];
  inbound: { linkId: number; fromId: number; fromName?: string; type: string; t: number; contribution: number }[];
  outboundCount: number;
  blast: { count: number; impact: number; dependents: Dependent[] } | null;
  spof: boolean;
}

export interface Link {
  id: number;
  sourceId: number;
  targetId: number;
  type: string;
}

export interface Breach {
  id: number;
  accountId: number;
  accountName?: string;
  title: string;
  breachDate: string | null;
  dataClasses: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: 'manual' | 'catalog' | 'simulated';
  status: 'open' | 'resolved';
  resolvedAt: string | null;
  createdAt: string;
}

export interface BreachAnalysis {
  account: { id: number; name: string; kind: Kind };
  exposedData: string[];
  affected: { id: number; name: string; kind: Kind; prob: number; reason: string; path: PathStep[]; channel: 'link' | 'reuse' | 'both' }[];
  reuseSiblings: { id: number; name: string }[];
  steps: { text: string; urgent: boolean; accountId?: number }[];
}

export interface Fix {
  key: string;
  category: 'breach' | '2fa' | 'password' | 'permission' | 'cleanup' | 'phone' | 'recovery';
  effort: number;
  accountId: number;
  title: string;
  detail: string;
  gain: number;
  reduction: number;
  scoreAfter: number;
  rank: number;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  op?: string;
}

export interface ActionLog {
  id: number;
  key: string;
  category: string;
  title: string;
  accountId: number | null;
  scoreBefore: number;
  scoreAfter: number;
  createdAt: string;
}

export interface Overall {
  score: number;
  scoreExact: number;
  securityRisk: number;
  privacyExposure: number;
  hygieneGap: number;
  totalRisk: number;
  counts: Record<Level, number> & { total: number; no2fa: number; reused: number; spofs: number };
}

export interface Snapshot {
  id: number;
  score: number;
  securityRisk: number;
  privacyExposure: number;
  reason: string | null;
  createdAt: string;
}

export interface Notification {
  id: number;
  type: 'breach' | 'reminder' | 'tip' | 'system';
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

export interface Group {
  id: number;
  label: string;
  size: number;
}

export interface Meta {
  serviceTypes: Record<string, { label: string; defaultImportance: number }>;
  twofa: Record<string, { label: string; factor: number; block: number }>;
  strong2fa: string[];
  signInMethods: Record<string, string>;
  linkTypes: Record<string, { label: string; base: number; desc: string }>;
  permissions: Record<string, { label: string; weight: number; takeover: number }>;
  dataClasses: Record<string, { label: string; weight: number }>;
  thresholds: { unusedDays: number; dormantDays: number };
}

export interface Dashboard {
  overall: Overall;
  riskiest: { id: number; name: string; kind: Kind; serviceType: string; risk: number; level: Level; P: number; reason: string }[];
  spofs: { id: number; name: string; kind: Kind; serviceType: string; risk: number; level: Level; P: number; twofa: string; count: number; impact: number; dependents: { id: number; name: string; prob: number }[] }[];
  topFixes: Fix[];
  fixCount: number;
  potentialScore: number;
  history: Snapshot[];
  recentActions: ActionLog[];
  openBreaches: number;
  unread: number;
  byType: { type: string; count: number; avgRisk: number }[];
  user: User;
}

export interface GraphNode {
  id: number;
  name: string;
  kind: Kind;
  serviceType: string;
  twofa: string;
  importance: number;
  passwordGroupId: number | null;
  risk: number;
  level: Level;
  p: number;
  P: number;
  inherited: number;
  spof: boolean;
  blastCount: number;
  dependents: Dependent[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: (Link & { t: number })[];
  groups: Group[];
  overall: Overall;
}
