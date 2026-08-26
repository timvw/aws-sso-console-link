// ==UserScript==
// @name         AWS SSO-safe console links
// @namespace    https://github.com/timvw/aws-sso-console-link
// @version      0.4.0
// @description  Add SSO-enabled companion links to AWS Console pages.
// @homepageURL  https://github.com/timvw/aws-sso-console-link
// @supportURL   https://github.com/timvw/aws-sso-console-link/issues
// @match        https://console.aws.amazon.com/*
// @match        https://*.console.aws.amazon.com/*
// @match        https://*.awsapps.com/start*
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const PORTAL_STORAGE_KEY = "ssoPortalUrl";
  const ACCOUNT_CONTROL_SELECTORS = [
    '[data-testid="awsc-nav-account-menu-button"]',
    '[data-testid="more-menu__awsc-nav-account-menu-button"]',
  ];
  const ACCOUNT_MENU_SELECTOR = '[data-testid="account-detail-menu"]';
  const FEEDBACK_HOST_ID = "aws-sso-console-link-feedback";
  const LINK_HOST_ID = "aws-sso-console-link-anchor";
  const COMPANION_HOST_ATTRIBUTE = "data-aws-sso-link-companion";
  const decoratedLinks = new WeakMap();
  let copyInProgress = false;
  let identityReadPromise = null;

  function normalizeAccountId(value) {
    if (!value) return null;

    const labelled = value.match(
      /Account ID\s*([0-9]{4}(?:-?[0-9]{4}){2})/i,
    );
    const parenthesized = value.match(/\(([0-9]{12})\)/);
    const generic = value.match(
      /(?:^|[^0-9])([0-9]{4}(?:-?[0-9]{4}){2})(?![0-9])/,
    );
    const match = labelled || parenthesized || generic;

    return match ? match[1].replace(/-/g, "") : null;
  }

  function extractPermissionSetName(value) {
    if (!value) return null;

    const generatedRole = value.match(
      /AWSReservedSSO_(.+)_[0-9a-f]{16}\/[^\s/]+/i,
    );
    if (generatedRole) return generatedRole[1];

    const displayRole = value.match(
      /(?:^|\s)([A-Za-z0-9+=,.@_-]+)\/[^\s/]+(?:\s|$)/,
    );
    return displayRole ? displayRole[1] : null;
  }

  function extractIdentity(texts) {
    const values = texts.filter(Boolean);
    const accountId = values.map(normalizeAccountId).find(Boolean) || null;
    const roleName =
      values.map(extractPermissionSetName).find(Boolean) || null;

    return { accountId, roleName };
  }

  function normalizePortalUrl(value) {
    if (!value) {
      throw new Error("Configure your AWS access portal URL first.");
    }

    const portalUrl = new URL(value.trim());
    const isAccessPortal =
      portalUrl.protocol === "https:" &&
      portalUrl.hostname.endsWith(".awsapps.com") &&
      portalUrl.pathname.replace(/\/+$/, "") === "/start";
    if (!isAccessPortal) {
      throw new Error(
        "The access portal must look like https://example.awsapps.com/start.",
      );
    }

    return `${portalUrl.origin}/start`;
  }

  function accessPortalUrlFromLocation(value) {
    try {
      return normalizePortalUrl(value);
    } catch {
      return null;
    }
  }

  function configurePortalUrl() {
    const current = GM_getValue(PORTAL_STORAGE_KEY, "");
    const value = window.prompt(
      "One-time setup: enter your AWS IAM Identity Center access portal URL.\n\nThe current AWS Console URL is detected automatically.",
      current || "https://example.awsapps.com/start",
    );
    if (value === null) {
      throw new Error("AWS access portal configuration was cancelled.");
    }

    const normalized = normalizePortalUrl(value);
    GM_setValue(PORTAL_STORAGE_KEY, normalized);
    return normalized;
  }

  function getConfiguredPortalUrl() {
    const configured = GM_getValue(PORTAL_STORAGE_KEY, "");
    return configured ? normalizePortalUrl(configured) : null;
  }

  function getPortalUrl() {
    return getConfiguredPortalUrl() || configurePortalUrl();
  }

  function normalizeAwsConsoleDestination(value, baseUrl) {
    try {
      const destinationUrl = baseUrl
        ? new URL(value, baseUrl)
        : new URL(value);
      const isAwsConsole =
        destinationUrl.protocol === "https:" &&
        (destinationUrl.hostname === "console.aws.amazon.com" ||
          destinationUrl.hostname.endsWith(".console.aws.amazon.com"));
      return isAwsConsole ? destinationUrl.href : null;
    } catch {
      return null;
    }
  }

  function buildSsoUrl({ portalUrl, accountId, roleName, destination }) {
    if (!/^\d{12}$/.test(accountId || "")) {
      throw new Error("Could not determine the 12-digit AWS account ID.");
    }
    if (!roleName) {
      throw new Error("Could not determine the IAM Identity Center role.");
    }

    const destinationUrl = normalizeAwsConsoleDestination(destination);
    if (!destinationUrl) {
      throw new Error("The current page is not an AWS Console URL.");
    }

    const params = new URLSearchParams({
      account_id: accountId,
      role_name: roleName,
      destination: destinationUrl,
    });

    return `${normalizePortalUrl(portalUrl)}/#/console?${params}`;
  }

  function isVisible(element) {
    return Boolean(element && element.getClientRects().length);
  }

  function findAccountControl() {
    let fallback = null;
    for (const selector of ACCOUNT_CONTROL_SELECTORS) {
      const element = document.querySelector(selector);
      if (!fallback && element) fallback = element;
      if (isVisible(element)) return element;
    }
    return fallback;
  }

  function collectIdentityTexts(accountControl, accountMenu) {
    const elements = [accountControl, accountMenu].filter(Boolean);
    const texts = [];

    for (const element of elements) {
      texts.push(element.textContent, element.getAttribute("title"));
      for (const titledElement of element.querySelectorAll("[title]")) {
        texts.push(titledElement.getAttribute("title"));
      }
    }

    return texts;
  }

  function readAvailableIdentity() {
    const accountControl = findAccountControl();
    const accountMenu = document.querySelector(ACCOUNT_MENU_SELECTOR);
    return {
      accountControl,
      identity: extractIdentity(
        collectIdentityTexts(accountControl, accountMenu),
      ),
    };
  }

  function waitForVisibleElement(selector, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (isVisible(existing)) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (isVisible(element)) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve(element);
        }
      });

      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Could not open the AWS account menu."));
      }, timeoutMs);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    });
  }

  async function readCurrentIdentityFromPage() {
    const available = readAvailableIdentity();
    const accountControl = available.accountControl;
    if (!accountControl) {
      throw new Error("Could not find the AWS account control.");
    }

    let accountMenu = document.querySelector(ACCOUNT_MENU_SELECTOR);
    let identity = available.identity;
    let openedMenu = false;

    if (!identity.accountId || !identity.roleName) {
      const clickable = accountControl.closest("button") || accountControl;
      const menuWasOpen = isVisible(accountMenu);

      if (!menuWasOpen) {
        clickable.click();
        openedMenu = true;
      }

      try {
        accountMenu = await waitForVisibleElement(ACCOUNT_MENU_SELECTOR);
        identity = extractIdentity(
          collectIdentityTexts(accountControl, accountMenu),
        );
      } finally {
        if (openedMenu) clickable.click();
      }
    }

    if (!identity.accountId) {
      throw new Error("Could not read the AWS account ID from the account menu.");
    }
    if (!identity.roleName) {
      throw new Error("Could not read the active IAM Identity Center role.");
    }

    return identity;
  }

  function readCurrentIdentity() {
    const available = readAvailableIdentity().identity;
    if (available.accountId && available.roleName) {
      return Promise.resolve(available);
    }

    if (!identityReadPromise) {
      identityReadPromise = readCurrentIdentityFromPage().finally(() => {
        identityReadPromise = null;
      });
    }
    return identityReadPromise;
  }

  function showFeedback(message, kind = "success") {
    document.getElementById(FEEDBACK_HOST_ID)?.remove();

    const host = document.createElement("div");
    host.id = FEEDBACK_HOST_ID;
    const shadow = host.attachShadow({ mode: "closed" });
    const notice = document.createElement("div");
    notice.textContent = message;
    notice.setAttribute("role", kind === "error" ? "alert" : "status");
    notice.style.cssText = `
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      max-width: 420px;
      padding: 10px 14px;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgb(0 0 0 / 28%);
      background: ${kind === "error" ? "#d13212" : "#2ea043"};
      color: white;
      font: 600 13px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;
    shadow.appendChild(notice);
    document.documentElement.appendChild(host);
    window.setTimeout(() => host.remove(), 3000);
  }

  async function copyCurrentSsoUrl() {
    if (copyInProgress) return;
    copyInProgress = true;

    try {
      const portalUrl = getPortalUrl();
      const identity = await readCurrentIdentity();
      const url = buildSsoUrl({
        portalUrl,
        ...identity,
        destination: window.location.href,
      });

      GM_setClipboard(url, "text");
      showFeedback(`SSO link copied (${identity.roleName})`);
    } catch (error) {
      console.error("AWS SSO link userscript:", error);
      showFeedback(error.message || "Could not copy SSO link", "error");
    } finally {
      copyInProgress = false;
    }
  }

  function setSsoLinkReady(link, url, identity, destination) {
    link.href = url;
    link.dataset.destination = destination;
    link.dataset.state = "ready";
    link.title = `Open or copy this AWS link through ${identity.roleName}`;
  }

  async function refreshSsoLink(
    link,
    destinationProvider,
    configureIfMissing = false,
  ) {
    const destination = normalizeAwsConsoleDestination(
      destinationProvider(),
      window.location.href,
    );

    try {
      if (!destination) {
        throw new Error("This is not an AWS Console link.");
      }
      const portalUrl = configureIfMissing
        ? getPortalUrl()
        : getConfiguredPortalUrl();
      if (!portalUrl) {
        link.removeAttribute("href");
        link.dataset.state = "unconfigured";
        link.title =
          "Visit your AWS access portal once, or configure it from the Violentmonkey menu";
        return null;
      }

      const available = readAvailableIdentity();
      let identity = available.identity;

      if (identity.accountId && identity.roleName) {
        const url = buildSsoUrl({ portalUrl, ...identity, destination });
        setSsoLinkReady(link, url, identity, destination);
        return url;
      }

      link.dataset.state = "loading";
      link.title = "Preparing SSO link…";
      identity = await readCurrentIdentity();
      const url = buildSsoUrl({ portalUrl, ...identity, destination });
      setSsoLinkReady(link, url, identity, destination);
      return url;
    } catch (error) {
      console.error("AWS SSO link userscript:", error);
      link.removeAttribute("href");
      link.dataset.state = "error";
      link.title = error.message || "Could not prepare SSO link";
      return null;
    }
  }

  function wireSsoLink(link, destinationProvider) {
    const update = () => refreshSsoLink(link, destinationProvider);
    link.addEventListener("pointerenter", update);
    link.addEventListener("focus", update);
    link.addEventListener("pointerdown", update);
    link.addEventListener("contextmenu", update);
    link.addEventListener("click", (event) => {
      const expectedDestination = normalizeAwsConsoleDestination(
        destinationProvider(),
        window.location.href,
      );
      const refresh = refreshSsoLink(link, destinationProvider, true);
      const isReady =
        link.hasAttribute("href") &&
        link.dataset.destination === expectedDestination;
      if (isReady) return;

      event.preventDefault();
      refresh.then((url) => {
        if (url) showFeedback("SSO link is ready—click it again to open it");
      });
    });

    update();
  }

  function createSsoLink() {
    if (document.getElementById(LINK_HOST_ID)) return true;

    const accountControl = findAccountControl();
    const insertionPoint =
      accountControl?.closest("button") || accountControl;
    if (!insertionPoint?.parentElement) return false;

    const host = document.createElement("span");
    host.id = LINK_HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          align-self: stretch;
          display: inline-flex;
        }
        a {
          align-items: center;
          border-inline-end: 1px solid rgb(255 255 255 / 24%);
          color: #fff;
          display: inline-flex;
          font: 600 13px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 0 12px;
          text-decoration: none;
          white-space: nowrap;
        }
        a:hover, a:focus-visible {
          background: rgb(255 255 255 / 12%);
          text-decoration: underline;
        }
        a[data-state="loading"], a[data-state="unconfigured"] {
          color: #d5dbdb;
        }
        a[data-state="error"] {
          color: #ffb3a7;
        }
      </style>
      <a data-state="loading" target="_blank" rel="noopener noreferrer">SSO link</a>
    `;

    const link = shadow.querySelector("a");
    wireSsoLink(link, () => window.location.href);

    insertionPoint.parentElement.insertBefore(host, insertionPoint);
    return true;
  }

  function isContentConsoleLink(link) {
    if (
      !link.hasAttribute("href") ||
      link.closest("header, nav, [role='navigation']")
    ) {
      return false;
    }

    const label =
      link.textContent?.trim() ||
      link.getAttribute("aria-label") ||
      link.getAttribute("title");
    if (!label) return false;

    const destination = normalizeAwsConsoleDestination(
      link.getAttribute("href"),
      window.location.href,
    );
    return Boolean(destination && destination !== window.location.href);
  }

  function createCompanionLink(sourceLink) {
    const existing = decoratedLinks.get(sourceLink);
    if (existing) {
      if (!existing.isConnected) sourceLink.after(existing);
      return;
    }

    const host = document.createElement("span");
    host.setAttribute(COMPANION_HOST_ATTRIBUTE, "");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          margin-inline-start: 6px;
          vertical-align: baseline;
        }
        a {
          border: 1px solid currentColor;
          border-radius: 3px;
          color: #0972d3;
          font: 700 10px/14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 0 3px;
          text-decoration: none;
        }
        a:hover, a:focus-visible {
          background: #e9f3ff;
          text-decoration: underline;
        }
        a[data-state="loading"], a[data-state="unconfigured"] {
          color: #687078;
        }
        a[data-state="error"] {
          color: #d13212;
        }
      </style>
      <a data-state="loading" target="_blank" rel="noopener noreferrer" aria-label="SSO-enabled version of this link">SSO</a>
    `;

    const ssoLink = shadow.querySelector("a");
    const destinationProvider = () => sourceLink.getAttribute("href");
    const update = () => refreshSsoLink(ssoLink, destinationProvider);
    sourceLink.addEventListener("pointerenter", update);
    sourceLink.addEventListener("focus", update);
    wireSsoLink(ssoLink, destinationProvider);

    sourceLink.after(host);
    decoratedLinks.set(sourceLink, host);
  }

  function decorateContentLinks() {
    const contentRoots = [...document.querySelectorAll("main, [role='main']")];
    const roots = contentRoots.length ? contentRoots : [document.body];
    const links = new Set();
    for (const root of roots) {
      for (const link of root?.querySelectorAll("a[href]") || []) {
        links.add(link);
      }
    }

    for (const link of links) {
      if (isContentConsoleLink(link)) createCompanionLink(link);
    }
  }

  function enhanceConsolePage() {
    createSsoLink();
    decorateContentLinks();

    let updateScheduled = false;
    const observer = new MutationObserver(() => {
      if (updateScheduled) return;
      updateScheduled = true;
      window.setTimeout(() => {
        updateScheduled = false;
        createSsoLink();
        decorateContentLinks();
      }, 100);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function registerActions() {
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand(
        "Copy SSO link for current page",
        copyCurrentSsoUrl,
      );
      GM_registerMenuCommand("Configure AWS access portal", () => {
        try {
          const portalUrl = configurePortalUrl();
          showFeedback(`Portal configured: ${new URL(portalUrl).hostname}`);
        } catch (error) {
          showFeedback(
            error.message || "Could not configure portal",
            "error",
          );
        }
      });
    }

    document.addEventListener(
      "keydown",
      (event) => {
        const isCopyShortcut =
          event.altKey &&
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          event.code === "KeyS";
        if (!isCopyShortcut || event.repeat) return;

        event.preventDefault();
        event.stopPropagation();
        copyCurrentSsoUrl();
      },
      true,
    );
  }

  const api = {
    accessPortalUrlFromLocation,
    buildSsoUrl,
    extractIdentity,
    extractPermissionSetName,
    normalizeAwsConsoleDestination,
    normalizePortalUrl,
    normalizeAccountId,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  const accessPortalUrl = accessPortalUrlFromLocation(window.location.href);
  if (accessPortalUrl) {
    GM_setValue(PORTAL_STORAGE_KEY, accessPortalUrl);
    return;
  }

  registerActions();
  enhanceConsolePage();
})();
