(function () {
  const DEV_PROXY_PORT = "3001";
  const LIVE_SUBTITLE_PROXY_URL = "https://flixer.su";
  const TARGET_DOMAIN = "plsdontscrapemelove.flixer.su";
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
      const isWorkersMediaHost = urlObj.hostname.endsWith(".workers.dev");
      const isLiveSubtitleApi = urlObj.hostname === "flixer.su" && urlObj.pathname.startsWith("/api/subtitle");
      const isFlixerClientAsset = urlObj.hostname === "flixer.su" && (urlObj.pathname.startsWith("/assets/client/") || urlObj.pathname.startsWith("/assets/wasm/"));
      const isLocalApi =
        (urlObj.origin === window.location.origin || urlObj.hostname === "localhost" || urlObj.hostname === "127.0.0.1") &&
        urlObj.pathname.startsWith("/api/");

      if (isLiveSubtitleApi) {
        return LIVE_SUBTITLE_PROXY_URL + urlObj.pathname + urlObj.search;
      }

      if (isFlixerClientAsset) {
        return urlObj.toString();
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

  installInsecureSubtleShim();

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

  function ensureDiscordNavButtons(root) {
    if (typeof document === "undefined") {
      return;
    }

    const searchRoot = root && typeof root.querySelectorAll === "function" ? root : document;
    const containers = Array.from(searchRoot.querySelectorAll("header div.flex.items-center")).filter(function (element) {
      return (
        element &&
        typeof element.querySelector === "function" &&
        (element.querySelector('a[href*="backup-domains"]') ||
          element.querySelector('a[aria-label="Backup Domains"]'))
      );
    });

    containers.forEach(function (container) {
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
    if (typeof document === "undefined") {
      return;
    }

    const searchRoot = root && typeof root.querySelectorAll === "function" ? root : document;
    const candidates = Array.from(
      searchRoot.querySelectorAll(
        'header a[aria-label="Discord"], header button[aria-label="Discord"], header a[href="/discord"], header a[href$="/discord"]'
      )
    ).filter(function (element) {
      return !(element.dataset && element.dataset.discordNavButton === "true");
    });

    candidates.forEach(function (element) {
      if (element && element.remove) {
        element.remove();
      }
    });
  }

  // Intercept Fetch
  const originalFetch = window.fetch;
  window.fetch = function (input, init = {}) {
    let url = (typeof input === "string") ? input : input.url;
    let newUrl = rewriteUrl(url);

    if (newUrl !== url) {
      if (input instanceof Request) {
        init.headers = addForwardHeaders(init.headers || input.headers);
        input = new Request(newUrl, {
          method: input.method,
          headers: init.headers,
          body: input.body,
          mode: input.mode,
          credentials: input.credentials,
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
    return originalOpen.call(this, method, newUrl, arguments[2], arguments[3], arguments[4]);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__proxyRelayHeaders && SHOULD_FORWARD_HEADERS) {
      try {
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
