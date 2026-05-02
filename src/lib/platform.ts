export const isMac = (): boolean => {
  const ua = navigator.userAgent || "";
  const plat = (navigator.platform || "").toLowerCase();
  return /mac/i.test(ua) || plat.includes("mac");
};
