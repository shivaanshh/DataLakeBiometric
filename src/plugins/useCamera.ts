import { useState, useEffect } from 'react';
import { Camera } from 'react-native-vision-camera';

type CameraDevice = ReturnType<typeof Camera.getAvailableCameraDevices>[number];

/**
 * Reliably picks the front camera (falls back to any camera).
 * Retries every 300 ms for up to 8 seconds because on Samsung/One-UI the
 * Camera2 device list is populated asynchronously after the component mounts.
 */
export function useCamera(): { device: CameraDevice | null; ready: boolean } {
  const [device, setDevice] = useState<CameraDevice | null>(null);

  useEffect(() => {
    let mounted  = true;
    let attempts = 0;
    const MAX    = 27; // 27 × 300 ms = ~8 s

    function pick(list: CameraDevice[]): CameraDevice | null {
      return list.find(d => d.position === 'front') ?? list[0] ?? null;
    }

    function tryNow() {
      if (!mounted) return;
      const list   = Camera.getAvailableCameraDevices();
      const chosen = pick(list);
      if (chosen) {
        setDevice(chosen);
        return;
      }
      attempts++;
      if (attempts < MAX) setTimeout(tryNow, 300);
    }

    // Subscribe to changes (fires when native init completes)
    const sub = Camera.addCameraDevicesChangedListener(list => {
      if (!mounted) return;
      const chosen = pick(list as CameraDevice[]);
      if (chosen) setDevice(chosen);
    });

    tryNow();

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return { device, ready: device !== null };
}
