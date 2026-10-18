/** Coarse browser-reported categories only. Never persist the raw user-agent string. */
export function describePresenceDevice(userAgent: string): { os: string; device: string } {
 if (/iPad/i.test(userAgent)) return { os: 'iOS', device: 'Tablet' };
 if (/iPhone|iPod/i.test(userAgent)) return { os: 'iOS', device: 'Mobile' };
 if (/Android/i.test(userAgent)) return { os: 'Android', device: /Mobile/i.test(userAgent) ? 'Mobile' : 'Tablet' };
 if (/CrOS/i.test(userAgent)) return { os: 'ChromeOS', device: 'Computer' };
 if (/Windows NT/i.test(userAgent)) return { os: 'Windows', device: 'Computer' };
 if (/Macintosh|Mac OS X/i.test(userAgent)) return { os: 'macOS', device: 'Computer' };
 if (/Linux|X11/i.test(userAgent)) return { os: 'Linux', device: 'Computer' };
 return { os: 'Unknown', device: 'Unknown' };
}
