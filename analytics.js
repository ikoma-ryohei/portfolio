(() => {
  // GA4: set the web data stream's measurement ID here (G-XXXXXXXXXX).
  const measurementId = "";
  const localHosts = ["localhost", "127.0.0.1", "[::1]"];

  if (
    !/^G-[A-Z0-9]+$/.test(measurementId) ||
    !["http:", "https:"].includes(window.location.protocol) ||
    localHosts.includes(window.location.hostname)
  ) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  // GA4 sends the initial page_view automatically with this config command.
  window.gtag("config", measurementId);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
})();
