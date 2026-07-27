import { useEffect, useRef, useState } from "react";

type Props = {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
};

export function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }
      } catch (e) {
        setError((e as Error).message || "Camera unavailable");
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function capture() {
    const v = videoRef.current;
    if (!v) return;
    const size = Math.min(v.videoWidth, v.videoHeight);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    // center-crop to square
    const sx = (v.videoWidth - size) / 2;
    const sy = (v.videoHeight - size) / 2;
    ctx.drawImage(v, sx, sy, size, size, 0, 0, size, size);
    onCapture(c.toDataURL("image/jpeg", 0.92));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg bg-[#0f0e0a] p-4 text-[#f2efe6]">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-xs tracking-[0.24em]">· TAKE PHOTO</div>
          <button onClick={onClose} className="font-mono text-xs opacity-70 hover:opacity-100">
            CLOSE ✕
          </button>
        </div>
        <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          {!ready && !error && (
            <div className="absolute inset-0 grid place-items-center font-mono text-xs">
              STARTING CAMERA…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center p-4 text-center font-mono text-xs text-red-300">
              {error}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-center gap-3">
          <button
            onClick={onClose}
            className="rounded-md border border-white/30 px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={capture}
            disabled={!ready}
            className="rounded-md bg-[#f2efe6] px-5 py-2 text-sm font-semibold text-[#17150f] disabled:opacity-40"
          >
            Capture ●
          </button>
        </div>
      </div>
    </div>
  );
}
