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

const toast = document.querySelector('.toast');
let toastTimer;

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const value = button.dataset.copy;
    try {
      await navigator.clipboard.writeText(value);
      if (!toast) return;
      toast.textContent = `Copied ${value}`;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
    } catch {
      // Clipboard access can be blocked in some embedded browsers; the token remains visible.
    }
  });
});
