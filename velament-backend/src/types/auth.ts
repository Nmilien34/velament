export type AuthProvider = "google" | "github";
export interface VerifiedIdentity {
  provider: AuthProvider;
  subject: string;
  email: string;
  name: string;
}
