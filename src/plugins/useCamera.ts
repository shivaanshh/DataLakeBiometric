import { useState, useEffect } from 'react';
import { Camera } from 'react-native-vision-camera';

type CameraDevice = ReturnType<typeof Camera.getAvailableCameraDevices>[number];

/**
 * Picks the front camera (falls back to any camera).
 * Only starts retrying AFTER permission is granted.
 * Retries every 300 ms for up to 10 seconds.
 */
export function useCamera(hasPermission: boolean): CameraDevice | null {
  const [device, setDevice] = useState<CameraDevice | null>(null);

  useEffect(() => {
    if (!hasPermission) return; // wait until permission granted

    let mounted  = true;
    let attempts = 0;
    const MAX    = 33; // 33 × 300 ms = ~10 s

    function pick(): CameraDevice | null {
      const list = Camera.getAvailableCameraDevices();
      return list.find(d => d.position === 'front') ?? list[0] ?? null;
    }

    function tryNow() {
      if (!mounted) return;
      const chosen = pick();
      if (chosen) { setDevice(chosen); return; }
      attempts++;
      if (attempts < MAX) setTimeout(tryNow, 300);
    }

    // Also subscribe to native change events
    const sub = Camera.addCameraDevicesChangedListener(newList => {
      if (!mounted) return;
      const chosen =
        (newList as CameraDevice[]).find(d => d.position === 'front') ??
        (newList as CameraDevice[])[0] ??
        null;
      if (chosen) setDevice(chosen);
    });

    tryNow();

    return () => { mounted = false; sub.remove(); };
  }, [hasPermission]); // restart when permission changes false→true

  return device;
}
