// Who signed in on the sign-in page. "firebase": an Identity Platform ID token, checked by firebase-admin (signature,
// audience = the project, expiry). "dev": the page sends a plain email and it is trusted; local runs only (config.ts
// refuses it on Cloud Run).
import { createHash } from "node:crypto";

export interface Identity {
  uid: string;
  email?: string;
}

export type VerifyIdentity = (proof: { idToken?: string; email?: string }) => Promise<Identity>;

export function firebaseIdentity(projectId?: string): VerifyIdentity {
  return async ({ idToken }) => {
    if (!idToken) throw new Error("no ID token");
    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const app = getApps()[0] ?? initializeApp(projectId ? { projectId } : undefined);
    const decoded = await getAuth(app).verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email };
  };
}

export const devIdentity: VerifyIdentity = async ({ email }) => {
  const clean = email?.trim().toLowerCase();
  if (!clean || !/^[^@\s]+@[^@\s]+$/.test(clean)) throw new Error("an email is needed");
  return { uid: `dev-${createHash("sha256").update(clean).digest("hex").slice(0, 20)}`, email: clean };
};
