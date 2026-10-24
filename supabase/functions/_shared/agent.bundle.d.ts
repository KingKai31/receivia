// Types for agent.bundle.js (generated from src/features/agent/server.ts by scripts/build-agent.mjs).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
export interface AgentEnv {
  anthropicKey?: string | null;
  resendKey?: string | null;
  whatsappToken?: string | null;
  whatsappPhoneId?: string | null;
  appBaseUrl: string;
  functionsUrl: string;
  signingSecret: string;
  fromEmail?: string;
  now?: Date;
}
type Db = SupabaseClient;
export function listOrgs(db: Db): Promise<string[]>;
export function loadProfile(db: Db, orgId: string): Promise<Record<string, unknown>>;
export function runPlan(db: Db, orgId: string, env: AgentEnv): Promise<unknown>;
export function runSend(
  db: Db,
  orgId: string,
  env: AgentEnv,
  opts?: { actionIds?: string[] },
): Promise<unknown>;
export function runBrief(db: Db, orgId: string, env: AgentEnv): Promise<unknown>;
export function runAll(
  db: Db,
  orgId: string,
  env: AgentEnv,
  trigger: string,
  opts?: { skipBrief?: boolean },
): Promise<{ status: string; steps: unknown[] }>;
export function approveAll(
  db: Db,
  orgId: string,
  day: string,
  by: string,
  env: AgentEnv,
): Promise<{ approved: number }>;
export function signApproval(
  c: { org: string; day: string; exp: number },
  secret: string,
): Promise<string>;
export function verifyApproval(
  token: string,
  secret: string,
  nowSec: number,
): Promise<{ org: string; day: string; exp: number } | null>;
export function draftMessage(
  facts: Record<string, unknown>,
  env: { anthropicKey?: string | null },
): Promise<{ subject: string; body: string; source: string; note: string }>;
