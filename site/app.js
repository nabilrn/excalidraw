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
    // Static v0.2.2 URLs remain valid if GitHub's public API is unavailable.
  }
}

hydrateLatestRelease();
