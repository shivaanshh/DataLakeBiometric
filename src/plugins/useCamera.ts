import { useState, useEffect } from 'react';
import { Camera, CameraDevice } from 'react-native-vision-camera';

/**
 * Returns the front camera device.
 * Only starts retrying AFTER permission is granted — prevents the hook from
 * exhausting all retries before the user has tapped "Allow" on the dialog.
 */
export function useCamera(hasPermission: boolean): CameraDevice | null {
  const [device, setDevice] = useState<CameraDevice | null>(null);

  useEffect(() => {
    if (!hasPermission) return;

    let alive    = true;
    let attempts = 0;
    const MAX    = 33; // 33 × 300 ms = ~10 s

    function pick(): CameraDevice | null {
      const list = Camera.getAvailableCameraDevices();
      return list.find(d => d.position === 'front') ?? list[0] ?? null;
    }

    function tryNow() {
      if (!alive) return;
      const d = pick();
      if (d) { setDevice(d); return; }
      if (++attempts < MAX) setTimeout(tryNow, 300);
    }

    // Subscribe to native change events (fires when Camera2 finishes init)
    const sub = Camera.addCameraDevicesChangedListener(devices => {
      if (!alive) return;
      const d = (devices as CameraDevice[]).find(d => d.position === 'front') ?? (devices as CameraDevice[])[0] ?? null;
      if (d) setDevice(d);
    });

    tryNow();
    return () => { alive = false; sub.remove(); };
  }, [hasPermission]); // restart the retry loop when permission changes false → true

  return device;
}
