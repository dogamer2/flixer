(() => {
  const DISCORD_INVITE_URL = "https://discord.gg/v87gDSVK5x";

  function isBackupDomainsPage() {
    const pathname = window.location.pathname || "";
    return (
      pathname === "/backup-domains" ||
      pathname.endsWith("/backup-domains") ||
      pathname.endsWith("backup-domains.html")
    );
  }

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

  function findDirectBackupLink(container) {
    if (!container || !container.children) {
      return null;
    }

    return (
      Array.from(container.children).find((child) => {
        return (
          child &&
          typeof child.matches === "function" &&
          (child.matches('a[href*="backup-domains"]') ||
            child.matches('a[aria-label="Backup Domains"]'))
        );
      }) || null
    );
  }

  function getDirectDiscordNavButtons(container) {
    if (!container || !container.children) {
      return [];
    }

    return Array.from(container.children).filter(
      (child) => child.dataset && child.dataset.discordNavButton === "true"
    );
  }

  function isValidDiscordNavButton(element) {
    return !!(
      element &&
      element.dataset &&
      element.dataset.discordNavButton === "true" &&
      findDirectBackupLink(element.parentElement)
    );
  }

  function isPrimaryBackupDiscordCta(element) {
    return !!(
      element &&
      ((element.dataset && element.dataset.discordPrimaryCta === "true") ||
        (typeof element.closest === "function" &&
          element.closest("[data-discord-primary-cta='true']")))
    );
  }

  function ensureDiscordNavButtons(root) {
    if (isBackupDomainsPage()) {
      return;
    }

    const searchRoot = root && typeof root.querySelectorAll === "function" ? root : document;
    const containers = Array.from(searchRoot.querySelectorAll("header div.flex.items-center")).filter((element) => {
      return !!findDirectBackupLink(element);
    });

    containers.forEach((container) => {
      const backupLink = findDirectBackupLink(container);
      const existingButtons = getDirectDiscordNavButtons(container);

      if (!backupLink) {
        return;
      }

      if (existingButtons.length > 0) {
        existingButtons.slice(1).forEach((button) => {
          button.remove();
        });
        return;
      }

      const discordButton = createDiscordNavButton();
      container.insertBefore(discordButton, backupLink);
    });
  }

  function removeStandaloneDiscordButtons(root) {
    const searchRoot = root && typeof root.querySelectorAll === "function" ? root : document;

    if (isBackupDomainsPage()) {
      Array.from(
        searchRoot.querySelectorAll(
          "[data-discord-nav-button='true'], [data-discord-floating='true'], a[aria-label='Discord'], button[aria-label='Discord'], a[href='/discord'], a[href$='/discord'], a[href*='discord.gg'], a[href*='discord.com/invite']"
        )
      ).forEach((element) => {
        if (!isPrimaryBackupDiscordCta(element)) {
          element.remove();
        }
      });
      return;
    }

    Array.from(searchRoot.querySelectorAll("[data-discord-nav-button='true']")).forEach((element) => {
      if (!isValidDiscordNavButton(element)) {
        element.remove();
      }
    });

    const candidates = Array.from(
      searchRoot.querySelectorAll(
        'header a[aria-label="Discord"], header button[aria-label="Discord"], header a[href="/discord"], header a[href$="/discord"], header a[href*="discord.gg"], header a[href*="discord.com/invite"]'
      )
    ).filter((element) => !isValidDiscordNavButton(element));

    candidates.forEach((element) => {
      element.remove();
    });

    const globalCandidates = Array.from(
      searchRoot.querySelectorAll(
        "a[href='/discord'], a[href$='/discord'], a[href*='discord.gg'], a[href*='discord.com/invite'], [data-discord-floating='true']"
      )
    ).filter((element) => !isValidDiscordNavButton(element) && !isPrimaryBackupDiscordCta(element));

    globalCandidates.forEach((element) => {
      element.remove();
    });
  }

  function applyDiscordButtons() {
    ensureDiscordNavButtons(document);
    removeStandaloneDiscordButtons(document);
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
