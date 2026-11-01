import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { auth } from './firebase';
import { FleetState } from '../types';
import { formatDate } from '../utils/storage';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const provider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach(scope => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Workspace Auth');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// ----------------------------------------------------
// GOOGLE SHEETS INTEGRATION
// ----------------------------------------------------

export interface ExportSheetsResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  rowsWritten: number;
}

export async function exportToGoogleSheets(state: FleetState): Promise<ExportSheetsResult> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not connected to Google Workspace. Please sign in with Google first.');
  }

  const title = `AVA Transport — FleetShift Logs (${new Date().toLocaleDateString('en-AE')})`;

  // Step 1: Create Spreadsheet with multiple tabs
  const createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Fleet Summary' } },
        { properties: { title: 'Trips & Shifts' } },
        { properties: { title: 'Extra Trips' } },
        { properties: { title: 'Fuel & Expenses' } },
        { properties: { title: 'Drivers Roster' } },
      ],
    }),
  });

  if (!createResp.ok) {
    const errText = await createResp.text();
    throw new Error(`Failed to create Google Sheet: ${errText}`);
  }

  const sheetData = await createResp.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl = sheetData.spreadsheetUrl;

  // Step 2: Prepare rows for each tab
  // 1. Summary
  const totalTrips = state.trips.length;
  const completedTrips = state.trips.filter(t => t.status === 'completed').length;
  const totalKm = state.trips.reduce((acc, t) => {
    if (t.startOdometer != null && t.endOdometer != null) {
      return acc + Math.max(0, t.endOdometer - t.startOdometer);
    }
    return acc;
  }, 0);
  const totalExpenses = state.expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  const totalFuelLiters = state.expenses.filter(e => e.type === 'Fuel').reduce((acc, e) => acc + (Number(e.liters) || 0), 0);

  const summaryValues = [
    ['AVA Transport FleetShift — Summary & KPI Audit', ''],
    ['Generated At', new Date().toLocaleString()],
    ['Active Drivers', state.drivers.filter(d => d.status === 'active').length],
    ['Total Registered Buses', state.buses.length],
    ['Total Shifts Recorded', totalTrips],
    ['Completed Shifts', completedTrips],
    ['Total Shift Kilometers', `${totalKm.toLocaleString()} km`],
    ['Total Extra Trips', state.extras.length],
    ['Total Expenses (AED)', `AED ${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
    ['Total Fuel Consumed', `${totalFuelLiters.toLocaleString()} Liters`],
  ];

  // 2. Trips
  const tripHeaders = [
    'Trip ID',
    'Driver ID',
    'Driver Name',
    'Bus Number',
    'Status',
    'Start Odometer (km)',
    'End Odometer (km)',
    'Total Distance (km)',
    'Created At',
    'Completed At',
    'Closed By',
  ];
  const tripValues = [
    tripHeaders,
    ...state.trips.map(t => [
      t.id,
      t.driverId,
      t.driverName,
      t.bus,
      t.status.toUpperCase(),
      t.startOdometer ?? '—',
      t.endOdometer ?? '—',
      t.startOdometer != null && t.endOdometer != null ? Math.max(0, t.endOdometer - t.startOdometer) : '—',
      formatDate(t.createdAt),
      formatDate(t.completedAt),
      t.closedBy || (t.status === 'completed' ? 'End Odo' : 'In Progress'),
    ]),
  ];

  // 3. Extras
  const extraHeaders = [
    'Extra ID',
    'Driver ID',
    'Driver Name',
    'Bus Number',
    'Start Km',
    'End Km',
    'Distance (km)',
    'Time',
    'Note / Reason',
    'Created At',
  ];
  const extraValues = [
    extraHeaders,
    ...state.extras.map(x => [
      x.id,
      x.driverId,
      x.driverName,
      x.bus,
      x.startKm ?? '—',
      x.endKm ?? '—',
      x.distance ?? (x.startKm != null && x.endKm != null ? Math.max(0, x.endKm - x.startKm) : '—'),
      x.time || '—',
      x.note || '—',
      formatDate(x.createdAt),
    ]),
  ];

  // 4. Expenses
  const expenseHeaders = [
    'Expense ID',
    'Driver Name',
    'Bus Number',
    'Expense Type',
    'Mode',
    'Liters',
    'Unit Price (AED)',
    'Total Amount (AED)',
    'Note',
    'Receipt File Attached',
    'Created At',
  ];
  const expenseValues = [
    expenseHeaders,
    ...state.expenses.map(e => [
      e.id,
      e.driverName,
      e.bus,
      e.type,
      e.mode === 'calc' ? 'Liters Calculation' : 'Direct Amount',
      e.liters ?? '—',
      e.unitPrice ?? '—',
      Number(e.amount || 0).toFixed(2),
      e.note || '—',
      e.receipt ? `${e.receipt.name} (${(e.receipt.size / 1024).toFixed(1)} KB)` : 'No',
      formatDate(e.createdAt),
    ]),
  ];

  // 5. Drivers
  const driverHeaders = ['Driver ID', 'Name', 'Assigned Bus', 'Phone', 'PIN', 'Status'];
  const driverValues = [
    driverHeaders,
    ...state.drivers.map(d => [d.id, d.name, d.bus, d.phone, '••••', d.status.toUpperCase()]),
  ];

  // Step 3: Write batch values
  const batchResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: "'Fleet Summary'!A1", values: summaryValues },
          { range: "'Trips & Shifts'!A1", values: tripValues },
          { range: "'Extra Trips'!A1", values: extraValues },
          { range: "'Fuel & Expenses'!A1", values: expenseValues },
          { range: "'Drivers Roster'!A1", values: driverValues },
        ],
      }),
    }
  );

  if (!batchResp.ok) {
    const errText = await batchResp.text();
    throw new Error(`Failed to populate Google Sheet rows: ${errText}`);
  }

  const totalRows =
    summaryValues.length + tripValues.length + extraValues.length + expenseValues.length + driverValues.length;

  return {
    spreadsheetId,
    spreadsheetUrl,
    rowsWritten: totalRows,
  };
}

// ----------------------------------------------------
// GOOGLE DRIVE INTEGRATION
// ----------------------------------------------------

export interface BackupDriveResult {
  folderId: string;
  folderUrl: string;
  filesUploaded: number;
}

export async function backupToGoogleDrive(
  state: FleetState,
  onProgress?: (step: string) => void
): Promise<BackupDriveResult> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not connected to Google Workspace. Please sign in with Google first.');
  }

  onProgress?.('Searching or creating Google Drive folder...');

  // Step 1: Check or create folder "FleetShift AVA Transport Backups"
  const folderName = 'AVA Transport FleetShift Cloud Vault';
  const query = encodeURIComponent(`name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  let folderId = '';
  let folderUrl = '';

  if (listResp.ok) {
    const listData = await listResp.json();
    if (listData.files && listData.files.length > 0) {
      folderId = listData.files[0].id;
      folderUrl = listData.files[0].webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
    }
  }

  if (!folderId) {
    const folderResp = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Automated backups and receipts vault for AVA Transport FleetShift',
      }),
    });
    if (!folderResp.ok) {
      throw new Error(`Failed to create Google Drive folder: ${await folderResp.text()}`);
    }
    const folderData = await folderResp.json();
    folderId = folderData.id;
    folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  }

  let filesUploaded = 0;

  // Step 2: Upload JSON Snapshot
  onProgress?.('Uploading Fleet JSON snapshot database...');
  const snapshotJson = JSON.stringify(state, null, 2);
  const metadata = {
    name: `FleetShift_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    parents: [folderId],
    mimeType: 'application/json',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([snapshotJson], { type: 'application/json' }));

  const uploadResp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );
  if (uploadResp.ok) {
    filesUploaded++;
  }

  // Step 3: Upload expense receipt attachments to Drive
  const receiptsToUpload = state.expenses.filter(e => e.receipt && e.receipt.dataUrl && e.receipt.dataUrl.startsWith('data:'));
  for (let i = 0; i < Math.min(receiptsToUpload.length, 10); i++) {
    const exp = receiptsToUpload[i];
    onProgress?.(`Uploading receipt ${i + 1}/${Math.min(receiptsToUpload.length, 10)} (${exp.bus} - ${exp.type})...`);

    try {
      const dataUrl = exp.receipt!.dataUrl;
      const mime = exp.receipt!.type || 'image/jpeg';
      const ext = mime.includes('pdf') ? 'pdf' : 'jpg';
      const cleanFileName = `receipt_${exp.bus}_${exp.type}_${exp.id}.${ext}`;

      // Convert data URL to Blob
      const base64Content = dataUrl.split(',')[1];
      if (!base64Content) continue;
      const byteChars = atob(base64Content);
      const byteNumbers = new Array(byteChars.length);
      for (let j = 0; j < byteChars.length; j++) {
        byteNumbers[j] = byteChars.charCodeAt(j);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mime });

      const fileMeta = {
        name: cleanFileName,
        parents: [folderId],
        mimeType: mime,
      };

      const fileForm = new FormData();
      fileForm.append('metadata', new Blob([JSON.stringify(fileMeta)], { type: 'application/json' }));
      fileForm.append('file', blob);

      const fResp = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fileForm,
        }
      );
      if (fResp.ok) {
        filesUploaded++;
      }
    } catch (e) {
      console.warn('Could not upload receipt to drive:', e);
    }
  }

  return {
    folderId,
    folderUrl,
    filesUploaded,
  };
}
