(function () {
  const DEV_PROXY_PORT = "3001";
  const LIVE_SUBTITLE_PROXY_URL = "https://flixer.su";
  const TARGET_DOMAIN = "plsdontscrapemelove.flixer.su";
  const API_DOMAIN = "api.flixer.su";
  const DOM_URL_ATTRS = ["src", "href"];
  const DISCORD_INVITE_URL = "https://discord.gg/v87gDSVK5x";
  const hostname = window.location.hostname;
  const IS_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const IS_LOCALHOST = ["localhost", "127.0.0.1"].includes(hostname);
  const IS_PRIVATE_NETWORK =
    IS_LOCALHOST ||
    (IS_IPV4 &&
      (hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)));
  const IS_PRODUCTION_HOST = !IS_PRIVATE_NETWORK;
  const DEV_PROXY_URL = `${window.location.protocol}//${hostname}:${DEV_PROXY_PORT}`;
  const PROXY_URL = IS_PRODUCTION_HOST ? window.location.origin : DEV_PROXY_URL;
  const SHOULD_FORWARD_HEADERS = !IS_PRODUCTION_HOST;
  const MEDIA_PROXY_PATH = "/__media_proxy__";
  const ACCESS_GATE_STYLE_ID = "flixer-access-gate-style";
  const ACCESS_GATE_ROOT_ID = "flixer-access-gate-overlay";
  const ACCESS_GATE_PENDING_CLASS = "flixer-access-gate-pending";
  const ACCESS_GATE_ACTIVE_CLASS = "flixer-access-gate-active";
  const originalFetch = window.fetch;

  function isBackupDomainsPage() {
    const pathname = window.location.pathname || "";
    return (
      pathname === "/backup-domains" ||
      pathname.endsWith("/backup-domains") ||
      pathname.endsWith("backup-domains.html")
    );
  }

  function base64ToArrayBuffer(base64) {
    const normalized = String(base64 || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = window.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function parseTmdbSignPayload(bufferSource) {
    const view =
      bufferSource instanceof Uint8Array
        ? bufferSource
        : bufferSource instanceof ArrayBuffer
          ? new Uint8Array(bufferSource)
          : ArrayBuffer.isView(bufferSource)
            ? new Uint8Array(bufferSource.buffer, bufferSource.byteOffset, bufferSource.byteLength)
            : new Uint8Array();
    const payload = new TextDecoder().decode(view);
    const firstColon = payload.indexOf(":");
    const secondColon = payload.indexOf(":", firstColon + 1);
    const thirdColon = payload.indexOf(":", secondColon + 1);

    if (firstColon === -1 || secondColon === -1 || thirdColon === -1) {
      throw new Error("Invalid TMDB signing payload");
    }

    return {
      key: payload.slice(0, firstColon),
      timestamp: payload.slice(firstColon + 1, secondColon),
      nonce: payload.slice(secondColon + 1, thirdColon),
      path: payload.slice(thirdColon + 1)
    };
  }

  function installInsecureSubtleShim() {
    if (IS_PRODUCTION_HOST || !IS_PRIVATE_NETWORK || !window.crypto || window.crypto.subtle) {
      return;
    }

    const subtleShim = {
      importKey: async function (format, keyData) {
        if (format !== "raw") {
          throw new Error(`Unsupported subtle.importKey format: ${format}`);
        }

        return {
          __tmdbRawKey: new TextDecoder().decode(
            keyData instanceof Uint8Array ? keyData : new Uint8Array(keyData)
          )
        };
      },
      sign: async function (_algorithm, importedKey, data) {
        const parsed = parseTmdbSignPayload(data);
        const signUrl = new URL("/api/tmdb-sign", PROXY_URL);
        signUrl.searchParams.set("key", importedKey && importedKey.__tmdbRawKey ? importedKey.__tmdbRawKey : parsed.key);
        signUrl.searchParams.set("timestamp", parsed.timestamp);
        signUrl.searchParams.set("nonce", parsed.nonce);
        signUrl.searchParams.set("path", parsed.path);

        const response = await window.fetch(signUrl.toString(), {
          headers: { "Cache-Control": "no-cache" }
        });

        if (!response.ok) {
          throw new Error(`Failed to sign request: HTTP ${response.status}`);
        }

        const json = await response.json();
        if (!json || typeof json.signature !== "string" || !json.signature) {
          throw new Error("Invalid TMDB signing response");
        }

        return base64ToArrayBuffer(json.signature);
      }
    };

    try {
      Object.defineProperty(window.crypto, "subtle", {
        configurable: true,
        enumerable: true,
        value: subtleShim
      });
    } catch (_error) {
      window.crypto.subtle = subtleShim;
    }
  }

  function rewriteUrl(url) {
    if (typeof url !== "string") return url;

    try {
      if (url.startsWith("/api/subtitle")) {
        return LIVE_SUBTITLE_PROXY_URL + url;
      }

      if (url.startsWith("api/subtitle")) {
        return LIVE_SUBTITLE_PROXY_URL + "/" + url;
      }

      if (url.startsWith("/api/")) {
        return PROXY_URL + url;
      }

      if (url.startsWith("api/")) {
        return PROXY_URL + "/" + url;
      }

      const urlObj = new URL(url, window.location.origin);
      const isTargetHost = urlObj.hostname === TARGET_DOMAIN;
      const isApiHost = urlObj.hostname === API_DOMAIN;
      const isWorkersMediaHost = urlObj.hostname.endsWith(".workers.dev");
      const isLiveSubtitleApi = urlObj.hostname === "flixer.su" && urlObj.pathname.startsWith("/api/subtitle");
      const isFlixerClientAsset = urlObj.hostname === "flixer.su" && (urlObj.pathname.startsWith("/assets/client/") || urlObj.pathname.startsWith("/assets/wasm/"));
      const isAbsoluteFlixerApi =
        (isApiHost || urlObj.hostname === "flixer.su") &&
        urlObj.pathname.startsWith("/api/");
      const isLocalApi =
        (urlObj.origin === window.location.origin || urlObj.hostname === "localhost" || urlObj.hostname === "127.0.0.1") &&
        urlObj.pathname.startsWith("/api/");

      if (isLiveSubtitleApi) {
        return LIVE_SUBTITLE_PROXY_URL + urlObj.pathname + urlObj.search;
      }

      if (isFlixerClientAsset) {
        return urlObj.toString();
      }

      if (isAbsoluteFlixerApi) {
        return PROXY_URL + urlObj.pathname + urlObj.search;
      }

      if (!IS_PRODUCTION_HOST && isWorkersMediaHost) {
        const mediaProxyUrl = new URL(MEDIA_PROXY_PATH, PROXY_URL);
        mediaProxyUrl.searchParams.set("url", urlObj.toString());
        return mediaProxyUrl.toString();
      }

      if (isTargetHost || isLocalApi) {
        return PROXY_URL + urlObj.pathname + urlObj.search;
      }
    } catch (error) {
      console.warn("Proxy Relay failed to rewrite URL:", url, error);
    }

    return url;
  }

  function isAccessApiUrl(url) {
    try {
      return new URL(url, window.location.origin).pathname.startsWith("/api/access/");
    } catch (_error) {
      return false;
    }
  }

  function shouldRunClientAccessGate() {
    if (typeof document === "undefined") {
      return false;
    }

    const pathname = window.location.pathname || "/";
    return !pathname.startsWith("/api/");
  }

  function ensureAccessGateStyles() {
    if (!shouldRunClientAccessGate() || document.getElementById(ACCESS_GATE_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = ACCESS_GATE_STYLE_ID;
    style.textContent = [
      `html.${ACCESS_GATE_PENDING_CLASS} body > :not(#${ACCESS_GATE_ROOT_ID}), html.${ACCESS_GATE_ACTIVE_CLASS} body > :not(#${ACCESS_GATE_ROOT_ID}) {`,
      "  visibility: hidden !important;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} {`,
      "  position: fixed;",
      "  inset: 0;",
      "  z-index: 2147483647;",
      "  display: none;",
      "  align-items: center;",
      "  justify-content: center;",
      "  padding: 24px;",
      "  background: radial-gradient(circle at top, #2a070a 0%, #090909 40%, #030303 100%);",
      "  color: #ffffff;",
      "  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
      "}",
      `html.${ACCESS_GATE_ACTIVE_CLASS} #${ACCESS_GATE_ROOT_ID} {`,
      "  display: flex;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-shell {`,
      "  width: min(100%, 460px);",
      "  background: rgba(10, 10, 10, 0.92);",
      "  border: 1px solid rgba(255, 255, 255, 0.08);",
      "  border-radius: 24px;",
      "  box-shadow: 0 40px 120px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.03);",
      "  padding: 32px 28px;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-logo-wrap {`,
      "  display: flex;",
      "  justify-content: center;",
      "  margin-bottom: 18px;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-logo {`,
      "  width: min(180px, 55vw);",
      "  height: auto;",
      "  display: block;",
      "  filter: drop-shadow(0 12px 30px rgba(229, 9, 20, 0.18));",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-brand {`,
      "  margin-bottom: 14px;",
      "  color: rgba(255, 255, 255, 0.74);",
      "  font-size: 14px;",
      "  letter-spacing: 0.34em;",
      "  text-transform: uppercase;",
      "  text-align: center;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} h1 {`,
      "  margin: 0;",
      "  font-size: 34px;",
      "  line-height: 1.05;",
      "  font-weight: 800;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} p {`,
      "  margin: 14px 0 0;",
      "  color: #9f9f9f;",
      "  font-size: 15px;",
      "  line-height: 1.6;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} form {`,
      "  margin-top: 28px;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} label {`,
      "  display: block;",
      "  margin-bottom: 10px;",
      "  color: rgba(255, 255, 255, 0.58);",
      "  font-size: 12px;",
      "  letter-spacing: 0.16em;",
      "  text-transform: uppercase;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} input {`,
      "  width: 100%;",
      "  padding: 15px 16px;",
      "  border: 1px solid rgba(255, 255, 255, 0.08);",
      "  border-radius: 14px;",
      "  background: #080808;",
      "  color: #ffffff;",
      "  font-size: 16px;",
      "  outline: none;",
      "  transition: border-color 0.2s ease, box-shadow 0.2s ease;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} input:focus {`,
      "  border-color: rgba(229, 9, 20, 0.8);",
      "  box-shadow: 0 0 0 4px rgba(229, 9, 20, 0.16);",
      "}",
      `#${ACCESS_GATE_ROOT_ID} button {`,
      "  width: 100%;",
      "  margin-top: 14px;",
      "  padding: 15px 16px;",
      "  border: 0;",
      "  border-radius: 14px;",
      "  background: linear-gradient(135deg, #e50914, #ff5058);",
      "  color: #ffffff;",
      "  font-size: 15px;",
      "  font-weight: 700;",
      "  cursor: pointer;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} button:disabled {`,
      "  opacity: 0.65;",
      "  cursor: wait;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-secondary-link {`,
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  width: fit-content;",
      "  margin: 12px auto 0;",
      "  color: #5865f2;",
      "  text-decoration: none;",
      "  transition: transform 0.16s ease, filter 0.16s ease;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-secondary-link:hover {`,
      "  filter: brightness(1.08);",
      "  transform: translateY(-1px);",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-secondary-link:focus-visible {`,
      "  outline: 2px solid rgba(88, 101, 242, 0.9);",
      "  outline-offset: 6px;",
      "  border-radius: 999px;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-discord-icon {`,
      "  width: 30px;",
      "  height: 30px;",
      "  display: block;",
      "  fill: currentColor;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-status {`,
      "  min-height: 24px;",
      "  margin-top: 16px;",
      "  font-size: 14px;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-status.error {`,
      "  color: #ff9b9b;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-status.success {`,
      "  color: #18c964;",
      "}",
      `#${ACCESS_GATE_ROOT_ID} .access-foot {`,
      "  margin-top: 24px;",
      "  color: rgba(255, 255, 255, 0.34);",
      "  font-size: 12px;",
      "}",
      "@media (max-width: 640px) {",
      `  #${ACCESS_GATE_ROOT_ID} { padding: 16px; }`,
      `  #${ACCESS_GATE_ROOT_ID} .access-shell { padding: 24px 20px; border-radius: 20px; }`,
      `  #${ACCESS_GATE_ROOT_ID} h1 { font-size: 28px; }`,
      "}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function waitForBody(callback) {
    if (document.body) {
      callback();
      return;
    }

    document.addEventListener("DOMContentLoaded", callback, { once: true });
  }

  function setAccessGateStatus(root, message, type) {
    if (!root) {
      return;
    }

    const status = root.querySelector("[data-access-status]");
    if (!status) {
      return;
    }

    status.textContent = message || "";
    status.className = `access-status${type ? ` ${type}` : ""}`;
  }

  async function requestAccessJson(path, init) {
    const headers = addForwardHeaders((init && init.headers) || {});
    const mergedInit = {
      ...(init || {}),
      cache: "no-store",
      credentials: SHOULD_FORWARD_HEADERS ? "include" : "same-origin",
      headers: headers
    };
    if (SHOULD_FORWARD_HEADERS) {
      mergedInit.mode = "cors";
    }
    const rewrittenUrl = rewriteUrl(path);
    const response = await originalFetch(rewrittenUrl, mergedInit);
    const payload = await response.json().catch(function () {
      return {};
    });
    return { payload, response };
  }

  function getAccessGateDefaultDescription() {
    return "Enter your access code to unlock the site.";
  }

  function ensureAccessGateOverlay() {
    if (!document.body) {
      return null;
    }

    let root = document.getElementById(ACCESS_GATE_ROOT_ID);

    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = ACCESS_GATE_ROOT_ID;
    root.innerHTML = [
      '<main class="access-shell" role="dialog" aria-modal="true" aria-labelledby="access-gate-title">',
      '<div class="access-logo-wrap"><img class="access-logo" src="/assets/images/logo.png" alt="Flixer"></div>',
      '<div class="access-brand">FLIXER</div>',
      '<h1 id="access-gate-title" data-access-title>Access Required</h1>',
      '<p data-access-description>Enter your access code to unlock the site.</p>',
      '<form data-access-form novalidate>',
      '<label for="access-gate-code">Access code</label>',
      '<input id="access-gate-code" name="code" type="text" inputmode="text" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="Paste your code">',
      '<button type="submit" data-access-submit>Unlock Site</button>',
      `<a class="access-secondary-link" href="${DISCORD_INVITE_URL}" target="_blank" rel="noreferrer noopener" aria-label="Join Our Discord">`,
      '<svg class="access-discord-icon" viewBox="0 0 127.14 96.36" aria-hidden="true">',
      '<path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83A97.68 97.68 0 0 0 49 6.83 72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.2h.02a105.73 105.73 0 0 0 32.17 16.16 77.7 77.7 0 0 0 6.89-11.12 68.42 68.42 0 0 1-10.84-5.18c.91-.66 1.8-1.35 2.66-2.08 20.87 9.54 43.46 9.54 64.08 0 .87.73 1.76 1.42 2.67 2.08a68.68 68.68 0 0 1-10.86 5.19 77 77 0 0 0 6.89 11.1A105.25 105.25 0 0 0 126.6 80.2c2.64-27.29-4.5-50.99-18.9-72.13ZM42.45 65.69C36.18 65.69 31 59.98 31 52.95s5-12.74 11.45-12.74S54 45.92 53.9 52.95c0 7.03-5.05 12.74-11.45 12.74Zm42.24 0c-6.27 0-11.45-5.71-11.45-12.74s5-12.74 11.45-12.74S96.14 45.92 96.14 52.95c0 7.03-5.05 12.74-11.45 12.74Z"/>',
      "</svg>",
      "</a>",
      '<div class="access-status" data-access-status role="status" aria-live="polite"></div>',
      "</form>",
      `<div class="access-foot">Requested path: ${window.location.pathname || "/"}</div>`,
      "</main>"
    ].join("");

    const form = root.querySelector("[data-access-form]");
    const input = root.querySelector("#access-gate-code");
    const submit = root.querySelector("[data-access-submit]");

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      const code = String(input.value || "").trim();
      if (!code) {
        setAccessGateStatus(root, "Enter a valid access code.", "error");
        input.focus();
        return;
      }

      submit.disabled = true;
      setAccessGateStatus(root, "Verifying code...", "");

      try {
        const result = await requestAccessJson("/api/access/redeem", {
          body: JSON.stringify({ code: code }),
          headers: {
            accept: "application/json",
            "content-type": "application/json"
          },
          method: "POST"
        });

        if (!result.response.ok) {
          throw new Error(result.payload.error || "The access code was rejected.");
        }

        setAccessGateStatus(root, "Access granted. Reloading...", "success");
        window.location.reload();
      } catch (error) {
        setAccessGateStatus(
          root,
          error && error.message ? error.message : "The access code was rejected.",
          "error"
        );
      } finally {
        submit.disabled = false;
      }
    });

    document.body.appendChild(root);
    return root;
  }

  function releaseAccessGate() {
    document.documentElement.classList.remove(ACCESS_GATE_PENDING_CLASS);
    document.documentElement.classList.remove(ACCESS_GATE_ACTIVE_CLASS);
  }

  function showAccessGate(options) {
    waitForBody(function () {
      const root = ensureAccessGateOverlay();
      if (!root) {
        return;
      }

      const title = root.querySelector("[data-access-title]");
      const description = root.querySelector("[data-access-description]");
      const input = root.querySelector("#access-gate-code");

      title.textContent = options && options.title ? options.title : "Access Required";
      description.textContent =
        options && options.description ? options.description : getAccessGateDefaultDescription();

      document.documentElement.classList.remove(ACCESS_GATE_PENDING_CLASS);
      document.documentElement.classList.add(ACCESS_GATE_ACTIVE_CLASS);
      setAccessGateStatus(root, options && options.status ? options.status : "", options && options.statusType ? options.statusType : "");
      input.focus();
    });
  }

  async function initializeClientAccessGate() {
    if (!shouldRunClientAccessGate()) {
      return;
    }

    ensureAccessGateStyles();
    document.documentElement.classList.add(ACCESS_GATE_PENDING_CLASS);

    try {
      const result = await requestAccessJson("/api/access/status", {
        headers: { accept: "application/json" },
        method: "GET"
      });

      if (result.response.ok && result.payload && result.payload.authorized) {
        releaseAccessGate();
        return;
      }

      if (!result.response.ok) {
        showAccessGate({
          description:
            result.payload && result.payload.error
              ? result.payload.error
              : "The access gate could not verify this browser yet.",
          status:
            result.payload && result.payload.error
              ? result.payload.error
              : `Access gate request failed (${result.response.status}).`,
          statusType: "error",
          title: "Gate Setup Required"
        });
        return;
      }

      showAccessGate({
        description: getAccessGateDefaultDescription(),
        title: "Access Required"
      });
    } catch (error) {
      showAccessGate({
        description:
          "The local access endpoint is unavailable. Start the proxy on localhost:3001 before loading the site.",
        status: error && error.message ? error.message : "Failed to reach the access gate.",
        statusType: "error",
        title: "Gate Setup Required"
      });
    }
  }

  installInsecureSubtleShim();
  initializeClientAccessGate();

  function addForwardHeaders(headersLike) {
    if (!SHOULD_FORWARD_HEADERS) {
      return headersLike;
    }

    const headers = new Headers(headersLike || {});
    headers.set("X-Forwarded-Cookie", document.cookie);
    headers.set("X-Forwarded-User-Agent", navigator.userAgent);
    return headers;
  }

  function rewriteDomAttribute(element, attributeName, value) {
    const rewritten = rewriteUrl(value);
    if (rewritten !== value) {
      element.setAttribute(attributeName, rewritten);
    }
  }

  function rewriteElementUrls(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;

    root.querySelectorAll("[src], [href]").forEach(function (element) {
      DOM_URL_ATTRS.forEach(function (attributeName) {
        if (element.hasAttribute(attributeName)) {
          rewriteDomAttribute(element, attributeName, element.getAttribute(attributeName));
        }
      });
    });
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
    link.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M20.317 4.369A19.791 19.791 0 0 0 15.885 3c-.191.328-.403.775-.553 1.124a18.27 18.27 0 0 0-5.134 0A11.713 11.713 0 0 0 9.645 3a19.736 19.736 0 0 0-4.433 1.369C2.41 8.598 1.652 12.723 2.03 16.79a19.9 19.9 0 0 0 5.429 2.74c.439-.603.83-1.24 1.165-1.911-.627-.238-1.224-.529-1.775-.867.149-.111.294-.225.434-.343 3.425 1.607 7.15 1.607 10.535 0 .142.118.287.232.434.343-.552.338-1.15.63-1.778.867.336.671.727 1.308 1.167 1.911a19.88 19.88 0 0 0 5.431-2.74c.444-4.713-.76-8.8-3.755-12.421ZM9.048 14.75c-1.029 0-1.875-.936-1.875-2.084 0-1.148.826-2.084 1.875-2.084 1.058 0 1.894.945 1.875 2.084 0 1.148-.827 2.084-1.875 2.084Zm5.905 0c-1.029 0-1.875-.936-1.875-2.084 0-1.148.826-2.084 1.875-2.084 1.058 0 1.894.945 1.875 2.084 0 1.148-.817 2.084-1.875 2.084Z"></path></svg>';
    return link;
  }

  function findDirectBackupLink(container) {
    if (!container || !container.children) {
      return null;
    }

    return (
      Array.from(container.children).find(function (child) {
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

    return Array.from(container.children).filter(function (child) {
      return !!(child.dataset && child.dataset.discordNavButton === "true");
    });
  }

  function isValidDiscordNavButton(element) {
    return !!(element && element.dataset && element.dataset.discordNavButton === "true" && findDirectBackupLink(element.parentElement));
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

    if (typeof document === "undefined") {
      return;
    }

    const searchRoot = root && typeof root.querySelectorAll === "function" ? root : document;
    const containers = Array.from(searchRoot.querySelectorAll("header div.flex.items-center")).filter(function (element) {
      return !!findDirectBackupLink(element);
    });

    containers.forEach(function (container) {
      const backupLink = findDirectBackupLink(container);
      const existingButtons = getDirectDiscordNavButtons(container);

      if (!backupLink) {
        return;
      }

      if (existingButtons.length > 0) {
        existingButtons.slice(1).forEach(function (button) {
          button.remove();
        });
        return;
      }

      const discordButton = createDiscordNavButton();
      container.insertBefore(discordButton, backupLink);
    });
  }

  function removeStandaloneDiscordButtons(root) {
    if (typeof document === "undefined") {
      return;
    }

    const searchRoot = root && typeof root.querySelectorAll === "function" ? root : document;

    if (isBackupDomainsPage()) {
      Array.from(
        searchRoot.querySelectorAll(
          "[data-discord-nav-button='true'], [data-discord-floating='true'], a[aria-label='Discord'], button[aria-label='Discord'], a[href='/discord'], a[href$='/discord'], a[href*='discord.gg'], a[href*='discord.com/invite']"
        )
      ).forEach(function (element) {
        if (!isPrimaryBackupDiscordCta(element) && element && element.remove) {
          element.remove();
        }
      });
      return;
    }

    Array.from(searchRoot.querySelectorAll("[data-discord-nav-button='true']")).forEach(function (element) {
      if (!isValidDiscordNavButton(element) && element && element.remove) {
        element.remove();
      }
    });

    const candidates = Array.from(
      searchRoot.querySelectorAll(
        'header a[aria-label="Discord"], header button[aria-label="Discord"], header a[href="/discord"], header a[href$="/discord"], header a[href*="discord.gg"], header a[href*="discord.com/invite"]'
      )
    ).filter(function (element) {
      return !isValidDiscordNavButton(element);
    });

    candidates.forEach(function (element) {
      if (element && element.remove) {
        element.remove();
      }
    });
  }

  // Intercept Fetch
  window.fetch = function (input, init = {}) {
    let url = (typeof input === "string") ? input : input.url;
    let newUrl = rewriteUrl(url);

    if (newUrl !== url) {
      const includeCredentials = SHOULD_FORWARD_HEADERS && isAccessApiUrl(newUrl);
      if (input instanceof Request) {
        init.headers = addForwardHeaders(init.headers || input.headers);
        input = new Request(newUrl, {
          method: input.method,
          headers: init.headers,
          body: input.body,
          mode: SHOULD_FORWARD_HEADERS ? "cors" : input.mode,
          credentials: includeCredentials ? "include" : input.credentials,
          cache: input.cache,
          redirect: input.redirect,
          referrer: input.referrer,
          referrerPolicy: input.referrerPolicy,
          integrity: input.integrity,
          keepalive: input.keepalive,
          signal: input.signal
        });
      } else {
        input = newUrl;
        if (SHOULD_FORWARD_HEADERS) {
          init.headers = addForwardHeaders(init.headers);
          init.mode = "cors";
          if (includeCredentials) {
            init.credentials = "include";
          }
        }
      }
    }
    return originalFetch(input, init);
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    const newUrl = rewriteUrl(url);
    this.__proxyRelayHeaders = newUrl !== url;
    this.__proxyRelayIncludeCredentials =
      this.__proxyRelayHeaders && SHOULD_FORWARD_HEADERS && isAccessApiUrl(newUrl);
    return originalOpen.call(this, method, newUrl, arguments[2], arguments[3], arguments[4]);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__proxyRelayHeaders && SHOULD_FORWARD_HEADERS) {
      try {
        this.withCredentials = !!this.__proxyRelayIncludeCredentials;
        this.setRequestHeader("X-Forwarded-Cookie", document.cookie);
        this.setRequestHeader("X-Forwarded-User-Agent", navigator.userAgent);
      } catch (error) {
        console.warn("Proxy Relay failed to apply XHR headers:", error);
      }
    }
    return originalSend.apply(this, arguments);
  };

  // Intercept DOM-set URLs such as <track src="/api/subtitle?...">
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (DOM_URL_ATTRS.includes(name) && typeof value === "string") {
      value = rewriteUrl(value);
    }
    return originalSetAttribute.call(this, name, value);
  };

  function patchSrcProperty(proto) {
    if (!proto) return;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "src");
    if (!descriptor || !descriptor.configurable || typeof descriptor.set !== "function") return;

    Object.defineProperty(proto, "src", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) {
        descriptor.set.call(this, rewriteUrl(value));
      }
    });
  }

  patchSrcProperty(window.HTMLTrackElement && window.HTMLTrackElement.prototype);
  patchSrcProperty(window.HTMLSourceElement && window.HTMLSourceElement.prototype);
  patchSrcProperty(window.HTMLMediaElement && window.HTMLMediaElement.prototype);
  patchSrcProperty(window.HTMLScriptElement && window.HTMLScriptElement.prototype);
  patchSrcProperty(window.HTMLImageElement && window.HTMLImageElement.prototype);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      rewriteElementUrls(document);
      ensureDiscordNavButtons(document);
      removeStandaloneDiscordButtons(document);
    });
  } else {
    rewriteElementUrls(document);
    ensureDiscordNavButtons(document);
    removeStandaloneDiscordButtons(document);
  }

  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type === "attributes" && mutation.target) {
        const attrName = mutation.attributeName;
        if (attrName && DOM_URL_ATTRS.includes(attrName) && mutation.target.getAttribute(attrName)) {
          rewriteDomAttribute(mutation.target, attrName, mutation.target.getAttribute(attrName));
        }
      }

      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        DOM_URL_ATTRS.forEach(function (attributeName) {
          if (node.hasAttribute && node.hasAttribute(attributeName)) {
            rewriteDomAttribute(node, attributeName, node.getAttribute(attributeName));
          }
        });

        rewriteElementUrls(node);
      });
    });

    ensureDiscordNavButtons(document);
    removeStandaloneDiscordButtons(document);
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: DOM_URL_ATTRS
  });

  console.log(`✅ Proxy Relay v3.9 Active (${IS_PRODUCTION_HOST ? "same-origin production proxy" : "dev proxy"})`);
}());
