import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Driver, Expense, ExtraTrip, FleetState, Trip } from '../types';
import { loadState, saveState } from '../utils/storage';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map(p => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline, using local cache.');
    } else {
      console.warn('Firebase connection check:', error);
    }
    return false;
  }
}

// Subscribe to real-time updates for drivers, trips, extras, and expenses
export function syncWithFirestore(onStateUpdated: (updater: (prev: FleetState) => FleetState) => void): () => void {
  const unsubs: Unsubscribe[] = [];

  // 1. Drivers
  try {
    const driversCol = collection(db, 'drivers');
    const u1 = onSnapshot(
      driversCol,
      snapshot => {
        if (!snapshot.empty) {
          const list: Driver[] = [];
          snapshot.forEach(docSnap => {
            list.push(docSnap.data() as Driver);
          });
          onStateUpdated(prev => {
            const next = { ...prev, drivers: list };
            saveState(next);
            return next;
          });
        }
      },
      err => {
        handleFirestoreError(err, OperationType.LIST, 'drivers');
      }
    );
    unsubs.push(u1);
  } catch (e) {
    console.warn('Failed to attach drivers listener:', e);
  }

  // 2. Trips
  try {
    const tripsCol = collection(db, 'trips');
    const u2 = onSnapshot(
      tripsCol,
      snapshot => {
        if (!snapshot.empty) {
          const list: Trip[] = [];
          snapshot.forEach(docSnap => {
            list.push(docSnap.data() as Trip);
          });
          onStateUpdated(prev => {
            const next = { ...prev, trips: list };
            saveState(next);
            return next;
          });
        }
      },
      err => {
        handleFirestoreError(err, OperationType.LIST, 'trips');
      }
    );
    unsubs.push(u2);
  } catch (e) {
    console.warn('Failed to attach trips listener:', e);
  }

  // 3. Extras
  try {
    const extrasCol = collection(db, 'extras');
    const u3 = onSnapshot(
      extrasCol,
      snapshot => {
        if (!snapshot.empty) {
          const list: ExtraTrip[] = [];
          snapshot.forEach(docSnap => {
            list.push(docSnap.data() as ExtraTrip);
          });
          onStateUpdated(prev => {
            const next = { ...prev, extras: list };
            saveState(next);
            return next;
          });
        }
      },
      err => {
        handleFirestoreError(err, OperationType.LIST, 'extras');
      }
    );
    unsubs.push(u3);
  } catch (e) {
    console.warn('Failed to attach extras listener:', e);
  }

  // 4. Expenses
  try {
    const expensesCol = collection(db, 'expenses');
    const u4 = onSnapshot(
      expensesCol,
      snapshot => {
        if (!snapshot.empty) {
          const list: Expense[] = [];
          snapshot.forEach(docSnap => {
            list.push(docSnap.data() as Expense);
          });
          onStateUpdated(prev => {
            const next = { ...prev, expenses: list };
            saveState(next);
            return next;
          });
        }
      },
      err => {
        handleFirestoreError(err, OperationType.LIST, 'expenses');
      }
    );
    unsubs.push(u4);
  } catch (e) {
    console.warn('Failed to attach expenses listener:', e);
  }

  return () => {
    unsubs.forEach(u => u());
  };
}

// Sync helper mutations to Firestore
export async function syncDriverToFirestore(driver: Driver): Promise<void> {
  const path = `drivers/${driver.id}`;
  try {
    await setDoc(doc(db, 'drivers', driver.id), driver);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteDriverFromFirestore(driverId: string): Promise<void> {
  const path = `drivers/${driverId}`;
  try {
    await deleteDoc(doc(db, 'drivers', driverId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncTripToFirestore(trip: Trip): Promise<void> {
  const path = `trips/${trip.id}`;
  try {
    // Sanitize heavy base64 photos if they exceed 800KB to stay safely under Firestore 1MB document limit
    const cleanStages: Record<string, any> = {};
    Object.entries(trip.stages || {}).forEach(([k, v]) => {
      cleanStages[k] = {
        odometer: v.odometer,
        timestamp: v.timestamp,
        gps: v.gps,
        photo: (v.photo && v.photo.length > 500000) ? v.photo.slice(0, 100) + '...[large]' : (v.photo || ''),
      };
    });
    const payload = {
      ...trip,
      stages: cleanStages,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'trips', trip.id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteTripFromFirestore(tripId: string): Promise<void> {
  const path = `trips/${tripId}`;
  try {
    await deleteDoc(doc(db, 'trips', tripId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncExtraToFirestore(extra: ExtraTrip): Promise<void> {
  const path = `extras/${extra.id}`;
  try {
    await setDoc(doc(db, 'extras', extra.id), {
      ...extra,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteExtraFromFirestore(extraId: string): Promise<void> {
  const path = `extras/${extraId}`;
  try {
    await deleteDoc(doc(db, 'extras', extraId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncExpenseToFirestore(expense: Expense): Promise<void> {
  const path = `expenses/${expense.id}`;
  try {
    // Sanitize receipt dataUrl if huge
    let cleanReceipt = expense.receipt;
    if (cleanReceipt && cleanReceipt.dataUrl && cleanReceipt.dataUrl.length > 500000) {
      cleanReceipt = {
        ...cleanReceipt,
        dataUrl: cleanReceipt.dataUrl.slice(0, 100) + '...[stored_locally]',
      };
    }
    await setDoc(doc(db, 'expenses', expense.id), {
      ...expense,
      receipt: cleanReceipt,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteExpenseFromFirestore(expenseId: string): Promise<void> {
  const path = `expenses/${expenseId}`;
  try {
    await deleteDoc(doc(db, 'expenses', expenseId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// Initial upload of existing local state if Firestore is empty
export async function seedInitialFirestoreData(): Promise<void> {
  const local = loadState();
  for (const d of local.drivers) {
    try {
      await setDoc(doc(db, 'drivers', d.id), d);
    } catch {
      // ignore
    }
  }
}
