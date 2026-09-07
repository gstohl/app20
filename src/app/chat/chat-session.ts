import type { MailKeypair } from "@/lib/mail";

type ChatSession = { scope: string; keypair: MailKeypair; seed: Uint8Array };
let session: ChatSession | null = null;

function copy(value: ChatSession): ChatSession {
  return { scope: value.scope, seed: value.seed.slice(), keypair: {
    publicKey: value.keypair.publicKey.slice(), privateKey: value.keypair.privateKey.slice(),
  } };
}

/** Memory only: navigation reuses an explicitly unlocked key until logout. */
export function rememberChatSession(value: ChatSession): void {
  clearChatSession();
  session = copy(value);
}

export function restoreChatSession(scope: string): ChatSession | null {
  if (!session) return null;
  if (session.scope !== scope) { clearChatSession(); return null; }
  return copy(session);
}

export function clearChatSession(): void {
  session?.seed.fill(0);
  session?.keypair.privateKey.fill(0);
  session = null;
}
