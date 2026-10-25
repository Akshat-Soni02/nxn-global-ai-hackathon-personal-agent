// The Store on Firestore (Native mode). On Cloud Run the service account's credentials are found automatically;
// locally, FIRESTORE_EMULATOR_HOST=localhost:8081 points it at the emulator (`gcloud emulators firestore start`).
// A reservation is one transaction over the day and the month documents, so two calls at once can't both slip under
// a limit; settling is plain increments.
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, type Firestore, getFirestore } from "firebase-admin/firestore";
import {
  checkQuota,
  type Device,
  type DeviceCode,
  EMPTY_USAGE,
  periodKeys,
  type Store,
  settleDelta,
  type UsagePeriod,
  type User,
} from "./store.ts";

export function firestoreStore(projectId?: string): Store {
  const app = getApps()[0] ?? initializeApp(projectId ? { projectId } : undefined);
  const db: Firestore = getFirestore(app);
  const users = db.collection("users");
  const devices = db.collection("devices");
  const codes = db.collection("deviceCodes");
  const dayRef = (uid: string, day: string) => db.doc(`usage/${uid}/days/${day}`);
  const monthRef = (uid: string, month: string) => db.doc(`usage/${uid}/months/${month}`);
  const asUsage = (data: Record<string, unknown> | undefined): UsagePeriod => ({ ...EMPTY_USAGE, ...data });
  const increments = (delta: Partial<UsagePeriod>) =>
    Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, FieldValue.increment(v ?? 0)]));

  return {
    async getUser(uid) {
      const snap = await users.doc(uid).get();
      return snap.exists ? ({ uid, ...snap.data() } as User) : undefined;
    },
    async ensureUser(uid, email, now) {
      const ref = users.doc(uid);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          if (email) tx.update(ref, { email });
          return { uid, ...snap.data(), ...(email ? { email } : {}) } as User;
        }
        const user: Omit<User, "uid"> = { plan: "free", created: now, ...(email ? { email } : {}) };
        tx.set(ref, user);
        return { uid, ...user };
      });
    },
    async putDevice(device) {
      const { id, ...rest } = device;
      await devices.doc(id).set(rest);
    },
    async getDevice(id) {
      const snap = await devices.doc(id).get();
      return snap.exists ? ({ id, ...snap.data() } as Device) : undefined;
    },
    async touchDevice(id, now) {
      await devices
        .doc(id)
        .update({ lastSeen: now })
        .catch(() => {});
    },
    async deleteDevice(id) {
      await devices.doc(id).delete();
    },
    async putCode(code) {
      const { deviceCode, ...rest } = code;
      await codes.doc(deviceCode).set(rest);
    },
    async getCode(deviceCode) {
      const snap = await codes.doc(deviceCode).get();
      return snap.exists ? ({ deviceCode, ...snap.data() } as DeviceCode) : undefined;
    },
    async findCode(userCode) {
      const snap = await codes.where("userCode", "==", userCode).limit(1).get();
      const doc = snap.docs[0];
      return doc ? ({ deviceCode: doc.id, ...doc.data() } as DeviceCode) : undefined;
    },
    async approveCode(deviceCode, uid) {
      await codes.doc(deviceCode).update({ status: "approved", uid });
    },
    async deleteCode(deviceCode) {
      await codes.doc(deviceCode).delete();
    },
    async reserve(uid, kind, amount, limits, now) {
      const { day, month } = periodKeys(now);
      const dRef = dayRef(uid, day);
      const mRef = monthRef(uid, month);
      return db.runTransaction(async (tx) => {
        const [d, m] = await tx.getAll(dRef, mRef);
        const refused = checkQuota(kind, amount, asUsage(d?.data()), asUsage(m?.data()), limits, now);
        if (refused) return refused;
        const delta = increments(kind === "llm" ? { llmReservedMicroUsd: amount } : { toolReserved: amount });
        tx.set(dRef, delta, { merge: true });
        tx.set(mRef, delta, { merge: true });
        return { ok: true as const, ticket: { uid, day, month, kind, amount } };
      });
    },
    async settle(ticket, actual) {
      const delta = increments(settleDelta(ticket, actual));
      const batch = db.batch();
      batch.set(dayRef(ticket.uid, ticket.day), delta, { merge: true });
      batch.set(monthRef(ticket.uid, ticket.month), delta, { merge: true });
      await batch.commit();
    },
    async usage(uid, now) {
      const { day, month } = periodKeys(now);
      const [d, m] = await db.getAll(dayRef(uid, day), monthRef(uid, month));
      return { day: asUsage(d?.data()), month: asUsage(m?.data()), dayKey: day, monthKey: month };
    },
  };
}
