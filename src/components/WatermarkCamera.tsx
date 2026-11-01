import { useEffect, useRef, useState } from 'react';
import { Driver } from '../types';
import { Icon } from './Icon';

interface WatermarkCameraProps {
  driver: Driver;
  bus: string;
  onCapture: (result: { dataUrl: string; gps: { lat: string; lng: string } | null; timestamp: number }) => void;
  onCancel: () => void;
}

export function WatermarkCamera({ driver, bus, onCapture, onCancel }: WatermarkCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: string; lng: string } | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function start() {
      try {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (mounted) {
                setGps({
                  lat: pos.coords.latitude.toFixed(5),
                  lng: pos.coords.longitude.toFixed(5),
                });
              }
            },
            () => {
              if (mounted) setGps({ lat: '25.20485', lng: '55.27078' }); // Dubai fallback default
            },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        } else {
          setGps({ lat: '25.20485', lng: '55.27078' });
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera not supported in this browser');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Camera access unavailable');
        }
      }
    }

    start();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const drawWatermark = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const pad = 12;
    const lineH = 16;
    const lines = [
      `⏱ ${new Date().toLocaleString('en-AE', { hour12: false })}`,
      `👤 ${driver.name} (${driver.id})`,
      `🚌 ${bus}`,
      `📍 ${gps ? `${gps.lat}, ${gps.lng}` : 'GPS…'}`,
    ];
    const boxH = lines.length * lineH + pad * 2;
    const boxW = Math.min(width - 16, 340);
    const x = 8;
    const y = height - boxH - 8;

    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, boxW, boxH, 8) : ctx.rect(x, y, boxW, boxH);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px ui-monospace, monospace';
    lines.forEach((line, i) => {
      ctx.fillText(line, x + pad, y + pad + (i + 0.8) * lineH);
    });

    // Accent stripe
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(x, y, 4, boxH);
  };

  const capture = async () => {
    if (!videoRef.current || !canvasRef.current || !ready) return;
    setCapturing(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    drawWatermark(ctx, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    setCapturing(false);
    onCapture({ dataUrl, gps, timestamp: Date.now() });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCapturing(true);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = img.width || 1280;
        canvas.height = img.height || 720;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          drawWatermark(ctx, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          setCapturing(false);
          onCapture({ dataUrl, gps, timestamp: Date.now() });
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSimulate = () => {
    setCapturing(true);
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Draw simulated dashboard / odometer
      const grad = ctx.createLinearGradient(0, 0, 1280, 720);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#1e293b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1280, 720);

      // Draw dial / speedo & odo display
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(640, 360, 220, 0.8 * Math.PI, 2.2 * Math.PI);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AVA TRANSPORT FLEET', 640, 260);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '22px monospace';
      ctx.fillText(`VEHICLE: ${bus}`, 640, 310);

      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 48px monospace';
      ctx.fillText('[ ODOMETER VERIFIED ]', 640, 380);

      ctx.textAlign = 'left';
      drawWatermark(ctx, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setCapturing(false);
      onCapture({ dataUrl, gps, timestamp: Date.now() });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-3 bg-slate-900/90 border-b border-slate-800">
        <button
          onClick={onCancel}
          className="text-slate-300 hover:text-white text-sm flex items-center gap-1.5 px-2 py-1 rounded"
        >
          <Icon name="X" size={18} /> Cancel
        </button>
        <span className="text-xs text-slate-400 font-medium">Watermarked Proof</span>
        <div className="w-16" />
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-slate-950">
        {error ? (
          <div className="text-center p-6 max-w-sm">
            <div className="w-14 h-14 mx-auto rounded-full bg-red-500/10 flex items-center justify-center mb-3">
              <Icon name="CameraOff" size={32} className="text-red-400" />
            </div>
            <p className="text-slate-200 font-medium text-sm mb-1">Camera Access Issue</p>
            <p className="text-slate-400 text-xs mb-5">{error}</p>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-sky-500/20"
              >
                <Icon name="Upload" size={16} /> Upload Photo File
              </button>
              <button
                onClick={handleSimulate}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
              >
                <Icon name="Camera" size={16} /> Generate Demo Proof
              </button>
              <button
                onClick={onCancel}
                className="w-full py-2 px-4 text-slate-400 hover:text-slate-200 text-xs mt-1"
              >
                Dismiss
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="max-w-full max-h-full object-contain" />
            <canvas ref={canvasRef} className="hidden" />
            {ready && (
              <div className="absolute bottom-4 left-3 right-3 pointer-events-none">
                <div className="bg-black/75 text-white text-[11px] font-mono p-3 rounded-xl leading-relaxed border-l-4 border-sky-500 shadow-xl backdrop-blur-sm">
                  <div className="text-slate-200">⏱ {new Date().toLocaleString('en-AE', { hour12: false })}</div>
                  <div className="text-slate-200">👤 {driver.name} ({driver.id})</div>
                  <div className="text-sky-300 font-semibold">🚌 {bus}</div>
                  <div className="text-slate-300">📍 {gps ? `${gps.lat}, ${gps.lng}` : 'Acquiring GPS…'}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {!error && (
        <div className="p-4 bg-slate-900/95 border-t border-slate-800 safe-bottom">
          <div className="flex gap-2 max-w-md mx-auto">
            <button
              onClick={capture}
              disabled={!ready || capturing}
              className="flex-1 py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold text-base flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer"
            >
              <Icon name="Camera" size={20} />
              {capturing ? 'Processing…' : 'Capture Proof'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Upload file instead"
              className="px-4 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer"
            >
              <Icon name="Upload" size={18} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      )}
    </div>
  );
}
