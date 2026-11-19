
const AGENT_URL = "http://127.0.0.1:8765";

let sessionToken: string | null = null;

export type AgentHealth = {
  status: string;
  operating_system: string;
  supported: boolean;
};

export async function checkAgentHealth(): Promise<AgentHealth> {
  const response = await fetch(`${AGENT_URL}/health`);

  if (!response.ok) {
    throw new Error("CyberGuard Agent is unavailable.");
  }

  return response.json();
}

export async function pairAgent(code: string): Promise<void> {
  const response = await fetch(`${AGENT_URL}/pair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code: code.trim() }),
  });

  if (!response.ok) {
    throw new Error("Invalid or expired pairing code.");
  }

  const data: { token: string } = await response.json();

  sessionToken = data.token;
}

export function isAgentPaired(): boolean {
  return sessionToken !== null;
}

export function disconnectAgent(): void {
  sessionToken = null;
}

export async function agentFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!sessionToken) {
    throw new Error("Pair your device with CyberGuard first.");
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${sessionToken}`);

  const response = await fetch(`${AGENT_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    disconnectAgent();
    throw new Error(
      "Your device pairing expired. Please reconnect."
    );
  }

  return response;
}
