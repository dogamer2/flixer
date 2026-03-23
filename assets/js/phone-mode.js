(function () {
  function isTvMode() {
    try {
      if (localStorage.getItem("flixer_tv_mode") === "1") return true;
    } catch (error) {}

    var ua = navigator.userAgent || "";
    return /GoogleTV|Android TV|SMART-TV|AFT|BRAVIA|TV\b/i.test(ua);
  }

  function shouldUsePhoneMode() {
    if (isTvMode()) return false;

    var width = Math.min(window.innerWidth || 0, screen.width || 0) || window.innerWidth || 0;
    var ua = navigator.userAgent || "";
    var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    var touchCapable = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
    var mobileUa = /iPhone|Android.+Mobile|Mobile Safari|Pixel|SamsungBrowser|Mobile\b/i.test(ua);

    return width <= 768 && (coarse || touchCapable || mobileUa);
  }

  function applyPhoneMode() {
    document.documentElement.classList.toggle("phone-mode", shouldUsePhoneMode());
  }

  applyPhoneMode();
  window.addEventListener("resize", applyPhoneMode, { passive: true });
  window.addEventListener("orientationchange", applyPhoneMode, { passive: true });
})();
