'use client';

import { useState, useEffect } from 'react';

export interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
  isTouchDevice: boolean;
}

export function useDevice(): DeviceInfo {
  const [device, setDevice] = useState<DeviceInfo>({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    width: 1200,
    height: 800,
    isTouchDevice: false,
  });

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const mobile = w < 768 || (touch && w < 1024);
      const tablet = !mobile && w < 1024;
      setDevice({
        isMobile: mobile,
        isTablet: tablet,
        isDesktop: !mobile && !tablet,
        width: w,
        height: h,
        isTouchDevice: touch,
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return device;
}
