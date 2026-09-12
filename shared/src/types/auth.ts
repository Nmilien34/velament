export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
export interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}
