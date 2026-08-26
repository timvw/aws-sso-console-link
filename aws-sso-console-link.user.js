// ==UserScript==
// @name         AWS SSO-safe console links
// @namespace    https://github.com/timvw/aws-sso-console-link
// @version      0.1.0
// @description  Copy the current AWS Console URL wrapped in the active account and IAM Identity Center role.
// @homepageURL  https://github.com/timvw/aws-sso-console-link
// @supportURL   https://github.com/timvw/aws-sso-console-link/issues
// @match        https://console.aws.amazon.com/*
// @match        https://*.console.aws.amazon.com/*
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
  const BUTTON_HOST_ID = "aws-sso-console-link-userscript";

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

  function configurePortalUrl() {
    const current = GM_getValue(PORTAL_STORAGE_KEY, "");
    const value = window.prompt(
      "Enter your AWS IAM Identity Center access portal URL:",
      current || "https://example.awsapps.com/start",
    );
    if (value === null) {
      throw new Error("AWS access portal configuration was cancelled.");
    }

    const normalized = normalizePortalUrl(value);
    GM_setValue(PORTAL_STORAGE_KEY, normalized);
    return normalized;
  }

  function getPortalUrl() {
    const configured = GM_getValue(PORTAL_STORAGE_KEY, "");
    return configured ? normalizePortalUrl(configured) : configurePortalUrl();
  }

  function buildSsoUrl({ portalUrl, accountId, roleName, destination }) {
    if (!/^\d{12}$/.test(accountId || "")) {
      throw new Error("Could not determine the 12-digit AWS account ID.");
    }
    if (!roleName) {
      throw new Error("Could not determine the IAM Identity Center role.");
    }

    const destinationUrl = new URL(destination);
    const isAwsConsole =
      destinationUrl.protocol === "https:" &&
      (destinationUrl.hostname === "console.aws.amazon.com" ||
        destinationUrl.hostname.endsWith(".console.aws.amazon.com"));
    if (!isAwsConsole) {
      throw new Error("The current page is not an AWS Console URL.");
    }

    const params = new URLSearchParams({
      account_id: accountId,
      role_name: roleName,
      destination: destinationUrl.href,
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

  async function readCurrentIdentity() {
    const accountControl = findAccountControl();
    if (!accountControl) {
      throw new Error("Could not find the AWS account control.");
    }

    let accountMenu = document.querySelector(ACCOUNT_MENU_SELECTOR);
    let identity = extractIdentity(
      collectIdentityTexts(accountControl, accountMenu),
    );
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

  function setButtonState(button, label, kind = "normal") {
    button.textContent = label;
    button.dataset.kind = kind;

    clearTimeout(button.resetTimer);
    button.resetTimer = setTimeout(() => {
      button.textContent = "Copy SSO link";
      button.dataset.kind = "normal";
    }, 3000);
  }

  async function copyCurrentSsoUrl(button) {
    if (button.disabled) return;
    button.disabled = true;

    try {
      setButtonState(button, "Reading AWS identity…");
      const portalUrl = getPortalUrl();
      const identity = await readCurrentIdentity();
      const url = buildSsoUrl({
        portalUrl,
        ...identity,
        destination: window.location.href,
      });

      GM_setClipboard(url, "text");
      setButtonState(
        button,
        `Copied ${identity.accountId} / ${identity.roleName}`,
        "success",
      );
    } catch (error) {
      console.error("AWS SSO link userscript:", error);
      setButtonState(button, error.message || "Could not copy SSO link", "error");
    } finally {
      button.disabled = false;
    }
  }

  function addCopyButton() {
    if (document.getElementById(BUTTON_HOST_ID)) return;

    const host = document.createElement("div");
    host.id = BUTTON_HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
        }
        button {
          appearance: none;
          background: #ec7211;
          border: 1px solid #9d4b00;
          border-radius: 16px;
          box-shadow: 0 2px 8px rgb(0 0 0 / 28%);
          color: #16191f;
          cursor: pointer;
          font: 600 13px/30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          max-width: 360px;
          min-height: 32px;
          padding: 0 14px;
        }
        button:hover { background: #f8991d; }
        button:disabled { cursor: wait; opacity: 0.9; }
        button[data-kind="success"] { background: #2ea043; color: white; }
        button[data-kind="error"] { background: #d13212; color: white; }
      </style>
      <button type="button" title="Copy a link that signs in with this AWS account and role">Copy SSO link</button>
    `;

    const button = shadow.querySelector("button");
    button.addEventListener("click", () => copyCurrentSsoUrl(button));
    document.body.appendChild(host);

    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("Copy role-safe AWS link", () =>
        copyCurrentSsoUrl(button),
      );
      GM_registerMenuCommand("Configure AWS access portal", () => {
        try {
          const portalUrl = configurePortalUrl();
          setButtonState(
            button,
            `Portal: ${new URL(portalUrl).hostname}`,
            "success",
          );
        } catch (error) {
          setButtonState(
            button,
            error.message || "Could not configure portal",
            "error",
          );
        }
      });
    }
  }

  const api = {
    buildSsoUrl,
    extractIdentity,
    extractPermissionSetName,
    normalizePortalUrl,
    normalizeAccountId,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  if (document.body) {
    addCopyButton();
  } else {
    window.addEventListener("DOMContentLoaded", addCopyButton, { once: true });
  }
})();
