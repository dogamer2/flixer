(function () {
  var MODE_STORAGE_KEY = "flixer_profile_mode_v1";
  var PROFILES_STORAGE_KEY = "flixer_profiles_v1";
  var ACTIVE_PROFILE_KEY = "flixer_active_profile_v1";
  var RATING_CACHE_KEY = "flixer_profile_rating_cache_v1";
  var STARTUP_SKIP_KEY = "flixer_profile_skip_chooser_once";
  var PROFILE_SEEDED_KEY = "__seeded__";
  var ROOT_ID = "flixer-profile-root";
  var STYLE_SCOPE = "flixer-profile";
  var PROFILE_SCOPED_KEYS = new Set(["myList", "watch_progress", "notificationState"]);
  var PROFILE_SCOPED_PREFIXES = ["progress_"];
  var PIN_ITERATIONS = 120000;
  var PROFILE_LIMIT = 6;
  var API_BASE = "https://api.flixer.su/api";
  var currentUser = null;
  var root = null;
  var nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  var state = {
    chooserOpen: false,
    manageOpen: false,
    editingProfileId: null,
    modeEnabled: false,
    profiles: [],
    activeProfileId: "",
    view: "chooser"
  };

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function safeParse(json, fallback) {
    try {
      return json ? JSON.parse(json) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function readStorage(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value == null ? fallback : safeParse(value, fallback);
    } catch (_error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {}
  }

  function removeStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch (_error) {}
  }

  function parseJwtPayload(token) {
    try {
      var parts = String(token || "").split(".");
      if (parts.length !== 3) return null;
      var normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      var padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
      return JSON.parse(atob(padded));
    } catch (_error) {
      return null;
    }
  }

  function currentToken() {
    try {
      return localStorage.getItem("token") || "";
    } catch (_error) {
      return "";
    }
  }

  function getAccountId() {
    var payload = parseJwtPayload(currentToken());
    if (payload && payload.userId) return "user:" + String(payload.userId);
    return "";
  }

  function getAccountModeMap() {
    return readStorage(MODE_STORAGE_KEY, {});
  }

  function setAccountMode(accountId, enabled) {
    var map = getAccountModeMap();
    if (!accountId) return;
    map[accountId] = !!enabled;
    writeStorage(MODE_STORAGE_KEY, map);
  }

  function getAccountMode(accountId) {
    var map = getAccountModeMap();
    return !!(accountId && map[accountId]);
  }

  function getProfilesMap() {
    return readStorage(PROFILES_STORAGE_KEY, {});
  }

  function setProfilesForAccount(accountId, profiles) {
    var map = getProfilesMap();
    map[accountId] = profiles;
    writeStorage(PROFILES_STORAGE_KEY, map);
  }

  function getProfilesForAccount(accountId) {
    var map = getProfilesMap();
    return accountId && Array.isArray(map[accountId]) ? map[accountId] : [];
  }

  function getActiveProfileMap() {
    return readStorage(ACTIVE_PROFILE_KEY, {});
  }

  function getStoredActiveProfileId(accountId) {
    var map = getActiveProfileMap();
    return accountId && typeof map[accountId] === "string" ? map[accountId] : "";
  }

  function setStoredActiveProfileId(accountId, profileId) {
    var map = getActiveProfileMap();
    if (!accountId) return;
    if (profileId) {
      map[accountId] = profileId;
    } else {
      delete map[accountId];
    }
    writeStorage(ACTIVE_PROFILE_KEY, map);
  }

  function randomId(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getInitialColor(index) {
    var colors = ["#2A62F4", "#D93B1D", "#6B31D8", "#0D7C66", "#D19112", "#B23A48"];
    return colors[index % colors.length];
  }

  function buildDefaultProfile(user) {
    var name = user && user.username ? String(user.username) : "Profile";
    return {
      id: randomId("profile"),
      name: name,
      avatarUrl: user && user.avatarUrl ? String(user.avatarUrl) : "",
      color: getInitialColor(0),
      isKids: false,
      maxRating: "TV-MA",
      pinSalt: "",
      pinHash: "",
      isPrimary: true
    };
  }

  function normalizeProfiles(profiles, user) {
    var normalized = Array.isArray(profiles) ? profiles.slice(0, PROFILE_LIMIT) : [];
    if (!normalized.length) {
      normalized.push(buildDefaultProfile(user));
    }
    normalized.forEach(function (profile, index) {
      if (!profile.id) profile.id = randomId("profile");
      if (!profile.name) profile.name = "Profile " + String(index + 1);
      if (!profile.color) profile.color = getInitialColor(index);
      if (typeof profile.isKids !== "boolean") profile.isKids = false;
      if (!profile.maxRating) profile.maxRating = profile.isKids ? "PG" : "TV-MA";
      if (typeof profile.isPrimary !== "boolean") profile.isPrimary = index === 0;
      if (typeof profile.pinSalt !== "string") profile.pinSalt = "";
      if (typeof profile.pinHash !== "string") profile.pinHash = "";
    });
    if (!normalized.some(function (profile) { return profile.isPrimary; })) {
      normalized[0].isPrimary = true;
    }
    return normalized;
  }

  function getActiveProfile() {
    var accountId = getAccountId();
    if (!accountId) return null;
    var profiles = getProfilesForAccount(accountId);
    var activeId = getStoredActiveProfileId(accountId);
    var active = profiles.find(function (profile) { return profile.id === activeId; });
    return active || profiles[0] || null;
  }

  function profileStorageKey(accountId, profileId, key) {
    return "flixer_profile_data_v1:" + accountId + ":" + profileId + ":" + key;
  }

  function isProfileScopedKey(key) {
    if (!key) return false;
    if (PROFILE_SCOPED_KEYS.has(key)) return true;
    return PROFILE_SCOPED_PREFIXES.some(function (prefix) {
      return key.indexOf(prefix) === 0;
    });
  }

  function shouldScopeStorageKey(key) {
    var accountId = getAccountId();
    var activeProfile = getActiveProfile();
    if (!accountId || !activeProfile) return false;
    if (!getAccountMode(accountId)) return false;
    return isProfileScopedKey(key);
  }

  function getScopedStorageKey(key) {
    var accountId = getAccountId();
    var activeProfile = getActiveProfile();
    if (!accountId || !activeProfile) return key;
    return profileStorageKey(accountId, activeProfile.id, key);
  }

  function installStorageNamespace() {
    var proto = window.Storage && window.Storage.prototype;
    if (!proto || proto.__flixerProfileScoped) return;
    proto.__flixerProfileScoped = true;

    var originalGetItem = proto.getItem;
    var originalSetItem = proto.setItem;
    var originalRemoveItem = proto.removeItem;

    proto.getItem = function (key) {
      if (this === localStorage && shouldScopeStorageKey(String(key || ""))) {
        var scopedValue = originalGetItem.call(this, getScopedStorageKey(String(key || "")));
        if (scopedValue != null) return scopedValue;
      }
      return originalGetItem.call(this, key);
    };

    proto.setItem = function (key, value) {
      if (this === localStorage && shouldScopeStorageKey(String(key || ""))) {
        return originalSetItem.call(this, getScopedStorageKey(String(key || "")), value);
      }
      return originalSetItem.call(this, key, value);
    };

    proto.removeItem = function (key) {
      if (this === localStorage && shouldScopeStorageKey(String(key || ""))) {
        return originalRemoveItem.call(this, getScopedStorageKey(String(key || "")));
      }
      return originalRemoveItem.call(this, key);
    };
  }

  function getScopedJson(scopeName, fallback) {
    var accountId = getAccountId();
    var activeProfile = getActiveProfile();
    if (!accountId || !activeProfile) return fallback;
    return readStorage(profileStorageKey(accountId, activeProfile.id, scopeName), fallback);
  }

  function setScopedJson(scopeName, value) {
    var accountId = getAccountId();
    var activeProfile = getActiveProfile();
    if (!accountId || !activeProfile) return;
    writeStorage(profileStorageKey(accountId, activeProfile.id, scopeName), value);
  }

  function shouldInterceptProfileData() {
    var accountId = getAccountId();
    var activeProfile = getActiveProfile();
    return !!(accountId && activeProfile && getAccountMode(accountId));
  }

  function writeProfileScopedJson(accountId, profileId, scopeName, value) {
    if (!accountId || !profileId) return;
    writeStorage(profileStorageKey(accountId, profileId, scopeName), value);
  }

  function readProfileScopedJson(accountId, profileId, scopeName, fallback) {
    if (!accountId || !profileId) return fallback;
    return readStorage(profileStorageKey(accountId, profileId, scopeName), fallback);
  }

  async function seedProfileDataIfNeeded() {
    var accountId = getAccountId();
    if (!accountId || !getAccountMode(accountId) || !nativeFetch) return;
    var profiles = normalizeProfiles(getProfilesForAccount(accountId), currentUser);
    var defaultProfile = profiles.find(function (profile) { return profile.isPrimary; }) || profiles[0];
    if (!defaultProfile) return;
    if (readProfileScopedJson(accountId, defaultProfile.id, PROFILE_SEEDED_KEY, false)) return;

    var token = currentToken();
    if (!token) return;
    var headers = { Authorization: "Bearer " + token };

    try {
      var results = await Promise.allSettled([
        nativeFetch(API_BASE + "/progress", { headers: headers }),
        nativeFetch(API_BASE + "/auth/my-list", { headers: headers })
      ]);

      var progress = {};
      var myList = [];

      if (results[0].status === "fulfilled" && results[0].value.ok) {
        progress = await results[0].value.json();
      }

      if (results[1].status === "fulfilled" && results[1].value.ok) {
        var listJson = await results[1].value.json();
        myList = listJson && Array.isArray(listJson.myList) ? listJson.myList : [];
      }

      writeProfileScopedJson(accountId, defaultProfile.id, "watch_progress", progress || {});
      writeProfileScopedJson(accountId, defaultProfile.id, "myList_api", myList || []);
      writeProfileScopedJson(accountId, defaultProfile.id, "myList", myList || []);
      writeProfileScopedJson(accountId, defaultProfile.id, PROFILE_SEEDED_KEY, true);
    } catch (_error) {}
  }

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  function isProgressEndpoint(url) {
    return /\/api\/progress(?:\/|$|\?)/.test(url);
  }

  function isMyListEndpoint(url) {
    return /\/auth\/my-list(?:\/|$|\?)/.test(url);
  }

  function handleProgressRequest(method, url, body) {
    var data = getScopedJson("watch_progress", {});
    if (method === "GET") {
      return jsonResponse(data, 200);
    }
    if (method === "POST") {
      var next = safeParse(body, data);
      setScopedJson("watch_progress", next);
      return jsonResponse(next, 200);
    }
    if (method === "DELETE") {
      var match = url.match(/\/api\/progress\/([^/?#]+)/);
      if (match) {
        var mediaId = decodeURIComponent(match[1]);
        if (data && Object.prototype.hasOwnProperty.call(data, mediaId)) {
          delete data[mediaId];
          setScopedJson("watch_progress", data);
        }
      }
      return jsonResponse({ success: true }, 200);
    }
    return null;
  }

  function handleMyListRequest(method, body) {
    var list = getScopedJson("myList_api", []);
    if (method === "GET") {
      return jsonResponse({ myList: list }, 200);
    }
    if (method === "POST") {
      var payload = safeParse(body, {});
      if (payload && payload.id && payload.mediaType && !list.some(function (item) {
        return item.id === payload.id && item.mediaType === payload.mediaType;
      })) {
        list = list.concat([{
          id: payload.id,
          mediaType: payload.mediaType,
          title: payload.title || "",
          addedAt: Date.now()
        }]);
        setScopedJson("myList_api", list);
      }
      return jsonResponse({ myList: list }, 200);
    }
    if (method === "DELETE") {
      var payloadToDelete = safeParse(body, {});
      list = list.filter(function (item) {
        return !(item.id === payloadToDelete.id && item.mediaType === payloadToDelete.mediaType);
      });
      setScopedJson("myList_api", list);
      return jsonResponse({ myList: list }, 200);
    }
    return null;
  }

  function requestBodyFromInit(init) {
    if (!init || init.body == null) return "";
    if (typeof init.body === "string") return init.body;
    if (init.body instanceof URLSearchParams) return init.body.toString();
    if (typeof FormData !== "undefined" && init.body instanceof FormData) {
      var object = {};
      init.body.forEach(function (value, key) {
        object[key] = value;
      });
      return JSON.stringify(object);
    }
    return "";
  }

  function installFetchInterceptor() {
    if (window.__flixerProfileFetchPatched || typeof window.fetch !== "function") return;
    window.__flixerProfileFetchPatched = true;

    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url ? input.url : "";
      var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (shouldInterceptProfileData()) {
        var body = requestBodyFromInit(init);
        if (isProgressEndpoint(url)) {
          var progressResponse = handleProgressRequest(method, url, body);
          if (progressResponse) return Promise.resolve(progressResponse);
        }
        if (isMyListEndpoint(url)) {
          var listResponse = handleMyListRequest(method, body);
          if (listResponse) return Promise.resolve(listResponse);
        }
      }
      return originalFetch(input, init);
    };
  }

  function installXhrInterceptor() {
    var proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto || proto.__flixerProfilePatched) return;
    proto.__flixerProfilePatched = true;

    var originalOpen = proto.open;
    var originalSend = proto.send;
    var originalSetRequestHeader = proto.setRequestHeader;

    proto.open = function (method, url) {
      this.__flixerProfileMethod = String(method || "GET").toUpperCase();
      this.__flixerProfileUrl = String(url || "");
      this.__flixerProfileHeaders = {};
      this.__flixerProfileIntercepted = false;
      return originalOpen.apply(this, arguments);
    };

    proto.setRequestHeader = function (header, value) {
      this.__flixerProfileHeaders = this.__flixerProfileHeaders || {};
      this.__flixerProfileHeaders[String(header || "")] = String(value || "");
      return originalSetRequestHeader.apply(this, arguments);
    };

    proto.send = function (body) {
      if (!shouldInterceptProfileData()) {
        return originalSend.apply(this, arguments);
      }

      var method = this.__flixerProfileMethod || "GET";
      var url = this.__flixerProfileUrl || "";
      var payload = typeof body === "string" ? body : "";
      var response = null;

      if (isProgressEndpoint(url)) {
        response = handleProgressRequest(method, url, payload);
      } else if (isMyListEndpoint(url)) {
        response = handleMyListRequest(method, payload);
      }

      if (!response) {
        return originalSend.apply(this, arguments);
      }

      var xhr = this;
      xhr.__flixerProfileIntercepted = true;
      Promise.resolve(response.text()).then(function (text) {
        Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 });
        Object.defineProperty(xhr, "status", { configurable: true, value: response.status });
        Object.defineProperty(xhr, "statusText", { configurable: true, value: "OK" });
        Object.defineProperty(xhr, "responseText", { configurable: true, value: text });
        Object.defineProperty(xhr, "response", { configurable: true, value: text });
        Object.defineProperty(xhr, "responseURL", { configurable: true, value: url });
        if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange(new Event("readystatechange"));
        xhr.dispatchEvent(new Event("readystatechange"));
        if (typeof xhr.onload === "function") xhr.onload(new Event("load"));
        xhr.dispatchEvent(new Event("load"));
        if (typeof xhr.onloadend === "function") xhr.onloadend(new Event("loadend"));
        xhr.dispatchEvent(new Event("loadend"));
      });
    };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initialsForProfile(profile) {
    var name = String(profile && profile.name || "P").trim();
    if (!name) return "P";
    var parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map(function (part) { return part.charAt(0).toUpperCase(); }).join("");
  }

  function profileAvatarMarkup(profile) {
    if (profile.avatarUrl) {
      return '<img src="' + escapeHtml(profile.avatarUrl) + '" alt="' + escapeHtml(profile.name) + '" />';
    }
    if (profile.isKids) {
      return '<span class="' + STYLE_SCOPE + '-avatar-label ' + STYLE_SCOPE + '-kids-label">kids</span>';
    }
    return '<span class="' + STYLE_SCOPE + '-avatar-label">' + escapeHtml(initialsForProfile(profile)) + "</span>";
  }

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    return root;
  }

  function closeOverlays() {
    state.chooserOpen = false;
    state.manageOpen = false;
    state.editingProfileId = null;
    render();
  }

  function adultRatingValue(rating) {
    var order = {
      G: 1,
      "TV-Y": 1,
      "TV-G": 1,
      PG: 2,
      "TV-Y7": 2,
      PG13: 3,
      "PG-13": 3,
      "TV-PG": 3,
      "TV-14": 4,
      "14A": 4,
      R: 5,
      MA15: 5,
      "18A": 5,
      NC17: 6,
      "NC-17": 6,
      "TV-MA": 6
    };
    return order[String(rating || "").toUpperCase()] || 999;
  }

  function normalizeRating(raw) {
    var rating = String(raw || "").trim().toUpperCase();
    if (!rating) return "";
    if (rating === "PG13") return "PG-13";
    if (rating === "NC17") return "NC-17";
    return rating;
  }

  function getRatingCache() {
    return readStorage(RATING_CACHE_KEY, {});
  }

  function setRatingCache(cache) {
    writeStorage(RATING_CACHE_KEY, cache);
  }

  function parseRatingFromResults(results) {
    if (!Array.isArray(results)) return "";
    var preferredCountries = ["US", "CA", "GB"];
    for (var i = 0; i < preferredCountries.length; i += 1) {
      var country = preferredCountries[i];
      for (var j = 0; j < results.length; j += 1) {
        var result = results[j];
        if (result.iso_3166_1 !== country) continue;
        var candidates = result.release_dates || result.ratings || [];
        if (!Array.isArray(candidates)) continue;
        for (var k = 0; k < candidates.length; k += 1) {
          var certification = normalizeRating(candidates[k].certification || candidates[k].rating);
          if (certification) return certification;
        }
      }
    }
    for (var n = 0; n < results.length; n += 1) {
      var item = results[n];
      var nested = item.release_dates || item.ratings || [];
      if (!Array.isArray(nested)) continue;
      for (var p = 0; p < nested.length; p += 1) {
        var nestedRating = normalizeRating(nested[p].certification || nested[p].rating);
        if (nestedRating) return nestedRating;
      }
    }
    return "";
  }

  async function fetchAgeRating(mediaType, mediaId) {
    var cache = getRatingCache();
    var cacheKey = String(mediaType) + ":" + String(mediaId);
    if (cache[cacheKey]) return cache[cacheKey];

    try {
      var endpoint = mediaType === "tv"
        ? "/api/tmdb/3/tv/" + mediaId + "/content_ratings?language=en-US"
        : "/api/tmdb/3/movie/" + mediaId + "/release_dates?language=en-US";
      var response = await window.fetch(endpoint, { credentials: "include" });
      if (!response.ok) return "";
      var json = await response.json();
      var rating = mediaType === "tv"
        ? parseRatingFromResults(json && json.results)
        : parseRatingFromResults(json && json.results);
      if (rating) {
        cache[cacheKey] = rating;
        setRatingCache(cache);
      }
      return rating;
    } catch (_error) {
      return "";
    }
  }

  function canAccessRating(profile, rating) {
    if (!profile || !profile.isKids) return true;
    if (!rating) return true;
    return adultRatingValue(rating) <= adultRatingValue(profile.maxRating);
  }

  function currentRouteMedia() {
    var path = window.location.pathname || "";
    var match = path.match(/^\/watch\/(movie|tv)\/(\d+)/);
    if (!match) return null;
    return {
      mediaType: match[1],
      mediaId: match[2]
    };
  }

  function showBlockedOverlay(profile, rating) {
    ensureRoot();
    var blockId = ROOT_ID + "-blocked";
    var existing = document.getElementById(blockId);
    if (existing) existing.remove();
    var node = document.createElement("div");
    node.id = blockId;
    node.className = STYLE_SCOPE + "-blocked";
    node.innerHTML =
      '<div class="' + STYLE_SCOPE + '-blocked-card">' +
      '<div class="' + STYLE_SCOPE + '-blocked-badge">Kids Profile</div>' +
      '<h2>This title is locked</h2>' +
      '<p>This profile is limited to ' + escapeHtml(profile.maxRating) + ' and below.' +
      (rating ? ' This title is rated ' + escapeHtml(rating) + "." : "") +
      "</p>" +
      '<div class="' + STYLE_SCOPE + '-blocked-actions">' +
      '<button type="button" data-profile-action="go-home">Back Home</button>' +
      '<button type="button" data-profile-action="switch-profile">Switch Profile</button>' +
      "</div>" +
      "</div>";
    ensureRoot().appendChild(node);
  }

  async function enforceKidsRouteGuard() {
    var profile = getActiveProfile();
    if (!profile || !profile.isKids || !getAccountMode(getAccountId())) return;
    var routeMedia = currentRouteMedia();
    if (!routeMedia) return;
    var rating = await fetchAgeRating(routeMedia.mediaType, routeMedia.mediaId);
    if (canAccessRating(profile, rating)) return;
    showBlockedOverlay(profile, rating);
  }

  async function promptForPin(profile) {
    if (!profile || !profile.pinSalt || !profile.pinHash) return true;
    var code = window.prompt("Enter the profile security code");
    if (typeof code !== "string" || !code.trim()) return false;
    return verifyPin(code.trim(), profile.pinSalt, profile.pinHash);
  }

  function bytesToBase64(bytes) {
    var binary = "";
    var array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < array.length; i += 1) {
      binary += String.fromCharCode(array[i]);
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function derivePinHash(pin, saltBytes) {
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle) throw new Error("Crypto unavailable");
    var keyMaterial = await subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    var bits = await subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PIN_ITERATIONS,
        salt: saltBytes
      },
      keyMaterial,
      256
    );
    return bytesToBase64(new Uint8Array(bits));
  }

  async function createPinRecord(pin) {
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var hash = await derivePinHash(pin, salt);
    return {
      pinSalt: bytesToBase64(salt),
      pinHash: hash
    };
  }

  async function verifyPin(pin, saltBase64, expectedHash) {
    try {
      var actual = await derivePinHash(pin, base64ToBytes(saltBase64));
      return actual === expectedHash;
    } catch (_error) {
      return false;
    }
  }

  function reloadForProfileChange() {
    window.location.reload();
  }

  async function selectProfile(profileId) {
    var accountId = getAccountId();
    if (!accountId) return;
    var profiles = normalizeProfiles(getProfilesForAccount(accountId), currentUser);
    var profile = profiles.find(function (item) { return item.id === profileId; });
    if (!profile) return;
    var allowed = await promptForPin(profile);
    if (!allowed) return;
    try {
      sessionStorage.setItem(STARTUP_SKIP_KEY, "1");
    } catch (_error) {}
    setStoredActiveProfileId(accountId, profile.id);
    closeOverlays();
    reloadForProfileChange();
  }

  function launchManageProfiles() {
    state.manageOpen = true;
    state.chooserOpen = false;
    state.view = "manage";
    render();
  }

  function launchChooser() {
    state.chooserOpen = true;
    state.manageOpen = false;
    state.view = "chooser";
    render();
  }

  function avatarOptionMarkup(profile, isActive) {
    return (
      '<button type="button" class="' + STYLE_SCOPE + '-card' + (isActive ? " is-active" : "") + '" data-profile-select="' + escapeHtml(profile.id) + '">' +
      '<span class="' + STYLE_SCOPE + '-avatar" style="background:' + escapeHtml(profile.color) + '">' + profileAvatarMarkup(profile) + "</span>" +
      '<span class="' + STYLE_SCOPE + '-name">' + escapeHtml(profile.name) + "</span>" +
      (profile.isKids ? '<span class="' + STYLE_SCOPE + '-tag">Kids</span>' : "") +
      "</button>"
    );
  }

  function createButtonMarkup() {
    return (
      '<button type="button" class="' + STYLE_SCOPE + '-card ' + STYLE_SCOPE + '-create" data-profile-action="create-profile">' +
      '<span class="' + STYLE_SCOPE + '-avatar ' + STYLE_SCOPE + '-avatar-plus"><span>+</span></span>' +
      '<span class="' + STYLE_SCOPE + '-name">Add Profile</span>' +
      "</button>"
    );
  }

  function renderChooser() {
    var activeProfile = getActiveProfile();
    var cards = state.profiles.map(function (profile) {
      return avatarOptionMarkup(profile, activeProfile && activeProfile.id === profile.id);
    }).join("");

    if (state.profiles.length < PROFILE_LIMIT) {
      cards += createButtonMarkup();
    }

    return (
      '<div class="' + STYLE_SCOPE + '-screen">' +
      '<div class="' + STYLE_SCOPE + '-chooser">' +
      '<h1>Who\'s watching?</h1>' +
      '<div class="' + STYLE_SCOPE + '-grid">' + cards + "</div>" +
      '<div class="' + STYLE_SCOPE + '-footer">' +
      '<button type="button" class="' + STYLE_SCOPE + '-secondary" data-profile-action="manage-profiles">Manage Profiles</button>' +
      '<button type="button" class="' + STYLE_SCOPE + '-ghost" data-profile-action="close">Close</button>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function profileFormDefaults(profile) {
    return {
      id: profile && profile.id || "",
      name: profile && profile.name || "",
      avatarUrl: profile && profile.avatarUrl || "",
      color: profile && profile.color || getInitialColor(state.profiles.length),
      isKids: !!(profile && profile.isKids),
      maxRating: profile && profile.maxRating || "PG",
      hasPin: !!(profile && profile.pinHash)
    };
  }

  function renderManage() {
    var editingProfile = state.profiles.find(function (profile) {
      return profile.id === state.editingProfileId;
    }) || null;
    var form = profileFormDefaults(editingProfile);
    var listMarkup = state.profiles.map(function (profile) {
      return (
        '<div class="' + STYLE_SCOPE + '-manage-row">' +
        '<div class="' + STYLE_SCOPE + '-manage-left">' +
        '<span class="' + STYLE_SCOPE + '-avatar" style="background:' + escapeHtml(profile.color) + '">' + profileAvatarMarkup(profile) + "</span>" +
        '<div>' +
        '<div class="' + STYLE_SCOPE + '-manage-name">' + escapeHtml(profile.name) + "</div>" +
        '<div class="' + STYLE_SCOPE + '-manage-meta">' +
        (profile.isKids ? "Kids profile" : "Standard profile") +
        (profile.pinHash ? " | Secured" : "") +
        (profile.isPrimary ? " | Default" : "") +
        "</div>" +
        "</div>" +
        "</div>" +
        '<div class="' + STYLE_SCOPE + '-manage-actions">' +
        '<button type="button" data-profile-edit="' + escapeHtml(profile.id) + '">Edit</button>' +
        (!profile.isPrimary ? '<button type="button" data-profile-delete="' + escapeHtml(profile.id) + '">Delete</button>' : "") +
        "</div>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="' + STYLE_SCOPE + '-screen">' +
      '<div class="' + STYLE_SCOPE + '-manage">' +
      '<div class="' + STYLE_SCOPE + '-manage-header">' +
      '<div>' +
      '<h2>Manage Profiles</h2>' +
      '<p>Turn on profile selection, add profiles, and set Kids restrictions.</p>' +
      "</div>" +
      '<button type="button" class="' + STYLE_SCOPE + '-ghost" data-profile-action="close">Done</button>' +
      "</div>" +
      '<div class="' + STYLE_SCOPE + '-settings-panel">' +
      '<label class="' + STYLE_SCOPE + '-toggle-row">' +
      '<span>' +
      '<strong>Profile selection on startup</strong>' +
      '<small>Only for signed-in accounts. When enabled, the app asks who\'s watching on every load.</small>' +
      "</span>" +
      '<input type="checkbox" data-profile-mode-toggle ' + (state.modeEnabled ? "checked" : "") + " />" +
      "</label>" +
      "</div>" +
      '<div class="' + STYLE_SCOPE + '-manage-columns">' +
      '<div class="' + STYLE_SCOPE + '-manage-list">' + listMarkup + "</div>" +
      '<form class="' + STYLE_SCOPE + '-profile-form" data-profile-form>' +
      '<h3>' + escapeHtml(editingProfile ? "Edit Profile" : "Create Profile") + "</h3>" +
      '<label>Name<input name="name" maxlength="20" value="' + escapeHtml(form.name) + '" required /></label>' +
      '<label>Avatar URL <input name="avatarUrl" value="' + escapeHtml(form.avatarUrl) + '" placeholder="Optional image URL" /></label>' +
      '<label>Color <input name="color" type="color" value="' + escapeHtml(form.color) + '" /></label>' +
      '<label class="' + STYLE_SCOPE + '-check-row"><input name="isKids" type="checkbox" ' + (form.isKids ? "checked" : "") + ' />Kids profile</label>' +
      '<label>Maximum rating<select name="maxRating">' +
      ["G", "PG", "PG-13", "TV-14", "R", "TV-MA"].map(function (rating) {
        return '<option value="' + rating + '" ' + (form.maxRating === rating ? "selected" : "") + ">" + rating + "</option>";
      }).join("") +
      "</select></label>" +
      '<label>Security code <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" placeholder="' + (form.hasPin ? "Leave blank to keep current code" : "Optional 4-8 digit code") + '" /></label>' +
      '<div class="' + STYLE_SCOPE + '-form-actions">' +
      '<button type="submit" class="' + STYLE_SCOPE + '-primary">' + escapeHtml(editingProfile ? "Save Profile" : "Create Profile") + "</button>" +
      '<button type="button" class="' + STYLE_SCOPE + '-secondary" data-profile-action="new-profile">New</button>' +
      "</div>" +
      (editingProfile ? '<input type="hidden" name="profileId" value="' + escapeHtml(editingProfile.id) + '" />' : "") +
      "</form>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderLauncher() {
    if (!currentUser || !getAccountMode(getAccountId())) return "";
    if (findAccountControl()) return "";
    var activeProfile = getActiveProfile();
    if (!activeProfile) return "";
    return (
      '<button type="button" class="' + STYLE_SCOPE + '-launcher" data-profile-action="open-chooser" aria-label="Profiles">' +
      '<span class="' + STYLE_SCOPE + '-launcher-avatar" style="background:' + escapeHtml(activeProfile.color) + '">' + profileAvatarMarkup(activeProfile) + "</span>" +
      '<span class="' + STYLE_SCOPE + '-launcher-name">' + escapeHtml(activeProfile.name) + "</span>" +
      "</button>"
    );
  }

  function render() {
    ensureRoot();
    var html = renderLauncher();
    if (state.chooserOpen) html += renderChooser();
    if (state.manageOpen) html += renderManage();
    root.innerHTML = html;
  }

  function syncStateFromStorage() {
    var accountId = getAccountId();
    state.modeEnabled = getAccountMode(accountId);
    state.profiles = normalizeProfiles(getProfilesForAccount(accountId), currentUser);
    setProfilesForAccount(accountId, state.profiles);
    state.activeProfileId = getStoredActiveProfileId(accountId);
    if (!state.activeProfileId && state.profiles[0]) {
      state.activeProfileId = state.profiles[0].id;
    }
  }

  function openStartupChooserIfNeeded() {
    if (!currentUser) return;
    syncStateFromStorage();
    if (state.modeEnabled) {
      var skipOnce = false;
      try {
        skipOnce = sessionStorage.getItem(STARTUP_SKIP_KEY) === "1";
        if (skipOnce) {
          sessionStorage.removeItem(STARTUP_SKIP_KEY);
        }
      } catch (_error) {}
      if (!skipOnce) {
        setStoredActiveProfileId(getAccountId(), "");
        state.activeProfileId = "";
        launchChooser();
        return;
      }
    }
    if (state.modeEnabled && !getStoredActiveProfileId(getAccountId())) {
      launchChooser();
      return;
    }
    render();
  }

  async function loadCurrentUser() {
    var token = currentToken();
    if (!token) {
      currentUser = null;
      render();
      return null;
    }

    try {
      var response = await nativeFetch("https://api.flixer.su/api/auth/profile", {
        headers: { Authorization: "Bearer " + token }
      });
      if (!response.ok) {
        currentUser = null;
        render();
        return null;
      }
      var json = await response.json();
      currentUser = json && json.user ? json.user : null;
      return currentUser;
    } catch (_error) {
      currentUser = null;
      return null;
    } finally {
      openStartupChooserIfNeeded();
    }
  }

  function findAccountControl() {
    if (!currentUser) return null;
    var header = document.querySelector("header");
    if (!(header instanceof HTMLElement)) return null;
    var username = String(currentUser.username || "").trim().toLowerCase();
    if (!username) return null;

    var best = null;
    var bestScore = Infinity;

    Array.from(header.querySelectorAll("button, a, div")).forEach(function (node) {
      if (!(node instanceof HTMLElement)) return;
      var text = String(node.textContent || "").trim().toLowerCase();
      if (!text || text.indexOf(username) === -1) return;
      var rect = node.getBoundingClientRect();
      if (rect.width < 40 || rect.width > 260 || rect.height < 20 || rect.height > 90) return;
      if (!node.querySelector("img") && !/^[a-z0-9 _-]+$/i.test(String(node.textContent || "").trim())) return;
      var score = Math.abs(window.innerWidth - rect.right) + Math.abs(rect.top) * 0.2;
      if (score < bestScore) {
        best = node;
        bestScore = score;
      }
    });

    return best;
  }

  function syncAccountControl() {
    var control = findAccountControl();
    if (!(control instanceof HTMLElement)) return;

    var activeProfile = getActiveProfile();
    var enabled = !!(activeProfile && getAccountMode(getAccountId()));
    var username = String(currentUser && currentUser.username || "").trim();

    if (!control.dataset.profileOriginalCursor) {
      control.dataset.profileOriginalCursor = control.style.cursor || "";
    }

    Array.from(control.querySelectorAll("span, div")).forEach(function (node) {
      if (!(node instanceof HTMLElement)) return;
      var text = String(node.textContent || "").trim();
      if (!text) return;
      if (text !== username && text !== control.dataset.profileOriginalName) return;
      if (!node.dataset.profileOriginalText) {
        node.dataset.profileOriginalText = text;
      }
      if (enabled && activeProfile) {
        node.textContent = activeProfile.name;
        control.dataset.profileOriginalName = node.dataset.profileOriginalText;
      } else if (node.dataset.profileOriginalText) {
        node.textContent = node.dataset.profileOriginalText;
      }
    });

    var image = control.querySelector("img");
    if (image instanceof HTMLImageElement) {
      if (!image.dataset.profileOriginalSrc) {
        image.dataset.profileOriginalSrc = image.getAttribute("src") || "";
      }
      if (enabled && activeProfile && activeProfile.avatarUrl) {
        image.src = activeProfile.avatarUrl;
      } else if (image.dataset.profileOriginalSrc) {
        image.src = image.dataset.profileOriginalSrc;
      }
    }

    if (enabled) {
      control.dataset.profileAction = "open-chooser";
      control.dataset.profileAccountBound = "1";
      control.style.cursor = "pointer";
      control.title = "Switch profiles";
    } else {
      delete control.dataset.profileAction;
      delete control.dataset.profileAccountBound;
      control.style.cursor = control.dataset.profileOriginalCursor || "";
      control.removeAttribute("title");
    }
  }

  function maybeInjectSettingsButton() {
    if (!currentUser) return;
    syncAccountControl();
    var candidates = Array.from(document.querySelectorAll("div, section")).filter(function (node) {
      if (!(node instanceof HTMLElement)) return false;
      if (node.dataset.profileModeInjected === "1") return false;
      if (!node.textContent) return false;
      return node.textContent.indexOf("Delete your local data") !== -1 ||
        node.textContent.indexOf("video player preferences") !== -1 ||
        node.textContent.indexOf("Settings") !== -1;
    });

    candidates.forEach(function (node) {
      node.dataset.profileModeInjected = "1";
      var panel = document.createElement("div");
      panel.className = STYLE_SCOPE + "-inline-settings";
      panel.innerHTML =
        '<div class="' + STYLE_SCOPE + '-inline-copy">' +
        '<strong>Profiles</strong>' +
        '<span>Enable profile selection and manage Kids restrictions.</span>' +
        "</div>" +
        '<div class="' + STYLE_SCOPE + '-inline-actions">' +
        '<label class="' + STYLE_SCOPE + '-inline-toggle">' +
        '<input type="checkbox" data-profile-inline-toggle ' + (state.modeEnabled ? "checked" : "") + " />" +
        "<span>Startup chooser</span>" +
        "</label>" +
        '<button type="button" data-profile-action="manage-profiles">Manage</button>' +
        "</div>";
      node.appendChild(panel);
    });
  }

  async function saveProfileFromForm(form) {
    var accountId = getAccountId();
    if (!accountId) return;
    var formData = new FormData(form);
    var profileId = String(formData.get("profileId") || "");
    var name = String(formData.get("name") || "").trim();
    var avatarUrl = String(formData.get("avatarUrl") || "").trim();
    var color = String(formData.get("color") || getInitialColor(state.profiles.length));
    var isKids = formData.get("isKids") === "on";
    var maxRating = String(formData.get("maxRating") || "PG");
    var pin = String(formData.get("pin") || "").trim();

    if (!name) return;

    var profiles = normalizeProfiles(getProfilesForAccount(accountId), currentUser);
    var existing = profileId ? profiles.find(function (profile) { return profile.id === profileId; }) : null;
    if (!existing && profiles.length >= PROFILE_LIMIT) return;

    var nextProfile = existing ? {
      id: existing.id,
      isPrimary: existing.isPrimary,
      pinSalt: existing.pinSalt,
      pinHash: existing.pinHash
    } : {
      id: randomId("profile"),
      isPrimary: false,
      pinSalt: "",
      pinHash: ""
    };

    nextProfile.name = name;
    nextProfile.avatarUrl = avatarUrl;
    nextProfile.color = color;
    nextProfile.isKids = isKids;
    nextProfile.maxRating = maxRating;

    if (pin) {
      if (!/^\d{4,8}$/.test(pin)) {
        window.alert("Security code must be 4 to 8 digits.");
        return;
      }
      var record = await createPinRecord(pin);
      nextProfile.pinSalt = record.pinSalt;
      nextProfile.pinHash = record.pinHash;
    }

    if (existing) {
      profiles = profiles.map(function (profile) {
        return profile.id === existing.id ? nextProfile : profile;
      });
    } else {
      profiles.push(nextProfile);
    }

    setProfilesForAccount(accountId, profiles);
    state.editingProfileId = nextProfile.id;
    syncStateFromStorage();
    render();
  }

  async function handleDeleteProfile(profileId) {
    var accountId = getAccountId();
    if (!accountId) return;
    var profiles = normalizeProfiles(getProfilesForAccount(accountId), currentUser);
    var target = profiles.find(function (profile) { return profile.id === profileId; });
    if (!target || target.isPrimary) return;
    var allowed = await promptForPin(target);
    if (!allowed) return;
    profiles = profiles.filter(function (profile) { return profile.id !== profileId; });
    setProfilesForAccount(accountId, profiles);
    if (getStoredActiveProfileId(accountId) === profileId) {
      setStoredActiveProfileId(accountId, "");
    }
    state.editingProfileId = null;
    syncStateFromStorage();
    render();
  }

  async function guardWatchNavigation(url) {
    var profile = getActiveProfile();
    if (!profile || !profile.isKids || !getAccountMode(getAccountId())) return true;
    var absolute = new URL(url, window.location.origin);
    var match = absolute.pathname.match(/^\/watch\/(movie|tv)\/(\d+)/);
    if (!match) return true;
    var rating = await fetchAgeRating(match[1], match[2]);
    if (canAccessRating(profile, rating)) return true;
    showBlockedOverlay(profile, rating);
    return false;
  }

  function installClickGuards() {
    document.addEventListener("click", function (event) {
      var actionTarget = event.target && event.target.closest("[data-profile-action],[data-profile-select],[data-profile-edit],[data-profile-delete]");
      if (actionTarget) {
        event.preventDefault();
        event.stopPropagation();
      }

      var selectId = actionTarget && actionTarget.getAttribute("data-profile-select");
      if (selectId) {
        selectProfile(selectId);
        return;
      }

      var editId = actionTarget && actionTarget.getAttribute("data-profile-edit");
      if (editId) {
        state.editingProfileId = editId;
        render();
        return;
      }

      var deleteId = actionTarget && actionTarget.getAttribute("data-profile-delete");
      if (deleteId) {
        handleDeleteProfile(deleteId);
        return;
      }

      var action = actionTarget && actionTarget.getAttribute("data-profile-action");
      if (action === "manage-profiles") {
        launchManageProfiles();
        return;
      }
      if (action === "open-chooser" || action === "switch-profile") {
        launchChooser();
        return;
      }
      if (action === "create-profile" || action === "new-profile") {
        state.editingProfileId = null;
        state.manageOpen = true;
        state.chooserOpen = false;
        render();
        return;
      }
      if (action === "close") {
        closeOverlays();
        return;
      }
      if (action === "go-home") {
        window.location.href = "/";
        return;
      }

      var anchor = event.target && event.target.closest("a[href]");
      if (!anchor) return;
      var href = anchor.getAttribute("href");
      if (!href || href.indexOf("/watch/") !== 0) return;
      event.preventDefault();
      guardWatchNavigation(href).then(function (allowed) {
        if (allowed) {
          window.location.href = href;
        }
      });
    }, true);

    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-profile-form")) return;
      event.preventDefault();
      saveProfileFromForm(form);
    });

    document.addEventListener("change", function (event) {
      var target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.hasAttribute("data-profile-mode-toggle") || target.hasAttribute("data-profile-inline-toggle")) {
        var accountId = getAccountId();
        setAccountMode(accountId, !!target.checked);
        if (!target.checked) {
          setStoredActiveProfileId(accountId, "");
          state.modeEnabled = false;
          closeOverlays();
          reloadForProfileChange();
          return;
        }
        state.modeEnabled = true;
        state.chooserOpen = true;
        render();
      }
    });
  }

  function installObservers() {
    var observer = new MutationObserver(function () {
      maybeInjectSettingsButton();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function handleAuthChange() {
    loadCurrentUser().then(function () {
      syncStateFromStorage();
      seedProfileDataIfNeeded().then(function () {
        syncAccountControl();
      });
      render();
      enforceKidsRouteGuard();
    });
  }

  function boot() {
    installStorageNamespace();
    installFetchInterceptor();
    installXhrInterceptor();
    installClickGuards();
    installObservers();
    handleAuthChange();
    window.addEventListener("auth-state-change", handleAuthChange);
    window.addEventListener("popstate", function () {
      window.setTimeout(enforceKidsRouteGuard, 60);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}());
