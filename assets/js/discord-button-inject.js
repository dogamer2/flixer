(() => {
  const DISCORD_INVITE_URL = "https://discord.gg/v87gDSVK5x";

  function discordIcon(className) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="' +
      className +
      '"><path d="M20.317 4.369A19.791 19.791 0 0 0 15.885 3c-.191.328-.403.775-.553 1.124a18.27 18.27 0 0 0-5.134 0A11.713 11.713 0 0 0 9.645 3a19.736 19.736 0 0 0-4.433 1.369C2.41 8.598 1.652 12.723 2.03 16.79a19.9 19.9 0 0 0 5.429 2.74c.439-.603.83-1.24 1.165-1.911-.627-.238-1.224-.529-1.775-.867.149-.111.294-.225.434-.343 3.425 1.607 7.15 1.607 10.535 0 .142.118.287.232.434.343-.552.338-1.15.63-1.778.867.336.671.727 1.308 1.167 1.911a19.88 19.88 0 0 0 5.431-2.74c.444-4.713-.76-8.8-3.755-12.421ZM9.048 14.75c-1.029 0-1.875-.936-1.875-2.084 0-1.148.826-2.084 1.875-2.084 1.058 0 1.894.945 1.875 2.084 0 1.148-.827 2.084-1.875 2.084Zm5.905 0c-1.029 0-1.875-.936-1.875-2.084 0-1.148.826-2.084 1.875-2.084 1.058 0 1.894.945 1.875 2.084 0 1.148-.817 2.084-1.875 2.084Z"></path></svg>'
    );
  }

  function createDiscordNavButton() {
    const link = document.createElement("a");
    link.href = DISCORD_INVITE_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "text-white hover:text-white/70 transition-colors p-1";
    link.setAttribute("aria-label", "Discord");
    link.setAttribute("title", "Discord");
    link.dataset.discordNavButton = "true";
    link.innerHTML = discordIcon("w-5 h-5");
    return link;
  }

  function ensureDiscordNavButtons(root) {
    const searchRoot = root && typeof root.querySelectorAll === "function" ? root : document;
    const containers = Array.from(searchRoot.querySelectorAll("header div.flex.items-center")).filter((element) => {
      return (
        element &&
        typeof element.querySelector === "function" &&
        (element.querySelector('a[href*="backup-domains"]') ||
          element.querySelector('a[aria-label="Backup Domains"]'))
      );
    });

    containers.forEach((container) => {
      if (container.querySelector("[data-discord-nav-button='true']")) {
        return;
      }

      const backupLink =
        container.querySelector('a[href*="backup-domains"]') ||
        container.querySelector('a[aria-label="Backup Domains"]');
      const discordButton = createDiscordNavButton();

      if (backupLink && backupLink.parentNode === container) {
        container.insertBefore(discordButton, backupLink);
      } else {
        container.appendChild(discordButton);
      }
    });
  }

  function removeStandaloneDiscordButtons(root) {
    const searchRoot = root && typeof root.querySelectorAll === "function" ? root : document;
    const candidates = Array.from(
      searchRoot.querySelectorAll(
        'header a[aria-label="Discord"], header button[aria-label="Discord"], header a[href="/discord"], header a[href$="/discord"]'
      )
    ).filter((element) => !(element.dataset && element.dataset.discordNavButton === "true"));

    candidates.forEach((element) => {
      element.remove();
    });
  }

  function ensureFallbackButton() {
    const hasNavButton = document.querySelector("[data-discord-nav-button='true']");
    const existingFloating = document.querySelector("[data-discord-floating='true']");

    if (hasNavButton) {
      existingFloating?.remove();
      return;
    }

    if (existingFloating || !document.body) {
      return;
    }

    const link = document.createElement("a");
    link.href = DISCORD_INVITE_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.dataset.discordFloating = "true";
    link.className =
      "fixed bottom-6 right-6 z-[120] inline-flex items-center gap-2 rounded-full bg-[#5865F2] px-4 py-3 text-sm font-medium text-white shadow-lg shadow-black/40 transition-colors hover:bg-[#4752C4]";
    link.style.cssText = [
      "position:fixed",
      "right:24px",
      "bottom:24px",
      "z-index:120",
      "display:inline-flex",
      "align-items:center",
      "gap:8px",
      "padding:12px 16px",
      "border-radius:9999px",
      "background:#5865F2",
      "color:#fff",
      "font:600 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "text-decoration:none",
      "box-shadow:0 12px 32px rgba(0,0,0,0.35)"
    ].join(";");
    link.innerHTML = discordIcon("w-4 h-4") + "<span>Discord</span>";
    document.body.appendChild(link);
  }

  function applyDiscordButtons() {
    ensureDiscordNavButtons(document);
    removeStandaloneDiscordButtons(document);
    ensureFallbackButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyDiscordButtons, { once: true });
  } else {
    applyDiscordButtons();
  }

  const observer = new MutationObserver(() => {
    applyDiscordButtons();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
