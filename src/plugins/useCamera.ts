import { useEffect, useState } from 'react';
import { Camera, CameraDevice } from 'react-native-vision-camera';

const RETRY_INTERVAL = 300;
const MAX_RETRIES = 30;

export function useCamera(hasPermission: boolean): CameraDevice | null {
  const [device, setDevice] = useState<CameraDevice | null>(null);

  useEffect(() => {
    if (!hasPermission) return;

    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tryFind = () => {
      const devices = Camera.getAvailableCameraDevices();
      const front = devices.find(d => d.position === 'front') ?? devices[0] ?? null;
      if (front) {
        if (!cancelled) setDevice(front);
        return;
      }
      retries++;
      if (retries < MAX_RETRIES && !cancelled) {
        timer = setTimeout(tryFind, RETRY_INTERVAL);
      }
    };

    tryFind();

    const sub = Camera.addCameraDevicesChangedListener(({ addedCameraDevices }) => {
      if (cancelled) return;
      const front = addedCameraDevices.find(d => d.position === 'front') ?? addedCameraDevices[0];
      if (front) setDevice(front);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [hasPermission]);

  return device;
}
