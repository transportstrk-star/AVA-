export interface Driver {
  id: string;
  name: string;
  bus: string;
  phone: string;
  pin: string;
  status: 'active' | 'locked';
}

export interface StageData {
  odometer: number;
  photo: string;
  gps: { lat: string; lng: string } | null;
  timestamp: number;
}

export interface Trip {
  id: string;
  driverId: string;
  driverName: string;
  bus: string;
  busSource: 'auto' | 'manual';
  assignedBus: string | null;
  startOdometer: number | null;
  endOdometer?: number | null;
  endedAt?: number | null;
  status: 'in_progress' | 'completed';
  stages: Record<string, StageData>;
  createdAt: number;
  completedAt: number | null;
  closedBy?: 'end_odo' | 'no_odo';
  closedEarly?: boolean;
}

export interface ExtraTrip {
  id: string;
  driverId: string;
  driverName: string;
  bus: string;
  startKm: number | null;
  endKm: number | null;
  distance: number | null;
  note: string;
  time: string;
  createdAt: number;
}

export interface Receipt {
  dataUrl: string;
  name: string;
  type: string;
  size: number;
  addedAt: number;
}

export interface Expense {
  id: string;
  driverId: string;
  driverName: string;
  bus: string;
  type: string;
  mode: 'calc' | 'direct';
  liters: number | null;
  unitPrice: number | null;
  amount: number;
  note: string;
  receipt: Receipt | null;
  createdAt: number;
}

export interface QueueItem {
  id: string;
  type: string;
  data?: any;
  tripId?: string;
  stageKey?: string;
  driverId?: string;
  queuedAt: number;
}

export interface FleetState {
  drivers: Driver[];
  trips: Trip[];
  extras: ExtraTrip[];
  expenses: Expense[];
  buses: string[];
}
