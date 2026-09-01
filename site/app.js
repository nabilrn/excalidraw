const navLinks = [...document.querySelectorAll('.topnav a')];
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;

    navLinks.forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`);
    });
  },
  { rootMargin: '-35% 0px -55% 0px', threshold: [0, 0.2, 0.5, 1] },
);

sections.forEach((section) => observer.observe(section));

const formatMb = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;

async function hydrateLatestRelease() {
  try {
    const response = await fetch('https://api.github.com/repos/nabilrn/excalidraw/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;

    const release = await response.json();
    const exe = release.assets?.find((asset) => asset.name.toLowerCase().endsWith('.exe'));
    const msi = release.assets?.find((asset) => asset.name.toLowerCase().endsWith('.msi'));

    document.querySelectorAll('.release-version').forEach((node) => {
      node.textContent = release.tag_name || node.textContent;
    });

    if (exe) {
      document.querySelectorAll('.download-exe').forEach((link) => {
        link.href = exe.browser_download_url;
      });
      const meta = document.querySelector('.exe-meta');
      if (meta) meta.textContent = `Windows x64 · EXE · ${formatMb(exe.size)}`;
    }

    if (msi) {
      document.querySelectorAll('.download-msi').forEach((link) => {
        link.href = msi.browser_download_url;
      });
    }
  } catch {
    // Static v0.2.1 URLs remain valid if GitHub's public API is unavailable.
  }
}

hydrateLatestRelease();

const PRIVACY_NOTICE_KEY = 'focuscanvas_privacy_notice_v1';

function installPrivacyNotice() {
  const style = document.createElement('style');
  style.textContent = `
    .privacy-banner {
      position: fixed;
      z-index: 200;
      right: 18px;
      bottom: 18px;
      width: min(430px, calc(100vw - 36px));
      padding: 17px;
      border: 1px solid #111;
      border-radius: 4px 7px 5px 8px / 7px 4px 8px 5px;
      background: #fff;
      box-shadow: 7px 9px 0 rgb(0 0 0 / .07);
      color: #111;
      font-family: "Patrick Hand", ui-rounded, system-ui, sans-serif;
    }
    .privacy-banner[hidden] { display: none; }
    .privacy-banner__kicker {
      margin: 0 0 4px;
      color: #999;
      font-size: 10px;
      letter-spacing: .09em;
    }
    .privacy-banner h2 {
      margin: 0;
      font-family: "Caveat", cursive;
      font-size: 26px;
      line-height: 1;
    }
    .privacy-banner p {
      margin: 9px 0 0;
      color: #555;
      font-size: 13px;
      line-height: 1.45;
    }
    .privacy-banner__details {
      margin-top: 11px;
      padding-top: 10px;
      border-top: 1px dashed #ccc;
      color: #777;
      font-size: 11px;
      line-height: 1.45;
    }
    .privacy-banner__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 14px;
    }
    .privacy-banner button {
      min-height: 31px;
      padding: 0 12px;
      border: 1px solid #ccc;
      border-radius: 3px 5px 4px 6px / 5px 3px 6px 4px;
      background: #fff;
      color: #111;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .privacy-banner button:hover { background: #f7f7f7; }
    .privacy-banner .privacy-banner__accept {
      border-color: #111;
      background: #111;
      color: #fff;
    }
    .privacy-banner .privacy-banner__accept:hover { background: #292929; }
    .privacy-link {
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .privacy-link:hover { color: #111; }
    @media (max-width: 720px) {
      .privacy-banner {
        right: 14px;
        bottom: 14px;
        width: calc(100vw - 28px);
      }
    }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('aside');
  banner.className = 'privacy-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-label', 'Cookies and privacy');
  banner.innerHTML = `
    <p class="privacy-banner__kicker">PRIVACY</p>
    <h2>Cookies & privacy</h2>
    <p>FocusCanvas does not use analytics or advertising cookies. This site only loads Google Fonts and reads public GitHub release metadata so the download button stays current.</p>
    <div class="privacy-banner__details" hidden>
      One local browser preference is stored to remember that you dismissed this notice. It is not used for tracking, profiling, advertising, or analytics.
    </div>
    <div class="privacy-banner__actions">
      <button type="button" class="privacy-banner__accept">Got it</button>
      <button type="button" class="privacy-banner__toggle">Privacy details</button>
    </div>
  `;

  const details = banner.querySelector('.privacy-banner__details');
  const toggle = banner.querySelector('.privacy-banner__toggle');
  const accept = banner.querySelector('.privacy-banner__accept');

  toggle?.addEventListener('click', () => {
    const opening = details?.hasAttribute('hidden');
    details?.toggleAttribute('hidden');
    toggle.textContent = opening ? 'Hide details' : 'Privacy details';
  });

  accept?.addEventListener('click', () => {
    try {
      localStorage.setItem(PRIVACY_NOTICE_KEY, 'dismissed');
    } catch {
      // The notice can still be dismissed for this page load when storage is unavailable.
    }
    banner.hidden = true;
  });

  document.body.appendChild(banner);

  try {
    banner.hidden = localStorage.getItem(PRIVACY_NOTICE_KEY) === 'dismissed';
  } catch {
    banner.hidden = false;
  }

  const footer = document.querySelector('.footer');
  if (footer) {
    const privacyLink = document.createElement('button');
    privacyLink.type = 'button';
    privacyLink.className = 'privacy-link';
    privacyLink.textContent = 'Privacy';
    privacyLink.addEventListener('click', () => {
      banner.hidden = false;
      banner.querySelector('.privacy-banner__accept')?.focus();
    });
    footer.appendChild(privacyLink);
  }
}

installPrivacyNotice();
