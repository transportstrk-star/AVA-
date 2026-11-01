import { Driver, FleetState, QueueItem, Receipt, Trip } from '../types';

export const ADMIN_PASS = 'admin123';
export const STORAGE_KEY = 'fleetshift_v1';
export const QUEUE_KEY = 'fleetshift_queue_v1';

export const SEED_DRIVERS: Driver[] = [
  { id: 'DRV-1001', name: 'Ahmed Al-Mansoori', bus: 'DXB-4821', phone: '+971501234001', pin: '1001', status: 'active' },
  { id: 'DRV-1002', name: 'Mohammed Hassan', bus: 'SHJ-3190', phone: '+971501234002', pin: '1002', status: 'active' },
  { id: 'DRV-1003', name: 'Fatima Al-Kaabi', bus: 'AUH-7742', phone: '+971501234003', pin: '1003', status: 'active' },
  { id: 'DRV-1004', name: 'Rajesh Kumar', bus: 'DXB-5518', phone: '+971501234004', pin: '1004', status: 'locked' },
];

export const STAGES = [
  { id: 1, key: 'start', title: 'Before Trip Start', subtitle: 'Record starting odometer & photo', icon: 'Play' },
  { id: 2, key: 'dest', title: 'Reached Destination', subtitle: 'Arrival / parking odometer', icon: 'MapPin' },
  { id: 3, key: 'returnStart', title: 'Before Return Start', subtitle: 'Odometer before return leg', icon: 'RotateCcw' },
  { id: 4, key: 'final', title: 'Final Return Parking', subtitle: 'Complete shift & sync', icon: 'Flag' },
];

export function loadState(): FleetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.drivers) {
        parsed.drivers = parsed.drivers.map((d: any) => ({
          ...d,
          pin: d.pin || (d.id && d.id.replace(/\D/g, '').slice(-4)) || '0000',
        }));
      }
      return {
        drivers: parsed.drivers || SEED_DRIVERS,
        trips: parsed.trips || [],
        extras: parsed.extras || [],
        expenses: parsed.expenses || [],
        buses: parsed.buses || ['DXB-4821', 'SHJ-3190', 'AUH-7742', 'DXB-5518', 'DXB-2201', 'AUH-8800'],
      };
    }
  } catch (e) {
    console.error('Error loading state:', e);
  }
  return {
    drivers: SEED_DRIVERS,
    trips: [],
    extras: [],
    expenses: [],
    buses: ['DXB-4821', 'SHJ-3190', 'AUH-7742', 'DXB-5518', 'DXB-2201', 'AUH-8800'],
  };
}

export function saveState(state: FleetState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('LocalStorage save failed:', e);
    return false;
  }
}

export function loadQueue(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveQueue(q: QueueItem[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch (e) {
    console.warn('Save queue failed:', e);
  }
}

export function uid(prefix = 'ID'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatDate(ts?: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-AE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatKm(n?: number | string | null): string {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('en') + ' km';
}

export function daysAgo(ts: number): number {
  return (Date.now() - ts) / (1000 * 60 * 60 * 24);
}

export function shiftDistance(trip?: Trip | null): number | null {
  if (!trip) return null;
  const s = trip.stages || {};
  const first = trip.startOdometer != null
    ? Number(trip.startOdometer)
    : (s.start ? Number(s.start.odometer) : null);
  const last = trip.endOdometer != null
    ? Number(trip.endOdometer)
    : (s.final ? Number(s.final.odometer) : null);
  if (first == null || last == null || isNaN(first) || isNaN(last)) return null;
  return Math.max(0, last - first);
}

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MAX_CHARS = 1200000;
export const RECEIPT_ACCEPT = 'image/*,application/pdf';

export function formatBytes(n?: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('Could not read file'));
      fr.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });
}

export function canvasUsable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext && c.getContext('2d') && c.toDataURL);
  } catch (e) {
    return false;
  }
}

export function shrinkImage(dataUrl: string, maxDim = 1400, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    if (!canvasUsable()) return resolve(dataUrl);
    let settled = false;
    const finish = (v: string) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    setTimeout(() => finish(dataUrl), 1500);
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round((img.width || maxDim) * scale);
          canvas.height = Math.round((img.height || maxDim) * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) return finish(dataUrl);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          finish(dataUrl);
        }
      };
      img.onerror = () => finish(dataUrl);
      img.src = dataUrl;
    } catch (e) {
      finish(dataUrl);
    }
  });
}

export async function fileToReceipt(file: File): Promise<Receipt> {
  const name = file.name || 'receipt';
  const type = file.type || '';
  const size = file.size || 0;

  if (!file) throw new Error('No file selected');
  if (size > RECEIPT_MAX_BYTES) {
    throw new Error(`Receipt is ${formatBytes(size)} — the limit is ${formatBytes(RECEIPT_MAX_BYTES)}`);
  }
  const isImage = type.startsWith('image/');
  const isPdf = type === 'application/pdf';
  if (!isImage && !isPdf) {
    throw new Error('Attach a photo or a PDF');
  }

  let dataUrl = await readFileAsDataUrl(file);

  if (isImage) {
    for (const [dim, q] of [[1400, 0.82], [1200, 0.65], [1000, 0.5]]) {
      const candidate = await shrinkImage(dataUrl, dim, q);
      dataUrl = candidate;
      if (dataUrl.length <= RECEIPT_MAX_CHARS) break;
    }
  }

  if (dataUrl.length > RECEIPT_MAX_CHARS * 1.6) {
    throw new Error('Receipt is too large to store — try a smaller photo');
  }

  return {
    dataUrl,
    name,
    type: isPdf ? 'application/pdf' : (type || 'image/*'),
    size,
    addedAt: Date.now(),
  };
}

export function lastOdometerForBus(state: FleetState, bus?: string): number | null {
  if (!bus) return null;
  const target = String(bus).trim().toUpperCase();
  let last: number | null = null;
  ((state && state.trips) || []).forEach(t => {
    if (String(t.bus || '').trim().toUpperCase() !== target) return;
    const nums: number[] = [];
    if (t.startOdometer != null) nums.push(Number(t.startOdometer));
    if (t.endOdometer != null) nums.push(Number(t.endOdometer));
    Object.values(t.stages || {}).forEach(st => {
      if (st && st.odometer != null) nums.push(Number(st.odometer));
    });
    nums.forEach(n => {
      if (!isNaN(n) && (last == null || n > last)) last = n;
    });
  });
  return last;
}
